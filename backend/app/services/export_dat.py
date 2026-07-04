from __future__ import annotations

from app.models import ProjectDocument


def project_to_dat(project: ProjectDocument) -> str:
    lines = []
    for point in project.points:
        height = "" if point.height is None else f"{point.height:.3f}"
        lines.append(f"{point.id},,{point.east:.3f},{point.north:.3f},{height}")
    return "\r\n".join(lines) + "\r\n"
