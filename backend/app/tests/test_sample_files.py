import json
from pathlib import Path

import pytest

from app.models import FieldMapping, ProjectDocument
from app.services.parse_files import detect_mapping, parse_uploaded_file, rows_to_points
from app.services.validate import validate_points, validate_project


SAMPLES_DIR = Path(__file__).resolve().parents[3] / "samples"


def parse_sample_points(filename: str):
    columns, rows = parse_uploaded_file(filename, (SAMPLES_DIR / filename).read_bytes())
    mapping = detect_mapping(columns)
    return rows_to_points(
        rows,
        FieldMapping(pointId=mapping["pointId"], east=mapping["east"], north=mapping["north"], height=mapping["height"], note=mapping["note"], code=mapping["code"]),
    )


def test_chinese_headers_sample_detects_and_parses():
    points = parse_sample_points("chinese_headers.csv")
    assert [point.id for point in points] == ["房A", "房B", "房C", "树1"]
    assert points[0].height == 12.31


def test_messy_dat_sample_ignores_blank_lines_and_parses_points():
    points = parse_sample_points("messy_points.dat")
    assert [point.id for point in points] == ["P01", "P02", "P03", "P04"]
    assert points[-1].north == 308.0


def test_duplicate_points_sample_reports_error():
    result = validate_points(parse_sample_points("duplicate_points.csv"))
    assert any(issue.type == "DUPLICATE_POINT_ID" for issue in result.errors)


def test_missing_height_sample_reports_warning():
    result = validate_points(parse_sample_points("missing_height.csv"))
    assert any(issue.type == "MISSING_HEIGHT" for issue in result.warnings)


def test_missing_coordinate_sample_fails_clearly():
    with pytest.raises(ValueError, match="Row 2 east is missing"):
        parse_sample_points("missing_coordinate.csv")


def test_swapped_xy_suspect_sample_reports_warning():
    result = validate_points(parse_sample_points("swapped_xy_suspect.csv"))
    assert any(issue.type == "SUSPECT_XY_MAPPING" for issue in result.warnings)


def test_invalid_project_missing_point_sample_reports_error():
    project = ProjectDocument.model_validate(json.loads((SAMPLES_DIR / "invalid_project_missing_point.json").read_text(encoding="utf-8")))
    result = validate_project(project)
    assert any(issue.type == "FEATURE_POINT_MISSING" for issue in result.errors)
