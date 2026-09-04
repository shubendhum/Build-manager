"""Conversational assistant over the job, backed by the local Qwen model.

Read-only by design. The model chooses from a small set of typed tools and this
module runs them — it never sees an endpoint, never writes a query, and cannot
change anything. Writes come later, behind an approval gate; until then the
worst a confused answer can do is be wrong on screen.

Entity resolution is by listing, not retrieval: a job has a few dozen packages
and trades, which cost a hundred-odd tokens to put in front of the model in
full. That is more accurate than top-k search — the model weighs every candidate
rather than the nearest few — and there is no index to keep in step with the
database.

Tools run scoped to one project and to the signed-in user's access, exactly as
the HTTP routes do.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from auth import get_current_user
from ai import VLLM_VISION_URL, VISION_MODEL, ENABLE_THINKING
import build_sequence
import httpx

logger = logging.getLogger(__name__)

agent_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

MAX_TOOL_ROUNDS = 5          # a read-only question needs very few hops
TIMEOUT = 180.0

SYSTEM = (
    "You are the assistant inside BuildManager, used by a site supervisor running "
    "residential builds in Victoria, Australia.\n"
    "Answer from the tools — never invent a price, a date, a trade or a status.\n"
    "Call a tool when you need facts. Once you have them, answer in plain words.\n"
    "Be brief and concrete: a builder wants the number and the name, not a preamble.\n"
    "Amounts are Australian dollars including GST unless stated otherwise.\n"
    "If something has not been quoted or booked, say so plainly rather than guessing.\n"
    "You can only read. If asked to send, award, book or change anything, say that "
    "you cannot do that yet and point to the button that can."
)


# ---------- tools ----------

async def t_job_overview(project_id: str) -> dict:
    """Where the job is up to, and the money position."""
    from board import trade_board
    b = await trade_board(project_id)
    return {
        "current_stage": b.get("current_step"),
        "totals": b["totals"],
        "packages": [
            {"title": r["title"], "step": r["step"], "step_name": r["step_name"],
             "state": r["state"], "trade": r["trade_name"],
             "price": r["awarded_amount"] or r["best_quote"],
             "on_site": r["scheduled_start"], "invoiced": r["invoiced"], "paid": r["paid"]}
            for r in b["rows"]
        ],
        "needs_pricing_soon": b.get("needs_pricing_soon", []),
    }


async def t_quotes_for(project_id: str, package: str = "") -> dict:
    """Every quote in, optionally narrowed to one package."""
    packages = await db.work_packages.find({"project_id": project_id}, {"_id": 0, "id": 1, "title": 1}).to_list(500)
    wanted = [p for p in packages if package.lower() in p["title"].lower()] if package else packages
    ids = {p["id"] for p in wanted}
    titles = {p["id"]: p["title"] for p in packages}

    quotes = await db.quotes.find(
        {"project_id": project_id, "package_id": {"$in": list(ids)}},
        {"_id": 0, "attachment.file_path": 0}).to_list(500)
    trades = {t["id"]: t["business_name"] for t in
              await db.trades.find({}, {"_id": 0, "id": 1, "business_name": 1}).to_list(500)}
    return {"quotes": [
        {"package": titles.get(q.get("package_id")), "trade": trades.get(q.get("trade_id")),
         "total_inc_gst": q["total_inc_gst"], "status": q["status"],
         "lead_time": q.get("lead_time"), "excludes": q.get("exclusions"),
         "source": q.get("source"), "needs_review": bool(q.get("needs_review"))}
        for q in quotes]}


async def t_who_hasnt_replied(project_id: str) -> dict:
    """Invitations still waiting on a price, and how long they have waited."""
    rfqs = await db.rfqs.find({"project_id": project_id, "status": "open"}, {"_id": 0}).to_list(500)
    trades = {t["id"]: t["business_name"] for t in
              await db.trades.find({}, {"_id": 0, "id": 1, "business_name": 1}).to_list(500)}
    packages = {p["id"]: p["title"] for p in
                await db.work_packages.find({"project_id": project_id}, {"_id": 0, "id": 1, "title": 1}).to_list(500)}
    waiting = []
    now = datetime.now(timezone.utc)
    for r in rfqs:
        for i in r.get("invitations", []):
            if i.get("status") == "submitted":
                continue
            days = None
            if i.get("sent_at"):
                try:
                    days = (now - datetime.fromisoformat(i["sent_at"])).days
                except ValueError:
                    pass
            waiting.append({"trade": trades.get(i["trade_id"]), "package": packages.get(r.get("package_id")),
                            "status": i.get("status"), "days_waiting": days,
                            "last_reply": i.get("last_reply_summary")})
    return {"waiting_on": waiting}


async def t_trades(project_id: str, trade_type: str = "") -> dict:
    """The trade directory, with any licence or insurance problems."""
    from trades import trade_warnings
    query = {"trade_type": trade_type} if trade_type else {}
    found = await db.trades.find(query, {"_id": 0}).to_list(500)
    return {"trades": [
        {"name": t["business_name"], "type": t.get("trade_type"), "email": t.get("email"),
         "phone": t.get("phone"), "rating": t.get("rating"),
         "warnings": [w["type"] + " " + w["level"] for w in trade_warnings(t)]}
        for t in found]}


async def t_documents(project_id: str) -> dict:
    """Drawings, permits and other files filed against the job."""
    docs = await db.documents.find({"project_id": project_id},
                                   {"_id": 0, "file_path": 0}).to_list(200)
    return {"documents": [{"title": d["title"], "category": d.get("category"),
                           "filename": d.get("filename")} for d in docs]}


async def t_build_sequence(project_id: str) -> dict:
    """The standard Victorian order, and what this job has against each step."""
    packages = await db.work_packages.find({"project_id": project_id},
                                           {"_id": 0, "title": 1, "trade_type": 1}).to_list(500)
    placed = {}
    for p in packages:
        step = build_sequence.place(p["title"], p.get("trade_type"))
        placed.setdefault(step["n"] if step else 99, []).append(p["title"])
    return {"sequence": [
        {"step": s["n"], "name": s["name"], "detail": s["detail"],
         "mandatory_inspection": bool(s.get("mandatory")),
         "lead_weeks": s["lead_weeks"], "note": s.get("note"),
         "packages_on_this_job": placed.get(s["n"], [])}
        for s in build_sequence.SEQUENCE]}


TOOLS = {
    "job_overview": (t_job_overview, "Where the job is up to, the money position, and every trade package with its state.", {}),
    "quotes_for": (t_quotes_for, "Quotes received, optionally for one package.",
                   {"package": {"type": "string", "description": "Part of a package title, e.g. 'plumbing'. Omit for all."}}),
    "who_hasnt_replied": (t_who_hasnt_replied, "Trades invited to quote who have not sent a price, and how long they have waited.", {}),
    "trades": (t_trades, "The trade directory with contact details and any lapsed licence or insurance.",
               {"trade_type": {"type": "string", "description": "Optional filter, e.g. 'plumber'."}}),
    "documents": (t_documents, "Drawings, permits and files on this job.", {}),
    "build_sequence": (t_build_sequence, "The standard Victorian build order and what this job has at each step.", {}),
}


def tool_schemas() -> list:
    return [{
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": params,
                           "required": [k for k, v in params.items() if v.get("required")]},
        },
    } for name, (_, desc, params) in TOOLS.items()]


# ---------- the loop ----------

class ChatInput(BaseModel):
    message: str
    history: list = []


async def call_model(messages: list) -> dict:
    payload = {
        "model": VISION_MODEL, "messages": messages, "tools": tool_schemas(),
        "tool_choice": "auto", "max_tokens": 900, "temperature": 0.1,
    }
    if not ENABLE_THINKING:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{VLLM_VISION_URL}/chat/completions", json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"The assistant is unavailable ({resp.status_code}).")
    return resp.json()["choices"][0]["message"]


@agent_router.post("/projects/{project_id}/agent/chat")
async def chat(project_id: str, data: ChatInput):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "name": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if not data.message.strip():
        raise HTTPException(status_code=400, detail="Ask a question first.")

    messages = [{"role": "system", "content": f"{SYSTEM}\n\nThe job is: {project['name']}."}]
    for turn in data.history[-8:]:                 # enough context, bounded cost
        if turn.get("role") in {"user", "assistant"} and turn.get("content"):
            messages.append({"role": turn["role"], "content": turn["content"][:4000]})
    messages.append({"role": "user", "content": data.message[:2000]})

    used = []
    for _ in range(MAX_TOOL_ROUNDS):
        try:
            reply = await call_model(messages)
        except (RuntimeError, httpx.HTTPError) as exc:
            logger.exception("Assistant call failed")
            raise HTTPException(status_code=502, detail=str(exc)[:200])

        calls = reply.get("tool_calls") or []
        if not calls:
            answer = (reply.get("content") or "").strip()
            return {"answer": answer or "I couldn't work that out from the job data.",
                    "tools_used": used}

        messages.append({"role": "assistant", "content": reply.get("content") or "",
                         "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            entry = TOOLS.get(name)
            if not entry:
                result = {"error": f"No such tool: {name}"}
            else:
                fn, _, allowed = entry
                # Only pass parameters the tool declares, and always scope to
                # this project — the model cannot reach another job.
                kwargs = {k: v for k, v in args.items() if k in allowed}
                try:
                    result = await fn(project_id, **kwargs)
                except Exception as exc:  # noqa: BLE001 — a tool fault is an answer, not a 500
                    logger.exception("Tool %s failed", name)
                    result = {"error": str(exc)[:200]}
            used.append({"tool": name, "arguments": args})
            messages.append({"role": "tool", "tool_call_id": call.get("id", name),
                             "content": json.dumps(result, default=str)[:12000]})

    return {"answer": "That needed more digging than I can do in one go — try asking it more narrowly.",
            "tools_used": used}


@agent_router.get("/agent/health")
async def agent_health():
    """Is the model reachable, and does it support the tool calling this needs?"""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(f"{VLLM_VISION_URL}/models")
        served = [m["id"] for m in resp.json().get("data", [])]
        return {"available": VISION_MODEL in served, "model": VISION_MODEL, "served": served}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        return {"available": False, "model": VISION_MODEL, "error": str(exc)[:200]}
