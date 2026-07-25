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
