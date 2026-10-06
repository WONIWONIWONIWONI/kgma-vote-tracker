"""Check responsive card sizes and the collapsed record table in Chromium."""
import copy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT/'dist/data/history.json').read_text())
base = copy.deepcopy(data['snapshots'][-1])
base['totalVotes'] = 100000000
for team, votes in zip(base['top3'], (12345678, 9876543, 8765432)):
    team.update(votes=votes, reportedShare=round(votes, 1)/1000000)
data['snapshots'] = []
for i in range(80):
    row = copy.deepcopy(base)
    row['sourceAt'] = (datetime.now(timezone.utc)-timedelta(minutes=5*(79-i))).isoformat()
    data['snapshots'].append(row)
data['historyCount'] = 80


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT/'dist')))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width in (320, 360, 390, 430, 768, 1280):
            context = browser.new_context(viewport={'width':width, 'height':844},
                                          is_mobile=width<=430, device_scale_factor=1)
            context.route('https://raw.githubusercontent.com/**', lambda route: route.fulfill(
                content_type='application/json', body=json.dumps(data)))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='networkidle')
            page.wait_for_function("document.querySelector('#sample-count').textContent==='80'")
            page.wait_for_timeout(600)
            metrics = page.evaluate("""() => ({
                viewport:innerWidth,body:document.documentElement.scrollWidth,
                leaders:[...document.querySelectorAll('.leader')].map(el=>({
                    w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})),
                panels:[...document.querySelectorAll('.panel')].map(el=>el.getBoundingClientRect().width),
                overlapping:[...document.querySelectorAll('.count-row')].some(el=>
                    el.querySelector('.vote-total').getBoundingClientRect().right>
                    el.querySelector('.share-value').getBoundingClientRect().left-1)
            })""")
            print(json.dumps({'width':width, **metrics, 'errors':errors}), flush=True)
            assert not errors, errors
            assert metrics['viewport'] == width, metrics
            assert metrics['body'] <= width, metrics
            assert not metrics['overlapping'], metrics
            cards = metrics['leaders']
            assert max(c['w'] for c in cards)-min(c['w'] for c in cards)<1, metrics
            assert max(c['h'] for c in cards)-min(c['h'] for c in cards)<1, metrics
            if width <= 760:
                assert all(abs(w-cards[0]['w'])<1 for w in metrics['panels']), metrics
            assert not page.locator('#history-details').evaluate('(el)=>el.open')
            assert not page.locator('#history-body').is_visible()
            page.locator('.history-summary').click()
            assert page.locator('#history-body').is_visible()
            assert page.locator('#history-body tr').count() == 12
            page.locator('#load-more').click()
            assert page.locator('#history-body tr').count() == 24
            assert page.locator('.history-scroll').evaluate('(el)=>el.getBoundingClientRect().height')<=421
            page.locator('.history-summary').click()
            assert not page.locator('#history-body').is_visible()
            context.close()
        browser.close()
finally:
    server.shutdown()
