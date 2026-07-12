"""Backend tests for BuildManager VIC Phase 0 - Photo Analysis."""
import os
import io
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://build-analyze.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"
CONSTRUCTION_PHOTO = "/tmp/construction_frame.jpg"

VALID_STAGES = {'site-preparation', 'base/slab', 'frame', 'lockup', 'fixing', 'completion', 'external-works', 'unknown'}
VALID_CONFIDENCE = {'low', 'medium', 'high'}


@pytest.fixture(scope="module")
def photo_bytes():
    with open(CONSTRUCTION_PHOTO, "rb") as f:
        return f.read()


# ---------- OpenAPI ----------
def test_openapi_reachable():
    r = requests.get(f"{API}/openapi.json", timeout=15)
    assert r.status_code == 200
    assert "paths" in r.json()


# ---------- Analyze - real AI ----------
def test_analyze_real_ai(photo_bytes):
    files = {"file": ("construction_frame.jpg", photo_bytes, "image/jpeg")}
    data = {"project_stage": "frame", "notes": "Double-storey build, frame inspection day"}
    r = requests.post(f"{API}/photos/analyze", files=files, data=data, timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    # top-level structural assertions
    for k in ["id", "filename", "stage_hint", "notes", "analysis", "image_url", "created_at"]:
        assert k in body, f"missing {k}"
    assert body["stage_hint"] == "frame"
    assert body["image_url"].startswith("/api/photos/")
    a = body["analysis"]
    assert a["identified_stage"] in VALID_STAGES
    assert isinstance(a["progress_notes"], str) and len(a["progress_notes"]) > 10
    assert isinstance(a["observations"], list) and len(a["observations"]) > 0
    assert isinstance(a["potential_issues"], list)
    assert a["confidence"] in VALID_CONFIDENCE
    # stash for later tests
    pytest.created_photo_id = body["id"]


# ---------- Validation errors ----------
def test_invalid_project_stage(photo_bytes):
    files = {"file": ("construction_frame.jpg", photo_bytes, "image/jpeg")}
    data = {"project_stage": "bogus-stage"}
    r = requests.post(f"{API}/photos/analyze", files=files, data=data, timeout=90)
    # Note: server validates AFTER opening image + AFTER checking size; but before AI call? Actually stage check is before AI. Fine.
    assert r.status_code == 400
    assert "project_stage" in r.text.lower() or "invalid" in r.text.lower()


def test_non_image_upload():
    files = {"file": ("notes.txt", b"this is not an image at all, just plain text", "text/plain")}
    r = requests.post(f"{API}/photos/analyze", files=files, timeout=30)
    assert r.status_code == 400
    assert "image" in r.text.lower()


def test_oversized_upload():
    big = b"\x00" * (11 * 1024 * 1024)
    files = {"file": ("huge.jpg", big, "image/jpeg")}
    r = requests.post(f"{API}/photos/analyze", files=files, timeout=60)
    assert r.status_code == 413


# ---------- List + image retrieval ----------
def test_list_photos_newest_first():
    r = requests.get(f"{API}/photos", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 1
    if len(data) >= 2:
        assert data[0]["created_at"] >= data[1]["created_at"]
    # ensure no _id leaks
    assert "_id" not in data[0]


def test_get_photo_image():
    # use id from earlier test if available, else pick from list
    photo_id = getattr(pytest, "created_photo_id", None)
    if not photo_id:
        photo_id = requests.get(f"{API}/photos", timeout=15).json()[0]["id"]
    r = requests.get(f"{API}/photos/{photo_id}/image", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    # verify it's actually a decodable image
    Image.open(io.BytesIO(r.content)).verify()


def test_get_photo_image_404():
    r = requests.get(f"{API}/photos/nonexistent-bogus-id-12345/image", timeout=15)
    assert r.status_code == 404
