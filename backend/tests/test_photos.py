"""Backend tests for BuildManager VIC Phase 0 - Photo Analysis (auth-required after Phase 1)."""
import os
import io
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
CONSTRUCTION_PHOTO = "/tmp/construction_frame.jpg"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}

VALID_STAGES = {'site-preparation', 'base/slab', 'frame', 'lockup', 'fixing', 'completion', 'external-works', 'unknown'}
VALID_CONFIDENCE = {'low', 'medium', 'high'}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def photo_bytes():
    with open(CONSTRUCTION_PHOTO, "rb") as f:
        return f.read()


# ---------- OpenAPI (unauth) ----------
def test_openapi_reachable():
    r = requests.get(f"{API}/openapi.json", timeout=15)
    assert r.status_code == 200
    assert "paths" in r.json()


# ---------- Analyze - real AI ----------
def test_analyze_real_ai(session, photo_bytes):
    files = {"file": ("construction_frame.jpg", photo_bytes, "image/jpeg")}
    data = {"project_stage": "frame", "notes": "Double-storey build, frame inspection day"}
    r = session.post(f"{API}/photos/analyze", files=files, data=data, timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ["id", "filename", "stage_hint", "notes", "analysis", "image_url", "created_at"]:
        assert k in body, f"missing {k}"
    assert body["stage_hint"] == "frame"
    a = body["analysis"]
    assert a["identified_stage"] in VALID_STAGES
    assert isinstance(a["progress_notes"], str) and len(a["progress_notes"]) > 10
    assert a["confidence"] in VALID_CONFIDENCE
    pytest.created_photo_id = body["id"]


# ---------- Validation errors ----------
def test_invalid_project_stage(session, photo_bytes):
    files = {"file": ("construction_frame.jpg", photo_bytes, "image/jpeg")}
    data = {"project_stage": "bogus-stage"}
    r = session.post(f"{API}/photos/analyze", files=files, data=data, timeout=90)
    assert r.status_code == 400


def test_non_image_upload(session):
    files = {"file": ("notes.txt", b"this is not an image at all", "text/plain")}
    r = session.post(f"{API}/photos/analyze", files=files, timeout=30)
    assert r.status_code == 400


def test_oversized_upload(session):
    big = b"\x00" * (11 * 1024 * 1024)
    files = {"file": ("huge.jpg", big, "image/jpeg")}
    r = session.post(f"{API}/photos/analyze", files=files, timeout=60)
    assert r.status_code == 413


# ---------- List + image retrieval ----------
def test_list_photos_newest_first(session):
    r = session.get(f"{API}/photos", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 1
    assert "_id" not in data[0]


def test_get_photo_image(session):
    photo_id = getattr(pytest, "created_photo_id", None)
    if not photo_id:
        photo_id = session.get(f"{API}/photos", timeout=15).json()[0]["id"]
    r = session.get(f"{API}/photos/{photo_id}/image", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    Image.open(io.BytesIO(r.content)).verify()


def test_get_photo_image_404(session):
    r = session.get(f"{API}/photos/nonexistent-bogus-id-12345/image", timeout=15)
    assert r.status_code == 404


# ---------- Unauthenticated calls now 401 ----------
def test_photos_unauth_blocked():
    r = requests.get(f"{API}/photos", timeout=15)
    assert r.status_code == 401
