from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_upload_parse_validate_and_export_flow():
    upload_response = client.post(
        "/api/upload/points",
        files={"file": ("points.csv", b"point_id,east,north,height,note,code\n1,500,300,12.3,tree,TREE\n", "text/csv")},
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()
    assert upload_payload["columns"] == ["point_id", "east", "north", "height", "note", "code"]
    assert upload_payload["detectedMapping"]["pointId"] == "point_id"

    parse_response = client.post(
        "/api/points/parse",
        json={
            "fileId": upload_payload["fileId"],
            "mapping": {
                "pointId": "point_id",
                "east": "east",
                "north": "north",
                "height": "height",
                "note": "note",
                "code": "code",
            },
        },
    )
    assert parse_response.status_code == 200
    parse_payload = parse_response.json()
    assert parse_payload["points"][0]["id"] == "1"
    assert parse_payload["validation"]["errors"] == []

    project = {
        "project": {"id": "demo", "name": "demo", "scale": 500},
        "points": parse_payload["points"],
        "features": [{"id": "tree-1", "type": "tree", "pointIds": ["1"]}],
    }
    validate_response = client.post("/api/project/validate", json=project)
    assert validate_response.status_code == 200
    assert validate_response.json()["errors"] == []

    dat_response = client.post("/api/export/dat", json=project)
    assert dat_response.status_code == 200
    assert "1,,500.000,300.000,12.300" in dat_response.content.decode("utf-8-sig")

    dxf_response = client.post("/api/export/dxf", json=project)
    assert dxf_response.status_code == 200
    assert b"TREE" in dxf_response.content


def test_chinese_header_csv_upload_detects_mapping():
    response = client.post(
        "/api/upload/points",
        files={"file": ("chinese_headers.csv", "点号,东坐标,北坐标,高程,备注,编码\n房A,500,300,12.3,房角点,B001\n".encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["detectedMapping"]["pointId"] == "点号"
    assert payload["detectedMapping"]["east"] == "东坐标"
    assert payload["detectedMapping"]["north"] == "北坐标"
    assert payload["detectedMapping"]["height"] == "高程"


def test_duplicate_points_file_reports_duplicate_error():
    upload_response = client.post(
        "/api/upload/points",
        files={"file": ("duplicate_points.csv", b"point_id,east,north,height\nP01,500,300,12.3\nP01,510,300,12.4\n", "text/csv")},
    )
    file_id = upload_response.json()["fileId"]
    parse_response = client.post(
        "/api/points/parse",
        json={"fileId": file_id, "mapping": {"pointId": "point_id", "east": "east", "north": "north", "height": "height"}},
    )
    assert parse_response.status_code == 200
    assert parse_response.json()["validation"]["errors"][0]["type"] == "DUPLICATE_POINT_ID"


def test_missing_coordinate_file_returns_clear_400():
    upload_response = client.post(
        "/api/upload/points",
        files={"file": ("missing_coordinate.csv", b"point_id,east,north,height\nP01,,300,12.3\n", "text/csv")},
    )
    file_id = upload_response.json()["fileId"]
    parse_response = client.post(
        "/api/points/parse",
        json={"fileId": file_id, "mapping": {"pointId": "point_id", "east": "east", "north": "north", "height": "height"}},
    )
    assert parse_response.status_code == 400
    assert "Row 1 east is missing" in parse_response.json()["detail"]


def test_project_validate_reports_missing_feature_point():
    project = {
        "project": {"id": "bad", "name": "bad", "scale": 500},
        "points": [{"id": "1", "east": 500, "north": 300, "height": 12.3}],
        "features": [{"id": "bad-feature", "type": "building", "pointIds": ["1", "999"], "closed": True, "layer": "BUILDING"}],
    }
    response = client.post("/api/project/validate", json=project)
    assert response.status_code == 200
    assert any(issue["type"] == "FEATURE_POINT_MISSING" for issue in response.json()["errors"])
