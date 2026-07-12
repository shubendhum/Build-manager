"""Shared helpers for calling the local vLLM vision model (Qwen3-VL-32B).

All AI calls in the app should go through vision_chat(); it speaks the OpenAI
chat-completions dialect against VLLM_VISION_URL and returns the raw content
string. extract_json() then parses strict-JSON replies defensively.
"""
import os
import json
import logging
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

VLLM_VISION_URL = os.environ.get('VLLM_VISION_URL', 'http://host.docker.internal:8002/v1')
VISION_MODEL = "vllm-qwen3-vl-32b"


def image_content(image_b64: str, media_type: str = "image/jpeg") -> dict:
    return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}}


def text_content(text: str) -> dict:
    return {"type": "text", "text": text}


async def vision_chat(messages: List[dict], max_tokens: int = 2048, timeout: float = 180.0) -> str:
    """Single chat-completions call. Raises RuntimeError with a friendly message on failure."""
    url = f"{VLLM_VISION_URL}/chat/completions"
    payload = {"model": VISION_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.0}
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPError as e:
            logger.error(f"Vision model request failed: {e}")
            raise RuntimeError(f"AI model request failed: {e}")
        except (KeyError, IndexError) as e:
            raise RuntimeError(f"Unexpected AI model response format: {e}")


def extract_json(raw: str):
    """Pull the first JSON object/array out of a model reply (tolerates ``` fences and chatter)."""
    text = raw.strip()
    if text.startswith('```'):
        text = text.strip('`')
        if text.lower().startswith('json'):
            text = text[4:]
    for open_ch, close_ch in (('{', '}'), ('[', ']')):
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"No parseable JSON in AI response: {raw[:200]}")


def coerce_float(value, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None:
            return default
        return float(str(value).replace(",", "").replace("$", "").strip())
    except (ValueError, TypeError):
        return default


def coerce_int(value, default: Optional[int] = None) -> Optional[int]:
    f = coerce_float(value)
    return int(round(f)) if f is not None else default
