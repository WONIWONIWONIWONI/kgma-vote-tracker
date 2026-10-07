"""Verify the deployed mobile dashboard against the public record feed and UI assets."""
from datetime import datetime
import json
from pathlib import Path
import struct
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'collector'))
from collect import KST, load_public_snapshot, utc_now
from playwright.sync_api import sync_playwright

SITE = 'https://woniwoniwoniwoni.github.io/kgma-vote-tracker/'


def emit(label, value):
    print(label + ' ' + json.dumps(value, ensure_ascii=False), flush=True)


source = load_public_snapshot()
emit('PUBLIC_SOURCE', {'now': utc_now(), 'sourceAt': source['sourceAt'],
                       'totalVotes': source['totalVotes']})
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True,
                                  locale='ko-KR', timezone_id='Asia/Seoul')
    page = context.new_page()
    errors, records = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: records.append(response)
            if urlsplit(response.url).netloc == 'raw.githubusercontent.com' else None)
    page.goto(SITE, wait_until='networkidle')
    page.wait_for_function("document.querySelector('#history-details')!==null")
    assert records and records[-1].ok, 'Initial public record fetch failed'
    with page.expect_response(lambda response: 'raw.githubusercontent.com' in response.url
                              and '/latest.json?' in response.url) as refreshed:
        page.locator('#refresh-button').click()
    response = refreshed.value
    assert response.ok, response.status
    assert 'v=' in urlsplit(response.url).query, 'Fresh record URL required'
    recent = response.json()
    assert recent['schemaVersion'] == 2
    assert all('top3' not in row and len(row['top2']) == 2 for row in recent['snapshots'])
    latest = recent['snapshots'][-1]
    expected = datetime.fromisoformat(latest['sourceAt'].replace('Z', '+00:00'))
    expected_text = expected.astimezone(KST).strftime('%Y.%m.%d %H:%M')
    page.wait_for_function("expected => document.querySelector('#source-time').textContent === expected", arg=expected_text)
    metrics = page.evaluate("""() => ({
      source:document.querySelector('#source-time').textContent,
      collected:document.querySelector('#collected-time').textContent,
      viewport:innerWidth, body:document.documentElement.scrollWidth,
      historyClosed:!document.querySelector('#history-details').open,
      notice:document.querySelector('#notice-text').textContent,
      hourly:[...document.querySelectorAll('.hourly-row')].map(el=>el.innerText),
      cards:[...document.querySelectorAll('.leader')].map(el=>({
        width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
    })""")
    collected = datetime.fromisoformat(latest['collectedAt'].replace('Z', '+00:00'))
    emit('LIVE_DASHBOARD', {**metrics, 'now':utc_now(), 'errors':errors,
                          'sourceToCollectionSeconds':(collected-expected).total_seconds()})
    assert not errors, errors
    assert metrics['viewport'] == 390 and metrics['body'] == 390, metrics
    assert metrics['historyClosed'], metrics
    assert len(metrics['cards']) == 2 and metrics['hourly'], metrics
    assert metrics['notice'].startswith('매시 2분부터 5분 간격으로 자료를 수집합니다.'), metrics
    assert '3위' not in page.locator('body').inner_text()
    assert len({(c['width'], c['height']) for c in metrics['cards']}) == 1, metrics
    refresh = page.locator('#refresh-button').bounding_box()
    copy = page.locator('#copy-button').bounding_box()
    assert refresh and copy, 'Refresh/copy buttons missing from deployed page'
    assert refresh['width'] == 112 and refresh['height'] == 44, refresh
    assert copy['width'] == 112 and copy['height'] == 44, copy
    assert page.locator('[data-image]').count() == 3, 'Expected three panel image controls'
    page.add_init_script("""window.probePngText=[];
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(value,...args){
        window.probePngText.push(String(value));return original.call(this,value,...args);
      };""")
    for metric in ('votes', 'share', 'gap'):
        page.locator(f'[data-metric="{metric}"]').click()
        expected_text = page.evaluate("""() => {
          const names=['RESCENE','RIIZE'];
          return [...document.querySelectorAll('.leader')].map((card,i)=>({
            label:(i+1)+'위 · '+names[i],
            votes:card.querySelector('.vote-value').innerText+'표',
            share:card.querySelector('.share-value').innerText
          }));
        }""")
        page.evaluate('window.probePngText=[]')
        with page.expect_download() as image_download:
            page.locator('[data-image="trend"]').click()
        download = image_download.value
        image_path = Path(download.path())
        image = image_path.read_bytes()
        assert image.startswith(b'\\x89PNG\\r\\n\\x1a\\n'), 'Chart export is not a PNG'
        width, height = struct.unpack('>II', image[16:24])
        assert 0 < width <= 4096 and 0 < height <= 4096 and width*height <= 8000000, (width, height)
        png_text = page.evaluate('window.probePngText')
        assert '현재 득표 현황' in png_text, png_text
        for card in expected_text:
            assert card['label'] in png_text, (metric, card, png_text)
            assert card['votes'] in png_text, (metric, card, png_text)
            assert card['share'] in png_text, (metric, card, png_text)
        emit('PUBLIC_PNG', {'metric':metric, 'bytes':len(image), 'width':width,
                            'height':height, 'teamCards':len(expected_text)})
    page.locator('.history-summary').click()
    assert page.locator('#history-body').is_visible()
    page.locator('.history-summary').click()
    assert not page.locator('#history-body').is_visible()
    emit('RESULT', 'PASS: public refresh, 112x44 controls, and downloadable vote/share/gap charts with both team cards')
    context.close()
    browser.close()
