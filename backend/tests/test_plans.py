"""Backend tests for BuildManager VIC — AI Build Planner (validation paths only).

Does NOT call the real vision model — the full analyze→draft→apply flow is exercised
manually/with live verification since it takes minutes. These tests cover auth,
upload validation and draft/apply guards.
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session):
    projects = session.get(f"{API}/projects", timeout=15).json()
    if not projects:
        pytest.skip("no job to plan against")
    return projects[0]["id"]


class TestPlanValidation:
    def test_unauth_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/plans", timeout=15)
        assert r.status_code == 401

    def test_list_plans_ok(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/plans", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_analyze_bad_project_404(self, session):
        files = {"file": ("plan.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}
        r = session.post(f"{API}/projects/nope/plans/analyze", files=files, timeout=15)
        assert r.status_code == 404

    def test_analyze_wrong_type_400(self, session, project_id):
        files = {"file": ("plan.txt", io.BytesIO(b"not a drawing"), "text/plain")}
        r = session.post(f"{API}/projects/{project_id}/plans/analyze", files=files, timeout=15)
        assert r.status_code == 400

    def test_analyze_empty_file_400(self, session, project_id):
        files = {"file": ("plan.pdf", io.BytesIO(b""), "application/pdf")}
        r = session.post(f"{API}/projects/{project_id}/plans/analyze", files=files, timeout=15)
        assert r.status_code == 400

    def test_analyze_corrupt_pdf_400(self, session, project_id):
        files = {"file": ("plan.pdf", io.BytesIO(b"definitely not a pdf"), "application/pdf")}
        r = session.post(f"{API}/projects/{project_id}/plans/analyze", files=files, timeout=15)
        assert r.status_code == 400

    def test_analyze_corrupt_image_400(self, session, project_id):
        files = {"file": ("plan.jpg", io.BytesIO(b"not a jpeg"), "image/jpeg")}
        r = session.post(f"{API}/projects/{project_id}/plans/analyze", files=files, timeout=15)
        assert r.status_code == 400

    def test_generate_draft_unknown_plan_404(self, session):
        r = session.post(f"{API}/plans/not-a-plan/generate-draft", timeout=15)
        assert r.status_code == 404

    def test_apply_unknown_plan_404(self, session):
        r = session.post(f"{API}/plans/not-a-plan/apply",
                         json={"draft_id": "x", "tasks": [], "estimate_lines": []}, timeout=15)
        assert r.status_code == 404


class TestAnalyseAFiledDrawing:
    """The planner used to want its own upload, so a drawing already on the job
    had to be uploaded a second time just to be read."""

    def test_a_filed_document_is_found_and_read(self, session, project_id):
        """A text file proves the lookup and the type check both ran against the
        stored document — without dispatching a real analysis at the model."""
        r = session.post(f"{API}/projects/{project_id}/documents", timeout=15,
                         files={"file": ("notes.txt", io.BytesIO(b"site notes"), "text/plain")},
                         data={"title": "PLANTEST notes", "category": "other"})
        assert r.status_code in (200, 201), r.text
        doc_id = r.json()["id"]
        try:
            a = session.post(f"{API}/projects/{project_id}/plans/analyze",
                             data={"document_id": doc_id}, timeout=30)
            assert a.status_code == 400
            assert "PDF" in a.json()["detail"]
        finally:
            session.delete(f"{API}/documents/{doc_id}", timeout=15)

    def test_a_document_from_another_job_is_refused(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/plans/analyze",
                         data={"document_id": "not-on-this-job"}, timeout=30)
        assert r.status_code == 404

    def test_neither_a_file_nor_a_document_is_refused(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/plans/analyze", data={}, timeout=30)
        assert r.status_code == 400
