from __future__ import annotations

import os
from pathlib import Path

import httpx


class AiClientError(RuntimeError):
    pass


def _load_local_env() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    for env_file in (backend_dir / ".env.local", backend_dir / ".env"):
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            text = line.strip()
            if not text or text.startswith("#") or "=" not in text:
                continue
            key, value = text.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_local_env()
print(f"DEEPSEEK_API_KEY loaded: {bool(os.getenv('DEEPSEEK_API_KEY'))}")


async def chat(messages: list[dict]) -> str:
    _load_local_env()
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise AiClientError("DEEPSEEK_API_KEY is not set. Please configure it before calling AI recommendations.")

    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{base_url}/v1/chat/completions", json=payload, headers=headers)
        response.raise_for_status()

    data = response.json()
    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise AiClientError("DeepSeek response does not contain assistant message content.") from exc
