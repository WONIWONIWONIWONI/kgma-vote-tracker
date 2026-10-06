"""Read the public Berriz ranking. No account, voting or posting actions."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata

from policy import end_at, operation, MAX_RECORDS, MAX_HISTORY_BYTES

URL = 'https://berriz.in/ko/vote/2026kgma/'
KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / 'dist/data/history.json'
RANK = re.compile(r'(?:^|\n)\s*(\d{1,3})\s+([^\n]+?)\s+(\d+(?:\.\d+)?)\s*%\s*[·•ㆍ・]?\s*([\d,]+)\s*표', re.M)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_text(text, now=None):
    """Parse visible Korean ranking text, requiring a source timestamp and total."""
    text = unicodedata.normalize('NFKC', text).replace('\r', '\n').replace('\u200b', '')
    total_match = re.search(r'총\s*투표\s*수\s*([\d,]+)', text)
    timestamp = re.search(r'(20\d\d)[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{2})\s*\(KST\)', text)
    if not total_match or not timestamp:
        raise ValueError('총 투표수 또는 원본 집계 시각을 찾지 못했습니다.')
    total = int(total_match.group(1).replace(',', ''))
    source_at = datetime(*map(int, timestamp.groups()), tzinfo=KST).astimezone(timezone.utc)
    now = now or datetime.now(timezone.utc)
    if source_at > now + timedelta(minutes=5):
        raise ValueError('원본 집계 시각이 미래입니다.')
    found = {}
    for m in RANK.finditer(text):
        rank = int(m.group(1))
        if rank > 3 or rank < 1:
            continue
        name = ' '.join(m.group(2).split())
        votes = int(m.group(4).replace(',', ''))
        team = {'rank': rank, 'id': name.casefold(), 'name': name, 'votes': votes, 'reportedShare': float(m.group(3))}
        if rank in found and found[rank] != team:
            raise ValueError('같은 순위의 내용이 서로 다릅니다.')
        found[rank] = team
    if set(found) != {1, 2, 3}:
        raise ValueError('1~3위 세 팀의 값을 모두 읽지 못했습니다. 화면 구조 확인이 필요합니다.')
    teams = [found[i] for i in (1, 2, 3)]
    if total <= 0 or sum(t['votes'] for t in teams) > total:
        raise ValueError('총투표수와 상위 팀의 표수가 맞지 않습니다.')
    if len({t['id'] for t in teams}) != 3:
        raise ValueError('중복된 팀이 있습니다.')
    if any(teams[i]['votes'] < teams[i+1]['votes'] for i in (0, 1)):
        raise ValueError('순위와 득표수 순서가 맞지 않습니다.')
    if any(abs(100*t['votes']/total-t['reportedShare']) > .151 for t in teams):
        raise ValueError('점유율과 표수의 비율이 맞지 않습니다.')
    return {'sourceAt': source_at.isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'collectedAt': utc_now(), 'origin': 'berriz_public_page', 'totalVotes': total, 'top3': teams}


def load_public_text():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(locale='ko-KR', timezone_id='Asia/Seoul')
        page = context.new_page()
        try:
            response = page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            if response and response.status >= 400:
                raise ValueError(f'공개 페이지 응답 오류: HTTP {response.status}')
            page.wait_for_function("/총\\s*투표\\s*수/.test(document.body.innerText) && /[\\d,]+\\s*표/.test(document.body.innerText)", timeout=30000)
            text = page.locator('body').inner_text(timeout=10000)
            # SPA hydration can update the total and candidate cards separately.
            try:
                parse_text(text)
            except ValueError:
                page.wait_for_timeout(1500)
                text = page.locator('body').inner_text(timeout=10000)
            return text
        except Exception:
            # Public, unauthenticated page only; diagnostics stay outside dist/.
            debug = ROOT / 'collector/debug'
            debug.mkdir(exist_ok=True)
            try:
                (debug/'last-visible-text.txt').write_text(page.locator('body').inner_text(timeout=3000), encoding='utf-8')
            except Exception:
                pass
            raise
        finally:
            browser.close()


def append_snapshot(data, snapshot):
    rows = data['snapshots']
    old = next((s for s in rows if s['sourceAt'] == snapshot['sourceAt']), None)
    if old:
        if old['totalVotes'] != snapshot['totalVotes'] or old['top3'] != snapshot['top3']:
            raise ValueError('동일 집계 시각의 값이 달라 기존 기록을 보존했습니다.')
        # Retain the first time this source observation was actually obtained.
        old['origin'] = snapshot['origin']
        return False
    if rows and snapshot['sourceAt'] < max(s['sourceAt'] for s in rows):
        raise ValueError('마지막 기록보다 오래된 응답입니다.')
    rows.append(snapshot)
    rows.sort(key=lambda s: s['sourceAt'])
    return True


def save(data):
    if len(data['snapshots']) > MAX_RECORDS:
        raise ValueError('Two-week observation storage limit reached; existing files preserved.')
    data.setdefault('operation', operation())
    data['historyCount'] = len(data['snapshots'])
    # Compact JSON cuts storage and transfer size without dropping any observations.
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
    if len(text.encode('utf-8')) > MAX_HISTORY_BYTES:
        raise ValueError('Observation file exceeds its 8 MiB safety limit.')
    recent = {**data, 'snapshots': data['snapshots'][-3:]}
    small = json.dumps(recent, ensure_ascii=False, separators=(',', ':'))
    outputs = {HISTORY: text,
               HISTORY.parent/'latest.json': small + '\n',
               HISTORY.parent/'seed.js': 'window.KGMA_SEED = ' + small + ';\n'}
    for path, value in outputs.items():
        if path.exists() and path.read_text(encoding='utf-8') == value:
            continue
        tmp = path.with_suffix('.tmp')
        tmp.write_text(value, encoding='utf-8')
        tmp.replace(path)


def collect_once(fixture=None, until=None):
    data = json.loads(HISTORY.read_text(encoding='utf-8'))
    collector = data.setdefault('collector', {})
    previous_state = collector.get('state')
    needs_format_update = 'historyCount' not in data or 'operation' not in data or not (HISTORY.parent/'latest.json').exists()
    data['operation'] = operation(until)
    collector.update(lastAttemptAt=utc_now(), intervalSeconds=300)
    if datetime.now(timezone.utc) >= end_at(until):
        collector.update(state='stopped', error=None)
        if previous_state != 'stopped' or needs_format_update:
            save(data)
        print('Configured collection end reached.')
        return 0
    try:
        text = Path(fixture).read_text(encoding='utf-8') if fixture else load_public_text()
        try:
            snapshot = parse_text(text)
        except ValueError:
            debug = ROOT / 'collector/debug'
            debug.mkdir(exist_ok=True)
            (debug/'last-visible-text.txt').write_text(text, encoding='utf-8')
            raise
        added = append_snapshot(data, snapshot)
        collector.update(state='ok', lastSuccessAt=utc_now(), error=None)
        if added or previous_state != 'ok' or needs_format_update:
            save(data)
        print(json.dumps({'ok': True, 'added': added, 'sourceAt': snapshot['sourceAt'], 'top3': snapshot['top3']}, ensure_ascii=False))
        return 0
    except Exception as exc:
        collector.update(state='error', error=type(exc).__name__+': '+str(exc)[:400])
        save(data)
        print('Collection failed; previous snapshots preserved: '+str(exc), file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--every', type=int, help='Run repeatedly; minimum 300 seconds.')
    parser.add_argument('--fixture', help='Offline parsing check with saved visible text.')
    parser.add_argument('--until', default=os.environ.get('COLLECT_UNTIL'), help='ISO timestamp; stop after this time.')
    args = parser.parse_args()
    if args.every and args.every < 300:
        parser.error('--every must be at least 300')
    if not args.every:
        return collect_once(args.fixture, args.until)
    while True:
        collect_once(args.fixture, args.until)
        if datetime.now(timezone.utc) >= end_at(args.until):
            return 0
        time.sleep(max(1, args.every-time.time()%args.every+20))


if __name__ == '__main__':
    raise SystemExit(main())
