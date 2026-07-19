from pydantic import BaseModel, Field


class RenameFaceBody(BaseModel):
    new_name: str = Field(description="New name for the face")


class AudioTranscriptionBody(BaseModel):
    event_id: str = Field(description="ID of the event to transcribe audio for")


class DeleteFaceImagesBody(BaseModel):
    ids: list[str] = Field(
        description="List of image filenames to delete from the face folder"
    )


class GenerateStateExamplesBody(BaseModel):
    model_name: str = Field(description="Name of the classification model")
    cameras: dict[str, tuple[float, float, float, float]] = Field(
        description="Dictionary mapping camera names to normalized crop coordinates in [x1, y1, x2, y2] format (values 0-1)"
    )


class GenerateObjectExamplesBody(BaseModel):
    model_name: str = Field(description="Name of the classification model")
    label: str = Field(
        description="Object label to collect examples for (e.g., 'person', 'car')"
    )


class KnownPlateBody(BaseModel):
    plate: str = Field(description="License plate string", min_length=2, max_length=20)
    label: str | None = Field(
        default=None, description="Display label for the plate (e.g. owner name)"
    )
    expires_at: str | None = Field(
        default=None,
        description="ISO 8601 datetime after which the plate is automatically removed",
    )
