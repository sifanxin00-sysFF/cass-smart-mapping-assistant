import pytest
from io import BytesIO

from openpyxl import Workbook

from app.models import FieldMapping
from app.services.parse_files import detect_mapping, parse_csv, parse_dat, parse_xlsx, rows_to_points


def test_parse_dat_to_points():
    columns, rows = parse_dat(b"1,,500.000,300.000,12.31\n2,,510.000,300.000,12.32\n")
    assert columns[:5] == ["point_id", "empty", "east", "north", "height"]
    points = rows_to_points(rows, FieldMapping(pointId="point_id", east="east", north="north", height="height"))
    assert points[0].id == "1"
    assert points[1].east == 510.0


def test_parse_dat_with_note_and_code():
    _, rows = parse_dat("P1,,500.000,300.000,12.31,old tree,TREE".encode())
    points = rows_to_points(
        rows,
        FieldMapping(pointId="point_id", east="east", north="north", height="height", note="note", code="code"),
    )
    assert points[0].note == "old tree"
    assert points[0].code == "TREE"


def test_parse_dat_with_numeric_code_column():
    _, rows = parse_dat("P1,101,500.000,300.000,12.31\n".encode())
    points = rows_to_points(
        rows,
        FieldMapping(pointId="point_id", east="east", north="north", height="height", code="code"),
    )
    assert rows[0]["code"] == "101"
    assert points[0].id == "P1"
    assert points[0].east == 500.0
    assert points[0].code == "101"


def test_parse_csv_detect_mapping():
    content = "point_id,east,north,height,note\n1,500,300,12.3,tree\n".encode()
    columns, rows = parse_csv(content)
    mapping = detect_mapping(columns)
    assert mapping["pointId"] == "point_id"
    assert mapping["east"] == "east"
    assert rows[0]["note"] == "tree"


def test_parse_csv_with_utf8_bom_and_trimmed_headers():
    content = "\ufeff point_id , east , north , height , note \nA-1,500,300,12.3,tree\n".encode("utf-8")
    columns, rows = parse_csv(content)
    mapping = detect_mapping(columns)
    points = rows_to_points(rows, FieldMapping(pointId=mapping["pointId"], east=mapping["east"], north=mapping["north"], height=mapping["height"]))
    assert columns == ["point_id", "east", "north", "height", "note"]
    assert points[0].id == "A-1"
    assert points[0].east == 500.0


def test_parse_csv_detect_chinese_headers():
    content = "点号,东坐标,北坐标,高程,备注,编码\n房A,500,300,12.3,房角点,B001\n".encode("utf-8")
    columns, rows = parse_csv(content)
    mapping = detect_mapping(columns)
    points = rows_to_points(
        rows,
        FieldMapping(
            pointId=mapping["pointId"],
            east=mapping["east"],
            north=mapping["north"],
            height=mapping["height"],
            note=mapping["note"],
            code=mapping["code"],
        ),
    )
    assert mapping == {
        "pointId": "点号",
        "east": "东坐标",
        "north": "北坐标",
        "height": "高程",
        "note": "备注",
        "code": "编码",
    }
    assert points[0].id == "房A"
    assert points[0].note == "房角点"


def test_parse_messy_dat_ignores_blank_lines_and_extra_spaces():
    content = b"\nP01,, 500.000 , 300.000 , 12.31 ,\n\nP02   510.000   300.000   12.32\nP03,,510.000,308.000,12.35,,\n"
    _, rows = parse_dat(content)
    points = rows_to_points(rows, FieldMapping(pointId="point_id", east="east", north="north", height="height"))
    assert [point.id for point in points] == ["P01", "P02", "P03"]
    assert points[2].north == 308.0


def test_rows_to_points_missing_coordinate_raises_clear_error():
    _, rows = parse_csv("point_id,east,north,height\nP01,,300,12.3\n".encode("utf-8"))
    with pytest.raises(ValueError, match="Row 1 east is missing"):
        rows_to_points(rows, FieldMapping(pointId="point_id", east="east", north="north", height="height"))


def test_rows_to_points_bad_coordinate_raises_clear_error():
    _, rows = parse_csv("point_id,east,north,height\nP01,abc,300,12.3\n".encode("utf-8"))
    with pytest.raises(ValueError, match="Row 1 east is not a number: abc"):
        rows_to_points(rows, FieldMapping(pointId="point_id", east="east", north="north", height="height"))


def test_parse_xlsx_detect_chinese_mapping():
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["点号", "东坐标", "北坐标", "高程", "备注", "编码"])
    sheet.append(["A1", 500, 300, 12.3, "tree", "TREE"])
    buffer = BytesIO()
    workbook.save(buffer)

    columns, rows = parse_xlsx(buffer.getvalue())
    mapping = detect_mapping(columns)
    points = rows_to_points(
        rows,
        FieldMapping(
            pointId=mapping["pointId"],
            east=mapping["east"],
            north=mapping["north"],
            height=mapping["height"],
            note=mapping["note"],
            code=mapping["code"],
        ),
    )

    assert points[0].id == "A1"
    assert points[0].height == 12.3
    assert points[0].code == "TREE"
