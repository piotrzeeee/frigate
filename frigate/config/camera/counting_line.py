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
