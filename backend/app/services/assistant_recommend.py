from __future__ import annotations

import json
from typing import Any

from app.services import ai_client


ALLOWED_AI_TYPES = {"line", "closed_polygon", "point_feature"}


async def generate_ai_plans(
    points: list[Any],
    candidates: list[Any],
    markups: list[Any],
    sketch_observation: str = "",
    sketch_observations: list[dict] | None = None,
) -> list[dict]:
    point_ids = {str(_value_from(point, "id", "")) for point in points}
    point_ids.discard("")

    messages = [
        {
            "role": "system",
            "content": (
                "你是南方 CASS 测量内业成图前处理助手，只根据传入测点、候选、草图标注和用户确认后的草图分析结果生成推荐方案。"
                "必须严格输出 JSON，不要输出解释性文字。"
            ),
        },
        {
            "role": "user",
            "content": _build_prompt(points, candidates, markups, sketch_observation, sketch_observations or []),
        },
    ]

    content = await ai_client.chat(messages)
    try:
        parsed = json.loads(_strip_json_wrapper(content))
    except json.JSONDecodeError:
        return []

    raw_plans = parsed.get("plans") if isinstance(parsed, dict) else None
    if not isinstance(raw_plans, list):
        return []

    plans: list[dict] = []
    for index, raw_plan in enumerate(raw_plans, start=1):
        plan = _sanitize_plan(raw_plan, point_ids, index)
        if plan:
            plans.append(plan)
    return plans


def _build_prompt(
    points: list[Any],
    candidates: list[Any],
    markups: list[Any],
    sketch_observation: str = "",
    sketch_observations: list[dict] | None = None,
) -> str:
    point_summary = [_summarize_point(point) for point in points]
    payload = {
        "points": point_summary,
        "candidates": [_summarize_candidate(candidate) for candidate in candidates],
        "markups": [_summarize_markup(markup) for markup in markups],
    }
    confirmed_observations = [_summarize_sketch_observation(item) for item in (sketch_observations or [])]
    sketch_section = ""
    if confirmed_observations:
        sketch_section = (
            "草图分析结果（已经用户确认）：\n"
            f"{json.dumps(confirmed_observations, ensure_ascii=False)}\n"
            "请优先根据以上草图分析结果生成推荐方案，再结合点号连续性补充其他候选。\n"
        )
    elif sketch_observation.strip():
        sketch_section = f"草图观察结果：{sketch_observation.strip()}\n"
    else:
        sketch_section = "无\n"

    return (
        "第一段：背景说明\n"
        "这是南方 CASS 测量内业成图场景。系统不是自动替代 CASS，而是根据测量点文件给人工成图提供候选推荐。\n"
        "测量点字段包括：点号、东坐标、北坐标、高程、备注、编码。本次只给你点号、备注、编码摘要，坐标不参与判断。\n"
        "常见地物类型包括：建筑物（房角点围成闭合面）、道路边线（连续折线）、围墙（连续折线或闭合）、"
        "绿化带（闭合面）、水池（闭合面）、台阶（折线）、独立树（单点）、井盖（单点）。\n"
        "判断连接关系的依据优先级：1. 备注字段（如“房角点”“道路边”“围墙”）；"
        "2. 编码字段（如“building”“road_edge”“wall”）；3. 点号连续性（连续点号通常属于同一地物）；"
        "4. 草图观察结果（如果有）。\n"
        "输出点号必须是字符串，必须在提供的点列表里存在，不能捏造。"
        "每个推荐 item 必须说清楚 reason，例如“点53-56备注均为房角点，推荐闭合成建筑物”。\n"
        "地物类型 type 只能是：line / closed_polygon / point_feature。"
        "请输出 2-3 个方案，每个方案包含 title、summary、confidence、items。"
        "每个 item 必须包含 name、type、pointIds、closed、layer、confidence、reason、risks。\n"
        "必须输出严格 JSON，不要 markdown，不要代码块，不要解释性文字。输出格式："
        '{ "plans": [ { "title": "...", "source": "ai_text", "summary": "...", "confidence": 0.8, "items": [ '
        '{ "name": "...", "type": "line", "pointIds": ["53","54"], "closed": false, "layer": "ROAD", '
        '"confidence": 0.8, "reason": "...", "risks": [] } ] } ] }\n\n'
        "第二段：当前点数据摘要（只包含点号、备注、编码）\n"
        f"{json.dumps(point_summary, ensure_ascii=False)}\n\n"
        "第三段：草图观察结果（如果有）\n"
        f"{sketch_section}\n"
        "辅助上下文：已有本地候选和草图标注\n"
        f"{json.dumps({'candidates': payload['candidates'], 'markups': payload['markups']}, ensure_ascii=False)}"
    )


def _sanitize_plan(raw_plan: Any, point_ids: set[str], index: int) -> dict | None:
    if not isinstance(raw_plan, dict):
        return None

    raw_items = raw_plan.get("items")
    if not isinstance(raw_items, list):
        return None

    items = [_sanitize_item(item, point_ids, item_index) for item_index, item in enumerate(raw_items, start=1)]
    items = [item for item in items if item]
    if not items:
        return None

    confidence = _to_float(raw_plan.get("confidence"), _average([item["confidence"] for item in items]))
    return {
        "id": str(raw_plan.get("id") or f"ai_plan_{index}"),
        "title": str(raw_plan.get("title") or f"AI 推荐方案 {index}"),
        "source": "ai_text",
        "status": "pending",
        "summary": str(raw_plan.get("summary") or "DeepSeek 根据当前测点与候选生成的推荐方案。"),
        "items": items,
        "confidence": confidence,
        "risks": _string_list(raw_plan.get("risks")),
    }


def _sanitize_item(raw_item: Any, point_ids: set[str], index: int) -> dict | None:
    if not isinstance(raw_item, dict):
        return None

    item_type = str(raw_item.get("type") or "")
    if item_type not in ALLOWED_AI_TYPES:
        return None

    raw_point_ids = raw_item.get("pointIds")
    if not isinstance(raw_point_ids, list):
        return None

    item_point_ids = [str(point_id) for point_id in raw_point_ids]
    if not item_point_ids or any(point_id not in point_ids for point_id in item_point_ids):
        return None

    return {
        "id": str(raw_item.get("id") or f"ai_item_{index}"),
        "name": str(raw_item.get("name") or f"AI 推荐地物 {index}"),
        "type": item_type,
        "pointIds": item_point_ids,
        "closed": bool(raw_item.get("closed", item_type == "closed_polygon")),
        "layer": str(raw_item.get("layer") or "DEFAULT"),
        "confidence": _to_float(raw_item.get("confidence"), 0.6),
        "reason": str(raw_item.get("reason") or "AI 根据输入数据生成。"),
        "risks": _string_list(raw_item.get("risks")),
    }


def _summarize_point(point: Any) -> dict:
    return {
        "id": str(_value_from(point, "id", "")),
        "note": str(_value_from(point, "note", "")),
        "code": str(_value_from(point, "code", "")),
    }


def _summarize_candidate(candidate: Any) -> dict:
    return {
        "id": str(_value_from(candidate, "id", "")),
        "source": str(_value_from(candidate, "source", "")),
        "type": str(_value_from(candidate, "type", "")),
        "name": str(_value_from(candidate, "name", "")),
        "pointIds": [str(point_id) for point_id in _value_from(candidate, "pointIds", []) or []],
        "closed": bool(_value_from(candidate, "closed", False)),
        "layer": str(_value_from(candidate, "layer", "")),
        "confidence": _value_from(candidate, "confidence", None),
        "reason": str(_value_from(candidate, "reason", "")),
    }


def _summarize_markup(markup: Any) -> dict:
    return {
        "id": str(_value_from(markup, "id", "")),
        "type": str(_value_from(markup, "type", "")),
        "label": str(_value_from(markup, "label", "")),
        "linkedPointIds": [str(point_id) for point_id in _value_from(markup, "linkedPointIds", []) or []],
        "linkedFeatureId": _value_from(markup, "linkedFeatureId", None),
        "note": str(_value_from(markup, "note", "")),
    }


def _summarize_sketch_observation(observation: dict) -> dict:
    return {
        "pointIds": [str(point_id) for point_id in observation.get("pointIds", []) or []],
        "featureType": str(observation.get("featureType") or "unknown"),
        "label": str(observation.get("label") or ""),
        "reason": str(observation.get("reason") or ""),
    }


def _value_from(value: Any, key: str, default: Any) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


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


def _to_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, result))


def _average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]
