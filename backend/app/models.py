from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class FieldMapping(BaseModel):
    pointId: str
    east: str
    north: str
    height: str | None = None
    note: str | None = None
    code: str | None = None


class SurveyPoint(BaseModel):
    id: str
    east: float
    north: float
    height: float | None = None
    note: str = ""
    code: str = ""


class Feature(BaseModel):
    id: str
    type: str
    name: str = ""
    pointIds: list[str]
    closed: bool = False
    layer: str = "DEFAULT"
    note: str = ""


class ProjectMeta(BaseModel):
    id: str = "local_project"
    name: str = "Untitled project"
    scale: int = 500
    coordinateSystem: str = "local"
    createdAt: str = Field(default_factory=lambda: datetime.now().date().isoformat())


class ProjectDocument(BaseModel):
    project: ProjectMeta
    points: list[SurveyPoint]
    features: list[Feature] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    type: str
    message: str
    pointId: str | None = None
    featureId: str | None = None
    severity: Literal["error", "warning"] = "warning"


class ValidationResult(BaseModel):
    errors: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)


class ParsePointsRequest(BaseModel):
    fileId: str
    mapping: FieldMapping


class UploadPreview(BaseModel):
    fileId: str
    columns: list[str]
    previewRows: list[dict[str, Any]]
    detectedMapping: dict[str, str | None]
