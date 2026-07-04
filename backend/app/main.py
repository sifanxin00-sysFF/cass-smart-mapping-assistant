from __future__ import annotations

import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

load_dotenv()

from app.assistant_models import AiRecommendResponse, SketchAnalysisRequest
from app.models import ParsePointsRequest, ProjectDocument, UploadPreview
from app.services.assistant_recommend import generate_ai_plans
from app.services.assistant_sketch import analyze_sketch_for_assistant
from app.services.export_dat import project_to_dat
from app.services.export_dxf import project_to_dxf
from app.services.parse_files import detect_mapping, parse_uploaded_file, rows_to_points
from app.services.validate import validate_points, validate_project


app = FastAPI(title="CASS Drawing Assistant API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_CACHE: dict[str, tuple[list[str], list[dict]]] = {}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload/points", response_model=UploadPreview)
async def upload_points(file: UploadFile = File(...)) -> UploadPreview:
    try:
        content = await file.read()
        columns, rows = parse_uploaded_file(file.filename or "", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_id = str(uuid.uuid4())
    UPLOAD_CACHE[file_id] = (columns, rows)
    return UploadPreview(
        fileId=file_id,
        columns=columns,
        previewRows=rows[:20],
        detectedMapping=detect_mapping(columns),
    )


@app.post("/api/points/parse")
def parse_points(request: ParsePointsRequest) -> dict:
    if request.fileId not in UPLOAD_CACHE:
        raise HTTPException(status_code=404, detail="Uploaded file has expired. Please upload it again.")
    _, rows = UPLOAD_CACHE[request.fileId]
    try:
        points = rows_to_points(rows, request.mapping)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    validation = validate_points(points)
    return {"points": [point.model_dump() for point in points], "validation": validation.model_dump()}


@app.post("/api/project/validate")
def validate_project_api(project: ProjectDocument) -> dict:
    return validate_project(project).model_dump()


@app.post("/api/assistant/recommend", response_model=AiRecommendResponse)
async def assistant_recommend(request: Request) -> AiRecommendResponse:
    body = await request.json()
    print(f"recommend called, has_key: {bool(os.getenv('DEEPSEEK_API_KEY'))}")
    try:
        plans = await generate_ai_plans(
            body.get("points", []),
            body.get("candidates", []),
            body.get("markups", []),
            body.get("sketch_observation", ""),
            body.get("sketch_observations", []),
        )
        print(f"ai_plans count: {len(plans)}")
    except Exception:
        print("fallback triggered")
        return AiRecommendResponse(plans=[], fallback=True)
    return AiRecommendResponse(plans=plans, fallback=False)


@app.post("/api/assistant/analyze-sketch")
async def assistant_analyze_sketch(request: SketchAnalysisRequest) -> dict:
    result = await analyze_sketch_for_assistant(
        request.image_base64,
        request.image_mime,
        request.points,
        [part.model_dump() for part in request.image_parts],
    )
    return result


@app.post("/api/export/dat")
def export_dat(project: ProjectDocument) -> Response:
    content = project_to_dat(project)
    filename = f"{project.project.id or 'cass_project'}.dat"
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/export/dxf")
def export_dxf(project: ProjectDocument) -> Response:
    content = project_to_dxf(project)
    filename = f"{project.project.id or 'cass_project'}.dxf"
    return Response(
        content=content,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
