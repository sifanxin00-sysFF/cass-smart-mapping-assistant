from app.models import Feature, ProjectDocument, ProjectMeta, SurveyPoint
from app.services.validate import validate_points, validate_project


def test_validate_duplicate_point_id():
    result = validate_points(
        [
            SurveyPoint(id="1", east=0, north=0, height=1),
            SurveyPoint(id="1", east=1, north=1, height=2),
        ]
    )
    assert any(issue.type == "DUPLICATE_POINT_ID" for issue in result.errors)


def test_validate_missing_height_and_suspect_xy_mapping():
    result = validate_points(
        [
            SurveyPoint(id="1", east=3_400_000, north=500_000),
            SurveyPoint(id="2", east=3_400_010, north=500_001, height=2),
        ]
    )
    assert any(issue.type == "MISSING_HEIGHT" for issue in result.warnings)
    assert any(issue.type == "SUSPECT_XY_MAPPING" for issue in result.warnings)


def test_validate_project_references_and_unused_points():
    project = ProjectDocument(
        project=ProjectMeta(name="demo"),
        points=[
            SurveyPoint(id="1", east=0, north=0, height=1),
            SurveyPoint(id="2", east=1, north=0, height=1),
            SurveyPoint(id="3", east=1, north=1, height=1),
            SurveyPoint(id="4", east=2, north=2, height=1),
        ],
        features=[Feature(id="f1", type="building", pointIds=["1", "2", "9"], closed=True, layer="BUILDING")],
    )
    result = validate_project(project)
    assert any(issue.type == "FEATURE_POINT_MISSING" for issue in result.errors)
    assert any(issue.type == "CLOSED_FEATURE_TOO_FEW_POINTS" for issue in result.errors)
    assert any(issue.type == "FEATURE_NOT_EXPLICITLY_CLOSED" for issue in result.warnings)
    assert any(issue.type == "UNUSED_POINTS" for issue in result.warnings)


def test_validate_closed_feature_warning():
    project = ProjectDocument(
        project=ProjectMeta(name="demo"),
        points=[
            SurveyPoint(id="1", east=0, north=0, height=1),
            SurveyPoint(id="2", east=1, north=0, height=1),
            SurveyPoint(id="3", east=1, north=1, height=1),
        ],
        features=[Feature(id="f1", type="building", pointIds=["1", "2", "3"], closed=True, layer="BUILDING")],
    )
    result = validate_project(project)
    assert any(issue.type == "FEATURE_NOT_EXPLICITLY_CLOSED" for issue in result.warnings)
