from pydantic import BaseModel, Field


class AlarmStateBody(BaseModel):
    armed: bool = Field(description="Whether the alarm is armed")
