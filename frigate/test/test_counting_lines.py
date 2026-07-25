"""Tests for counting line configuration and crossing geometry."""

import unittest
from copy import deepcopy

from pydantic import ValidationError

from frigate.config import FrigateConfig


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


if __name__ == "__main__":
    unittest.main()
