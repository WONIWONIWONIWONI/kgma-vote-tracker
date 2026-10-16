"""Create an isolated vote tracker from the checked-out KGMA reference.

No network calls, guessed observations, workflow execution, or GitHub writes.
The resulting collector remains opt-in until a new source adapter is verified.
"""
import argparse
from datetime import datetime, timezone
from html import escape
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SITE = ('index.html', 'style.css', 'app.js', 'candles.js', 'axis.js',
        'hourly.js', 'exports.js', 'favicon.svg')
CODE = ('collector/collect.py', 'collector/runner.py', 'collector/policy.py',
        'collector/lifecycle.py', 'collector/prepare_site.py',
        '.github/workflows/collect-and-publish.yml',
        '.github/workflows/publish.yml', 'qa/test_axis.cjs', 'qa/test_hourly.cjs')
OLD_RAW = 'https://raw.githubusercontent.com/WONIWONIWONIWONI/kgma-vote-tracker/main/'


def replace_once(text, old, new, path):
    count = text.count(old)
    if count != 1:
        raise ValueError(f'{path}: expected one occurrence, found {count}: {old[:90]!r}')
    return text.replace(old, new, 1)


def valid_url(value):
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or any(c in value for c in "'\"\\<>\r\n"):
        raise ValueError('Vote URL must be a public HTTPS URL without credentials.')
    return value


def valid_timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('End time must include a timezone, e.g. +09:00 or Z.')
    return parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def write(root, path, content):
    dest = root / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding='utf-8')


def adapt_collector(original):
    # Retain the proven storage, deduplication and stop policy; replace only the source reader.
    suffix = original.split('def append_snapshot(data, snapshot):', 1)
    if len(suffix) != 2:
        raise ValueError('Collector layout changed; review source before generating a tracker.')
    kept = 'def append_snapshot(data, snapshot):' + suffix[1]
    kept = replace_once(kept,
        "snapshot = parse_text(Path(fixture).read_text(encoding='utf-8')) if fixture else load_public_snapshot()",
        "snapshot = validate_snapshot(json.loads(Path(fixture).read_text(encoding='utf-8'))) if fixture else load_public_snapshot()",
        'collector/collect.py')
    return '''"""Source-neutral observation storage. Implement only source_adapter.read_snapshot."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import time

from policy import end_at, operation, MAX_RECORDS, MAX_HISTORY_BYTES
from source_adapter import read_snapshot

ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / 'dist/data/history.json'


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def validate_snapshot(raw, now=None):
    """Fail closed on fabricated, incomplete, inconsistent or stale source data."""
    if not isinstance(raw, dict):
        raise ValueError('A source observation must be an object.')
    stamp = raw.get('sourceAt')
    if not isinstance(stamp, str):
        raise ValueError('The source must publish an original aggregation time.')
    try:
        parsed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Invalid source timestamp.') from exc
    if parsed.tzinfo is None or parsed.astimezone(timezone.utc) > (now or datetime.now(timezone.utc)) + timedelta(minutes=5):
        raise ValueError('Source timestamp lacks a timezone or lies in the future.')
    total, teams = raw.get('totalVotes'), raw.get('top2')
    if type(total) is not int or total <= 0 or not isinstance(teams, list) or len(teams) != 2:
        raise ValueError('Total votes and exactly two ranked teams are required.')
    if [t.get('rank') for t in teams if isinstance(t, dict)] != [1, 2]:
        raise ValueError('Ranks must be first and second.')
    if any(type(t.get('votes')) is not int or t['votes'] < 0 or
           not isinstance(t.get('name'), str) or not t['name'].strip() or
           not isinstance(t.get('id'), str) or not t['id'].strip() for t in teams):
        raise ValueError('Each team needs a stable id, name and integer vote count.')
    if len({t['id'].casefold() for t in teams}) != 2 or teams[0]['votes'] < teams[1]['votes'] or sum(t['votes'] for t in teams) > total:
        raise ValueError('Ranks, unique team IDs and total votes disagree.')
    clean = []
    for team in teams:
        share = team.get('reportedShare')
        if share is None:
            share = round(team['votes'] / total * 100, 1)
        if type(share) not in (int, float) or abs(share - 100 * team['votes'] / total) > .151:
            raise ValueError('Reported share differs from votes and total.')
        clean.append({'rank': team['rank'], 'id': team['id'].strip().casefold(),
                      'name': team['name'].strip(), 'votes': team['votes'],
                      'reportedShare': float(share)})
    return {'sourceAt': parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'collectedAt': utc_now(), 'origin': 'public_vote_source',
            'totalVotes': total, 'top2': clean}


def load_public_snapshot():
    return validate_snapshot(read_snapshot())


''' + kept


def build(args, root=ROOT):
    vote_url = valid_url(args.vote_url)
    end_at = valid_timestamp(args.end_at)
    now = datetime.now(timezone.utc)
    if datetime.fromisoformat(end_at.replace('Z', '+00:00')) <= now:
        raise ValueError('End time must be in the future.')
    if (datetime.fromisoformat(end_at.replace('Z', '+00:00')) - now).total_seconds() > 14 * 86400:
        raise ValueError('The reference budget covers up to 14 days; review limits for a longer vote.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        raise ValueError('Repository must have OWNER/REPO form.')
    if not re.fullmatch(r'[a-z0-9-]+', args.slug):
        raise ValueError('Slug must contain lowercase ASCII letters, numbers and hyphens.')
    if not args.title.strip() or not args.source_name.strip() or not args.target_id.strip() or not args.target_name.strip():
        raise ValueError('Title, source, target id and target name are required.')
    if any(any(c in value for c in "'\"\\<>\r\n") for value in (args.title, args.source_name, args.target_id, args.target_name)):
        raise ValueError('Labels must not contain quotes, angle brackets or line breaks.')
    destination = Path(args.output).expanduser().resolve()
    if destination.exists():
        raise FileExistsError(f'Refusing to overwrite existing path: {destination}')
    if destination == root.resolve() or root.resolve() in destination.parents:
        raise ValueError('Choose an output directory outside this repository.')
    for path in (*('dist/' + s for s in SITE), *CODE):
        if not (root / path).is_file():
            raise FileNotFoundError(f'Reference repository is incomplete: {path}')

    created = False
    try:
        destination.mkdir(parents=True)
        created = True
        for path in (*('dist/' + s for s in SITE), *CODE):
            dest = destination / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / path, dest)
        raw = 'https://raw.githubusercontent.com/' + args.repository + '/main/'
        title, source, target = args.title.strip(), args.source_name.strip(), args.target_name.strip()
        target_id = args.target_id.strip().casefold()
        htitle, hsource, htarget = escape(title), escape(source), escape(target)
        html = (destination / 'dist/index.html').read_text(encoding='utf-8')
        html = html.replace('2026 KGMA', htitle).replace('KGMA TOP 2', htitle)
        html = html.replace('BERRIZ GLOBAL FANS’ CHOICE', htitle.upper())
        html = html.replace('KGMA 트래커 홈', htitle + ' 트래커 홈')
        html = html.replace('https://berriz.in/ko/vote/2026kgma/', escape(vote_url, quote=True))
        html = html.replace('Berriz ↗', hsource + ' ↗')
        html = html.replace('리센느', htarget).replace('베리즈', hsource)
        html = html.replace('표차는 1위와 2위의 득표수 차이입니다.',
            '표차는 ' + htarget + ' 득표수에서 상위 2팀 중 상대 팀의 득표수를 뺀 값입니다. 대상 팀이 상위 2팀 밖이면 표차 관측점은 표시하지 않습니다.')
        html = html.replace('표차 그래프는 각 시점의 1·2위를 비교하므로 팀이 바뀔 수 있습니다.',
            '표차 그래프는 각 시점에 ' + htarget + '가 상위 2팀에 있을 때 상대 팀과 비교합니다.')
        html = html.replace('2026년 10월 21일 00:45(KST)', escape(datetime.fromisoformat(end_at.replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')))
        html = html.replace('수집기는 ' + hsource + '의 공개 순위 API를 매시 2분부터 5분 간격(02·07·12·17분…)으로 확인합니다.',
            '수집기는 검증된 공개 순위 자료를 주기적으로 확인합니다.')
        write(destination, 'dist/index.html', html)

        app = (destination / 'dist/app.js').read_text(encoding='utf-8')
        app = replace_once(app, 'const colors = {rescene:palette[0],riize:palette[1]};', 'const colors = {};', 'dist/app.js')
        app = replace_once(app, "const gapDefs = [{id:'resceneGap',name:'리센느 − 경쟁팀',color:palette[0]}];",
            "const gapDefs = [{id:'targetGap',name:" + json.dumps(target + ' − 경쟁팀', ensure_ascii=False) + ",color:palette[0]}];", 'dist/app.js')
        app = replace_once(app,
            "const isRescene = team => /rescene|리센느/i.test(String(team?.id||team?.name||'')); // gap anchor: RESCENE",
            'const isRescene = team => String(team?.id||\'\').toLowerCase() === ' + json.dumps(target_id, ensure_ascii=False) + ';', 'dist/app.js')
        app = replace_once(app, 'const rescene=s.top2.find(isRescene),rival=s.top2.find(t=>!isRescene(t));return rescene&&rival?rescene.votes-rival.votes:null;',
            'const target=s.top2.find(isRescene),rival=s.top2.find(t=>!isRescene(t));return target&&rival?target.votes-rival.votes:null;', 'dist/app.js')
        app = replace_once(app, OLD_RAW + 'dist/data/history.json', raw + 'dist/data/history.json', 'dist/app.js')
        app = app.replace('2026-10-20T15:45:00Z', end_at).replace('리센느', target)
        app = app.replace('2026 KGMA', title).replace('Berriz', source)
        app = app.replace('https://berriz.in/ko/vote/2026kgma/', vote_url)
        app = app.replace('kgma-', args.slug + '-')
        app = app.replace('매시 2분부터 5분 간격으로 자료를 수집합니다. (02·07·12·17분…)', '검증된 공개 자료를 주기적으로 수집합니다.')
        write(destination, 'dist/app.js', app)

        candles = (destination / 'dist/candles.js').read_text(encoding='utf-8')
        candles = replace_once(candles, OLD_RAW, raw, 'dist/candles.js')
        candles = replace_once(candles, "if (/RESCENE|리센느/i.test(name)) rescene = tp[i];",
            'if (String(tp[i].id || \'\').toLowerCase() === ' + json.dumps(target_id, ensure_ascii=False) + ') rescene = tp[i];', 'dist/candles.js')
        candles = candles.replace('리센느', target).replace('RESCENE', target).replace('KGMA', title).replace('Berriz', source).replace('kgma-', args.slug + '-')
        write(destination, 'dist/candles.js', candles)
        exports = (destination / 'dist/exports.js').read_text(encoding='utf-8').replace('2026 KGMA', title).replace('Berriz', source)
        write(destination, 'dist/exports.js', exports)

        collector = adapt_collector((destination / 'collector/collect.py').read_text(encoding='utf-8'))
        write(destination, 'collector/collect.py', collector)
        write(destination, 'collector/source_adapter.py', '''"""Map this election's PUBLIC results to the standard observation contract.

Return an object with sourceAt (the original timestamp with timezone),
totalVotes, and top2: rank, stable id, name, votes and optional reportedShare.
Never substitute collection time for an unknown original timestamp.
Do not guess past records or silently bypass login / access controls.
"""
SOURCE_URL = ''' + repr(vote_url) + '''


def read_snapshot():
    raise NotImplementedError('Inspect the actual public voting source and implement this adapter before enabling collection.')
''')
        policy = (destination / 'collector/policy.py').read_text(encoding='utf-8')
        policy = policy.replace('2026-10-06T15:45:00Z', now.isoformat(timespec='seconds').replace('+00:00', 'Z'))
        policy = policy.replace('2026-10-20T15:45:00Z', end_at)
        write(destination, 'collector/policy.py', policy)
        runner = (destination / 'collector/runner.py').read_text(encoding='utf-8').replace('Update observed KGMA ranking records', 'Update observed ' + args.slug + ' ranking records')
        write(destination, 'collector/runner.py', runner)
        for path in ('.github/workflows/collect-and-publish.yml', '.github/workflows/publish.yml'):
            workflow = (destination / path).read_text(encoding='utf-8')
            workflow = workflow.replace('KGMA', title).replace('kgma-', args.slug + '-').replace(' # RESCENE gap deployment', '')
            if path.endswith('collect-and-publish.yml'):
                workflow = workflow.replace("vars.COLLECT_ENABLED != 'false'", "vars.COLLECT_ENABLED == 'true'")
            else:
                # The original visual QA is tailored to KGMA names; run it only after adapting it to this vote.
                workflow = workflow.replace('if: github.event.repository.private == false',
                                            "if: github.event.repository.private == false && vars.PUBLISH_ENABLED == 'true'")
                workflow = workflow.replace('      - run: pip install -r collector/requirements.txt\n', '')
                workflow = workflow.replace("      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n          cache: pip\n          cache-dependency-path: collector/requirements.txt\n", '')
                workflow = workflow.replace("      - uses: actions/cache/restore@v4\n        with:\n          path: ~/.cache/ms-playwright\n          key: ${{ runner.os }}-playwright-${{ hashFiles('collector/requirements.txt') }}\n", '')
                workflow = workflow.replace('      - run: python -m playwright install --with-deps chromium\n', '')
                workflow = workflow.replace('      - name: Verify mobile widths, hourly bars, and exports\n        run: python -u qa/check_layout.py\n', '')
                workflow = workflow.replace("      - 'qa/check_layout.py'\n", '')
                workflow = workflow.replace("      - name: Prepare compact fallback and enforce size ceiling\n        run: python collector/prepare_site.py",
                    "      - name: Require a real source observation and prepare site\n        run: python collector/prepare_site.py")
            write(destination, path, workflow)
        # Prevent accidental publishing of an empty or fabricated tracker.
        prep = (destination / 'collector/prepare_site.py').read_text(encoding='utf-8')
        prep = replace_once(prep, "    data['operation'] = operation()", "    if not data['snapshots']:\n        raise ValueError('No verified source observations yet; publishing is disabled.')\n    data['operation'] = operation()", 'collector/prepare_site.py')
        write(destination, 'collector/prepare_site.py', prep)

        history = {'schemaVersion': 2, 'sourceUrl': vote_url, 'collector': {'state': 'pending', 'intervalSeconds': 300,
                   'lastAttemptAt': None, 'lastSuccessAt': None, 'error': None}, 'snapshots': [],
                   'operation': {'startsAt': now.isoformat(timespec='seconds').replace('+00:00', 'Z'), 'endsAt': end_at},
                   'historyCount': 0}
        compact = json.dumps(history, ensure_ascii=False, separators=(',', ':'))
        write(destination, 'dist/data/history.json', compact + '\n')
        write(destination, 'dist/data/latest.json', compact + '\n')
        write(destination, 'dist/data/seed.js', 'window.KGMA_SEED = ' + compact + ';\n')
        write(destination, 'collector/test_adapter_contract.py', '''import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import validate_snapshot

class SourceContract(unittest.TestCase):
    def test_rejects_missing_original_timestamp(self):
        with self.assertRaises(ValueError):
            validate_snapshot({'totalVotes': 100, 'top2': []})

    def test_rejects_fake_or_inconsistent_counts(self):
        row = {'sourceAt': '2026-01-01T00:00:00Z', 'totalVotes': 100,
               'top2': [{'rank': 1, 'id': 'a', 'name': 'A', 'votes': 70},
                        {'rank': 2, 'id': 'b', 'name': 'B', 'votes': 50}]}
        with self.assertRaises(ValueError):
            validate_snapshot(row)
''')
        write(destination, 'README.md', f'''# {title} — 투표 트래커 (연결 준비 중)

원본: {vote_url}\n\n이 사본에는 실제 투표 기록이 없습니다. 수집 및 배포가 비활성 상태입니다.\n
1. `collector/source_adapter.py`에 공개 순위의 실제 데이터 읽기를 구현합니다. 로그인이나 접근 제한이 필요하면 우회하지 않습니다. 반드시 **원본 집계 시각**, 전체 투표수, 상위 2팀의 안정적인 ID, 표수와 표시 점유율을 확인하세요.
2. `python -m unittest discover -s collector -p 'test_*.py'` 및 실제 응답의 저장 예제로 `python collector/collect.py --fixture /path/to/real_observation.json`을 검증합니다. fixture는 최초 관측으로 저장되니 실제 검증된 값만 사용하세요.
3. `python collector/prepare_site.py`가 통과하는지 확인하고, 모바일 화면과 이미지 파일의 제목·표차를 확인합니다. 첫 관측이 없어도 사이트가 공개되도록 변경하지 마세요.
4. 이 폴더를 별도의 공개 저장소 `{args.repository}`의 `main`에 올리고 Pages의 Source를 GitHub Actions로 지정합니다. 검증된 첫 관측 이후 저장소 Actions variable `PUBLISH_ENABLED=true`를 지정하고 Publish 워크플로를 수동 실행해 사이트를 배포합니다. 그 전에는 게시 작업도 실행되지 않습니다.
5. 데이터 검증과 사이트 검증이 끝난 뒤에만 저장소 Actions variable `COLLECT_ENABLED=true`를 지정하고 Collect 워크플로를 실행합니다. 수집 작업은 기본적으로 켜지지 않습니다. 종료 시각은 `{end_at}`이며, 종료 뒤 워크플로 예약이 비활성화됩니다.

원본 API 또는 페이지 구조가 달라지면 `collector/source_adapter.py`만 연결합니다. `dist/`의 그래프·표·PNG·CSV UI는 보존됩니다. 대상 팀 ID `{target_id}`가 현재 상위 두 팀에 없으면 대상 팀의 표차 관측값은 표시되지 않습니다. 시간별 증가량도 상위 두 팀 기록에 한합니다. 이 한계가 맞지 않는 투표는 수집 스키마와 화면을 함께 조정해야 합니다.\n''')
        return destination
    except Exception:
        if created:
            shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('output', 'repository', 'vote-url', 'title', 'source-name',
                   'target-id', 'target-name', 'slug', 'end-at'):
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args()
    print('Created inactive tracker at', build(args))


if __name__ == '__main__':
    main()
