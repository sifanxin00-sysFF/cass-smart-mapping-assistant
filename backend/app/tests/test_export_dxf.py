from io import StringIO

import ezdxf

from app.models import Feature, ProjectDocument, ProjectMeta, SurveyPoint
from app.services.export_dat import project_to_dat
from app.services.export_dxf import project_to_dxf


def sample_project():
    return ProjectDocument(
        project=ProjectMeta(id="demo", name="demo", scale=500),
        points=[
            SurveyPoint(id="1", east=500, north=300, height=12.3),
            SurveyPoint(id="2", east=510, north=300, height=12.4),
            SurveyPoint(id="3", east=510, north=308, height=12.5),
            SurveyPoint(id="4", east=520, north=310, height=12.6),
        ],
        features=[
            Feature(id="f1", type="building", pointIds=["1", "2", "3"], closed=True),
            Feature(id="f2", type="road_edge", pointIds=["2", "4"]),
            Feature(id="f3", type="tree", pointIds=["4"]),
            Feature(id="f4", type="manhole", pointIds=["1"]),
        ],
    )


def test_export_dat():
    content = project_to_dat(sample_project())
    assert "1,,500.000,300.000,12.300" in content


def test_export_dxf_bytes():
    content = project_to_dxf(sample_project())
    assert b"SECTION" in content
    assert b"BUILDING" in content
    assert b"TREE" in content


def test_export_dxf_can_be_read_and_has_expected_layers():
    doc = ezdxf.read(StringIO(project_to_dxf(sample_project()).decode("utf-8")))
    layers = {layer.dxf.name for layer in doc.layers}
    assert {"BUILDING", "ROAD", "TREE", "MANHOLE", "ELEVATION"}.issubset(layers)

    entities = list(doc.modelspace())
    assert any(entity.dxftype() == "POINT" for entity in entities)
    assert any(entity.dxftype() == "TEXT" and entity.dxf.layer == "ELEVATION" for entity in entities)
    assert any(entity.dxftype() == "LWPOLYLINE" and entity.dxf.layer == "BUILDING" for entity in entities)
    assert any(entity.dxftype() == "CIRCLE" and entity.dxf.layer == "TREE" for entity in entities)
