"""One-off public-page diagnosis; no accounts or voting actions."""
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'collector'))
from collect import URL, parse_text, utc_now
from playwright.sync_api import sync_playwright


def emit(label, value):
    print(label + ' ' + json.dumps(value, ensure_ascii=False), flush=True)


def snapshot(page, label):
    try:
        data = parse_text(page.locator('body').inner_text())
        emit(label, {'now': utc_now(), 'sourceAt': data['sourceAt'],
                     'totalVotes': data['totalVotes'], 'top3': data['top3']})
    except Exception as exc:
        emit(label, {'error': str(exc)[:300]})


with sync_playwright() as p:
    browser = p.chromium.launch()
    for fresh in (False, True):
        context = browser.new_context(locale='ko-KR', timezone_id='Asia/Seoul')
        page = context.new_page()
        responses = []
        page.on('response', lambda response: responses.append(response)
                if response.request.resource_type in ('fetch', 'xhr') else None)
        target = URL + ('?refresh=' + str(int(time.time())) if fresh else '')
        response = page.goto(target, wait_until='domcontentloaded')
        emit('DOCUMENT', {'freshURL': fresh, 'status': response.status,
             'headers': {k: v for k, v in response.headers.items()
                         if k in ('age', 'date', 'cache-control', 'x-cache')}})
        page.wait_for_function("/총\\s*투표\\s*수/.test(document.body.innerText)")
        snapshot(page, 'IMMEDIATE')
        page.wait_for_timeout(10000)
        snapshot(page, 'AFTER_10S')
        for item in responses:
            url = urlsplit(item.url)
            if not any(w in url.path.lower() for w in ('vote', 'rank', 'kgma')):
                continue
            out = {'endpoint': url.scheme + '://' + url.netloc + url.path,
                   'status': item.status, 'headers': {k: v for k, v in item.headers.items()
                       if k in ('age', 'date', 'cache-control', 'x-cache')}}
            try:
                out['public_response_excerpt'] = json.dumps(item.json(), ensure_ascii=False)[:2200]
            except Exception:
                pass
            emit('PUBLIC_DATA', out)
        context.close()
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True,
                                  locale='ko-KR', timezone_id='Asia/Seoul')
    page = context.new_page()
    page.on('pageerror', lambda error: emit('PAGE_ERROR', str(error)))
    page.on('requestfailed', lambda req: emit('FAILED_REQUEST', urlsplit(req.url).netloc + urlsplit(req.url).path))
    page.goto('https://woniwoniwoniwoni.github.io/kgma-vote-tracker/', wait_until='networkidle')
    page.wait_for_timeout(3000)
    emit('LIVE_DASHBOARD', page.evaluate("""() => ({
      source:document.querySelector('#source-time').textContent,
      notice:document.querySelector('#notice-text').textContent,
      viewport:innerWidth, body:document.documentElement.scrollWidth,
      boxes:[...document.querySelectorAll('.leader,.panel')].map(el=>({
        class:el.className,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
    })"""))
    context.close()
    browser.close()
