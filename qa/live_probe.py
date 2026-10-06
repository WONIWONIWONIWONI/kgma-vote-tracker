"""Verify the deployed mobile dashboard against the public record feed."""
from datetime import datetime
import json
from pathlib import Path
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
    page.locator('.history-summary').click()
    assert page.locator('#history-body').is_visible()
    page.locator('.history-summary').click()
    assert not page.locator('#history-body').is_visible()
    emit('RESULT', 'PASS: top-two data, minute-two notice, hourly gains, mobile cards, collapsed history')
    context.close()
    browser.close()
