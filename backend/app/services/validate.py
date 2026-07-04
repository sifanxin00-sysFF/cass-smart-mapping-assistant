from __future__ import annotations

from collections import Counter
from statistics import median

from app.feature_types import FEATURE_TYPES
from app.models import ProjectDocument, SurveyPoint, ValidationIssue, ValidationResult


def validate_points(points: list[SurveyPoint]) -> ValidationResult:
    result = ValidationResult()
    ids = [point.id for point in points]
    for point_id, count in Counter(ids).items():
        if count > 1:
            result.errors.append(
                ValidationIssue(
                    type="DUPLICATE_POINT_ID",
                    message=f"Duplicate point id: {point_id}",
                    pointId=point_id,
                    severity="error",
                )
            )

    for point in points:
        if point.height is None:
            result.warnings.append(
                ValidationIssue(
                    type="MISSING_HEIGHT",
                    message=f"Point {point.id} has no elevation.",
                    pointId=point.id,
                )
            )

    if looks_like_xy_swapped(points):
        result.warnings.append(
            ValidationIssue(
                type="SUSPECT_XY_MAPPING",
                message="Coordinates look unusual. Please confirm east/north or X/Y mapping.",
            )
        )

    return result


def validate_project(project: ProjectDocument) -> ValidationResult:
    result = validate_points(project.points)
    point_ids = {point.id for point in project.points}
    used_point_ids: set[str] = set()

    for feature in project.features:
        spec = FEATURE_TYPES.get(feature.type)
        if spec is None:
            result.warnings.append(
                ValidationIssue(
                    type="UNKNOWN_FEATURE_TYPE",
                    message=f"Unknown feature type: {feature.type}",
                    featureId=feature.id,
                )
            )

        if not feature.pointIds:
            result.errors.append(
                ValidationIssue(
                    type="EMPTY_FEATURE",
                    message=f"Feature {feature.name or feature.id} has no points.",
                    featureId=feature.id,
                    severity="error",
                )
            )
            continue

        missing = [point_id for point_id in feature.pointIds if point_id not in point_ids]
        if missing:
            result.errors.append(
                ValidationIssue(
                    type="FEATURE_POINT_MISSING",
                    message=f"Feature {feature.name or feature.id} references missing points: {', '.join(missing)}",
                    featureId=feature.id,
                    severity="error",
                )
            )

        used_point_ids.update(point_id for point_id in feature.pointIds if point_id in point_ids)

        is_point_feature = bool(spec and spec.get("point"))
        if is_point_feature and len(feature.pointIds) != 1:
            result.warnings.append(
                ValidationIssue(
                    type="POINT_FEATURE_COUNT",
                    message=f"Point feature {feature.name or feature.id} should reference exactly one point.",
                    featureId=feature.id,
                )
            )

        should_close = bool((spec and spec.get("closed")) or feature.closed)
        if should_close:
            unique_count = len(dict.fromkeys(point_id for point_id in feature.pointIds if point_id in point_ids))
            if unique_count < 3:
                result.errors.append(
                    ValidationIssue(
                        type="CLOSED_FEATURE_TOO_FEW_POINTS",
                        message=f"Closed feature {feature.name or feature.id} needs at least 3 unique points.",
                        featureId=feature.id,
                        severity="error",
                    )
                )
            if feature.pointIds[0] != feature.pointIds[-1]:
                result.warnings.append(
                    ValidationIssue(
                        type="FEATURE_NOT_EXPLICITLY_CLOSED",
                        message=f"Closed feature {feature.name or feature.id} is not explicitly closed.",
                        featureId=feature.id,
                    )
                )

    unused = sorted(point_ids - used_point_ids, key=natural_key)
    if unused:
        preview = ", ".join(unused[:20])
        suffix = "..." if len(unused) > 20 else ""
        result.warnings.append(
            ValidationIssue(type="UNUSED_POINTS", message=f"{len(unused)} points are not used by any feature: {preview}{suffix}")
        )

    return result


def looks_like_xy_swapped(points: list[SurveyPoint]) -> bool:
    if len(points) < 2:
        return False

    east_values = [point.east for point in points]
    north_values = [point.north for point in points]
    east_span = max(east_values) - min(east_values)
    north_span = max(north_values) - min(north_values)
    if north_span > 0 and east_span / north_span > 20:
        return True
    if east_span > 0 and north_span / east_span > 20:
        return True

    east_mid = abs(median(east_values))
    north_mid = abs(median(north_values))
    return east_mid > 1_000_000 and north_mid < 1_000_000


def natural_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(value):010d}")
    except ValueError:
        return (1, value)
