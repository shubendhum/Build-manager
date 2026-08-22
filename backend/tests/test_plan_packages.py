"""Unit tests for planner package extraction (plans.clean_draft).

Pure function, no I/O — these run without the model or the database and cover
the cases a language model actually gets wrong: invented trade types, invented
stages, duplicate titles, and estimate lines naming a package that didn't
survive validation.
"""
import pytest

from plans import clean_draft

RATES = [{"id": "r1", "work_item": "Concrete slab", "unit": "m²", "trade_type": "concreter"}]


def draft(**over):
    data = {
        "tasks": [{"stage_key": "base", "name": "Pour slab", "description": "d"}],
        "trade_types": ["concreter", "plumber"],
        "packages": [
            {"title": "Slab", "trade_type": "concreter", "stage_key": "base", "scope": "Pour it."},
            {"title": "Plumbing", "trade_type": "plumber", "stage_key": "fixing", "scope": "Pipes."},
        ],
        "estimate_lines": [
            {"description": "Slab concrete", "stage_key": "base", "package": "Slab",
             "quantity": 100, "unit": "m²", "rate": 115, "rate_ref": "Concrete slab"},
        ],
    }
    data.update(over)
    return data


class TestPackages:
    def test_packages_are_extracted(self):
        out = clean_draft(draft(), RATES)
        assert [p["title"] for p in out["packages"]] == ["Slab", "Plumbing"]
        assert out["packages"][0]["trade_type"] == "concreter"
        assert out["packages"][0]["scope"] == "Pour it."

    def test_packages_sort_by_build_stage(self):
        out = clean_draft(draft(packages=[
            {"title": "Painting", "trade_type": "painter", "stage_key": "completion", "scope": "s"},
            {"title": "Slab", "trade_type": "concreter", "stage_key": "base", "scope": "s"},
        ]), RATES)
        assert [p["title"] for p in out["packages"]] == ["Slab", "Painting"]

    def test_unknown_trade_type_falls_back_to_other(self):
        """Glazier isn't a trade type here — the package must survive anyway."""
        out = clean_draft(draft(packages=[
            {"title": "Windows", "trade_type": "glazier", "stage_key": "lockup", "scope": "s"},
        ]), RATES)
        assert len(out["packages"]) == 1
        assert out["packages"][0]["trade_type"] == "other"

    def test_invalid_stage_drops_the_package(self):
        out = clean_draft(draft(packages=[
            {"title": "Nope", "trade_type": "plumber", "stage_key": "invented-stage", "scope": "s"},
        ]), RATES)
        assert out["packages"] == []

    def test_blank_title_dropped(self):
        out = clean_draft(draft(packages=[
            {"title": "   ", "trade_type": "plumber", "stage_key": "base", "scope": "s"},
        ]), RATES)
        assert out["packages"] == []

    def test_duplicate_titles_collapse(self):
        out = clean_draft(draft(packages=[
            {"title": "Plumbing", "trade_type": "plumber", "stage_key": "base", "scope": "first"},
            {"title": "plumbing", "trade_type": "plumber", "stage_key": "fixing", "scope": "second"},
        ]), RATES)
        assert len(out["packages"]) == 1
        assert out["packages"][0]["scope"] == "first", "first one wins"

    def test_missing_packages_key_is_fine(self):
        out = clean_draft(draft(packages=None), RATES)
        assert out["packages"] == []
        assert out["estimate_lines"][0]["package_title"] is None


class TestLineBinding:
    def test_line_binds_to_its_package(self):
        out = clean_draft(draft(), RATES)
        assert out["estimate_lines"][0]["package_title"] == "Slab"

    def test_binding_is_case_insensitive_but_returns_canonical_title(self):
        out = clean_draft(draft(estimate_lines=[
            {"description": "x", "stage_key": "base", "package": "SLAB",
             "quantity": 1, "unit": "m²", "rate": 10},
        ]), RATES)
        assert out["estimate_lines"][0]["package_title"] == "Slab"

    def test_line_naming_a_dropped_package_does_not_dangle(self):
        """The model can cite a package that failed validation — that link must be null."""
        out = clean_draft(draft(
            packages=[{"title": "Bad", "trade_type": "plumber", "stage_key": "nope", "scope": "s"}],
            estimate_lines=[{"description": "x", "stage_key": "base", "package": "Bad",
                             "quantity": 1, "unit": "m²", "rate": 10}],
        ), RATES)
        assert out["packages"] == []
        assert out["estimate_lines"][0]["package_title"] is None

    def test_line_with_no_package_is_allowed(self):
        out = clean_draft(draft(estimate_lines=[
            {"description": "x", "stage_key": "base", "quantity": 1, "unit": "m²", "rate": 10},
        ]), RATES)
        assert out["estimate_lines"][0]["package_title"] is None

    def test_rate_guide_match_still_works(self):
        out = clean_draft(draft(), RATES)
        line = out["estimate_lines"][0]
        assert line["rate_item_id"] == "r1"
        assert line["ai_suggested"] is False

    def test_negative_quantities_still_rejected(self):
        out = clean_draft(draft(estimate_lines=[
            {"description": "x", "stage_key": "base", "package": "Slab",
             "quantity": -5, "unit": "m²", "rate": 10},
        ]), RATES)
        assert out["estimate_lines"] == []
