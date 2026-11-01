import unittest
from types import SimpleNamespace as NS

from turns import annotation_to_turns, speaker_bounds, speakers_in_order


class FakeAnnotation:
    def __init__(self, tracks):
        self._tracks = tracks

    def itertracks(self, yield_label=False):
        assert yield_label
        return iter(self._tracks)


class AnnotationToTurns(unittest.TestCase):
    def test_orders_by_time_rounds_and_keeps_labels(self):
        ann = FakeAnnotation([
            (NS(start=5.00049, end=7.5), "t1", "SPEAKER_01"),
            (NS(start=0.0, end=4.9996), "t0", "SPEAKER_00"),
        ])
        self.assertEqual(annotation_to_turns(ann), [
            {"start": 0.0, "end": 5.0, "speaker": "SPEAKER_00"},
            {"start": 5.0, "end": 7.5, "speaker": "SPEAKER_01"},
        ])

    def test_drops_zero_length_turns(self):
        ann = FakeAnnotation([(NS(start=1.0, end=1.0), "a", "SPEAKER_00"), (NS(start=1.0, end=2.0), "b", "SPEAKER_00")])
        self.assertEqual(len(annotation_to_turns(ann)), 1)

    def test_empty(self):
        self.assertEqual(annotation_to_turns(FakeAnnotation([])), [])


class Speakers(unittest.TestCase):
    def test_first_appearance_order(self):
        turns = [{"speaker": "B"}, {"speaker": "A"}, {"speaker": "B"}]
        self.assertEqual(speakers_in_order(turns), ["B", "A"])


class Bounds(unittest.TestCase):
    def test_exact_wins_over_range(self):
        self.assertEqual(speaker_bounds(2, 1, 5), {"num_speakers": 2})

    def test_range_and_single_bounds(self):
        self.assertEqual(speaker_bounds(None, 2, 4), {"min_speakers": 2, "max_speakers": 4})
        self.assertEqual(speaker_bounds(None, None, 3), {"max_speakers": 3})
        self.assertEqual(speaker_bounds(None, 2, None), {"min_speakers": 2})

    def test_reversed_range_is_fixed_and_junk_ignored(self):
        self.assertEqual(speaker_bounds(None, 5, 2), {"min_speakers": 2, "max_speakers": 5})
        self.assertEqual(speaker_bounds(0, -1, "x"), {})
        self.assertEqual(speaker_bounds(None, None, None), {})


if __name__ == "__main__":
    unittest.main()
