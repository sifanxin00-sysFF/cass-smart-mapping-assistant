from __future__ import annotations

import json
import re
from typing import Any

from app.services import ai_client, vision_client


ALLOWED_SKETCH_FEATURE_TYPES = {
    "building",
    "road_edge",
    "wall",
    "green_area",
    "water",
    "stairs",
    "tree",
    "manhole",
    "unknown",
}


async def analyze_sketch_for_assistant(
    image_base64: str,
    image_mime: str,
    points: list[Any],
    image_parts: list[dict[str, Any]] | None = None,
) -> dict:
    try:
        parts = _normalize_image_parts(image_base64, image_mime, image_parts)
        vision_parts: list[dict[str, str]] = []
        vision_errors: list[str] = []
        for index, part in enumerate(parts):
            label = part["label"] or f"区域{index + 1}"
            try:
                text = await vision_client.analyze_sketch(
                    part["image_base64"],
                    part["image_mime"],
                    _points_summary(points),
                    label,
                )
                vision_parts.append({"label": label, "text": text})
            except Exception as exc:
                vision_errors.append(f"{label}: {type(exc).__name__} {exc}")
                continue
        if not vision_parts:
            raise RuntimeError("; ".join(vision_errors) or "视觉分析失败")

        vision_text = _join_vision_parts(vision_parts)
        structure_text = await _extract_structured_observations(vision_text)
        structured = _parse_structured_response(structure_text, vision_text)
    except Exception as exc:
        message = str(exc) or "视觉分析失败"
        if "QWEN_VL_API_KEY" in message:
            message = "未配置视觉分析 API"
        if "DEEPSEEK_API_KEY" in message:
            message = "未配置 DeepSeek API"
        return {
            "observations": [],
            "uncertainPoints": [],
            "generalDescription": "",
            "rawText": "",
            "visionRawText": "",
            "visionRawParts": [],
            "structureRawText": "",
            "success": False,
            "error": message,
        }

    return {
        "observations": structured["observations"],
        "uncertainPoints": structured["uncertainPoints"],
        "generalDescription": vision_text,
        "rawText": vision_text,
        "visionRawText": vision_text,
        "visionRawParts": vision_parts,
        "structureRawText": structure_text,
        "success": True,
        "error": None,
    }


def _normalize_image_parts(image_base64: str, image_mime: str, image_parts: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for part in image_parts or []:
        part_base64 = str(part.get("image_base64") or "")
        part_mime = str(part.get("image_mime") or image_mime or "image/jpeg")
        if not part_base64:
            continue
        normalized.append(
            {
                "image_base64": part_base64,
                "image_mime": part_mime,
                "label": str(part.get("label") or ""),
            }
        )
    if normalized:
        return normalized
    return [{"image_base64": image_base64, "image_mime": image_mime or "image/jpeg", "label": "完整图"}]


def _join_vision_parts(vision_parts: list[dict[str, str]]) -> str:
    return "\n\n".join(f"【{part['label']}】\n{part['text']}" for part in vision_parts)


async def _extract_structured_observations(vision_text: str) -> str:
    prompt = (
        "以下是AI对一张测量草图的真实描述：\n"
        f"{vision_text}\n\n"
        "请从这段描述中提取出明确提到的点号和对应的地物类型，\n"
        "只提取描述中明确出现的点号，不要补充任何描述中没有提到的点号。\n"
        "如果描述里没有明确说某几个点号对应什么类型，就不要生成那条observation。\n\n"
        "提取规则：\n"
        "- 必须保留原文里出现的具体中文词汇作为label，不要为了套类型而简化信息。\n"
        "- 如果描述提到“楼梯”，featureType用stairs，label保留“楼梯”。\n"
        "- 如果描述提到“棚”或“棚板”，featureType用unknown，label保留原文用词，比如“棚板”。\n"
        "- 如果描述提到“栅栏”，featureType用wall，label保留“栅栏”。\n"
        "- 如果描述提到“电线杆”，featureType用unknown，label保留“电线杆”。\n"
        "- 如果描述提到“垃圾桶”，featureType用unknown，label保留“垃圾桶”。\n"
        "- 如果描述提到“树”或具体树名，featureType用tree，label保留原文实际词汇，比如“柳树”。\n"
        "- 不确定的统一归unknown，但label必须保留原文实际写的词，不能丢信息。\n"
        "- observations颗粒度要细：不要把17-35这种很多点全部合并成一条。\n"
        "- 如果原始描述里能看出明显子分组，比如树、电线杆、灯、垃圾桶、栅栏分别出现，要拆成多条，每条只对应真正同一类型同一组的点号。\n\n"
        "覆盖率规则：\n"
        "- 不要只提取带中文地物名的单点；如果描述明确说一组点号在同一排、同一椭圆、同一弧线、同一长条状区域、同一连接线上，也要提取成 observation。\n"
        "- 这类只有几何/位置关系、没有明确地物名的点组，featureType 用 unknown，label 保留原文关系，例如“横向点列”“椭圆内点列”“弧线点列”“长条状弧线点列”。\n"
        "- 对明确列出的点组要尽量完整保留点号，例如描述写“48、49、50、51、52排成一行”，pointIds 必须包含这5个点。\n"
        "- 如果同一组超过10个点，要按原文的自然分组拆开，不要合成一条超长 observation。\n"
        "- 忽略那些原文明确说只是“已知测点摘要”或“并非本图实际识别”的点号列表；只提取草图画面中实际可见、实际描述的点号。\n\n"
        "输出JSON格式：\n"
        "{\n"
        '  "observations": [\n'
        "    {\n"
        '      "pointIds": ["15", "16"],\n'
        '      "featureType": "road_edge",\n'
        '      "label": "道路边线",\n'
        '      "reason": "描述中明确说点15、16之间有线连接并标注为道路边线"\n'
        "    }\n"
        "  ],\n"
        '  "uncertainPoints": [],\n'
        '  "generalDescription": "原始描述"\n'
        "}\n\n"
        "featureType 只能是以下之一：building / road_edge / wall / green_area / water / stairs / tree / manhole / unknown。\n"
        "如果描述内容模糊，没有任何明确的点号-类型对应关系，observations返回空数组。\n"
        "只输出严格JSON，不要markdown，不要解释。"
    )
    return await ai_client.chat([{"role": "user", "content": prompt}])


def _parse_structured_response(raw_text: str, vision_text: str) -> dict:
    try:
        parsed = json.loads(_strip_json_wrapper(raw_text))
    except json.JSONDecodeError:
        return {"observations": [], "uncertainPoints": [], "generalDescription": vision_text}

    if not isinstance(parsed, dict):
        return {"observations": [], "uncertainPoints": [], "generalDescription": vision_text}

    mentioned_point_ids = _extract_point_ids_from_text(vision_text)
    observations = _sanitize_observations(parsed.get("observations"), mentioned_point_ids)
    uncertain_points = _sanitize_point_ids(parsed.get("uncertainPoints"), mentioned_point_ids)
    return {
        "observations": observations,
        "uncertainPoints": uncertain_points,
        "generalDescription": vision_text,
    }


def _sanitize_observations(value: Any, mentioned_point_ids: set[str]) -> list[dict]:
    if not isinstance(value, list):
        return []

    observations: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        point_ids = _sanitize_point_ids(item.get("pointIds"), mentioned_point_ids)
        if not point_ids:
            continue

        feature_type = str(item.get("featureType") or "unknown")
        if feature_type not in ALLOWED_SKETCH_FEATURE_TYPES:
            feature_type = "unknown"

        label = str(item.get("label") or "")
        reason = str(item.get("reason") or "")
        feature_type, label = _normalize_feature_type_and_label(feature_type, label, reason)

        observations.append(
            {
                "pointIds": point_ids,
                "featureType": feature_type,
                "label": label,
                "reason": reason,
            }
        )
    return observations


def _normalize_feature_type_and_label(feature_type: str, label: str, reason: str) -> tuple[str, str]:
    source_text = f"{label} {reason}"
    keyword_rules = [
        ("楼梯", "stairs", "楼梯"),
        ("棚板", "unknown", "棚板"),
        ("棚", "unknown", "棚"),
        ("栅栏", "wall", "栅栏"),
        ("电线杆", "unknown", "电线杆"),
        ("垃圾桶", "unknown", "垃圾桶"),
        ("柳树", "tree", "柳树"),
        ("树", "tree", label or "树"),
    ]
    for keyword, mapped_type, mapped_label in keyword_rules:
        if keyword in source_text:
            return mapped_type, label or mapped_label
    return feature_type, label


def _sanitize_point_ids(value: Any, mentioned_point_ids: set[str]) -> list[str]:
    if not isinstance(value, list):
        return []

    point_ids: list[str] = []
    for point_id in value:
        text = str(point_id)
        if text in mentioned_point_ids and text not in point_ids:
            point_ids.append(text)
    return point_ids


def _extract_point_ids_from_text(text: str) -> set[str]:
    return set(re.findall(r"(?<![A-Za-z0-9])(?:[A-Za-z]?\d+[A-Za-z]?)(?![A-Za-z0-9])", text))


def _strip_json_wrapper(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def _points_summary(points: list[Any]) -> str:
    rows: list[str] = []
    for point in points[:80]:
        point_id = str(_value_from(point, "id", ""))
        note = str(_value_from(point, "note", ""))
        code = str(_value_from(point, "code", ""))
        rows.append(f"id={point_id}, note={note}, code={code}")
    if len(points) > 80:
        rows.append(f"...共 {len(points)} 个点，仅展示前 80 个")
    return "\n".join(rows)


def _value_from(value: Any, key: str, default: Any) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)
