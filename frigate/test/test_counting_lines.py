"""Tests for counting line configuration and crossing geometry."""

import unittest
from copy import deepcopy

from pydantic import ValidationError

from frigate.config import FrigateConfig
from frigate.track.tracked_object import (
    check_line_crossing,
    line_side,
    segments_intersect,
)


class TestCountingLineConfig(unittest.TestCase):
    def setUp(self):
        self.minimal = {
            "mqtt": {"host": "mqtt"},
            "cameras": {
                "back": {
                    "ffmpeg": {
                        "inputs": [
                            {"path": "rtsp://10.0.0.1:554/video", "roles": ["detect"]}
                        ]
                    },
                    "detect": {"height": 1080, "width": 1920, "fps": 5},
                }
            },
        }

    def test_line_endpoints_scaled_to_pixels(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "entrance": {"coordinates": "0.5,0.0,0.5,1.0"}
        }
        frigate_config = FrigateConfig(**config)
        line = frigate_config.cameras["back"].counting_lines["entrance"]
        assert line.start == (960, 0)
        assert line.end == (960, 1080)
        assert line.objects == ["person"]
        assert line.reverse is False
        assert line.enabled is True

    def test_hysteresis_covers_a_band_around_the_line(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "entrance": {"coordinates": "0.5,0.0,0.5,1.0"}
        }
        frigate_config = FrigateConfig(**config)
        line = frigate_config.cameras["back"].counting_lines["entrance"]

        # 1.5% of a 1080 tall frame, so anchors within ~16px of the line
        # are inconclusive while anything past that counts
        assert abs(line_side(line.start, line.end, (945, 500))) < line.hysteresis
        assert abs(line_side(line.start, line.end, (930, 500))) > line.hysteresis

    def test_line_rejects_wrong_point_count(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "bad": {"coordinates": "0.5,0.0,0.5,1.0,0.6,0.5"}
        }
        with self.assertRaises((ValidationError, ValueError)):
            FrigateConfig(**config)

    def test_line_rejects_absolute_coordinates(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "bad": {"coordinates": "100,0,100,700"}
        }
        with self.assertRaises((ValidationError, ValueError)):
            FrigateConfig(**config)

    def test_objects_string_coerced_to_list(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "entrance": {"coordinates": "0.5,0.0,0.5,1.0", "objects": "person"}
        }
        frigate_config = FrigateConfig(**config)
        line = frigate_config.cameras["back"].counting_lines["entrance"]
        assert line.objects == ["person"]

    def test_line_rejects_untracked_objects(self):
        config = deepcopy(self.minimal)
        config["cameras"]["back"]["counting_lines"] = {
            "entrance": {"coordinates": "0.5,0.0,0.5,1.0", "objects": ["dog"]}
        }
        with self.assertRaises((ValidationError, ValueError)):
            FrigateConfig(**config)


class TestCrossingGeometry(unittest.TestCase):
    # vertical line from (100, 0) down to (100, 200)
    START = (100, 0)
    END = (100, 200)

    def test_line_side_signs(self):
        # screen coords, y down: A->B points down, x < 100 is side > 0
        assert line_side(self.START, self.END, (150, 100)) < 0
        assert line_side(self.START, self.END, (50, 100)) > 0
        assert line_side(self.START, self.END, (100, 50)) == 0

    def test_segments_intersect(self):
        assert segments_intersect((50, 100), (150, 100), self.START, self.END)
        # parallel, never touches
        assert not segments_intersect((50, 10), (50, 190), self.START, self.END)
        # crosses the infinite line but beyond the segment end
        assert not segments_intersect((50, 300), (150, 300), self.START, self.END)

    def test_crossing_direction(self):
        prev, cur = (50, 100), (150, 100)
        prev_side = line_side(self.START, self.END, prev)
        side = line_side(self.START, self.END, cur)
        assert (
            check_line_crossing(prev_side, side, prev, cur, self.START, self.END, False)
            == "out"
        )
        assert (
            check_line_crossing(side, prev_side, cur, prev, self.START, self.END, False)
            == "in"
        )

    def test_crossing_reversed(self):
        prev, cur = (50, 100), (150, 100)
        prev_side = line_side(self.START, self.END, prev)
        side = line_side(self.START, self.END, cur)
        assert (
            check_line_crossing(prev_side, side, prev, cur, self.START, self.END, True)
            == "in"
        )

    def test_no_crossing_same_side(self):
        p1, p2 = (150, 100), (180, 120)
        s1 = line_side(self.START, self.END, p1)
        s2 = line_side(self.START, self.END, p2)
        assert check_line_crossing(s1, s2, p1, p2, self.START, self.END, False) is None

    def test_no_crossing_beyond_segment(self):
        # sign flips but movement passes below the line's end point
        p1, p2 = (50, 300), (150, 300)
        s1 = line_side(self.START, self.END, p1)
        s2 = line_side(self.START, self.END, p2)
        assert check_line_crossing(s1, s2, p1, p2, self.START, self.END, False) is None


if __name__ == "__main__":
    unittest.main()
