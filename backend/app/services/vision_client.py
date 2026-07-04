from __future__ import annotations

import os
import re
from datetime import datetime

import httpx


class VisionClientError(RuntimeError):
    pass


async def analyze_sketch(image_base64: str, image_mime: str, points_summary: str, region_hint: str = "") -> str:
    api_key = os.getenv("QWEN_VL_API_KEY")
    if not api_key:
        raise VisionClientError("QWEN_VL_API_KEY is not configured")

    base_url = os.getenv("QWEN_VL_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
    model = os.getenv("QWEN_VL_MODEL", "qwen3-vl-flash")
    image_url = f"data:{image_mime};base64,{image_base64}"

    prompt = (
        "这是一张测量现场手绘草图，图上有阿拉伯数字点号标注和中文文字说明。\n"
        f"{f'这是草图的{region_hint}，请只描述这部分能看到的内容。' if region_hint else ''}\n"
        "请仔细描述你在图中实际看到的内容，包括：\n"
        "- 你能清楚辨认的点号有哪些\n"
        "- 这些点号附近写了什么中文字（如果能辨认）\n"
        "- 点号之间是否用线连接，连接方式是什么\n"
        "- 哪些区域的字迹模糊看不清\n\n"
        "请只描述你真实看到的，不要推测或补充图中没有的内容。\n"
        "如果某个点号看不清具体是哪个数字，就说看不清，不要猜。\n\n"
        "已知测点摘要只用于帮助你核对可能存在的点号，不要根据摘要补充图中没看到的内容：\n"
        f"{points_summary or '无'}"
    )

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        "temperature": 0.0,
        "max_tokens": 2000,
        "repetition_penalty": 1.15,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    print(
        "[vision_client] request start "
        f"time={_now()} model={model} region={region_hint or '完整图'} image_mime={image_mime} base64_chars={len(image_base64)}"
    )
    for attempt in range(1, 3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
                print(
                    "[vision_client] response received "
                    f"time={_now()} region={region_hint or '完整图'} attempt={attempt} status={response.status_code} response_bytes={len(response.content)}"
                )
                response.raise_for_status()
                break
        except Exception as exc:
            print(
                "[vision_client] exception "
                f"time={_now()} region={region_hint or '完整图'} attempt={attempt} type={type(exc).__name__} error={exc}"
            )
            if attempt >= 2:
                raise

    data = response.json()
    try:
        return _truncate_repetition_loop(str(data["choices"][0]["message"]["content"]).strip())
    except (KeyError, IndexError, TypeError) as exc:
        raise VisionClientError("Qwen3-VL response does not contain message content") from exc


def _truncate_repetition_loop(text: str) -> str:
    if not text:
        return text

    min_repeats = 10
    max_unit_size = 20
    length = len(text)
    for index in range(length):
        for unit_size in range(1, max_unit_size + 1):
            if index + unit_size * (min_repeats + 1) > length:
                continue
            unit = text[index : index + unit_size]
            if not unit.strip():
                continue
            if not _is_meaningful_repeat_unit(unit):
                continue

            repeat_count = 1
            next_index = index + unit_size
            while text[next_index : next_index + unit_size] == unit:
                repeat_count += 1
                next_index += unit_size
                if repeat_count > min_repeats:
                    print(
                        "[vision_client] repeated text truncated "
                        f"time={_now()} repeat_unit={unit!r} repeat_start={index}"
                    )
                    return text[:index].rstrip()
    return text


def _is_meaningful_repeat_unit(unit: str) -> bool:
    return bool(re.search(r"[A-Za-z0-9_\u4e00-\u9fff]", unit))


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
