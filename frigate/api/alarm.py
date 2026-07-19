"""Alarm APIs."""

import datetime
import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from frigate.api.auth import require_role
from frigate.api.defs.request.alarm_body import AlarmStateBody
from frigate.api.defs.response.generic_response import GenericResponse
from frigate.api.defs.tags import Tags
from frigate.models import AlarmState, AlarmTrigger

logger = logging.getLogger(__name__)

router = APIRouter(tags=[Tags.alarm])


@router.get(
    "/alarm",
    summary="Get alarm state and recent triggers",
    description="""Returns the current alarm armed state and the most recent alarm
    triggers (review alerts that occurred while the alarm was armed).""",
)
def get_alarm():
    state = AlarmState.get_or_none(AlarmState.id == 0)
    triggers = [
        {
            "review_id": trigger.review_id,
            "camera": trigger.camera,
            "ts": trigger.ts.isoformat() if trigger.ts else None,
            "data": json.loads(trigger.data) if trigger.data else {},
        }
        for trigger in AlarmTrigger.select().order_by(AlarmTrigger.ts.desc()).limit(50)
    ]
    return JSONResponse(
        content={
            "armed": bool(state.armed) if state else False,
            "updated_at": (
                state.updated_at.isoformat() if state and state.updated_at else None
            ),
            "triggers": triggers,
        },
        status_code=200,
    )


@router.post(
    "/alarm",
    response_model=GenericResponse,
    dependencies=[Depends(require_role(["admin"]))],
    summary="Arm or disarm the alarm",
    description="""Sets the alarm armed state. While armed, review alerts are recorded
    as alarm triggers.""",
)
def set_alarm(body: AlarmStateBody):
    AlarmState.insert(
        id=0, armed=body.armed, updated_at=datetime.datetime.now()
    ).on_conflict(
        conflict_target=[AlarmState.id],
        update={
            AlarmState.armed: body.armed,
            AlarmState.updated_at: datetime.datetime.now(),
        },
    ).execute()

    return JSONResponse(
        content={
            "success": True,
            "message": f"Alarm {'armed' if body.armed else 'disarmed'}.",
        },
        status_code=200,
    )
