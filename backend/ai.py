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

VLLM_VISION_URL = os.environ.get('VLLM_VISION_URL', 'http://host.docker.internal:8004/v1')
# Must match an id served by that endpoint (GET /v1/models) — a mismatch is a 404
# from vLLM, not a connection error, so it looks like "the AI is broken".
VISION_MODEL = os.environ.get('VLLM_VISION_MODEL', 'vllm-qwen38-27b')
# Qwen3 emits a separate reasoning stream that spends the token budget before it
# writes any content. Every prompt in this app asks for strict JSON, so thinking
# is off by default: it returns clean JSON in a fraction of the tokens.
ENABLE_THINKING = os.environ.get('VLLM_ENABLE_THINKING', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}


def image_content(image_b64: str, media_type: str = "image/jpeg") -> dict:
    return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}}


def text_content(text: str) -> dict:
    return {"type": "text", "text": text}


async def vision_chat(messages: List[dict], max_tokens: int = 2048, timeout: float = 180.0) -> str:
    """Single chat-completions call. Raises RuntimeError with a friendly message on failure."""
    url = f"{VLLM_VISION_URL}/chat/completions"
    payload = {"model": VISION_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.0}
    if not ENABLE_THINKING:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300]
            logger.error("Vision model rejected the request (%s): %s", e.response.status_code, body)
            if e.response.status_code == 404:
                raise RuntimeError(
                    f"The AI model '{VISION_MODEL}' is not served at {VLLM_VISION_URL}. "
                    f"Check VLLM_VISION_MODEL against GET {VLLM_VISION_URL}/models."
                )
            raise RuntimeError(f"AI model request failed ({e.response.status_code}): {body}")
        except httpx.HTTPError as e:
            logger.error(f"Vision model request failed: {e}")
            raise RuntimeError(
                f"Could not reach the AI model at {VLLM_VISION_URL}. Is it running? ({e})"
            )
        try:
            choice = data["choices"][0]
            content = choice["message"].get("content")
        except (KeyError, IndexError) as e:
            raise RuntimeError(f"Unexpected AI model response format: {e}")

        # A reasoning model can spend the whole budget thinking and return nothing.
        if not content or not content.strip():
            if choice.get("finish_reason") == "length":
                raise RuntimeError(
                    "The AI model hit its token limit before answering. "
                    "Try a smaller drawing, or raise max_tokens."
                )
            raise RuntimeError("The AI model returned an empty response.")
        return content


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
