from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_client, vision_client
from app.services.assistant_sketch import _parse_structured_response, analyze_sketch_for_assistant


POINTS = [{"id": "15", "east": 100.0, "north": 200.0, "height": 10.0, "note": "楼梯", "code": ""}]


def test_parse_deepseek_structured_response_keeps_only_described_point_ids():
    vision_text = "图中能看到点号15和16，15到16之间有线连接，旁边写着楼梯。没有看到其他房角点。"
    raw_text = """
    {
      "observations": [
        {
          "pointIds": ["15", "16"],
          "featureType": "stairs",
          "label": "楼梯",
          "reason": "描述中明确提到15和16之间有线连接，旁边写着楼梯"
        },
        {
          "pointIds": ["53", "54"],
          "featureType": "building",
          "label": "建筑物",
          "reason": "这条是编造的"
        }
      ],
      "uncertainPoints": ["16", "58"],
      "generalDescription": "原始描述"
    }
    """

    result = _parse_structured_response(raw_text, vision_text)

    assert result["observations"] == [
        {
            "pointIds": ["15", "16"],
            "featureType": "stairs",
            "label": "楼梯",
            "reason": "描述中明确提到15和16之间有线连接，旁边写着楼梯",
        }
    ]
    assert result["uncertainPoints"] == ["16"]
    assert result["generalDescription"] == vision_text


def test_parse_deepseek_bad_json_returns_empty_observations():
    vision_text = "图中只能看到一些树和线，点号看不清。"

    result = _parse_structured_response("不是 JSON", vision_text)

    assert result["observations"] == []
    assert result["uncertainPoints"] == []
    assert result["generalDescription"] == vision_text


def test_parse_deepseek_preserves_specific_labels_and_types():
    vision_text = "图中点号15附近写着楼梯，点号16附近写着棚板，点号17附近写着栅栏，点号18附近写着电线杆。"
    raw_text = """
    {
      "observations": [
        {"pointIds": ["15"], "featureType": "tree", "label": "楼梯", "reason": "点15附近写着楼梯"},
        {"pointIds": ["16"], "featureType": "tree", "label": "棚板", "reason": "点16附近写着棚板"},
        {"pointIds": ["17"], "featureType": "unknown", "label": "栅栏", "reason": "点17附近写着栅栏"},
        {"pointIds": ["18"], "featureType": "tree", "label": "电线杆", "reason": "点18附近写着电线杆"}
      ],
      "uncertainPoints": [],
      "generalDescription": "原始描述"
    }
    """

    result = _parse_structured_response(raw_text, vision_text)

    assert [item["featureType"] for item in result["observations"]] == ["stairs", "unknown", "wall", "unknown"]
    assert [item["label"] for item in result["observations"]] == ["楼梯", "棚板", "栅栏", "电线杆"]


def test_vision_client_truncates_repetition_loop():
    repeated = "前面是真实描述。楼梯楼梯楼梯楼梯楼梯楼梯楼梯楼梯楼梯楼梯楼梯楼梯后面不应保留"

    result = vision_client._truncate_repetition_loop(repeated)

    assert result == "前面是真实描述。"


def test_analyze_sketch_for_assistant_two_step_success(monkeypatch):
    async def fake_analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
        assert image_base64 == "abc"
        assert image_mime == "image/png"
        assert "15" in points_summary
        return "图中清楚看到点号15和16，15到16之间有线连接，旁边写着楼梯。"

    async def fake_chat(messages: list[dict]) -> str:
        assert "图中清楚看到点号15和16" in messages[0]["content"]
        return """
        {
          "observations": [
            {
              "pointIds": ["15", "16"],
              "featureType": "stairs",
              "label": "楼梯",
              "reason": "描述中明确说15到16之间有线连接，旁边写着楼梯"
            }
          ],
          "uncertainPoints": [],
          "generalDescription": "原始描述"
        }
        """

    monkeypatch.setattr(vision_client, "analyze_sketch", fake_analyze_sketch)
    monkeypatch.setattr(ai_client, "chat", fake_chat)

    result = asyncio.run(analyze_sketch_for_assistant("abc", "image/png", POINTS))

    assert result["success"] is True
    assert result["observations"][0]["pointIds"] == ["15", "16"]
    assert result["observations"][0]["featureType"] == "stairs"
    assert result["visionRawText"] == "【完整图】\n图中清楚看到点号15和16，15到16之间有线连接，旁边写着楼梯。"
    assert result["visionRawParts"] == [{"label": "完整图", "text": "图中清楚看到点号15和16，15到16之间有线连接，旁边写着楼梯。"}]
    assert "observations" in result["structureRawText"]
    assert result["error"] is None


def test_analyze_sketch_for_assistant_multiple_parts(monkeypatch):
    calls: list[tuple[str, str]] = []

    async def fake_analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
        calls.append((image_base64, region_hint))
        return f"{region_hint}看到点号15，旁边写着楼梯。"

    async def fake_chat(messages: list[dict]) -> str:
        content = messages[0]["content"]
        assert "【上半部分】" in content
        assert "【下半部分】" in content
        return """
        {
          "observations": [
            {
              "pointIds": ["15"],
              "featureType": "stairs",
              "label": "楼梯",
              "reason": "描述中明确说点15旁边写着楼梯"
            }
          ],
          "uncertainPoints": [],
          "generalDescription": "原始描述"
        }
        """

    monkeypatch.setattr(vision_client, "analyze_sketch", fake_analyze_sketch)
    monkeypatch.setattr(ai_client, "chat", fake_chat)

    result = asyncio.run(
        analyze_sketch_for_assistant(
            "",
            "image/jpeg",
            POINTS,
            [
                {"image_base64": "top", "image_mime": "image/jpeg", "label": "上半部分"},
                {"image_base64": "bottom", "image_mime": "image/jpeg", "label": "下半部分"},
            ],
        )
    )

    assert calls == [("top", "上半部分"), ("bottom", "下半部分")]
    assert result["success"] is True
    assert len(result["visionRawParts"]) == 2
    assert result["observations"][0]["label"] == "楼梯"


def test_analyze_sketch_for_assistant_filters_deepseek_hallucinated_points(monkeypatch):
    async def fake_analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
        return "图中清楚看到点号15和16，旁边写着楼梯。"

    async def fake_chat(messages: list[dict]) -> str:
        return """
        {
          "observations": [
            {
              "pointIds": ["53", "54", "55", "56"],
              "featureType": "building",
              "label": "建筑物",
              "reason": "编造的房角点"
            }
          ],
          "uncertainPoints": ["57"],
          "generalDescription": "原始描述"
        }
        """

    monkeypatch.setattr(vision_client, "analyze_sketch", fake_analyze_sketch)
    monkeypatch.setattr(ai_client, "chat", fake_chat)

    result = asyncio.run(analyze_sketch_for_assistant("abc", "image/png", POINTS))

    assert result["success"] is True
    assert result["observations"] == []
    assert result["uncertainPoints"] == []


def test_analyze_sketch_for_assistant_failure(monkeypatch):
    async def fake_analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
        raise RuntimeError("vision failed")

    monkeypatch.setattr(vision_client, "analyze_sketch", fake_analyze_sketch)

    result = asyncio.run(analyze_sketch_for_assistant("abc", "image/png", POINTS))

    assert result["success"] is False
    assert result["observations"] == []
    assert "vision failed" in result["error"]


def test_vision_client_without_api_key(monkeypatch):
    monkeypatch.delenv("QWEN_VL_API_KEY", raising=False)

    with pytest.raises(vision_client.VisionClientError):
        asyncio.run(vision_client.analyze_sketch("abc", "image/png", "id=15"))


def test_analyze_sketch_api_without_key_returns_error(monkeypatch):
    async def fake_analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
        raise vision_client.VisionClientError("QWEN_VL_API_KEY is not configured")

    monkeypatch.setattr(vision_client, "analyze_sketch", fake_analyze_sketch)
    client = TestClient(app)

    response = client.post(
        "/api/assistant/analyze-sketch",
        json={"image_base64": "abc", "image_mime": "image/png", "points": POINTS},
    )

    assert response.status_code == 200
    assert response.json() == {
        "observations": [],
        "uncertainPoints": [],
        "generalDescription": "",
        "rawText": "",
        "visionRawText": "",
        "visionRawParts": [],
        "structureRawText": "",
        "success": False,
        "error": "未配置视觉分析 API",
    }
