"""Stop this tracker when voting closes, retaining all observed records."""
from datetime import datetime, timezone
import os

START_AT = '2026-10-06T15:45:00Z'
END_AT = '2026-10-19T15:00:00Z'  # 2026-10-19 24:00 / 2026-10-20 00:00 KST
MAX_RECORDS = 4100
MAX_HISTORY_BYTES = 8 * 1024 * 1024


def end_at(override=None):
    fixed = datetime.fromisoformat(END_AT.replace('Z', '+00:00'))
    requested = override or os.environ.get('COLLECT_UNTIL')
    if requested:
        candidate = datetime.fromisoformat(requested.replace('Z', '+00:00'))
        if candidate.tzinfo is None:
            raise ValueError('COLLECT_UNTIL must include a timezone.')
        fixed = min(fixed, candidate)
    return fixed.astimezone(timezone.utc)


def operation(override=None):
    return {'startsAt': START_AT, 'endsAt': end_at(override).isoformat().replace('+00:00', 'Z')}


if __name__ == '__main__':
    print('active=' + str(datetime.now(timezone.utc) < end_at()).lower())
