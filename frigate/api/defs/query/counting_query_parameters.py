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
