from __future__ import annotations

import io

import ezdxf

from app.feature_types import FEATURE_TYPES
from app.models import Feature, ProjectDocument, SurveyPoint


LAYER_COLORS = {
    "POINTS": 7,
    "POINT_LABEL": 1,
    "ELEVATION": 1,
    "BUILDING": 6,
    "ROAD": 4,
    "GREEN": 3,
    "WATER": 5,
    "STAIRS": 2,
    "WALL": 7,
    "TREE": 3,
    "MANHOLE": 7,
    "DEFAULT": 7,
}


def project_to_dxf(project: ProjectDocument) -> bytes:
    doc = ezdxf.new("R2010")
    setup_layers(doc)
    msp = doc.modelspace()
    point_map = {point.id: point for point in project.points}
    text_height = text_height_for_scale(project.project.scale)

    for point in project.points:
        location = (point.east, point.north, point.height or 0)
        msp.add_point(location, dxfattribs={"layer": "POINTS"})
        add_text(
            msp,
            point.id,
            (point.east + text_height * 0.35, point.north + text_height * 0.35),
            text_height,
            "POINT_LABEL",
        )
        if point.height is not None:
            add_text(
                msp,
                f"{point.height:.2f}",
                (point.east + text_height * 0.35, point.north - text_height * 0.85),
                text_height * 0.85,
                "ELEVATION",
            )

    for feature in project.features:
        draw_feature(msp, feature, point_map, text_height)

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def setup_layers(doc: ezdxf.EzDxf) -> None:
    for layer, color in LAYER_COLORS.items():
        if layer not in doc.layers:
            doc.layers.add(layer, color=color)


def draw_feature(msp, feature: Feature, point_map: dict[str, SurveyPoint], text_height: float) -> None:
    points = [point_map[point_id] for point_id in feature.pointIds if point_id in point_map]
    if not points:
        return

    spec = FEATURE_TYPES.get(feature.type, {})
    layer = resolve_layer(feature, spec)
    ensure_layer(msp.doc, layer)
    is_point_feature = bool(spec.get("point"))

    if is_point_feature:
        draw_point_feature(msp, points[0], feature, spec, layer, text_height)
        return

    coords = [(point.east, point.north) for point in points]
    should_close = bool(feature.closed or spec.get("closed"))
    if should_close and coords[0] != coords[-1]:
        coords.append(coords[0])
    if len(coords) >= 2:
        msp.add_lwpolyline(coords, close=should_close, dxfattribs={"layer": layer})

    if feature.name:
        first = points[0]
        add_text(msp, feature.name, (first.east + text_height, first.north + text_height), text_height, layer)


def draw_point_feature(msp, point: SurveyPoint, feature: Feature, spec: dict, layer: str, text_height: float) -> None:
    radius = text_height * 0.8
    center = (point.east, point.north)

    if layer == "TREE":
        msp.add_circle(center, radius, dxfattribs={"layer": layer})
        msp.add_line((point.east - radius, point.north), (point.east + radius, point.north), dxfattribs={"layer": layer})
        msp.add_line((point.east, point.north - radius), (point.east, point.north + radius), dxfattribs={"layer": layer})
    elif layer == "MANHOLE":
        msp.add_circle(center, radius * 0.75, dxfattribs={"layer": layer})
        msp.add_lwpolyline(
            [
                (point.east - radius, point.north - radius),
                (point.east + radius, point.north - radius),
                (point.east + radius, point.north + radius),
                (point.east - radius, point.north + radius),
            ],
            close=True,
            dxfattribs={"layer": layer},
        )
    else:
        msp.add_circle(center, radius, dxfattribs={"layer": layer})

    label = feature.name or spec.get("name") or feature.type
    add_text(msp, label, (point.east + radius * 1.4, point.north + radius * 0.2), text_height, layer)


def resolve_layer(feature: Feature, spec: dict) -> str:
    if feature.layer and feature.layer != "DEFAULT":
        return feature.layer.upper()
    return str(spec.get("layer") or "DEFAULT").upper()


def ensure_layer(doc: ezdxf.EzDxf, layer: str) -> None:
    if layer not in doc.layers:
        doc.layers.add(layer, color=LAYER_COLORS.get(layer, 7))


def add_text(msp, text: str, insert: tuple[float, float], height: float, layer: str) -> None:
    entity = msp.add_text(text, dxfattribs={"height": height, "layer": layer})
    if hasattr(entity, "set_placement"):
        entity.set_placement(insert)
    else:
        entity.dxf.insert = insert


def text_height_for_scale(scale: int) -> float:
    if scale <= 500:
        return 1.0
    if scale <= 1000:
        return 1.8
    return 3.0
