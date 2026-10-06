"""Publish observations on a fixed clock within a bounded GitHub Actions job."""
import argparse
from datetime import datetime, timezone
import json
import math
import subprocess
import sys
import time

from collect import HISTORY, ROOT, save, utc_now
from policy import end_at

INTERVAL = 300
OFFSET = 90  # Give the source time to update after each five-minute boundary.


def next_tick(now):
    return (math.floor((now - OFFSET) / INTERVAL) + 1) * INTERVAL + OFFSET


def git(*args, check=True):
    return subprocess.run(['git', *args], cwd=ROOT, check=check, timeout=90)


def publish_records():
    git('add', 'dist/data/history.json', 'dist/data/latest.json', 'dist/data/seed.js')
    changed = git('diff', '--cached', '--quiet', check=False)
    if changed.returncode == 0:
        return
    if changed.returncode != 1:
        raise RuntimeError('Could not check staged observations.')
    git('commit', '-m', 'Update observed KGMA ranking records')
    for attempt in range(3):
        if git('push', 'origin', 'HEAD:main', check=False).returncode == 0:
            return
        # Preserve code edits made while a collection was in progress. Never force-push.
        git('pull', '--rebase', 'origin', 'main')
    raise RuntimeError('Could not publish observations after three attempts.')


def run_cycle():
    # A queued run must start from the latest records, not the event's old SHA.
    git('pull', '--ff-only', 'origin', 'main')
    try:
        result = subprocess.run([sys.executable, '-u', 'collector/collect.py'],
                                cwd=ROOT, timeout=180)
        code = result.returncode
    except subprocess.TimeoutExpired:
        data = json.loads(HISTORY.read_text(encoding='utf-8'))
        data.setdefault('collector', {}).update(
            state='error', lastAttemptAt=utc_now(), intervalSeconds=INTERVAL,
            error='Collection exceeded the 180-second timeout.')
        save(data)
        code = 1
    publish_records()
    data = json.loads(HISTORY.read_text(encoding='utf-8'))
    if data.get('collector', {}).get('state') == 'stopped':
        return 'stopped'
    return 'ok' if code == 0 else 'error'


def run_for(seconds, cycle=run_cycle, clock=time.time, monotonic=time.monotonic,
            sleep=time.sleep):
    deadline = monotonic() + seconds
    failures = 0
    while monotonic() < deadline:
        state = cycle()
        failures = failures + 1 if state == 'error' else 0
        if state == 'stopped':
            return 0
        if failures >= 3:
            raise RuntimeError('Three collections failed; the queued job can restart fresh.')
        tick = next_tick(clock())
        print('Next check: ' + datetime.fromtimestamp(tick, timezone.utc).isoformat(), flush=True)
        # Short waits keep cancellation responsive and respect the job's lifetime.
        while clock() < tick and monotonic() < deadline:
            sleep(min(30, tick - clock(), max(0, deadline - monotonic())))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--minutes', type=int, default=330)
    args = parser.parse_args()
    if not 1 <= args.minutes <= 330:
        parser.error('--minutes must be between 1 and 330')
    try:
        remaining = max(0, end_at().timestamp() - time.time())
        result = run_for(min(args.minutes * 60, remaining))
        if time.time() >= end_at().timestamp():
            run_cycle()  # Marks the end without contacting Berriz.
        return result
    except (RuntimeError, subprocess.SubprocessError) as exc:
        print('Continuous collection stopped: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
