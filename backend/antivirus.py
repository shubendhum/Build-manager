"""Virus scanning for files that arrive from outside.

Tradie email attachments and portal uploads come from people we do not control,
so they are scanned before they are written anywhere the app will serve them
again. Talks to clamd over TCP using the INSTREAM command, implemented directly
on asyncio sockets — no new dependency, and nothing blocking the event loop.

Also checks that a file really is what it claims: a PDF whose bytes do not start
with %PDF is not a PDF, whatever the Content-Type said.

Config:
  CLAMAV_HOST / CLAMAV_PORT   where clamd listens (default clamav:3310)
  ANTIVIRUS_REQUIRED          true (default) = refuse to store an unscannable
                              file. false = store it, marked "unscanned".
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

CHUNK = 64 * 1024
CONNECT_TIMEOUT = 10.0
SCAN_TIMEOUT = 120.0

# First bytes that must be present for the type the sender claimed.
MAGIC = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def host() -> str:
    return _env("CLAMAV_HOST", "clamav")


def port() -> int:
    try:
        return int(_env("CLAMAV_PORT", "3310"))
    except ValueError:
        return 3310


def required() -> bool:
    """Whether an unscannable file may be stored anyway."""
    return _env("ANTIVIRUS_REQUIRED", "true").lower() in {"1", "true", "yes", "on"}


class ScanResult(BaseModel):
    status: str                      # clean | infected | unscanned
    signature: Optional[str] = None  # what was found, when infected
    detail: Optional[str] = None     # why it could not be scanned
    scanned_at: str

    @property
    def safe_to_store(self) -> bool:
        if self.status == "clean":
            return True
        if self.status == "infected":
            return False
        return not required()        # unscanned: depends on configuration


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def looks_like(media_type: str, raw: bytes) -> bool:
    """Does the content match the type it claims to be?"""
    prefixes = MAGIC.get((media_type or "").lower())
    if not prefixes:
        return True              # nothing to check against
    return any(raw.startswith(p) for p in prefixes)


async def scan(raw: bytes) -> ScanResult:
    """Scan bytes with clamd. Never raises — an unreachable scanner is a
    result ("unscanned"), not an exception for the caller to handle."""
    if not raw:
        return ScanResult(status="clean", scanned_at=_now())
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host(), port()), timeout=CONNECT_TIMEOUT)
    except (OSError, asyncio.TimeoutError) as exc:
        logger.warning("Virus scanner unreachable at %s:%s — %s", host(), port(), exc)
        return ScanResult(status="unscanned", scanned_at=_now(),
                          detail=f"Scanner unreachable at {host()}:{port()}")
    try:
        writer.write(b"zINSTREAM\0")
        for i in range(0, len(raw), CHUNK):
            block = raw[i:i + CHUNK]
            writer.write(len(block).to_bytes(4, "big") + block)
        writer.write((0).to_bytes(4, "big"))     # zero-length chunk ends the stream
        await writer.drain()

        reply = (await asyncio.wait_for(reader.read(4096), timeout=SCAN_TIMEOUT)) \
            .decode("utf-8", "replace").strip().strip("\0")
    except (OSError, asyncio.TimeoutError) as exc:
        logger.warning("Virus scan failed: %s", exc)
        return ScanResult(status="unscanned", scanned_at=_now(), detail=str(exc)[:200])
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass

    # clamd answers "stream: OK" or "stream: <Signature> FOUND"
    if reply.endswith("OK"):
        return ScanResult(status="clean", scanned_at=_now())
    if "FOUND" in reply:
        signature = reply.split(":", 1)[-1].replace("FOUND", "").strip()
        logger.error("Infected file rejected: %s", signature)
        return ScanResult(status="infected", signature=signature, scanned_at=_now())
    return ScanResult(status="unscanned", scanned_at=_now(), detail=reply[:200])


async def check_incoming(raw: bytes, media_type: str, filename: str) -> ScanResult:
    """Full gate for a file from outside: is it what it claims, and is it clean?"""
    if not looks_like(media_type, raw):
        logger.warning("Rejected %s — content does not match %s", filename, media_type)
        return ScanResult(status="infected", signature="Content-Type mismatch",
                          detail=f"Contents are not a valid {media_type}", scanned_at=_now())
    return await scan(raw)


async def available() -> bool:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host(), port()), timeout=CONNECT_TIMEOUT)
        writer.write(b"zPING\0")
        await writer.drain()
        reply = (await asyncio.wait_for(reader.read(64), timeout=10.0)).decode(errors="replace")
        writer.close()
        return "PONG" in reply
    except (OSError, asyncio.TimeoutError):
        return False
