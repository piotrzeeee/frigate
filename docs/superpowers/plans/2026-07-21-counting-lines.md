# Counting Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native per-camera counting lines: every tracked object crossing a configured virtual line is stored with a direction (in/out), exposed over a new API, and shown in a new "Counting" tab in the Frigate UI with a line editor in Settings.

**Architecture:** Config model next to `ZoneConfig`; crossing detection inside `TrackedObject.update()` (same place zones are evaluated); persistence via the fork's proven path (topic constant in `const.py`, ZMQ `InterProcessRequestor`, DB write in a `dispatcher.py` handler); new FastAPI router; React page plus a 2-point variant of the existing polygon editor.

**Tech Stack:** Python 3.13 / Pydantic / Peewee / FastAPI backend; React + TypeScript + SWR + ApexCharts + react-konva frontend.

Spec: `docs/superpowers/specs/2026-07-21-counting-lines-design.md`.

## Global Constraints

- American English everywhere; NO em dashes in docs, comments, or strings (repo rule).
- Python: lazy logging (`logger.debug("x %s", v)`), no periods at end of log messages, comprehensive type hints, run tests with `python3 -u -m unittest`.
- Every user-facing UI string goes through `t()` with keys added to `web/public/locales/en/**`; after adding keys run `npm run i18n:extract` from `web/`.
- After changing Pydantic config models run `python3 generate_config_translations.py` (repo root); never hand-edit `web/public/locales/en/config/*.json`.
- After adding/changing API endpoints run `python3 generate_api_auth_spec.py` (repo root); never hand-edit `docs/static/frigate-api.yaml`.
- Formatting: `ruff format frigate/` and `ruff check frigate/`; frontend `npm run lint` from `web/`.
- Direction semantics (fixed by spec): line is a vector from point A (first pair) to point B (second pair); in screen coordinates (y down), an object ending on the side where the cross product `(B-A) x (P-A)` is positive crossed "in"; `reverse: true` swaps in/out.
- Commit after each task with a short imperative message ending in the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: CountingLineConfig (config model + wiring)

**Files:**
- Create: `frigate/config/camera/counting_line.py`
- Modify: `frigate/config/camera/__init__.py` (star-import list)
- Modify: `frigate/config/camera/camera.py` (field next to `zones`, ~line 193)
- Modify: `frigate/config/config.py` (finalize block, after zone contour generation at ~line 986)
- Modify: `frigate/config/profile_manager.py` (mirror of zone regeneration at ~line 283)
- Test: `frigate/test/test_counting_lines.py`

**Interfaces:**
- Consumes: `FrigateBaseModel` (`frigate/config/base.py`), zone conventions from `frigate/config/camera/zone.py`.
- Produces: `CountingLineConfig` with fields `friendly_name: str | None`, `enabled: bool = True`, `coordinates: str`, `objects: list[str] = ["person"]`, `reverse: bool = False`; method `generate_line(frame_shape: tuple[int, int]) -> None`; properties `start: tuple[int, int]`, `end: tuple[int, int]` (pixel coords). `CameraConfig.counting_lines: dict[str, CountingLineConfig]`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `frigate/test/test_counting_lines.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -u -m unittest frigate.test.test_counting_lines -v`
Expected: FAIL (`counting_lines` is rejected as extra field / attribute missing).

- [ ] **Step 3: Implement the config model**

Create `frigate/config/camera/counting_line.py`:

```python
"""Counting line configuration."""

import logging

from pydantic import Field, PrivateAttr, field_validator

from ..base import FrigateBaseModel

__all__ = ["CountingLineConfig"]

logger = logging.getLogger(__name__)


class CountingLineConfig(FrigateBaseModel):
    friendly_name: str | None = Field(
        None,
        title="Counting line name",
        description="A user-friendly name for the counting line, displayed in the Frigate UI. If not set, a formatted version of the line name will be used.",
    )
    enabled: bool = Field(
        default=True,
        title="Enabled",
        description="Enable or disable this counting line. Disabled lines are ignored at runtime.",
    )
    coordinates: str = Field(
        title="Coordinates",
        description="Two points that define the counting line as relative (0-1) coordinates in the form x1,y1,x2,y2. Walking along the line from the first point to the second, objects passing from your left to your right are counted as in.",
    )
    objects: str | list[str] = Field(
        default=["person"],
        title="Counted objects",
        description="List of object types (from labelmap) that are counted when crossing this line. If empty, all objects are counted.",
    )
    reverse: bool = Field(
        default=False,
        title="Reverse direction",
        description="Swap the in and out directions of the line.",
    )

    _start: tuple[int, int] = PrivateAttr(default=(0, 0))
    _end: tuple[int, int] = PrivateAttr(default=(0, 0))

    @property
    def start(self) -> tuple[int, int]:
        return self._start

    @property
    def end(self) -> tuple[int, int]:
        return self._end

    def get_formatted_name(self, line_name: str) -> str:
        """Return the friendly name if set, otherwise a formatted version of the line name."""
        if self.friendly_name:
            return self.friendly_name
        return line_name.replace("_", " ").title()

    @field_validator("objects", mode="before")
    @classmethod
    def validate_objects(cls, v):
        if isinstance(v, str) and "," not in v:
            return [v]

        return v

    def generate_line(self, frame_shape: tuple[int, int]) -> None:
        """Convert relative coordinates to pixel endpoints for the camera frame."""
        points = self.coordinates.split(",")

        if len(points) != 4:
            raise ValueError(
                f"Counting line coordinates must contain exactly 2 points (x1,y1,x2,y2): {self.coordinates}"
            )

        try:
            values = [float(p) for p in points]
        except ValueError:
            raise ValueError(
                f"Invalid counting line coordinates: {self.coordinates}"
            ) from None

        if any(v < 0 or v > 1 for v in values):
            raise ValueError(
                f"Counting line coordinates must be relative (between 0-1): {self.coordinates}"
            )

        self._start = (
            int(values[0] * frame_shape[1]),
            int(values[1] * frame_shape[0]),
        )
        self._end = (
            int(values[2] * frame_shape[1]),
            int(values[3] * frame_shape[0]),
        )
```

In `frigate/config/camera/__init__.py`, add to the star-import list (alphabetical, after `.camera`):

```python
from .counting_line import *  # noqa: F403
```

In `frigate/config/camera/camera.py`, add the import next to `from .zone import ZoneConfig` (line 42):

```python
from .counting_line import CountingLineConfig
```

and the field directly after the `zones` field (~line 197):

```python
    counting_lines: dict[str, CountingLineConfig] = Field(
        default_factory=dict,
        title="Counting lines",
        description="Counting lines count objects that cross a virtual line, with a direction (in or out).",
    )
```

In `frigate/config/config.py`, directly after the zone finalize block (after `zone.enabled_in_config = zone.enabled` loop, ~line 989):

```python
            # generate counting line endpoints
            for line in camera_config.counting_lines.values():
                line.generate_line(camera_config.frame_shape)
```

In `frigate/config/profile_manager.py`, directly after the zone regeneration loop (`zone.generate_contour(cam_config.frame_shape)`, ~line 283), add the same two-line loop for `cam_config.counting_lines.values()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -u -m unittest frigate.test.test_counting_lines -v`
Expected: PASS (4 tests).
Also run: `python3 -u -m unittest frigate.test.test_config` to catch regressions.

- [ ] **Step 5: Regenerate config translations, format, commit**

```bash
python3 generate_config_translations.py
ruff format frigate/ && ruff check frigate/
git add frigate/config/ frigate/test/test_counting_lines.py web/public/locales/en/config/
git commit -m "Add counting line configuration model"
```

---

### Task 2: Crossing geometry + TrackedObject hook

**Files:**
- Modify: `frigate/track/tracked_object.py` (module-level helpers near `zone_filtered` at line 545; state in `__init__` near line 60; detection block in `update()` after `self.pending_loitering = in_loitering_zone` at ~line 301)
- Test: `frigate/test/test_counting_lines.py` (append)

**Interfaces:**
- Consumes: `CountingLineConfig.start/end/objects/enabled/reverse` from Task 1; existing `bottom_center` anchor (line 183) and `self.obj_data` (previous frame data until line 380).
- Produces: module functions `line_side(a, b, p) -> float`, `segments_intersect(p1, p2, q1, q2) -> bool`, `check_line_crossing(prev_side, side, prev_anchor, anchor, start, end, reverse) -> str | None`; instance state `TrackedObject.line_sides: dict[str, float]` and `TrackedObject.pending_line_crossings: list[dict[str, Any]]`. Task 3 drains `pending_line_crossings`; each entry has keys `camera, line, label, direction, timestamp, event_id`.

- [ ] **Step 1: Write the failing tests**

Append to `frigate/test/test_counting_lines.py`:

```python
from frigate.track.tracked_object import (
    check_line_crossing,
    line_side,
    segments_intersect,
)


class TestCrossingGeometry(unittest.TestCase):
    # vertical line from (100, 0) down to (100, 200)
    START = (100, 0)
    END = (100, 200)

    def test_line_side_signs(self):
        # screen coords, y down: A->B points down, x > 100 is side > 0
        assert line_side(self.START, self.END, (150, 100)) > 0
        assert line_side(self.START, self.END, (50, 100)) < 0
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
            check_line_crossing(
                prev_side, side, prev, cur, self.START, self.END, False
            )
            == "in"
        )
        assert (
            check_line_crossing(
                side, prev_side, cur, prev, self.START, self.END, False
            )
            == "out"
        )

    def test_crossing_reversed(self):
        prev, cur = (50, 100), (150, 100)
        prev_side = line_side(self.START, self.END, prev)
        side = line_side(self.START, self.END, cur)
        assert (
            check_line_crossing(
                prev_side, side, prev, cur, self.START, self.END, True
            )
            == "out"
        )

    def test_no_crossing_same_side(self):
        p1, p2 = (150, 100), (180, 120)
        s1 = line_side(self.START, self.END, p1)
        s2 = line_side(self.START, self.END, p2)
        assert (
            check_line_crossing(s1, s2, p1, p2, self.START, self.END, False) is None
        )

    def test_no_crossing_beyond_segment(self):
        # sign flips but movement passes below the line's end point
        p1, p2 = (50, 300), (150, 300)
        s1 = line_side(self.START, self.END, p1)
        s2 = line_side(self.START, self.END, p2)
        assert (
            check_line_crossing(s1, s2, p1, p2, self.START, self.END, False) is None
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -u -m unittest frigate.test.test_counting_lines -v`
Expected: FAIL with ImportError (`line_side` not defined).

- [ ] **Step 3: Implement helpers and the hook**

In `frigate/track/tracked_object.py`, add module-level functions after `zone_filtered` (line 545+):

```python
def line_side(
    a: tuple[int, int], b: tuple[int, int], p: tuple[float, float]
) -> float:
    """Return which side of the directed line A->B point P is on.

    Sign of the 2D cross product; 0 means P is exactly on the line.
    """
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def segments_intersect(
    p1: tuple[float, float],
    p2: tuple[float, float],
    q1: tuple[int, int],
    q2: tuple[int, int],
) -> bool:
    """Return True if segment p1-p2 strictly crosses segment q1-q2."""
    d1 = line_side(q1, q2, p1)
    d2 = line_side(q1, q2, p2)
    d3 = line_side(p1, p2, q1)
    d4 = line_side(p1, p2, q2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def check_line_crossing(
    prev_side: float,
    side: float,
    prev_anchor: tuple[float, float],
    anchor: tuple[float, float],
    start: tuple[int, int],
    end: tuple[int, int],
    reverse: bool,
) -> str | None:
    """Return "in" or "out" if the anchor movement crossed the line, else None.

    Walking along the line from start to end, an object passing from the
    left to the right is "in" unless reverse is set.
    """
    if prev_side == 0 or side == 0:
        return None
    if (prev_side > 0) == (side > 0):
        return None
    if not segments_intersect(prev_anchor, anchor, start, end):
        return None

    direction = "in" if side > 0 else "out"
    if reverse:
        return "out" if direction == "in" else "in"
    return direction
```

In `TrackedObject.__init__` (next to `self.zone_presence` etc., ~line 60):

```python
        self.line_sides: dict[str, float] = {}
        self.pending_line_crossings: list[dict[str, Any]] = []
```

In `TrackedObject.update()`, insert after `self.pending_loitering = in_loitering_zone` (~line 301). At this point `bottom_center` still holds the current-frame absolute anchor from line 183 and `self.obj_data` still holds the previous frame:

```python
        # check counting lines; self.obj_data still holds the previous
        # frame here, so it provides the previous anchor position
        if self.camera_config.counting_lines and not self.false_positive:
            prev_anchor = (self.obj_data["centroid"][0], self.obj_data["box"][3])
            for name, line in self.camera_config.counting_lines.items():
                if not line.enabled:
                    continue
                if len(line.objects) > 0 and obj_data["label"] not in line.objects:
                    continue

                side = line_side(line.start, line.end, bottom_center)
                prev_side = self.line_sides.get(name, 0)
                direction = check_line_crossing(
                    prev_side,
                    side,
                    prev_anchor,
                    bottom_center,
                    line.start,
                    line.end,
                    line.reverse,
                )

                if direction is not None:
                    self.pending_line_crossings.append(
                        {
                            "camera": self.camera_config.name,
                            "line": name,
                            "label": obj_data["label"],
                            "direction": direction,
                            "timestamp": obj_data["frame_time"],
                            "event_id": self.obj_data["id"],
                        }
                    )
                    # a crossing must reach the update callback promptly
                    significant_change = True
                    logger.debug(
                        "%s: object %s crossed line %s direction %s",
                        self.camera_config.name,
                        self.obj_data["id"],
                        name,
                        direction,
                    )

                if side != 0:
                    self.line_sides[name] = side
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -u -m unittest frigate.test.test_counting_lines -v`
Expected: PASS. Also run the full suite: `python3 -u -m unittest` (pre-existing failures unrelated to this change are acceptable; note them).

- [ ] **Step 5: Format and commit**

```bash
ruff format frigate/ && ruff check frigate/
git add frigate/track/tracked_object.py frigate/test/test_counting_lines.py
git commit -m "Detect counting line crossings in tracked object updates"
```

---

### Task 3: Persistence (model, migration, dispatcher, drain)

**Files:**
- Modify: `frigate/models.py` (add `AutoField` to the peewee import list at lines 1-12; new model at end)
- Create: `migrations/038_create_line_crossing_table.py`
- Modify: `frigate/app.py` (model import at ~line 59; bind list at ~line 278)
- Modify: `frigate/const.py` (topic constant near `UPSERT_REVIEW_SEGMENT`, ~line 133)
- Modify: `frigate/comms/dispatcher.py` (handler near `handle_upsert_review_segment` at ~line 174; handler map at ~line 353; imports)
- Modify: `frigate/track/object_processing.py` (drain in `update` and `end` callbacks, ~lines 130 and 200; import)

**Interfaces:**
- Consumes: `TrackedObject.pending_line_crossings` dicts from Task 2 (keys `camera, line, label, direction, timestamp, event_id`); `self.requestor` (`InterProcessRequestor`) already present in `TrackedObjectProcessor` (line 89).
- Produces: `LineCrossing` peewee model (fields `id, camera, line, label, direction, timestamp, event_id`; `timestamp` stores epoch floats like other tables); topic constant `INSERT_LINE_CROSSING = "insert_line_crossing"`. Task 4 queries `LineCrossing`.

- [ ] **Step 1: Add the model**

In `frigate/models.py` add `AutoField,` to the peewee import block, then append:

```python
class LineCrossing(Model):
    id = AutoField()
    camera = CharField(index=True, max_length=20)
    line = CharField(max_length=50)
    label = CharField(max_length=20)
    direction = CharField(max_length=3)
    timestamp = DateTimeField(index=True)
    event_id = CharField(null=True, max_length=30)
```

- [ ] **Step 2: Write the migration**

Create `migrations/038_create_line_crossing_table.py` (template: `migrations/037_create_alarm_tables.py`):

```python
"""Peewee migrations -- 038_create_line_crossing_table.py.

This migration creates the linecrossing table, which stores one row per
tracked object crossing of a configured counting line.
"""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS linecrossing (
            id INTEGER NOT NULL PRIMARY KEY,
            camera VARCHAR(20) NOT NULL,
            line VARCHAR(50) NOT NULL,
            label VARCHAR(20) NOT NULL,
            direction VARCHAR(3) NOT NULL,
            timestamp DATETIME NOT NULL,
            event_id VARCHAR(30)
        )
        """
    )
    migrator.sql(
        "CREATE INDEX IF NOT EXISTS linecrossing_camera_timestamp"
        " ON linecrossing (camera, timestamp)"
    )
    migrator.sql(
        "CREATE INDEX IF NOT EXISTS linecrossing_timestamp"
        " ON linecrossing (timestamp)"
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql("DROP TABLE IF EXISTS linecrossing")
```

- [ ] **Step 3: Bind the model and add the topic**

In `frigate/app.py`: add `LineCrossing` to the `from frigate.models import (...)` block (~line 59) and to the `models = [...]` bind list (~line 278), keeping alphabetical order.

In `frigate/const.py`, next to `UPSERT_REVIEW_SEGMENT` (~line 133):

```python
INSERT_LINE_CROSSING = "insert_line_crossing"
```

- [ ] **Step 4: Dispatcher handler**

In `frigate/comms/dispatcher.py`:
- add `INSERT_LINE_CROSSING` to the `frigate.const` import block and `LineCrossing` to the `frigate.models` import block,
- next to `handle_upsert_review_segment` (~line 174) add:

```python
        def handle_insert_line_crossing() -> None:
            LineCrossing.insert(payload).execute()
```

- add to the handler map (~line 353):

```python
            INSERT_LINE_CROSSING: handle_insert_line_crossing,
```

- [ ] **Step 5: Drain pending crossings in TrackedObjectProcessor**

In `frigate/track/object_processing.py`, add `INSERT_LINE_CROSSING` to the `frigate.const` import block. At the TOP of the `update` callback (line 130, before `obj.has_snapshot = ...`) and at the TOP of the `end` callback, add the identical drain:

```python
            if obj.pending_line_crossings:
                for crossing in obj.pending_line_crossings:
                    self.requestor.send_data(INSERT_LINE_CROSSING, crossing)
                obj.pending_line_crossings = []
```

(The `end` drain catches an object whose final crossing happened right before it left the frame.)

- [ ] **Step 6: Verify and commit**

Run: `python3 -u -m unittest frigate.test.test_counting_lines frigate.test.test_config -v`
Expected: PASS (persistence is exercised end to end by the HTTP tests in Task 4, which run the real migration).

```bash
ruff format frigate/ && ruff check frigate/
git add frigate/models.py migrations/038_create_line_crossing_table.py frigate/app.py frigate/const.py frigate/comms/dispatcher.py frigate/track/object_processing.py
git commit -m "Persist counting line crossings to the database"
```

---

### Task 4: Counting API

**Files:**
- Create: `frigate/api/counting.py`
- Create: `frigate/api/defs/query/counting_query_parameters.py`
- Modify: `frigate/api/defs/tags.py` (new enum member)
- Modify: `frigate/api/fastapi_app.py` (import at lines 16-31, include at lines 132-148)
- Test: `frigate/test/http_api/test_http_counting.py`

**Interfaces:**
- Consumes: `LineCrossing` model (Task 3); auth helpers `allow_any_authenticated`, `get_allowed_cameras_for_filter` from `frigate/api/auth.py` (pattern: `frigate/api/preview.py:31-56`).
- Produces: `GET /counting/crossings` returning a JSON list of `{id, camera, line, label, direction, timestamp, event_id}`; `GET /counting/summary` returning a JSON list of `{camera, line, bucket, count_in, count_out}` where `bucket` is `YYYY-MM-DDTHH:00` (hour) or `YYYY-MM-DD` (day) in server local time. The UI (Task 5) relies on these exact shapes.

- [ ] **Step 1: Write the failing tests**

Create `frigate/test/http_api/test_http_counting.py` (harness pattern: `frigate/test/http_api/test_http_review.py`):

```python
"""Tests for the counting line APIs."""

from fastapi.testclient import TestClient

from frigate.api.auth import get_allowed_cameras_for_filter, get_current_user
from frigate.models import LineCrossing
from frigate.test.http_api.base_http_test import BaseTestHttp

BASE_TS = 1750000000.0


class TestHttpCounting(BaseTestHttp):
    def setUp(self):
        super().setUp([LineCrossing])
        self.app = self.create_app()
        self.app.dependency_overrides[get_current_user] = lambda: {
            "username": "admin",
            "role": "admin",
        }
        self.app.dependency_overrides[get_allowed_cameras_for_filter] = lambda: [
            "front_door"
        ]

    def tearDown(self):
        self.app.dependency_overrides.clear()
        super().tearDown()

    def _insert(self, direction: str, ts_offset: float, camera: str = "front_door"):
        LineCrossing.insert(
            camera=camera,
            line="entrance",
            label="person",
            direction=direction,
            timestamp=BASE_TS + ts_offset,
            event_id="1750000000.0-abc123",
        ).execute()

    def test_crossings_returns_rows_in_range(self):
        self._insert("in", 0)
        self._insert("out", 10)
        self._insert("in", 9999)
        with TestClient(self.app) as client:
            resp = client.get(
                "/counting/crossings",
                params={"after": BASE_TS - 1, "before": BASE_TS + 100},
            )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 2
        assert rows[0]["direction"] == "out"  # newest first
        assert rows[1]["direction"] == "in"

    def test_crossings_excludes_unlisted_camera(self):
        self._insert("in", 0, camera="garage")
        with TestClient(self.app) as client:
            resp = client.get("/counting/crossings")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_summary_buckets_by_hour(self):
        self._insert("in", 0)
        self._insert("in", 1)
        self._insert("out", 2)
        self._insert("in", 3600)  # next hour bucket
        with TestClient(self.app) as client:
            resp = client.get(
                "/counting/summary",
                params={
                    "after": BASE_TS - 1,
                    "before": BASE_TS + 7200,
                    "bucket": "hour",
                },
            )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 2
        assert rows[0]["count_in"] == 2
        assert rows[0]["count_out"] == 1
        assert rows[1]["count_in"] == 1
        assert rows[1]["count_out"] == 0

    def test_summary_buckets_by_day(self):
        self._insert("in", 0)
        self._insert("out", 1)
        with TestClient(self.app) as client:
            resp = client.get(
                "/counting/summary",
                params={"after": BASE_TS - 1, "before": BASE_TS + 100, "bucket": "day"},
            )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["count_in"] == 1
        assert rows[0]["count_out"] == 1
```

Note: assertions are timezone-agnostic on purpose (bucket labels use server local time; counts and bucket cardinality do not depend on it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -u -m unittest frigate.test.http_api.test_http_counting -v`
Expected: FAIL with 404 (routes not registered).

- [ ] **Step 3: Implement query params, router, registration**

Create `frigate/api/defs/query/counting_query_parameters.py`:

```python
from typing import Literal

from pydantic import BaseModel
from pydantic.json_schema import SkipJsonSchema


class CountingQueryParams(BaseModel):
    cameras: str = "all"
    lines: str = "all"
    labels: str = "all"
    after: float | SkipJsonSchema[None] = None
    before: float | SkipJsonSchema[None] = None
    limit: int = 100
    bucket: Literal["hour", "day"] = "hour"
```

Create `frigate/api/counting.py`:

```python
"""Counting line APIs."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from peewee import Case, fn

from frigate.api.auth import (
    allow_any_authenticated,
    get_allowed_cameras_for_filter,
)
from frigate.api.defs.query.counting_query_parameters import CountingQueryParams
from frigate.api.defs.tags import Tags
from frigate.models import LineCrossing

logger = logging.getLogger(__name__)

router = APIRouter(tags=[Tags.counting])


def build_clauses(params: CountingQueryParams, allowed_cameras: list[str]) -> list:
    """Translate query params into peewee where clauses with camera access enforced."""
    if params.cameras != "all":
        cameras = [c for c in params.cameras.split(",") if c in allowed_cameras]
        if not cameras:
            raise HTTPException(status_code=403, detail="Access denied for camera")
    else:
        cameras = allowed_cameras

    clauses = [LineCrossing.camera << cameras]

    if params.lines != "all":
        clauses.append(LineCrossing.line << params.lines.split(","))
    if params.labels != "all":
        clauses.append(LineCrossing.label << params.labels.split(","))
    if params.after is not None:
        clauses.append(LineCrossing.timestamp >= params.after)
    if params.before is not None:
        clauses.append(LineCrossing.timestamp < params.before)

    return clauses


@router.get(
    "/counting/crossings",
    summary="Get raw counting line crossings",
    description="Returns individual line crossing events, newest first.",
    dependencies=[Depends(allow_any_authenticated())],
)
def get_crossings(
    params: CountingQueryParams = Depends(),
    allowed_cameras: list[str] = Depends(get_allowed_cameras_for_filter),
):
    clauses = build_clauses(params, allowed_cameras)
    crossings = list(
        LineCrossing.select()
        .where(*clauses)
        .order_by(LineCrossing.timestamp.desc())
        .limit(params.limit)
        .dicts()
    )
    return JSONResponse(content=crossings)


@router.get(
    "/counting/summary",
    summary="Get aggregated counting line counts",
    description="""Returns in/out counts per camera and line, bucketed by hour
    or day in server local time.""",
    dependencies=[Depends(allow_any_authenticated())],
)
def get_summary(
    params: CountingQueryParams = Depends(),
    allowed_cameras: list[str] = Depends(get_allowed_cameras_for_filter),
):
    clauses = build_clauses(params, allowed_cameras)
    fmt = "%Y-%m-%dT%H:00" if params.bucket == "hour" else "%Y-%m-%d"
    bucket = fn.strftime(
        fmt, fn.datetime(LineCrossing.timestamp, "unixepoch", "localtime")
    )
    rows = list(
        LineCrossing.select(
            LineCrossing.camera,
            LineCrossing.line,
            bucket.alias("bucket"),
            fn.SUM(Case(None, [(LineCrossing.direction == "in", 1)], 0)).alias(
                "count_in"
            ),
            fn.SUM(Case(None, [(LineCrossing.direction == "out", 1)], 0)).alias(
                "count_out"
            ),
        )
        .where(*clauses)
        .group_by(LineCrossing.camera, LineCrossing.line, bucket)
        .order_by(LineCrossing.camera, LineCrossing.line, bucket)
        .dicts()
    )
    return JSONResponse(content=rows)
```

In `frigate/api/defs/tags.py` add after `classification`:

```python
    counting = "Counting"
```

In `frigate/api/fastapi_app.py`: add `counting,` to the `from frigate.api import (...)` block and `app.include_router(counting.router)` after `app.include_router(classification.router)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -u -m unittest frigate.test.http_api.test_http_counting -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Regenerate OpenAPI spec, format, commit**

```bash
python3 generate_api_auth_spec.py
ruff format frigate/ && ruff check frigate/
git add frigate/api/ frigate/test/http_api/test_http_counting.py docs/static/frigate-api.yaml
git commit -m "Add counting line crossings and summary APIs"
```

---

### Task 5: Counting page in the web UI

**Files:**
- Create: `web/src/pages/Counting.tsx`
- Create: `web/public/locales/en/views/counting.json`
- Modify: `web/src/App.tsx` (lazy import ~line 19-34; route in the admin `ProtectedRoute` block at lines 102-113)
- Modify: `web/src/hooks/use-navigation.ts` (ID constant at lines 14-23; nav entry at lines 80-103)
- Modify: `web/public/locales/en/common.json` (`menu.counting` next to `menu.alarm` at ~line 265)
- Modify: `web/src/types/frigateConfig.ts` (`counting_lines` on `CameraConfig`, next to `zones` at ~line 301)

**Interfaces:**
- Consumes: `GET counting/summary` shape from Task 4 (`{camera, line, bucket, count_in, count_out}` with hour buckets `YYYY-MM-DDTHH:00`); `useSWR` array-key fetcher (`web/src/api/index.tsx:22-27`); `Chart` from `react-apexcharts` (pattern: `web/src/components/graph/SystemGraph.tsx`); `Calendar` + `Popover` from `web/src/components/ui/`.
- Produces: route `/counting`, nav id `ID_COUNTING = 11`.

- [ ] **Step 1: Type + registration plumbing**

In `web/src/types/frigateConfig.ts`, next to the `zones` field of `CameraConfig`:

```ts
  counting_lines: {
    [lineName: string]: {
      friendly_name?: string;
      enabled: boolean;
      coordinates: string;
      objects: string[];
      reverse: boolean;
    };
  };
```

In `web/src/App.tsx`: `const Counting = lazy(() => import("@/pages/Counting"));` and inside the admin `ProtectedRoute` block: `<Route path="/counting" element={<Counting />} />`.

In `web/src/hooks/use-navigation.ts`: `export const ID_COUNTING = 11;` and a nav entry after the alarm entry:

```ts
        {
          id: ID_COUNTING,
          variant,
          icon: LuArrowLeftRight,
          title: "menu.counting",
          url: "/counting",
          enabled:
            isDesktop &&
            isAdmin &&
            Object.values(config?.cameras ?? {}).some(
              (camera) => Object.keys(camera.counting_lines ?? {}).length > 0,
            ),
        },
```

Import `LuArrowLeftRight` from `react-icons/lu` (if that name does not exist in the installed version, use `LuArrowRightLeft`). Keep the `useMemo` deps array as is (it already includes `config`; verify).

In `web/public/locales/en/common.json`, next to `"alarm": "Alarm"`: `"counting": "Counting",`.

- [ ] **Step 2: Locale file**

Create `web/public/locales/en/views/counting.json`:

```json
{
  "documentTitle": "Counting - Frigate",
  "title": "Counting",
  "in": "In",
  "out": "Out",
  "balance": "Balance",
  "selectDay": "Select day",
  "noLines": "No counting lines are configured. Draw lines in Settings under Masks / Zones.",
  "hourlyChart": "Crossings per hour"
}
```

- [ ] **Step 3: The page**

Create `web/src/pages/Counting.tsx`. Skeleton (follow `web/src/pages/Alarm.tsx` for shell and `SystemGraph.tsx` for charts):

```tsx
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FrigateConfig } from "@/types/frigateConfig";
import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { LuCalendar } from "react-icons/lu";
import useSWR from "swr";

type SummaryRow = {
  camera: string;
  line: string;
  bucket: string;
  count_in: number;
  count_out: number;
};

export default function Counting() {
  const { t } = useTranslation(["views/counting"]);
  const { data: config } = useSWR<FrigateConfig>("config");
  const [day, setDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  const after = day.getTime() / 1000;
  const before = after + 86400;

  const { data: summary } = useSWR<SummaryRow[]>(
    ["counting/summary", { after, before, bucket: "hour" }],
    { refreshInterval: 30000 },
  );

  const camerasWithLines = useMemo(
    () =>
      Object.entries(config?.cameras ?? {})
        .filter(([, cam]) => Object.keys(cam.counting_lines ?? {}).length > 0)
        .map(([name, cam]) => ({ name, lines: cam.counting_lines })),
    [config],
  );

  // ... render: day picker in header, then per camera / per line a card with
  // totals (sum of count_in / count_out for that line, balance = in - out)
  // and an ApexCharts bar chart of 24 hour buckets with two series
  // (t("in"), t("out")); hour index parsed with Number(row.bucket.slice(11, 13)).
}
```

Full render requirements:
- Header row like `Alarm.tsx:69-77` with `t("title")` and the day picker (`Popover` + `Calendar`, single-date mode, `LuCalendar` icon button showing the selected date via `day.toLocaleDateString()`).
- If `camerasWithLines` is empty, render `t("noLines")` centered.
- Per line card: title `lines[name].friendly_name ?? name` plus camera name, three stat blocks (`t("in")`, `t("out")`, `t("balance")`), then `<Chart type="bar" height="160" ...>` with `series: [{ name: t("in"), data: hours }, { name: t("out"), data: hours }]`, x axis categories `["00", ..., "23"]`, and minimal options (no toolbar, no data labels); reuse the palette `["#5C7CFA", "#ED5CFA"]` (see `LineGraph.tsx:13`).
- Buckets come back in server local time; the page shows them as-is without timezone conversion (matches the NVR being the household timezone).
- No hardcoded strings; everything through `t()`.

- [ ] **Step 4: Lint, i18n extract, build**

Run from `web/`:

```bash
npm run lint
npm run i18n:extract
npm run build
```

Expected: lint clean, extraction produces no unexpected diff beyond the new namespace, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Counting.tsx web/src/App.tsx web/src/hooks/use-navigation.ts web/src/types/frigateConfig.ts web/public/locales/en/
git commit -m "Add counting tab with daily line crossing stats"
```

---

### Task 6: Line editor in Settings

**Files:**
- Create: `web/src/components/settings/CountingLineEditPane.tsx`
- Modify: `web/src/types/canvas.ts:1` (extend `PolygonType`)
- Modify: `web/src/views/settings/MasksAndZonesView.tsx` (color in `handleNewPolygon` at ~line 156; build-from-config next to the zone loop at ~line 327; pane switch at ~line 735; add-button + list section modeled on the zone section at ~line 784)
- Modify: `web/src/components/settings/PolygonCanvas.tsx` (2-point auto-finish in `handleMouseDown`, ~lines 113-191)
- Modify: `web/src/components/filter/ZoneMaskFilter.tsx` (new type chip)
- Modify: `web/public/locales/en/views/settings.json` (new keys under the masks and zones section)

**Interfaces:**
- Consumes: `Polygon` type (`web/src/types/canvas.ts:3-18`); save pattern from `MotionMaskEditPane.tsx:190-248` (JSON `config_data` PUT to `config/set`); helpers `flattenPoints`, `interpolatePoints`, `parseCoordinates` from `web/src/utils/canvasUtil.ts`; `CountingLineConfig` fields from Task 1 (`coordinates`, `friendly_name`, `enabled`, `reverse`).
- Produces: polygon type `"counting_line"` usable across the masks and zones view; config writes to `cameras.<camera>.counting_lines.<name>`.

- [ ] **Step 1: Extend the polygon type and canvas**

`web/src/types/canvas.ts:1`:

```ts
export type PolygonType = "zone" | "motion_mask" | "object_mask" | "counting_line";
```

In `PolygonCanvas.tsx` `handleMouseDown`, the point-adding branch (lines 178-188) builds `updatedPoints` via `addPointToPolygon` and writes the polygon back. Extend that write so a counting line finishes itself at 2 points:

```tsx
        updatedPolygons[activePolygonIndex] = {
          ...activePolygon,
          points: updatedPoints,
          pointsOrder: updatedPointsOrder,
          isFinished:
            activePolygon.isFinished ||
            (activePolygon.type == "counting_line" &&
              updatedPoints.length == 2),
        };
        setPolygons(updatedPolygons);
```

The ">= 3 points closes on first point" branch (`PolygonCanvas.tsx:147-157`) can never trigger for a 2-point line, so it needs no guard.

- [ ] **Step 2: MasksAndZonesView wiring**

- `handleNewPolygon` (~line 156): add `if (type == "counting_line") { polygonColor = [0, 180, 220]; }`.
- Build polygons from config next to the zone build (~line 327): iterate `cameraConfig.counting_lines`, producing `Polygon` objects with `type: "counting_line"`, `points: parseCoordinates(line.coordinates)` scaled like zones, `isFinished: true`, `name`, `friendly_name`, `enabled`, color `[0, 180, 220]`.
- Add-button + list section: copy the zone section structure (~lines 784-860) with `setEditPane("counting_line"); handleNewPolygon("counting_line");` and a `PolygonItem` list of counting-line polygons.
- Pane switch (~line 735): render `CountingLineEditPane` with the same prop set as `MotionMaskEditPane` when `editPane == "counting_line"`.
- `ZoneMaskFilter.tsx`: add a `counting_line` chip so lines can be shown/hidden like the other types.

- [ ] **Step 3: The edit pane**

Create `CountingLineEditPane.tsx` by copying the structure of `MotionMaskEditPane.tsx` (form via `react-hook-form` + `zod`, same props). Differences:

- Zod schema: mask name rules plus `reverse: z.boolean()`, and points refine `points.length === 2` with an "isFinished" refine as in `MotionMaskEditPane.tsx:158`.
- Fields rendered: name, friendly name, enabled switch, reverse switch (label `t("countingLines.reverse", { ns: "views/settings" })` with a description explaining it swaps in and out).
- Save handler (adapt `MotionMaskEditPane.tsx:190-248`):

```tsx
      const coordinates = flattenPoints(
        interpolatePoints(polygon.points, scaledWidth, scaledHeight, 1, 1),
      ).join(",");

      const lineConfig = {
        friendly_name: friendly_name,
        enabled: enabled,
        reverse: reverse,
        coordinates: coordinates,
      };

      axios
        .put("config/set", {
          config_data: {
            cameras: {
              [polygon.camera]: { counting_lines: { [lineId]: lineConfig } },
            },
          },
          requires_restart: 1,
        })
```

  Counting lines are read once at startup, so save with `requires_restart: 1` (no hot reload in v1) and show a success toast that includes `t("countingLines.restartRequired")`. Rename and delete follow the mask pane's delete-old-path pattern (`config/set?cameras.<camera>.counting_lines.<oldName>`).
- No objects selector in v1: lines count `person` by default; other object lists are edited in YAML.

- [ ] **Step 4: i18n keys**

Add to `web/public/locales/en/views/settings.json`, following the naming style of the zone/mask sections (exact nesting to match siblings, e.g. under the masks and zones area):

```json
    "countingLines": {
      "label": "Counting Lines",
      "desc": "Counting lines count objects that cross them, with an in and an out direction.",
      "add": "Add Counting Line",
      "reverse": "Reverse direction",
      "reverseDesc": "Swap which side counts as in and which counts as out.",
      "restartRequired": "Restart Frigate to apply counting line changes."
    }
```

Plus the type label wherever `PolygonItem` / `ZoneMaskFilter` map `PolygonType` to display strings (find by following how `motion_mask` resolves its label).

- [ ] **Step 5: Lint, extract, build, commit**

```bash
npm run lint
npm run i18n:extract
npm run build
git add web/src/ web/public/locales/en/
git commit -m "Add counting line editor to masks and zones settings"
```

---

### Task 7: Docs, face recognition rollout, final sweep

**Files:**
- Create: `docs/docs/configuration/counting_lines.md`
- Modify: `HAILO10H-SETUP.md` (new face recognition section)

**Interfaces:**
- Consumes: everything above; upstream doc style from `docs/docs/configuration/zones.md` and `docs/docs/configuration/face_recognition.md`.

- [ ] **Step 1: Counting lines configuration doc**

Create `docs/docs/configuration/counting_lines.md` in the style of `zones.md`: what counting lines are, full YAML example (below), direction semantics (walking from the first point to the second, left-to-right is in; `reverse` swaps), note that edits require a restart, the Counting tab, and the `GET /counting/summary` API for Grafana.

```yaml
cameras:
  front_door:
    counting_lines:
      entrance:
        coordinates: "0.40,0.10,0.45,0.95"
        objects:
          - person
        reverse: false
        friendly_name: Main entrance
```

- [ ] **Step 2: Face recognition section in HAILO10H-SETUP.md**

Add a section covering: enabling the existing native face recognition on the RPi5 deployment (`face_recognition: enabled: true`, `model_size: small` since embeddings run on host CPU via ONNX, not on the Hailo NPU), that `person` must be tracked, tuning `recognition_threshold` (default 0.9) and `min_area` on real footage, and training workflow through the Face Library page. One line noting that moving embeddings to the Hailo NPU is a possible future task like the LPR OCR migration.

- [ ] **Step 3: Full verification sweep**

```bash
python3 -u -m unittest
ruff format --check frigate/ && ruff check frigate/
python3 -u -m mypy --config-file frigate/mypy.ini frigate || true  # note new errors only
python3 generate_api_auth_spec.py --check
cd web && npm run lint && npm run i18n:extract:ci && npm run build
```

Expected: all clean (mypy: no NEW errors versus dev).

- [ ] **Step 4: Commit**

```bash
git add docs/docs/configuration/counting_lines.md HAILO10H-SETUP.md
git commit -m "Document counting lines and face recognition rollout"
```

---

## Out of scope (from the approved spec)

MQTT/HA counter sensors; line hysteresis/debounce; hot reload of line config (restart required in v1); retroactive face scanning of recordings; face embeddings on the Hailo NPU; objects selector in the line edit pane (YAML only).

## Deployment note (not a repo task)

Enabling `face_recognition` in the rpi5AI deployment config and threshold tuning happens on the device after this branch is deployed; the doc section from Task 7 is the checklist for it.
