"""Verify the closed public archive without requesting the Berriz source."""
from datetime import datetime, timezone
import json
import os
import time
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

SITE = 'https://woniwoniwoniwoni.github.io/kgma-vote-tracker/'
REPOSITORY_RAW = 'https://raw.githubusercontent.com/WONIWONIWONIWONI/kgma-vote-tracker/'
# An immutable revision avoids stale /main CDN responses at the voting cutoff.
RAW = REPOSITORY_RAW + os.environ['GITHUB_SHA'] + '/dist/data/'
API = 'https://api.github.com/repos/WONIWONIWONIWONI/kgma-vote-tracker/'
END = datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)
deadline = time.monotonic() + 300


def read_json(url):
    sep = '&' if '?' in url else '?'
    request = Request(url + sep + 'archive_check=' + str(time.time_ns()),
                      headers={'Accept': 'application/json', 'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def wait_for(check, label):
    while True:
        try:
            value = check()
            if value:
                return value
        except Exception as exc:
            print(label + ': ' + str(exc)[:180], flush=True)
        if time.monotonic() >= deadline:
            raise AssertionError(label + ' did not complete before the verification deadline')
        time.sleep(10)


# Retain a baseline of every record available when this check starts.
baseline = read_json(REPOSITORY_RAW + '8f3a45027311c1fabb1a3f4d842d0f4f3fa91002/dist/data/history.json')
while datetime.now(timezone.utc) < END:
    remaining = (END - datetime.now(timezone.utc)).total_seconds()
    print('Waiting for the configured voting cutoff; collection remains enabled.', flush=True)
    time.sleep(min(15, max(0, remaining)))


def stopped_history():
    data = read_json(RAW + 'history.json')
    return data if data.get('collector', {}).get('state') == 'stopped' else None


data = wait_for(stopped_history, 'Final collector status')
assert stamp(data['operation']['endsAt']) == END
rows = data['snapshots']
assert data['historyCount'] == len(rows) >= 3718
assert rows[:len(baseline['snapshots'])] == baseline['snapshots'], 'Existing observations changed'
assert all(stamp(row['sourceAt']) < END for row in rows)
assert all(not row.get('collectedAt') or stamp(row['collectedAt']) < END for row in rows)
assert len({row['sourceAt'] for row in rows}) == len(rows)
recent = read_json(RAW + 'latest.json')
assert recent['collector']['state'] == 'stopped'
assert recent['historyCount'] == len(rows)
assert recent['snapshots'] == rows[-3:]


def collector_disabled():
    workflow = read_json(API + 'actions/workflows/collect-and-publish.yml')
    return workflow if workflow['state'].startswith('disabled') else None


workflow = wait_for(collector_disabled, 'Collector workflow disable')


def deployed_archive():
    request = Request(SITE + '?archive_check=' + str(time.time_ns()), headers={'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=15) as response:
        html = response.read().decode('utf-8')
    if 'app.js?v=20261020-archive-local' not in html:
        return None
    archived = read_json(SITE + 'data/history.json')
    if archived.get('collector', {}).get('state') != 'stopped':
        return None
    assert archived['snapshots'] == rows, 'Deployed archive differs from preserved records'
    return archived


wait_for(deployed_archive, 'Final Pages archive')
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844},
                                  is_mobile=True, locale='ko-KR', timezone_id='Asia/Seoul')
    # Links may point at the official page, but the archive check never opens it.
    context.route('**/*berriz.in/**', lambda route: route.abort())
    page = context.new_page()
    errors, feed_requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: feed_requests.append(request.url)
            if 'raw.githubusercontent.com' in request.url else None)
    page.goto(SITE + '?archive_check=' + str(time.time_ns()), wait_until='networkidle')
    page.wait_for_function("document.querySelector('#status-label').textContent === '투표 종료'")
    page.wait_for_function("expected => document.querySelector('#sample-count').textContent.replaceAll(',','') === String(expected)",
                           arg=len(rows))
    assert '마지막 관측값' in page.locator('#notice-text').inner_text()
    assert not feed_requests, 'Final archive must load its same-origin preserved data'
    assert page.locator('#trend-chart path').count() >= 1
    assert page.locator('#cd-svg rect').count() >= 1
    page.locator('#history-details summary').click()
    assert page.locator('#history-body tr').count() >= 1
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Advance timers using real deployed scripts; neither chart may poll after closing.
    count = len(feed_requests)
    page.clock.install()
    page.clock.fast_forward(16 * 60 * 1000)
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    assert len(feed_requests) == count, 'Closed archive made automatic feed requests'
    assert not errors, errors
    browser.close()

print('ARCHIVE_VERIFIED ' + json.dumps({
    'historyCount': len(rows), 'lastSourceAt': rows[-1]['sourceAt'],
    'lastCollectedAt': rows[-1].get('collectedAt'), 'workflowState': workflow['state'],
    'site': SITE, 'state': data['collector']['state'],
    'allBaselineObservationsPreserved': True, 'liveMobileChartsAndHistory': True,
    'automaticRequestsAfterClose': 0}, ensure_ascii=False), flush=True)
