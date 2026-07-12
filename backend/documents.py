import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.responses import FileResponse
from db import db
from auth import get_current_user

documents_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

DOCS_DIR = Path(__file__).parent / "uploads" / "documents"
DOCS_DIR.mkdir(parents=True, exist_ok=True)

MAX_DOC_BYTES = 15 * 1024 * 1024  # 15 MB
CATEGORIES = {"drawings", "permits", "contracts", "insurance", "certificates", "other"}
ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@documents_router.post("/projects/{project_id}/documents")
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("other"),
    notes: str = Form(""),
):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of: {sorted(CATEGORIES)}")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext or 'none'}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum upload size is 15 MB.")

    doc_id = str(uuid.uuid4())
    file_path = DOCS_DIR / f"{doc_id}{ext}"
    file_path.write_bytes(raw)

    record = {
        "id": doc_id,
        "project_id": project_id,
        "title": title.strip() or Path(file.filename or "document").stem,
        "category": category,
        "notes": notes.strip(),
        "filename": file.filename or f"document{ext}",
        "file_size": len(raw),
        "media_type": ALLOWED_EXTENSIONS[ext],
        "uploaded_at": now_iso(),
    }
    doc = dict(record)
    doc["file_path"] = str(file_path)
    await db.documents.insert_one(doc)
    return record


@documents_router.get("/projects/{project_id}/documents")
async def list_documents(project_id: str, category: Optional[str] = Query(None)):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    query = {"project_id": project_id}
    if category:
        if category not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"category must be one of: {sorted(CATEGORIES)}")
        query["category"] = category
    return await db.documents.find(query, {"_id": 0, "file_path": 0}).sort("uploaded_at", -1).to_list(500)


@documents_router.get("/documents/{doc_id}/download")
async def download_document(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    file_path = Path(doc["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file missing on disk.")
    return FileResponse(file_path, media_type=doc.get("media_type", "application/octet-stream"), filename=doc["filename"])


@documents_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "file_path": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc.get("file_path"):
        Path(doc["file_path"]).unlink(missing_ok=True)
    await db.documents.delete_one({"id": doc_id})
    return {"message": "Document deleted."}
