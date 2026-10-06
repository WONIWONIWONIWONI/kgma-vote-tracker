"""Build small initial data and reject unexpectedly large Pages artifacts."""
import json
from collect import HISTORY, ROOT, save
from policy import operation


def main():
    data = json.loads(HISTORY.read_text(encoding='utf-8'))
    data['operation'] = operation()
    save(data)
    size = sum(p.stat().st_size for p in (ROOT/'dist').rglob('*') if p.is_file())
    if size > 10 * 1024 * 1024:
        raise ValueError('Site exceeds the project\'s 10 MiB deployment ceiling.')
    print(json.dumps({'siteBytes': size, 'historyBytes': HISTORY.stat().st_size,
                      'latestBytes': (HISTORY.parent/'latest.json').stat().st_size}))


if __name__ == '__main__':
    main()
