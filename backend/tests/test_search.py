"""Backend tests for BuildManager VIC — global search."""
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


class TestSearch:
    def test_unauth_401(self):
        r = requests.get(f"{API}/search", params={"q": "ballarat"}, timeout=15)
        assert r.status_code == 401

    def test_project_by_suburb(self, session):
        r = session.get(f"{API}/search", params={"q": "ballarat"}, timeout=15)
        assert r.status_code == 200
        results = r.json()["results"]
        assert any(x["type"] == "project" for x in results)
        proj = next(x for x in results if x["type"] == "project")
        assert proj["project_id"] == proj["id"]

    def test_trade_by_name(self, session):
        trades = session.get(f"{API}/trades", timeout=15).json()
        needle = trades[0]["business_name"][:6]
        r = session.get(f"{API}/search", params={"q": needle}, timeout=15)
        assert r.status_code == 200
        assert any(x["type"] == "trade" for x in r.json()["results"])

    def test_case_insensitive(self, session):
        lower = session.get(f"{API}/search", params={"q": "ballarat"}, timeout=15).json()["results"]
        upper = session.get(f"{API}/search", params={"q": "BALLARAT"}, timeout=15).json()["results"]
        assert len(lower) == len(upper) > 0

    def test_short_query_empty(self, session):
        r = session.get(f"{API}/search", params={"q": "b"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_regex_chars_escaped(self, session):
        r = session.get(f"{API}/search", params={"q": ".*({["}, timeout=15)
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_capped_at_20(self, session):
        r = session.get(f"{API}/search", params={"q": "e"}, timeout=15)
        assert r.status_code == 200  # single char → empty, so use a broad 2-char term
        r2 = session.get(f"{API}/search", params={"q": "er"}, timeout=15)
        assert len(r2.json()["results"]) <= 20
