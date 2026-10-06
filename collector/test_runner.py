import unittest

from runner import run_for


class Clock:
    def __init__(self):
        self.now = 120.0

    def read(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class RunnerTests(unittest.TestCase):
    def test_fixed_clock_does_not_drift_with_collection_duration(self):
        clock = Clock()
        starts = []

        def cycle():
            starts.append(clock.now)
            clock.now += 17
            return 'ok'

        run_for(901, cycle, clock.read, clock.read, clock.sleep)
        self.assertEqual(starts, [120, 420, 720, 1020])

    def test_one_failure_does_not_stop_the_next_collection(self):
        clock = Clock()
        starts = []

        def cycle():
            starts.append(clock.now)
            clock.now += 3
            return 'error' if len(starts) == 1 else 'ok'

        run_for(601, cycle, clock.read, clock.read, clock.sleep)
        self.assertEqual(starts, [120, 143, 420, 720])

    def test_stopped_source_exits_without_waiting(self):
        clock = Clock()
        self.assertEqual(run_for(1000, lambda: 'stopped', clock.read,
                                 clock.read, clock.sleep), 0)
        self.assertEqual(clock.now, 120)

    def test_waiting_for_public_update_retries_without_waiting_five_minutes(self):
        clock = Clock()
        starts = []

        def cycle():
            starts.append(clock.now)
            return 'waiting' if len(starts) < 3 else 'ok'

        run_for(301, cycle, clock.read, clock.read, clock.sleep)
        self.assertEqual(starts, [120, 140, 160, 420])

    def test_waiting_retries_are_bounded_within_the_update_window(self):
        clock = Clock()
        starts = []

        def cycle():
            starts.append(clock.now)
            return 'waiting'

        run_for(301, cycle, clock.read, clock.read, clock.sleep)
        self.assertIn(240, starts)
        self.assertNotIn(260, starts)
        self.assertEqual(starts[-1], 420)

    def test_deadline_is_respected_during_wait(self):
        clock = Clock()
        run_for(5, lambda: 'ok', clock.read, clock.read, clock.sleep)
        self.assertEqual(clock.now, 125)


if __name__ == '__main__':
    unittest.main()
