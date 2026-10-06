import copy
from datetime import datetime, timezone
import unittest
from collect import parse_text, parse_api, append_snapshot, migrate_top2

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
    def test_public_api_matches_the_visible_page_and_sorts_candidates(self):
        visible = parse_text(TEXT, NOW)
        payload = {'code': '0000', 'data': {'aggregatedAt': visible['sourceAt'],
                   'totalVotes': visible['totalVotes'], 'candidates': [
                       {'name': t['name'], 'voteCount': t['votes'],
                        'votePercentage': t['reportedShare']} for t in reversed(visible['top2'])]}}
        api = parse_api(payload, NOW)
        self.assertEqual(api['top2'], visible['top2'])
        self.assertEqual(api['sourceAt'], visible['sourceAt'])
        self.assertEqual(api['origin'], 'berriz_public_api')
        payload['data']['totalVotes'] = 100
        with self.assertRaises(ValueError):
            parse_api(payload, NOW)

    def test_capture_counts_and_timezone(self):
        s = parse_text(TEXT, NOW)
        self.assertEqual(s['sourceAt'], '2026-10-06T15:15:00Z')
        self.assertEqual(s['totalVotes'], 11195)
        self.assertEqual([t['votes'] for t in s['top2']], [3279,2895])
        self.assertEqual(s['top2'][0]['votes']-s['top2'][1]['votes'],384)

    def test_single_line_cards_and_whitespace(self):
        s = parse_text(TEXT.replace('1\nRESCENE\n', '1 RESCENE ').replace('2\nRIIZE\n','2 RIIZE '), NOW)
        self.assertEqual(len(s['top2']), 2)

    def test_inconsistent_total_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('11,195','1,195'), NOW)

    def test_inconsistent_share_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('29.3%','39.3%'), NOW)

    def test_missing_team_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('25.9% · 2,895표',''), NOW)

    def test_future_timestamp_is_rejected(self):
        with self.assertRaises(ValueError): parse_text(TEXT.replace('00:15','01:15'), NOW)

    def test_duplicate_snapshot_updates_provenance_without_adding(self):
        s=parse_text(TEXT,NOW)
        old=copy.deepcopy(s)
        old.update(origin='user_capture', collectedAt=None)
        data={'snapshots':[old]}
        self.assertFalse(append_snapshot(data,s))
        self.assertEqual(len(data['snapshots']),1)
        self.assertEqual(data['snapshots'][0]['origin'],'berriz_public_page')

    def test_conflicting_snapshot_keeps_history(self):
        s=parse_text(TEXT,NOW); data={'snapshots':[copy.deepcopy(s)]}; before=copy.deepcopy(data)
        s['top2'][0]['votes']+=1
        with self.assertRaises(ValueError): append_snapshot(data,s)
        self.assertEqual(data,before)

    def test_migration_preserves_all_leader_values_and_observation_metadata(self):
        row = parse_text(TEXT, NOW)
        expected = copy.deepcopy(row)
        row['top3'] = row.pop('top2') + [{'rank': 3, 'id': 'third', 'name': 'Third', 'votes': 839}]
        data = {'schemaVersion': 1, 'snapshots': [row], 'collector': {'state': 'ok'}}
        self.assertTrue(migrate_top2(data))
        self.assertEqual(data['snapshots'], [expected])
        self.assertEqual(data['schemaVersion'], 2)
        self.assertFalse(migrate_top2(data))

    def test_third_place_is_neither_required_nor_stored(self):
        original = parse_text(TEXT, NOW)
        changed = parse_text(TEXT.replace('7.5% · 839표', '99.9% · 999표'), NOW)
        self.assertEqual(original['top2'], changed['top2'])
        self.assertNotIn('top3', changed)
        self.assertEqual(len(changed['top2']), 2)

if __name__=='__main__': unittest.main()
