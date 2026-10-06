"""Disable this collector's future schedules after the requested end time."""
from datetime import datetime, timezone
import os
import subprocess
from policy import end_at


def main():
    if datetime.now(timezone.utc) < end_at():
        print('Still inside the two-week operating window.')
        return 0
    repo = os.environ['GITHUB_REPOSITORY']
    subprocess.run(['gh', 'api', '--method', 'PUT',
                    f'repos/{repo}/actions/workflows/collect-and-publish.yml/disable'],
                   check=True, timeout=30)
    print('Collection ended; future collector schedules are disabled. Records remain available.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
