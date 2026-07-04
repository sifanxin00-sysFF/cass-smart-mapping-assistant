from __future__ import annotations

import asyncio
import json

from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_client
from app.services.assistant_recommend import generate_ai_plans


POINTS = [
    {"id": "53", "east": 100.0, "north": 200.0, "height": 10.0, "note": "", "code": ""},
    {"id": "54", "east": 101.0, "north": 201.0, "height": 10.1, "note": "", "code": ""},
    {"id": "55", "east": 102.0, "north": 202.0, "height": 10.2, "note": "", "code": ""},
]


def test_generate_ai_plans_accepts_valid_json(monkeypatch):
    async def fake_chat(messages: list[dict]) -> str:
        return json.dumps(
            {
                "plans": [
                    {
                        "title": "道路方案",
                        "source": "ai_text",
                        "summary": "按 53-55 生成道路边线。",
                        "confidence": 0.8,
                        "items": [
                            {
                                "name": "道路边线",
                                "type": "line",
                                "pointIds": ["53", "54", "55"],
                                "closed": False,
                                "layer": "ROAD",
                                "confidence": 0.82,
                                "reason": "连续点形成线状地物。",
                                "risks": [],
                            }
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    plans = asyncio.run(generate_ai_plans(POINTS, [], []))

    assert len(plans) == 1
    assert plans[0]["source"] == "ai_text"
    assert plans[0]["items"][0]["pointIds"] == ["53", "54", "55"]


def test_generate_ai_plans_bad_json_returns_empty(monkeypatch):
    async def fake_chat(messages: list[dict]) -> str:
        return "not json"

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    assert asyncio.run(generate_ai_plans(POINTS, [], [])) == []


def test_generate_ai_plans_drops_missing_point_item(monkeypatch):
    async def fake_chat(messages: list[dict]) -> str:
        return json.dumps(
            {
                "plans": [
                    {
                        "title": "坏点号方案",
                        "source": "ai_text",
                        "summary": "包含不存在点号。",
                        "confidence": 0.7,
                        "items": [
                            {
                                "name": "不存在点线",
                                "type": "line",
                                "pointIds": ["53", "999"],
                                "closed": False,
                                "layer": "DEFAULT",
                                "confidence": 0.7,
                                "reason": "测试过滤。",
                                "risks": [],
                            }
                        ],
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    assert asyncio.run(generate_ai_plans(POINTS, [], [])) == []


def test_generate_ai_plans_drops_unknown_type_item(monkeypatch):
    async def fake_chat(messages: list[dict]) -> str:
        return json.dumps(
            {
                "plans": [
                    {
                        "title": "未知类型方案",
                        "source": "ai_text",
                        "summary": "包含未知类型。",
                        "confidence": 0.7,
                        "items": [
                            {
                                "name": "未知地物",
                                "type": "building",
                                "pointIds": ["53", "54"],
                                "closed": False,
                                "layer": "DEFAULT",
                                "confidence": 0.7,
                                "reason": "测试过滤。",
                                "risks": [],
                            }
                        ],
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    assert asyncio.run(generate_ai_plans(POINTS, [], [])) == []


def test_generate_ai_plans_prompt_includes_sketch_observation(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_chat(messages: list[dict]) -> str:
        captured["prompt"] = messages[-1]["content"]
        return json.dumps(
            {
                "plans": [
                    {
                        "title": "草图辅助方案",
                        "source": "ai_text",
                        "summary": "结合草图观察生成。",
                        "confidence": 0.8,
                        "items": [
                            {
                                "name": "草图线",
                                "type": "line",
                                "pointIds": ["53", "54"],
                                "closed": False,
                                "layer": "DEFAULT",
                                "confidence": 0.75,
                                "reason": "草图观察中提示 53 到 54 存在线状关系。",
                                "risks": [],
                            }
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    plans = asyncio.run(generate_ai_plans(POINTS, [], [], "草图观察测试内容"))

    assert "草图观察测试内容" in captured["prompt"]
    assert len(plans) == 1


def test_generate_ai_plans_prompt_includes_structured_sketch_observations(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_chat(messages: list[dict]) -> str:
        captured["prompt"] = messages[-1]["content"]
        return json.dumps(
            {
                "plans": [
                    {
                        "title": "用户确认草图方案",
                        "source": "ai_text",
                        "summary": "按用户确认的草图观察生成。",
                        "confidence": 0.85,
                        "items": [
                            {
                                "name": "建筑物",
                                "type": "closed_polygon",
                                "pointIds": ["53", "54", "55"],
                                "closed": True,
                                "layer": "BUILDING",
                                "confidence": 0.85,
                                "reason": "用户确认草图中 53、54、55 属于建筑物轮廓。",
                                "risks": [],
                            }
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(ai_client, "chat", fake_chat)

    plans = asyncio.run(
        generate_ai_plans(
            POINTS,
            [],
            [],
            "",
            [{"pointIds": ["53", "54", "55"], "featureType": "building", "label": "建筑物", "reason": "封闭矩形"}],
        )
    )

    assert "草图分析结果（已经用户确认）" in captured["prompt"]
    assert '"featureType": "building"' in captured["prompt"]
    assert '"pointIds": ["53", "54", "55"]' in captured["prompt"]
    assert len(plans) == 1


def test_assistant_recommend_without_api_key_returns_fallback(monkeypatch):
    monkeypatch.setattr(ai_client, "_load_local_env", lambda: None)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    client = TestClient(app)

    response = client.post(
        "/api/assistant/recommend",
        json={"points": POINTS, "candidates": [], "markups": []},
    )

    assert response.status_code == 200
    assert response.json() == {"plans": [], "source": "ai_text", "fallback": True}
