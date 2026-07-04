from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AiRecommendRequest(BaseModel):
    points: list[dict[str, Any]] = Field(default_factory=list)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    markups: list[dict[str, Any]] = Field(default_factory=list)
    sketch_observation: str = ""


class AiRecommendResponse(BaseModel):
    plans: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["ai_text"] = "ai_text"
    fallback: bool


class SketchImagePart(BaseModel):
    image_base64: str
    image_mime: str
    label: str = ""


class SketchAnalysisRequest(BaseModel):
    image_base64: str = ""
    image_mime: str = ""
    image_parts: list[SketchImagePart] = Field(default_factory=list)
    points: list[dict[str, Any]] = Field(default_factory=list)


class SketchAnalysisResponse(BaseModel):
    observation: str = ""
    success: bool
    error: str | None = None
