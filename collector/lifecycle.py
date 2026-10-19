"""Publish the final archive and disable this collector after voting closes."""
from datetime import datetime, timezone
import os
import subprocess
from policy import end_at


def main():
    if datetime.now(timezone.utc) < end_at():
        print('Voting is still open; collection continues until the configured cutoff.')
        return 0
    repo = os.environ['GITHUB_REPOSITORY']
    workflow = f'repos/{repo}/actions/workflows/collect-and-publish.yml'
    state = subprocess.run(['gh', 'api', workflow, '--jq', '.state'],
                           check=True, timeout=30, capture_output=True, text=True).stdout.strip()
    if state.startswith('disabled'):
        print('Collector schedules are already disabled; the archive remains available.')
        return 0
    # workflow_dispatch can be triggered by GITHUB_TOKEN. Deploy the full final
    # history as a same-origin fallback, even if the raw feed is unavailable later.
    subprocess.run(['gh', 'api', '--method', 'POST',
                    f'repos/{repo}/actions/workflows/publish.yml/dispatches',
                    '-f', 'ref=main'], check=True, timeout=30)
    subprocess.run(['gh', 'api', '--method', 'PUT',
                    workflow + '/disable'],
                   check=True, timeout=30)
    print('Collection ended; future collector schedules are disabled. Records remain available.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
