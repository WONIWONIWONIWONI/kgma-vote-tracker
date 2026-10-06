import copy
from datetime import datetime, timezone
from pathlib import Path
import json
import unittest
from collect import parse_text, append_snapshot

TEXT = '''총 투표수
11,195
2026.10.07 00:15 (KST) 기준 · 5분 단위 갱신
1
RESCENE
29.3% · 3,279표
2
RIIZE
25.9% · 2,895표
3
SHOWNU X HYUNGWON
7.5% · 839표
4
ALPHA DRIVE ONE
6.8% · 760표'''
NOW = datetime(2026, 10, 6, 15, 30, tzinfo=timezone.utc)

class CollectorTests(unittest.TestCase):
    def test_capture_counts_and_timezone(self):
        s = parse_text(TEXT, NOW)
        self.assertEqual(s['sourceAt'], '2026-10-06T15:15:00Z')
        self.assertEqual(s['totalVotes'], 11195)
        self.assertEqual([t['votes'] for t in s['top3']], [3279,2895,839])
        self.assertEqual(s['top3'][0]['votes']-s['top3'][1]['votes'],384)

    def test_single_line_cards_and_whitespace(self):
        s = parse_text(TEXT.replace('1\nRESCENE\n', '1 RESCENE ').replace('2\nRIIZE\n','2 RIIZE '), NOW)
        self.assertEqual(len(s['top3']), 3)

    def test_inconsistent_total_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('11,195','1,195'), NOW)

    def test_inconsistent_share_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('29.3%','39.3%'), NOW)

    def test_missing_team_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('7.5% · 839표',''), NOW)

    def test_future_timestamp_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('00:15','01:15'), NOW)

    def test_duplicate_snapshot_updates_provenance_without_adding(self):
        data=json.loads((Path(__file__).resolve().parents[1]/'dist/data/history.json').read_text())
        s=parse_text(TEXT,NOW)
        self.assertFalse(append_snapshot(data,s))
        self.assertEqual(len(data['snapshots']),1)
        self.assertEqual(data['snapshots'][0]['origin'],'berriz_public_page')

    def test_conflicting_snapshot_keeps_history(self):
        s=parse_text(TEXT,NOW); data={'snapshots':[copy.deepcopy(s)]}; before=copy.deepcopy(data)
        s['top3'][0]['votes']+=1
        with self.assertRaises(ValueError): append_snapshot(data,s)
        self.assertEqual(data,before)

if __name__=='__main__': unittest.main()
