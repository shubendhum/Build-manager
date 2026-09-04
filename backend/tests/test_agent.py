"""Tests for the read-only assistant.

The tool layer is tested directly and always runs. The end-to-end chat needs the
model and skips cleanly without it, so the suite stays green on a machine with no
GPU.
"""
import asyncio
import os

import pytest
import requests

import agent
from conftest import real_projects

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
T = 600


# Motor binds its connection pool to the first event loop it sees, so every
# call has to share one loop. asyncio.run() would make a fresh one each time and
# the second call would find the pool attached to a closed loop.
_loop = asyncio.new_event_loop()


def run(coro):
    return _loop.run_until_complete(coro)


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session):
    """A job with real data on it.

    Not simply the first one: another worker's scratch job can appear at the top
    of the list and be deleted underneath these tests mid-run.
    """
    r = session.get(f"{API}/projects", timeout=30)
    assert r.status_code == 200
    projects = real_projects(r.json())
    if not projects:
        pytest.skip("no job to ask about")
    return projects[0]["id"]


def model_up():
    try:
        return requests.get(f"{API}/agent/health", timeout=20).status_code in (200, 401)
    except requests.RequestException:
        return False


class TestToolSurface:
    """What the model is allowed to do is the whole safety model here."""

    def test_every_tool_is_read_only(self):
        writes = {"send", "create", "update", "delete", "award", "book", "pay", "accept"}
        for name in agent.TOOLS:
            assert not any(w in name for w in writes), f"{name} looks like it writes"

    def test_schemas_are_well_formed(self):
        for schema in agent.tool_schemas():
            fn = schema["function"]
            assert fn["name"] in agent.TOOLS
            assert fn["description"], f"{fn['name']} has no description for the model to read"
            assert fn["parameters"]["type"] == "object"

    def test_system_prompt_forbids_acting(self):
        assert "only read" in agent.SYSTEM.lower()
        assert "never invent" in agent.SYSTEM.lower()

    def test_tool_rounds_are_bounded(self):
        assert 1 <= agent.MAX_TOOL_ROUNDS <= 10, "an unbounded loop would hang the request"


class TestToolsAgainstRealData:
    def test_job_overview_reports_stage_and_money(self, project_id):
        out = run(agent.t_job_overview(project_id))
        assert "totals" in out and "packages" in out
        for p in out["packages"]:
            assert "title" in p and "state" in p and "step" in p

    def test_quotes_can_be_narrowed_to_a_package(self, project_id):
        every = run(agent.t_quotes_for(project_id))["quotes"]
        if not every:
            pytest.skip("no quotes on this job yet")
        title = every[0]["package"] or ""
        if not title:
            pytest.skip("quote has no package title")
        narrowed = run(agent.t_quotes_for(project_id, package=title.split()[0]))["quotes"]
        assert len(narrowed) <= len(every)
        assert all(title.split()[0].lower() in (q["package"] or "").lower() for q in narrowed)

    def test_waiting_list_excludes_trades_that_replied(self, project_id):
        for w in run(agent.t_who_hasnt_replied(project_id))["waiting_on"]:
            assert w["status"] != "submitted"

    def test_build_sequence_is_the_full_victorian_order(self, project_id):
        seq = run(agent.t_build_sequence(project_id))["sequence"]
        assert len(seq) == 25
        assert seq[0]["step"] == 1 and seq[-1]["step"] == 25
        assert any(s["mandatory_inspection"] for s in seq)

    def test_no_tool_leaks_a_file_path(self, project_id):
        """Disk paths are not the model's business, and not the user's either."""
        import json
        for name, (fn, _, _) in agent.TOOLS.items():
            blob = json.dumps(run(fn(project_id)), default=str)
            assert "/app/backend/uploads" not in blob, f"{name} leaked a file path"


@pytest.mark.skipif(not model_up(), reason="assistant endpoint unreachable")
class TestChat:
    def test_answers_a_real_question(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/agent/chat", timeout=T,
                         json={"message": "How many trade packages are on this job?"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["answer"].strip()
        assert body["tools_used"], "it should have read the job rather than guessed"

    def test_empty_question_refused(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/agent/chat", json={"message": "   "}, timeout=60)
        assert r.status_code == 400

    def test_unknown_project_404(self, session):
        r = session.post(f"{API}/projects/does-not-exist/agent/chat",
                         json={"message": "hello"}, timeout=60)
        assert r.status_code == 404
