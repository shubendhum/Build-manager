"""Backend tests for BuildManager VIC — Records: variations register + site diary.

Uses seeded user pm@rldtech.com.au / SitePM-2026 and seeded project 'Residence - Ballarat West'.
Cleans up everything it creates.
"""
import os
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
    r = session.get(f"{API}/projects", timeout=15)
    assert r.status_code == 200
    p = next(x for x in r.json() if x["name"] == "Residence – Ballarat West")
    return p["id"]


class TestVariations:
    created = []

    def test_unauth_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/variations", timeout=15)
        assert r.status_code == 401

    def test_create_auto_numbering(self, session, project_id):
        existing = session.get(f"{API}/projects/{project_id}/variations", timeout=15).json()
        highest = 0
        for v in existing:
            highest = max(highest, int(v["number"].split("-")[-1]))
        r1 = session.post(f"{API}/projects/{project_id}/variations",
                          json={"title": "TEST_VO Upgrade oven", "cost_delta": 1800}, timeout=15)
        assert r1.status_code == 200, r1.text
        v1 = r1.json()
        r2 = session.post(f"{API}/projects/{project_id}/variations",
                          json={"title": "TEST_VO Delete alfresco ceiling fan", "cost_delta": -420}, timeout=15)
        assert r2.status_code == 200
        v2 = r2.json()
        TestVariations.created = [v1, v2]
        assert v1["number"] == f"VO-{highest + 1:03d}"
        assert v2["number"] == f"VO-{highest + 2:03d}"
        assert v1["status"] == "proposed"
        assert v2["cost_delta"] == -420

    def test_invalid_status_400(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/variations",
                         json={"title": "TEST_VO bad", "status": "bogus"}, timeout=15)
        assert r.status_code == 400

    def test_empty_title_400(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/variations", json={"title": "  "}, timeout=15)
        assert r.status_code == 400

    def test_approved_variation_flows_into_budget(self, session, project_id):
        base = session.get(f"{API}/projects/{project_id}/budget", timeout=15).json()["totals"]
        v1, v2 = TestVariations.created
        r = session.put(f"{API}/variations/{v1['id']}", json={"status": "approved"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        after = session.get(f"{API}/projects/{project_id}/budget", timeout=15).json()["totals"]
        assert round(after["approved_variations_total"] - base["approved_variations_total"], 2) == 1800.0
        assert round(after["adjusted_contract_value"] - base["adjusted_contract_value"], 2) == 1800.0
        assert after["adjusted_contract_value"] == round(after["contract_value"] + after["approved_variations_total"], 2)
        # Rejected variations do NOT flow in
        r2 = session.put(f"{API}/variations/{v2['id']}", json={"status": "rejected"}, timeout=15)
        assert r2.status_code == 200
        after2 = session.get(f"{API}/projects/{project_id}/budget", timeout=15).json()["totals"]
        assert after2["approved_variations_total"] == after["approved_variations_total"]

    def test_delete(self, session):
        for v in TestVariations.created:
            r = session.delete(f"{API}/variations/{v['id']}", timeout=15)
            assert r.status_code == 200
        r = session.delete(f"{API}/variations/{TestVariations.created[0]['id']}", timeout=15)
        assert r.status_code == 404


class TestSiteDiary:
    entry = None

    def test_unauth_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/diary", timeout=15)
        assert r.status_code == 401

    def test_create_entry(self, session, project_id):
        payload = {"date": "2026-07-10", "weather": "overcast", "temp_c": 11.5,
                   "crew": [{"trade": "Carpenters", "count": 3}, {"trade": "  ", "count": 2}],
                   "notes": "TEST_DIARY Frame straightening complete, trusses delivered."}
        r = session.post(f"{API}/projects/{project_id}/diary", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        e = r.json()
        TestSiteDiary.entry = e
        assert e["weather"] == "overcast"
        assert e["temp_c"] == 11.5
        # blank crew rows dropped
        assert e["crew"] == [{"trade": "Carpenters", "count": 3}]

    def test_invalid_weather_400(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/diary", json={"weather": "hailstorm-of-frogs"}, timeout=15)
        assert r.status_code == 400

    def test_list_and_update(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/diary", timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == TestSiteDiary.entry["id"] for x in r.json())
        r2 = session.put(f"{API}/diary/{TestSiteDiary.entry['id']}", json={"notes": "TEST_DIARY updated"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["notes"] == "TEST_DIARY updated"

    def test_diary_entry_in_site_diary_pdf(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/site-diary.pdf",
                        params={"date_from": "2026-07-10", "date_to": "2026-07-10"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.headers["content-type"] == "application/pdf"
        assert r.content[:4] == b"%PDF"

    def test_delete_entry(self, session):
        r = session.delete(f"{API}/diary/{TestSiteDiary.entry['id']}", timeout=15)
        assert r.status_code == 200
        r2 = session.delete(f"{API}/diary/{TestSiteDiary.entry['id']}", timeout=15)
        assert r2.status_code == 404
