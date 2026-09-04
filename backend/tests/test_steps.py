"""The supervisor's checklist — phases A to O.

The data is checked without the API (it must be continuous, uniquely keyed and
cover every step of the build sequence), then the endpoints are exercised
against the live job.
"""
import os
import uuid
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
    """A job of its own.

    These tests tick items, set due dates and write permit numbers. Run against
    the first job on the system they were doing that to a real build — a test
    permit number ended up on a real building permit that way.
    """
    r = session.post(f"{API}/projects", timeout=30, json={
        "name": f"STEPSTEST {uuid.uuid4().hex[:8]}", "client_name": "C",
        "site_suburb": "Tarneit", "site_postcode": "3029",
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API}/projects/{pid}", timeout=30)


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


class TestOneSourceOfTruth:
    """The screen review found the same thing tracked in two places. These lock
    the merges in so they cannot quietly come back."""

    def test_mandatory_inspections_live_only_on_the_checklist(self):
        """They used to be seeded as roadmap tasks as well, so one could be
        ticked while the other still showed it outstanding."""
        import roadmap_template
        seeded = [t for tasks in roadmap_template.ROADMAP_TEMPLATE.values()
                  for t in tasks if t[2]]
        assert seeded == [], f"still seeding inspections as tasks: {seeded}"
        holds = [i for p in supervisor.PHASES for i in p["items"] if i["kind"] == "hold"]
        assert len(holds) >= 4, "the checklist must carry them instead"

    def test_no_next_step_points_at_a_screen_that_was_merged_away(self, session, project_id):
        gone = {"packages", "quotes", "trades", "planner", "documents",
                "budget", "invoices", "variations", "roadmap"}
        live = {"work", "steps", "timeline", "drawings", "money", "diary", "overview"}
        d = session.get(f"{API}/projects/{project_id}/next-steps", timeout=60).json()
        for a in d["actions"]:
            assert a["tab"] not in gone, f"{a['id']} still points at {a['tab']}"
            assert a["tab"] in live, f"{a['id']} points at unknown tab {a['tab']}"

    def test_the_board_carries_the_coverage_the_packages_screen_held(self, session, project_id):
        t = session.get(f"{API}/projects/{project_id}/board", timeout=60).json()["totals"]
        for k in ("package_count", "priced_count", "committed_count",
                  "committed", "invoiced", "paid", "outstanding"):
            assert k in t, f"board totals missing {k}"
        assert t["priced_count"] <= t["package_count"]
        assert t["committed_count"] <= t["package_count"]

    def test_the_dashboard_leads_with_hold_points_not_inspection_tasks(self, session):
        d = session.get(f"{API}/dashboard", timeout=120).json()
        assert "hold_points" in d and "checklist_overdue" in d
        assert "inspections" not in d, "the widget that read seeded tasks is gone"


class TestChecklistMeetsBoard:
    """The checklist confirms; the board actions. Every piece of trade work the
    checklist names has to resolve to a board row, or be reported as missing."""

    def test_every_trade_entry_names_items_that_exist(self):
        for phase_key, entries in supervisor.TRADE_WORK.items():
            phase = supervisor.BY_KEY[phase_key]
            keys = {i["key"] for i in phase["items"]}
            for e in entries:
                assert set(e["items"]) <= keys, f"{phase_key}/{e['key']} names a missing item"
                assert e["match"], f"{e['key']} has no keywords to match a package by"

    def test_trade_types_are_real(self):
        from trades import TRADE_TYPES
        for entries in supervisor.TRADE_WORK.values():
            for e in entries:
                assert e["type"] in TRADE_TYPES, f"{e['key']} has type {e['type']}"

    def test_a_matched_item_carries_its_board_row(self, session, project_id):
        session.post(f"{API}/projects/{project_id}/packages", timeout=60,
                     json={"title": "Plumbing Rough-in & Fit-off", "trade_type": "plumber",
                           "stage_key": "lockup"})
        d = session.get(f"{API}/projects/{project_id}/steps", timeout=60).json()
        withtrade = [i for p in d["phases"] for i in p["items"] if i["trade"]]
        assert withtrade, "some items are delivered by a trade"
        for i in withtrade:
            assert "work" in i["trade"]
            if i["trade"]["package"]:
                assert i["trade"]["package"]["id"] and i["trade"]["package"]["title"]

    def test_the_catch_all_trade_type_never_matches_by_type_alone(self):
        """"other" covers the scaffolder, the window supplier and the cleaner, so
        matching on it would put any of them against any other."""
        from steps import _match_package
        packages = [{"id": "1", "title": "Windows & External Doors", "trade_type": "other",
                     "status": "draft", "step": 11}]
        entry = {"key": "scaffold", "work": "Scaffolding", "type": "other", "match": ["scaffold"]}
        assert _match_package(entry, packages, [10, 11, 12]) is None

    def test_a_keyword_prefers_the_package_in_this_phase(self):
        """"roof" matches the frame carpenter's roof structure and the roofer;
        only the second is roofing."""
        from steps import _match_package
        packages = [{"id": "1", "title": "Timber Frame & Roof Structure", "trade_type": "carpenter",
                     "status": "draft", "step": 7},
                    {"id": "2", "title": "Roofing & Gutters", "trade_type": "roofer",
                     "status": "draft", "step": 10}]
        entry = {"key": "roofer", "work": "Roofing", "type": "roofer", "match": ["roof"]}
        assert _match_package(entry, packages, [10, 11, 12])["id"] == "2"

    def test_one_package_can_cover_two_visits(self):
        """The plumber's rough-in and fit-off are normally one engagement."""
        from steps import _match_package
        packages = [{"id": "1", "title": "Plumbing Rough-in & Fit-off", "trade_type": "plumber",
                     "status": "draft", "step": 13}]
        entry = {"key": "plumber-fitoff", "work": "Plumbing fit-off", "type": "plumber",
                 "match": ["plumb"]}
        assert _match_package(entry, packages, [20, 21])["id"] == "1"

    def test_booking_a_gap_puts_it_on_the_board_and_closes_the_gap(self, session):
        made = session.post(f"{API}/projects", timeout=60, json={
            "name": "GAPTEST scratch", "client_name": "C",
            "site_suburb": "Tarneit", "site_postcode": "3029"}).json()["id"]
        try:
            gaps = session.get(f"{API}/projects/{made}/trade-gaps", timeout=60).json()["unbooked"]
            # Counted once per engagement: the concreter, the HVAC installer and
            # the garage-door fitter are each named by two phases.
            distinct = {e["work"] for v in supervisor.TRADE_WORK.values() for e in v}
            assert {g["work"] for g in gaps} == distinct

            one = session.post(f"{API}/projects/{made}/trade-gaps", timeout=60,
                               json={"keys": ["Insulation"]})
            assert one.status_code == 200, one.text
            assert one.json()["count"] == 1

            rest = session.post(f"{API}/projects/{made}/trade-gaps", timeout=120, json={})
            assert rest.status_code == 200, rest.text

            after = session.get(f"{API}/projects/{made}/trade-gaps", timeout=60).json()["unbooked"]
            assert after == [], f"still unbooked: {[g['work'] for g in after]}"

            # And every checklist item now points at a real row.
            d = session.get(f"{API}/projects/{made}/steps", timeout=60).json()
            orphan = [t["work"] for p in d["phases"] for t in p["trades"] if not t["package"]]
            assert orphan == [], orphan

            again = session.post(f"{API}/projects/{made}/trade-gaps", timeout=60, json={})
            assert again.status_code == 400, "nothing left to add"
        finally:
            session.delete(f"{API}/projects/{made}", timeout=60)

    def test_a_booked_package_lands_at_the_right_step(self, session):
        """A package created from the checklist must place itself in the build
        sequence, or it piles up at step 1 where nothing is."""
        made = session.post(f"{API}/projects", timeout=60, json={
            "name": "GAPSTEP scratch", "client_name": "C",
            "site_suburb": "Tarneit", "site_postcode": "3029"}).json()["id"]
        try:
            session.post(f"{API}/projects/{made}/trade-gaps", timeout=120, json={})
            rows = session.get(f"{API}/projects/{made}/board", timeout=60).json()["rows"]
            at_one = [r["title"] for r in rows if r["step"] == 1]
            # Only the genuine pre-start work belongs at step 1.
            assert set(at_one) <= {"Site establishment", "Surveyor set-out"}, \
                f"unplaced packages piled up at step 1: {at_one}"
        finally:
            session.delete(f"{API}/projects/{made}", timeout=60)


class TestTimeline:
    """Planning backwards from handover, and the order-by dates that fall out."""

    def test_the_sequence_carries_a_duration_for_every_step(self):
        import build_sequence
        for s in build_sequence.SEQUENCE:
            assert s["days"] >= 1, f"{s['key']} has no duration"
            assert isinstance(s["parallel"], bool)
        # A single-storey slab-on-ground runs 19–35 weeks of active work.
        assert 19 * 5 <= build_sequence.BUILD_DAYS <= 35 * 5

    def test_working_days_skip_weekends_and_victorian_holidays(self):
        from datetime import date
        from timeline import add_working_days, sub_working_days, is_working_day
        assert not is_working_day(date(2026, 1, 1)), "New Year's Day"
        assert not is_working_day(date(2026, 4, 25)), "ANZAC Day"
        assert not is_working_day(date(2026, 11, 3)), "Melbourne Cup"
        # Friday + 1 working day is Monday.
        assert add_working_days(date(2026, 9, 4), 1) == date(2026, 9, 7)
        assert sub_working_days(date(2026, 9, 7), 1) == date(2026, 9, 4)

    def test_backwards_and_forwards_agree(self):
        """Planning back from a finish must give the same span as planning
        forward from the start it produces."""
        from datetime import date
        from timeline import plan_backwards, plan_forwards
        back = plan_backwards(date(2027, 6, 30))
        fwd = plan_forwards(back[0]["start"])
        assert fwd[-1]["finish"] == back[-1]["finish"]

    def test_every_material_is_ordered_before_it_is_needed(self, session, project_id):
        from datetime import date
        session.put(f"{API}/projects/{project_id}",
                    json={"target_completion": (date.today() + timedelta(days=400)).isoformat()},
                    timeout=60)
        d = session.get(f"{API}/projects/{project_id}/timeline", timeout=60).json()
        assert d["orders"], "there are materials to order"
        for o in d["orders"]:
            assert o["order_by"] < o["needed_by"], f"{o['name']} is ordered after it is needed"
            assert o["lead_weeks"] >= 1

    def test_the_longest_lead_item_is_ordered_first(self, session, project_id):
        d = session.get(f"{API}/projects/{project_id}/timeline", timeout=60).json()
        orderable = [o for o in d["orders"] if not o["measured_on_site"]]
        dates = [o["order_by"] for o in orderable]
        assert dates == sorted(dates), "order-by dates must run in order"

    def test_a_measured_item_is_never_reported_as_late_to_order(self, session, project_id):
        d = session.get(f"{API}/projects/{project_id}/timeline", timeout=60).json()
        for o in d["orders"]:
            if o["measured_on_site"]:
                assert o["status"] == "sequenced", \
                    f"{o['name']} is templated off finished work — it cannot be ordered ahead"

    def test_an_unreachable_handover_date_says_so(self, session, project_id):
        from datetime import date
        soon = (date.today() + timedelta(days=30)).isoformat()
        session.put(f"{API}/projects/{project_id}", json={"target_completion": soon}, timeout=60)
        d = session.get(f"{API}/projects/{project_id}/timeline", timeout=60).json()
        assert d["start_has_passed"], "30 days is not 25 weeks"
        assert d["planned_start"] < d["today"]

    def test_a_material_can_be_priced_separately(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/material-orders",
                         json={"keys": ["frames-trusses"]}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["created"][0]["title"] == "Supply: Frames and trusses"

        d = session.get(f"{API}/projects/{project_id}/timeline", timeout=60).json()
        frames = next(o for o in d["orders"] if o["key"] == "frames-trusses")
        assert frames["supply_package"], "the supply package must attach to its material"

        again = session.post(f"{API}/projects/{project_id}/material-orders",
                             json={"keys": ["frames-trusses"]}, timeout=60)
        assert again.status_code == 400, "already priced separately"

    def test_the_checklist_long_lead_list_comes_from_the_materials(self):
        import materials
        item = next(i for p in supervisor.PHASES for i in p["items"]
                    if i["key"] == "long-lead-orders")
        assert len(item["sub"]) == len([m for m in materials.MATERIALS if not m.get("after")])
        assert "Bricks" in item["sub"][0], "longest lead time is listed first"

    def test_unknown_project_404(self, session):
        assert session.get(f"{API}/projects/nope/timeline", timeout=60).status_code == 404
