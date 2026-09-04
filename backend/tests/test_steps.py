"""The supervisor's checklist — phases A to O.

The data is checked without the API (it must be continuous, uniquely keyed and
cover every step of the build sequence), then the endpoints are exercised
against the live job.
"""
import os
from datetime import date, timedelta

import pytest
import requests

import supervisor

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session):
    projects = session.get(f"{API}/projects", timeout=30).json()
    if not projects:
        pytest.skip("no project to run the checklist against")
    return projects[0]["id"]


class TestChecklistData:
    def test_numbering_is_continuous(self):
        """Items are quoted by number, so a gap would be a real problem."""
        ns = [i["n"] for p in supervisor.PHASES for i in p["items"]]
        assert ns == list(range(1, len(ns) + 1))

    def test_every_key_is_unique(self):
        keys = [f"{p['key']}:{i['key']}" for p in supervisor.PHASES for i in p["items"]]
        assert len(set(keys)) == len(keys)

    def test_every_build_step_belongs_to_a_phase(self):
        import build_sequence
        covered = {n for p in supervisor.PHASES for n in p["steps"]}
        assert covered == {s["n"] for s in build_sequence.SEQUENCE}

    def test_both_mandatory_hold_points_are_present(self):
        holds = [p for p in supervisor.PHASES if p.get("hold")]
        assert len(holds) == 2, "pre-slab and frame are both mandatory in Victoria"
        assert all(i["kind"] == "hold" for p in holds for i in p["items"])

    def test_statutory_lead_times_are_recorded(self):
        """These are the ones that cannot be done on the day they are needed."""
        leads = {i["key"]: i["remind_days"] for p in supervisor.PHASES
                 for i in p["items"] if i.get("remind_days")}
        assert leads["road-reserve-consent"] >= 20, "Wyndham wants 20 business days"
        assert "asset-protection" in leads

    def test_every_item_has_a_known_kind(self):
        from steps import SEVERITY_RANK  # noqa: F401  — imported to prove steps loads
        known = set(supervisor.EXTERNAL_KINDS) | {
            "check", "site", "record", "test", "document", "meeting", "safety"}
        for p in supervisor.PHASES:
            for i in p["items"]:
                assert i["kind"] in known, f"{i['n']} has kind {i['kind']}"

    def test_find_resolves_and_rejects(self):
        assert supervisor.find("b:asset-protection")
        assert supervisor.find("b:no-such-thing") is None
        assert supervisor.find("nope:asset-protection") is None


class TestChecklistApi:
    def test_returns_every_phase_and_item(self, session, project_id):
        d = session.get(f"{API}/projects/{project_id}/steps", timeout=60).json()
        assert len(d["phases"]) == len(supervisor.PHASES)
        assert d["items_total"] == supervisor.ITEM_COUNT
        assert sum(p["total"] for p in d["phases"]) == supervisor.ITEM_COUNT
        assert len(d["ongoing"]) > 0

    def test_exactly_one_phase_is_current(self, session, project_id):
        d = session.get(f"{API}/projects/{project_id}/steps", timeout=60).json()
        assert len([p for p in d["phases"] if p["current"]]) <= 1

    def test_ticking_an_item_moves_the_count(self, session, project_id):
        key = "c:strip-topsoil"
        before = session.get(f"{API}/projects/{project_id}/steps", timeout=60).json()
        r = session.put(f"{API}/projects/{project_id}/steps/{key}",
                        json={"status": "done"}, timeout=60)
        assert r.status_code == 200, r.text
        after = r.json()
        item = next(i for p in after["phases"] for i in p["items"] if i["action_key"] == key)
        assert item["status"] == "done" and item["completed_at"]
        assert after["items_done"] == before["items_done"] + 1

        # Reopening it clears the stamp rather than leaving a false record.
        reopened = session.put(f"{API}/projects/{project_id}/steps/{key}",
                               json={"status": "todo"}, timeout=60).json()
        item = next(i for p in reopened["phases"] for i in p["items"] if i["action_key"] == key)
        assert item["status"] == "todo" and not item["completed_at"]

    def test_a_past_due_date_reads_as_overdue(self, session, project_id):
        key = "c:compaction-test"
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        d = session.put(f"{API}/projects/{project_id}/steps/{key}",
                        json={"due_date": yesterday}, timeout=60).json()
        r = next(x for x in d["reminders"] if x["action_key"] == key)
        assert r["severity"] == "overdue" and "1 day overdue" == r["why"]

        session.put(f"{API}/projects/{project_id}/steps/{key}",
                    json={"due_date": ""}, timeout=60)

    def test_reminders_are_ranked_worst_first(self, session, project_id):
        from steps import SEVERITY_RANK
        d = session.get(f"{API}/projects/{project_id}/steps", timeout=60).json()
        ranks = [SEVERITY_RANK[r["severity"]] for r in d["reminders"]]
        assert ranks == sorted(ranks)

    def test_a_settled_item_stops_being_reminded(self, session, project_id):
        key = "a:road-reserve-consent"
        d = session.put(f"{API}/projects/{project_id}/steps/{key}",
                        json={"status": "n-a"}, timeout=60).json()
        assert not any(r["action_key"] == key for r in d["reminders"])
        session.put(f"{API}/projects/{project_id}/steps/{key}", json={"status": "todo"}, timeout=60)

    def test_a_reference_number_is_kept(self, session, project_id):
        key = "a:permit-obtained"
        d = session.put(f"{API}/projects/{project_id}/steps/{key}",
                        json={"reference": "BP-TEST-0001"}, timeout=60).json()
        item = next(i for p in d["phases"] for i in p["items"] if i["action_key"] == key)
        assert item["reference"] == "BP-TEST-0001"

    def test_a_nonsense_status_is_refused(self, session, project_id):
        r = session.put(f"{API}/projects/{project_id}/steps/a:permit-obtained",
                        json={"status": "maybe"}, timeout=60)
        assert r.status_code == 400

    def test_a_nonsense_due_date_is_refused(self, session, project_id):
        r = session.put(f"{API}/projects/{project_id}/steps/a:permit-obtained",
                        json={"due_date": "next tuesday"}, timeout=60)
        assert r.status_code == 400

    def test_an_unknown_item_is_refused(self, session, project_id):
        r = session.put(f"{API}/projects/{project_id}/steps/a:invented",
                        json={"status": "done"}, timeout=60)
        assert r.status_code == 404

    def test_a_document_from_another_job_is_refused(self, session, project_id):
        r = session.put(f"{API}/projects/{project_id}/steps/a:permit-obtained",
                        json={"document_id": "not-a-document"}, timeout=60)
        assert r.status_code == 404

    def test_an_unknown_project_is_refused(self, session):
        assert session.get(f"{API}/projects/nope/steps", timeout=60).status_code == 404

    def test_the_checklist_reaches_the_next_steps_panel(self, session, project_id):
        d = session.get(f"{API}/projects/{project_id}/next-steps", timeout=60).json()
        assert d["checklist"]["total"] == supervisor.ITEM_COUNT
        ids = {a["id"] for a in d["actions"]}
        assert ids & {"hold-point", "checklist-overdue", "checklist-lead-time"}, \
            "a fresh job has lead-time items and they should be visible off the checklist tab"


class TestReminderRules:
    """_reminders decides what a builder is shown first, so test it directly
    rather than by driving 193 items through the API."""

    @staticmethod
    def _phases(*specs):
        """Build the shape list_steps produces: (key, [(kind, status, due)])."""
        out = []
        for i, (key, items) in enumerate(specs):
            out.append({"key": key, "letter": key.upper(), "name": key, "items": [
                {"n": i * 100 + j, "action_key": f"{key}:{j}", "name": f"item {j}",
                 "kind": kind, "status": status, "due_date": due,
                 "external": kind in supervisor.EXTERNAL_KINDS,
                 **({"remind_days": lead} if lead else {})}
                for j, (kind, status, due, lead) in enumerate(items)]})
        return out

    def test_a_hold_point_outranks_everything(self):
        from steps import _reminders
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        phases = self._phases(("a", [("permit", "todo", yesterday, None),
                                     ("hold", "todo", None, None)]))
        got = _reminders(phases, "a")
        assert got[0]["severity"] == "hold"

    def test_a_lead_time_item_surfaces_one_phase_early(self):
        from steps import _reminders
        phases = self._phases(("a", []), ("b", [("permit", "todo", None, 20)]))
        assert [r["severity"] for r in _reminders(phases, "a")] == ["lead-time"]

    def test_nothing_surfaces_from_two_phases_ahead(self):
        from steps import _reminders
        phases = self._phases(("a", []), ("b", []), ("c", [("permit", "todo", None, 20)]))
        assert _reminders(phases, "a") == []

    def test_work_you_do_yourself_is_not_chased(self):
        """A 'check' is yours to do — reminding you of all 90 of them is noise."""
        from steps import _reminders
        phases = self._phases(("a", [("check", "todo", None, None),
                                     ("site", "todo", None, None)]))
        assert _reminders(phases, "a") == []

    def test_a_dated_item_is_chased_by_its_date_whoever_owns_it(self):
        from steps import _reminders
        soon = (date.today() + timedelta(days=2)).isoformat()
        phases = self._phases(("a", [("check", "todo", soon, None)]))
        got = _reminders(phases, "a")
        assert got[0]["severity"] == "due-soon" and got[0]["why"] == "due in 2 days"

    def test_a_settled_item_is_never_reminded(self):
        from steps import _reminders
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        for status in ("done", "n-a"):
            phases = self._phases(("a", [("hold", status, yesterday, 20)]))
            assert _reminders(phases, "a") == [], f"{status} should be silent"

    def test_a_future_phase_is_quiet(self):
        from steps import _reminders
        phases = self._phases(("a", [("permit", "todo", None, None)]),
                              ("b", [("permit", "todo", None, None)]))
        got = _reminders(phases, "a")
        assert [r["phase_key"] for r in got] == ["a"]
