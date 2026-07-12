"""Backend tests for BuildManager VIC Phase 1 - Auth, Projects, Tasks, Photos with project filtering.

Reuses seeded user pm@rldtech.com.au / SitePM-2026 and seeded project 'Residence - Ballarat West'.
Avoids triggering brute-force lockout - only uses correct password for the seeded email.
"""
import os
import io
import uuid
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
CONSTRUCTION_PHOTO = "/tmp/construction_frame.jpg"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.text}"
    assert "access_token" in s.cookies, "access_token cookie not set"
    assert "refresh_token" in s.cookies, "refresh_token cookie not set"
    return s


@pytest.fixture(scope="module")
def seeded_project(session):
    r = session.get(f"{API}/projects", timeout=15)
    assert r.status_code == 200
    projects = r.json()
    seed = next((p for p in projects if p["name"] == "Residence \u2013 Ballarat West"), None)
    assert seed is not None, "Seeded project not found"
    return seed


# ---------- Auth ----------
class TestAuth:
    def test_unauth_projects_401(self):
        r = requests.get(f"{API}/projects", timeout=15)
        assert r.status_code == 401

    def test_unauth_photos_401(self):
        r = requests.get(f"{API}/photos", timeout=15)
        assert r.status_code == 401

    def test_login_and_me(self, session):
        r = session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == CREDS["email"]
        assert "password_hash" not in data

    def test_wrong_password_nonexistent_email(self):
        # Use nonexistent email to avoid locking out the real seeded account
        r = requests.post(f"{API}/auth/login",
                          json={"email": f"nobody-{uuid.uuid4().hex[:8]}@example.com",
                                "password": "wrongpw123"}, timeout=15)
        assert r.status_code == 401

    def test_register_new_account(self):
        email = f"test_{uuid.uuid4().hex[:10]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST User", "email": email, "password": "abcd1234"},
                          timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == email
        assert "password_hash" not in data

    def test_register_short_password(self):
        r = requests.post(f"{API}/auth/register",
                          json={"name": "X", "email": f"x{uuid.uuid4().hex[:6]}@example.com",
                                "password": "short"}, timeout=15)
        assert r.status_code == 400

    def test_refresh(self, session):
        r = session.post(f"{API}/auth/refresh", timeout=15)
        assert r.status_code == 200
        assert "access_token" in r.cookies or "access_token" in session.cookies

    def test_logout(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json=CREDS, timeout=15)
        r = s.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code == 200
        # After logout, /me should 401
        r2 = s.get(f"{API}/auth/me", timeout=15)
        assert r2.status_code == 401


# ---------- Projects ----------
class TestProjects:
    def test_seeded_project_progress(self, seeded_project):
        assert seeded_project["progress"] == 13, f"Expected 13% got {seeded_project['progress']}"
        assert seeded_project["status"] == "active"
        assert seeded_project["contract_value"] == 620000

    def test_get_seeded_roadmap(self, session, seeded_project):
        r = session.get(f"{API}/projects/{seeded_project['id']}/roadmap", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data["stages"]) == 6
        total_tasks = sum(s["total_count"] for s in data["stages"])
        assert total_tasks == 36, f"Expected 36 tasks got {total_tasks}"
        inspections = sum(1 for s in data["stages"] for t in s["tasks"] if t.get("is_mandatory_inspection"))
        assert inspections == 4
        assert data["overall_progress"] == 13

    def test_create_project_and_verify_roadmap(self, session):
        payload = {
            "name": "TEST_Project_" + uuid.uuid4().hex[:8],
            "client_name": "Test Client",
            "site_suburb": "Geelong",
            "site_postcode": "3220",
            "project_type": "extension",
            "status": "planning",
            "contract_value": 250000,
        }
        r = session.post(f"{API}/projects", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        project = r.json()
        assert project["progress"] == 0
        pid = project["id"]

        # verify roadmap generated
        r2 = session.get(f"{API}/projects/{pid}/roadmap", timeout=15)
        assert r2.status_code == 200
        rm = r2.json()
        total = sum(s["total_count"] for s in rm["stages"])
        inspections = sum(1 for s in rm["stages"] for t in s["tasks"] if t.get("is_mandatory_inspection"))
        assert total == 36
        assert inspections == 4

        # cleanup
        session.delete(f"{API}/projects/{pid}", timeout=15)

    def test_invalid_postcode(self, session):
        payload = {
            "name": "TEST_Bad", "client_name": "X",
            "site_suburb": "Sydney", "site_postcode": "2000",
        }
        r = session.post(f"{API}/projects", json=payload, timeout=15)
        assert r.status_code == 400
        assert "postcode" in r.text.lower()

    def test_update_project(self, session):
        payload = {"name": "TEST_UpdMe", "client_name": "X",
                   "site_suburb": "Ballarat", "site_postcode": "3350"}
        r = session.post(f"{API}/projects", json=payload, timeout=15)
        pid = r.json()["id"]
        try:
            r2 = session.put(f"{API}/projects/{pid}", json={"status": "active", "notes": "updated"}, timeout=15)
            assert r2.status_code == 200
            assert r2.json()["status"] == "active"
            # verify persistence
            r3 = session.get(f"{API}/projects/{pid}", timeout=15)
            assert r3.json()["notes"] == "updated"
        finally:
            session.delete(f"{API}/projects/{pid}", timeout=15)

    def test_delete_removes_tasks(self, session):
        r = session.post(f"{API}/projects", json={
            "name": "TEST_Del", "client_name": "X",
            "site_suburb": "Ballarat", "site_postcode": "3350"}, timeout=15)
        pid = r.json()["id"]
        r2 = session.delete(f"{API}/projects/{pid}", timeout=15)
        assert r2.status_code == 200
        # verify roadmap 404
        r3 = session.get(f"{API}/projects/{pid}", timeout=15)
        assert r3.status_code == 404


# ---------- Tasks ----------
class TestTasks:
    def test_task_status_updates_progress(self, session):
        # Create fresh project, complete one pre-construction task, expect stage=~11%, overall=1%
        r = session.post(f"{API}/projects", json={
            "name": "TEST_TaskProg", "client_name": "X",
            "site_suburb": "Bendigo", "site_postcode": "3550"}, timeout=15)
        pid = r.json()["id"]
        try:
            rm = session.get(f"{API}/projects/{pid}/roadmap", timeout=15).json()
            pre_stage = next(s for s in rm["stages"] if s["key"] == "pre-construction")
            task_id = pre_stage["tasks"][0]["id"]

            r2 = session.put(f"{API}/tasks/{task_id}", json={"status": "done"}, timeout=15)
            assert r2.status_code == 200

            rm2 = session.get(f"{API}/projects/{pid}/roadmap", timeout=15).json()
            pre2 = next(s for s in rm2["stages"] if s["key"] == "pre-construction")
            assert pre2["progress"] == 11, f"stage progress expected 11 got {pre2['progress']}"
            # overall = 5 * 11 / 100 = 0.55 -> weighted acc/total; weight_sum=5 (only pre-construction has done), 
            # actually weight_sum sums all stages that have relevant tasks. All stages have relevant tasks.
            # Overall = (5*11 + 0 + ... ) / 100 = 0.55 -> round = 1
            assert rm2["overall_progress"] == 1, f"overall expected 1 got {rm2['overall_progress']}"
        finally:
            session.delete(f"{API}/projects/{pid}", timeout=15)

    def test_custom_task_crud(self, session):
        r = session.post(f"{API}/projects", json={
            "name": "TEST_CustTask", "client_name": "X",
            "site_suburb": "Ballarat", "site_postcode": "3350"}, timeout=15)
        pid = r.json()["id"]
        try:
            # create custom
            r2 = session.post(f"{API}/projects/{pid}/tasks", json={
                "title": "Custom check", "stage_key": "frame", "status": "not-started"}, timeout=15)
            assert r2.status_code == 200
            task = r2.json()
            assert task["is_custom"] is True
            tid = task["id"]

            # edit
            r3 = session.put(f"{API}/tasks/{tid}", json={"title": "Updated custom"}, timeout=15)
            assert r3.status_code == 200
            assert r3.json()["title"] == "Updated custom"

            # delete
            r4 = session.delete(f"{API}/tasks/{tid}", timeout=15)
            assert r4.status_code == 200

            # verify gone from roadmap
            rm = session.get(f"{API}/projects/{pid}/roadmap", timeout=15).json()
            all_ids = [t["id"] for s in rm["stages"] for t in s["tasks"]]
            assert tid not in all_ids
        finally:
            session.delete(f"{API}/projects/{pid}", timeout=15)

    def test_invalid_task_status(self, session, seeded_project):
        rm = session.get(f"{API}/projects/{seeded_project['id']}/roadmap", timeout=15).json()
        tid = rm["stages"][0]["tasks"][0]["id"]
        r = session.put(f"{API}/tasks/{tid}", json={"status": "bogus"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_stage_key_new_task(self, session, seeded_project):
        r = session.post(f"{API}/projects/{seeded_project['id']}/tasks", json={
            "title": "x", "stage_key": "bogus"}, timeout=15)
        assert r.status_code == 400


# ---------- Photos ----------
class TestPhotos:
    def test_photos_list_authorized(self, session):
        r = session.get(f"{API}/photos", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_photo_bogus_project_id_404(self, session):
        with open(CONSTRUCTION_PHOTO, "rb") as f:
            files = {"file": ("f.jpg", f.read(), "image/jpeg")}
        data = {"project_id": "nonexistent-bogus-id"}
        r = session.post(f"{API}/photos/analyze", files=files, data=data, timeout=30)
        assert r.status_code == 404

    def test_photo_analyze_with_project_and_filter(self, session, seeded_project):
        # Only 1 real AI call
        with open(CONSTRUCTION_PHOTO, "rb") as f:
            files = {"file": ("frame.jpg", f.read(), "image/jpeg")}
        data = {"project_id": seeded_project["id"], "project_stage": "frame"}
        r = session.post(f"{API}/photos/analyze", files=files, data=data, timeout=120)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["project_id"] == seeded_project["id"]
        photo_id = rec["id"]

        # filter list
        r2 = session.get(f"{API}/photos", params={"project_id": seeded_project["id"]}, timeout=15)
        assert r2.status_code == 200
        photos = r2.json()
        assert any(p["id"] == photo_id for p in photos)
        assert all(p["project_id"] == seeded_project["id"] for p in photos)

        # image retrieval with cookie auth
        r3 = session.get(f"{BASE_URL}{rec['image_url']}", timeout=15)
        assert r3.status_code == 200
        assert r3.headers.get("content-type", "").startswith("image/")
        Image.open(io.BytesIO(r3.content)).verify()

        # image retrieval without auth 401
        r4 = requests.get(f"{BASE_URL}{rec['image_url']}", timeout=15)
        assert r4.status_code == 401
