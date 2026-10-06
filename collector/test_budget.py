import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collect
import lifecycle
from policy import END_AT, MAX_RECORDS, end_at
from test_collect import TEXT, NOW


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.history = Path(self.tmp.name)/'history.json'
        self.patch = patch.object(collect, 'HISTORY', self.history)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        clock_patch = patch.object(collect, 'datetime', wraps=datetime)
        clock = clock_patch.start()
        clock.now.return_value = NOW
        self.addCleanup(clock_patch.stop)

    def data(self):
        snap = collect.parse_text(TEXT, NOW)
        return {'schemaVersion': 1, 'sourceUrl': collect.URL,
                'collector': {'state': 'ok'}, 'snapshots': [snap]}

    def test_full_history_is_preserved_and_live_window_is_bounded(self):
        data = self.data()
        data['snapshots'] = [dict(data['snapshots'][0], sourceAt=f'2026-10-06T15:{n:02}:00Z')
                             for n in (15, 20, 25, 30, 35)]
        collect.save(data)
        full = json.loads(self.history.read_text())
        recent = json.loads((self.history.parent/'latest.json').read_text())
        self.assertEqual(full['snapshots'], data['snapshots'])
        self.assertEqual(recent['snapshots'], data['snapshots'][-3:])
        self.assertEqual(recent['historyCount'], 5)

    def test_repeated_same_source_does_not_commit_a_new_heartbeat(self):
        data = self.data()
        collect.save(data)
        original = self.history.read_bytes()
        with patch.object(collect, 'load_public_text', return_value=TEXT):
            self.assertEqual(collect.collect_once(), 0)
        self.assertEqual(self.history.read_bytes(), original)

    def test_end_never_reads_the_source_and_marks_stopped(self):
        collect.save(self.data())
        with patch.object(collect, 'load_public_text') as read:
            self.assertEqual(collect.collect_once(until='2000-01-01T00:00:00Z'), 0)
            read.assert_not_called()
        self.assertEqual(json.loads(self.history.read_text())['collector']['state'], 'stopped')

    def test_accidental_extension_cannot_bypass_the_fixed_end(self):
        self.assertEqual(end_at('2099-01-01T00:00:00Z').isoformat(),
                         '2026-10-20T15:45:00+00:00')
        with self.assertRaises(ValueError):
            end_at('2026-10-07T01:00:00')

    def test_record_cap_keeps_the_last_valid_file(self):
        data = self.data();collect.save(data)
        before = self.history.read_bytes()
        data['snapshots'] *= MAX_RECORDS + 1
        with self.assertRaises(ValueError):
            collect.save(data)
        self.assertEqual(self.history.read_bytes(), before)

    def test_workflow_disable_only_runs_after_end(self):
        fixed = datetime(2026, 10, 20, 15, 45, tzinfo=timezone.utc)
        with patch.object(lifecycle, 'end_at', return_value=fixed), \
             patch.object(lifecycle, 'datetime') as clock, \
             patch.object(lifecycle.subprocess, 'run') as request, \
             patch.dict(lifecycle.os.environ, {'GITHUB_REPOSITORY': 'owner/repo'}):
            clock.now.return_value = datetime(2026, 10, 7, tzinfo=timezone.utc)
            lifecycle.main();request.assert_not_called()
            clock.now.return_value = fixed
            lifecycle.main()
            self.assertEqual(request.call_args.args[0], ['gh', 'api', '--method', 'PUT',
                'repos/owner/repo/actions/workflows/collect-and-publish.yml/disable'])


if __name__ == '__main__':
    unittest.main()
