from pydantic import BaseModel, Field, RootModel


class FacesResponse(RootModel[dict[str, list[str]]]):
    """Response model for the get_faces endpoint.

    Returns a mapping of face names to lists of image filenames.
    Each face name corresponds to a directory in the faces folder,
    and the list contains the names of image files for that face.

    Example:
        {
            "john_doe": ["face1.webp", "face2.jpg"],
            "jane_smith": ["face3.png"]
        }
    """

    root: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Dictionary mapping face names to lists of image filenames",
    )


class KnownPlateEntry(BaseModel):
    """A single known license plate entry."""

    plate: str = Field(description="License plate string")
    label: str | None = Field(
        default=None, description="Display label for the plate (e.g. owner name)"
    )
    expires_at: str | None = Field(
        default=None,
        description="ISO 8601 datetime after which the plate is automatically removed",
    )
    created_at: str | None = Field(
        default=None, description="ISO 8601 datetime the entry was created"
    )


class KnownPlatesResponse(RootModel[list[KnownPlateEntry]]):
    """Response model for the known plates list endpoint."""

    root: list[KnownPlateEntry] = Field(
        default_factory=list, description="List of known license plate entries"
    )


class FaceRecognitionResponse(BaseModel):
    """Response model for face recognition endpoint.

    Returns the result of attempting to recognize a face from an uploaded image.
    """

    success: bool = Field(description="Whether the face recognition was successful")
    score: float | None = Field(
        default=None, description="Confidence score of the recognition (0-1)"
    )
    face_name: str | None = Field(
        default=None, description="The recognized face name if successful"
    )
