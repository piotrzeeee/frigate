"""Tests for the counting line APIs."""

from frigate.api.auth import get_allowed_cameras_for_filter, get_current_user
from frigate.models import AlarmState, AlarmTrigger, LineCrossing
from frigate.test.http_api.base_http_test import AuthTestClient, BaseTestHttp

BASE_TS = 1750000000.0


class TestHttpCounting(BaseTestHttp):
    def setUp(self):
        super().setUp([LineCrossing, AlarmState, AlarmTrigger])
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
        with AuthTestClient(self.app) as client:
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
        with AuthTestClient(self.app) as client:
            resp = client.get("/counting/crossings")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_summary_buckets_by_hour(self):
        self._insert("in", 0)
        self._insert("in", 1)
        self._insert("out", 2)
        self._insert("in", 3600)  # next hour bucket
        with AuthTestClient(self.app) as client:
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
        with AuthTestClient(self.app) as client:
            resp = client.get(
                "/counting/summary",
                params={"after": BASE_TS - 1, "before": BASE_TS + 100, "bucket": "day"},
            )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["count_in"] == 1
        assert rows[0]["count_out"] == 1

    def test_crossings_accessible_to_viewer(self):
        self._insert("in", 0)
        app_with_gate = self.create_app(enforce_default_admin=True)
        app_with_gate.dependency_overrides[get_current_user] = lambda: {
            "username": "viewer1",
            "role": "viewer",
        }
        app_with_gate.dependency_overrides[get_allowed_cameras_for_filter] = lambda: [
            "front_door"
        ]
        with AuthTestClient(app_with_gate) as client:
            resp_counting = client.get(
                "/counting/crossings",
                headers={"remote-role": "viewer", "remote-user": "viewer1"},
            )
            resp_alarm = client.get(
                "/alarm",
                headers={"remote-role": "viewer", "remote-user": "viewer1"},
            )
        assert resp_counting.status_code == 200
        rows = resp_counting.json()
        assert len(rows) == 1
        assert resp_alarm.status_code == 403
