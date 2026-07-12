import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user

diary_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

WEATHER_OPTIONS = {"sunny", "partly-cloudy", "overcast", "rain", "storm", "windy", "frost"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CrewEntry(BaseModel):
    trade: str
    count: int = 1


class DiaryEntryInput(BaseModel):
    date: Optional[str] = None
    weather: str = ""
    temp_c: Optional[float] = None
    crew: List[CrewEntry] = []
    notes: str = ""
    photo_ids: List[str] = []


class DiaryEntryUpdate(BaseModel):
    date: Optional[str] = None
    weather: Optional[str] = None
    temp_c: Optional[float] = None
    crew: Optional[List[CrewEntry]] = None
    notes: Optional[str] = None
    photo_ids: Optional[List[str]] = None


def validate_weather(weather: Optional[str]):
    if weather and weather not in WEATHER_OPTIONS:
        raise HTTPException(status_code=400, detail=f"weather must be one of: {sorted(WEATHER_OPTIONS)}")


def clean_crew(crew: list) -> list:
    return [{"trade": c["trade"].strip(), "count": max(int(c["count"]), 1)}
            for c in crew if c.get("trade", "").strip()]


@diary_router.get("/projects/{project_id}/diary")
async def list_diary_entries(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    return await db.diary_entries.find({"project_id": project_id}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(1000)


@diary_router.post("/projects/{project_id}/diary")
async def create_diary_entry(project_id: str, data: DiaryEntryInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    validate_weather(data.weather)
    entry = data.model_dump()
    entry["id"] = str(uuid.uuid4())
    entry["project_id"] = project_id
    entry["date"] = entry["date"] or datetime.now(timezone.utc).date().isoformat()
    entry["crew"] = clean_crew(entry["crew"])
    entry["notes"] = entry["notes"].strip()
    entry["created_at"] = now_iso()
    entry["updated_at"] = now_iso()
    await db.diary_entries.insert_one(dict(entry))
    entry.pop("_id", None)
    return entry


@diary_router.put("/diary/{entry_id}")
async def update_diary_entry(entry_id: str, data: DiaryEntryUpdate):
    if not await db.diary_entries.find_one({"id": entry_id}):
        raise HTTPException(status_code=404, detail="Diary entry not found.")
    updates = data.model_dump(exclude_unset=True)
    validate_weather(updates.get("weather"))
    if "crew" in updates and updates["crew"] is not None:
        updates["crew"] = clean_crew(updates["crew"])
    if "notes" in updates and updates["notes"] is not None:
        updates["notes"] = updates["notes"].strip()
    updates["updated_at"] = now_iso()
    await db.diary_entries.update_one({"id": entry_id}, {"$set": updates})
    return await db.diary_entries.find_one({"id": entry_id}, {"_id": 0})


@diary_router.delete("/diary/{entry_id}")
async def delete_diary_entry(entry_id: str):
    result = await db.diary_entries.delete_one({"id": entry_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Diary entry not found.")
    return {"message": "Diary entry deleted."}
