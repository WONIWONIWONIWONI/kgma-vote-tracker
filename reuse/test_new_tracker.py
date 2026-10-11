"""End-to-end checks for an isolated copy without contacting a vote source."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

from new_tracker import ROOT, build


class NewTrackerTests(unittest.TestCase):
    def args(self, output):
        return SimpleNamespace(output=str(output), repository='example/new-vote',
            vote_url='https://example.com/public/results', title='NEW VOTE',
            source_name='Official', target_id='new-team', target_name='새팀',
            slug='new-vote',
            end_at=(datetime.now(timezone.utc) + timedelta(days=3)).isoformat())

    def test_new_copy_never_contains_old_votes_or_enabled_collector(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'tracker'
            build(self.args(out), ROOT)
            data = json.loads((out / 'dist/data/history.json').read_text(encoding='utf-8'))
            self.assertEqual(data['snapshots'], [])
            self.assertEqual(data['historyCount'], 0)
            self.assertEqual(data['sourceUrl'], 'https://example.com/public/results')
            script = (out / 'dist/app.js').read_text(encoding='utf-8')
            self.assertIn('window.KGMA_SEED', script)
            self.assertIn('https://raw.githubusercontent.com/example/new-vote/main/dist/data/history.json', script)
            self.assertNotIn('WONIWONIWONIWONI/kgma-vote-tracker', script)
            self.assertIn('새팀 − 경쟁팀', script)
            self.assertIn('new-team', script)
            candle = (out / 'dist/candles.js').read_text(encoding='utf-8')
            self.assertIn('new-team', candle)
            self.assertNotIn('/RESCENE|리센느/i', candle)
            workflow = (out / '.github/workflows/collect-and-publish.yml').read_text(encoding='utf-8')
            self.assertIn("vars.COLLECT_ENABLED == 'true'", workflow)
            blocked = subprocess.run([sys.executable, 'collector/prepare_site.py'], cwd=out,
                                     capture_output=True, text=True)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn('No verified source observations', blocked.stderr)

    def test_real_shape_fixture_and_duplicate_are_recorded_once(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'tracker'
            build(self.args(out), ROOT)
            observed = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(timespec='seconds')
            fixture = {'sourceAt': observed, 'totalVotes': 1000, 'top2': [
                {'rank': 1, 'id': 'new-team', 'name': 'NEW TEAM', 'votes': 450, 'reportedShare': 45},
                {'rank': 2, 'id': 'other', 'name': 'OTHER', 'votes': 300, 'reportedShare': 30}]}
            path = out / 'observation.json'
            path.write_text(json.dumps(fixture), encoding='utf-8')
            for _ in range(2):
                result = subprocess.run([sys.executable, 'collector/collect.py', '--fixture', str(path)],
                                        cwd=out, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads((out / 'dist/data/history.json').read_text(encoding='utf-8'))
            self.assertEqual(len(data['snapshots']), 1)
            self.assertEqual(data['snapshots'][0]['sourceAt'], observed.replace('+00:00', 'Z'))
            success = subprocess.run([sys.executable, 'collector/prepare_site.py'],
                                     cwd=out, capture_output=True, text=True)
            self.assertEqual(success.returncode, 0, success.stderr)

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'tracker'
            out.mkdir()
            marker = out / 'private.txt'
            marker.write_text('untouched', encoding='utf-8')
            with self.assertRaises(FileExistsError):
                build(self.args(out), ROOT)
            self.assertEqual(marker.read_text(encoding='utf-8'), 'untouched')


if __name__ == '__main__':
    unittest.main()
