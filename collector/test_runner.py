import unittest

from runner import run_for


class Clock:
    def __init__(self):
        self.now = 90.0

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
        self.assertEqual(starts, [90, 390, 690, 990])

    def test_one_failure_does_not_stop_the_next_collection(self):
        clock = Clock()
        starts = []

        def cycle():
            starts.append(clock.now)
            clock.now += 3
            return 'error' if len(starts) == 1 else 'ok'

        run_for(601, cycle, clock.read, clock.read, clock.sleep)
        self.assertEqual(starts, [90, 390, 690])

    def test_stopped_source_exits_without_waiting(self):
        clock = Clock()
        self.assertEqual(run_for(1000, lambda: 'stopped', clock.read,
                                 clock.read, clock.sleep), 0)
        self.assertEqual(clock.now, 90)

    def test_deadline_is_respected_during_wait(self):
        clock = Clock()
        run_for(5, lambda: 'ok', clock.read, clock.read, clock.sleep)
        self.assertEqual(clock.now, 95)


if __name__ == '__main__':
    unittest.main()
