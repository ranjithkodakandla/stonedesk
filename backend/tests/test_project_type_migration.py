import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

import pytest

from app import main as app_main


def _reset_projects():
    app_main.projects_col.docs.clear()


def test_create_project_persists_apartment_default():
    _reset_projects()
    created = app_main.create_project()
    assert created["project_type"] == "apartment"
    stored = app_main.projects_col.find_one({"id": created["id"]})
    assert stored["project_type"] == "apartment"


def test_project_response_defaults_legacy_missing_project_type_to_apartment():
    doc = {"id": 999, "name": "Legacy project"}
    assert app_main.project_response(doc)["project_type"] == "apartment"


def test_project_response_preserves_explicit_house_type():
    doc = {"id": 998, "name": "A house project", "project_type": "house"}
    assert app_main.project_response(doc)["project_type"] == "house"


def test_project_response_preserves_explicit_apartment_type():
    doc = {"id": 997, "name": "An apartment project", "project_type": "apartment"}
    assert app_main.project_response(doc)["project_type"] == "apartment"


def _empty_filter_matches(doc):
    """Mirrors the $or filter in forward_migration_project_type.js."""
    value = doc.get("project_type", "__missing__")
    return value == "__missing__" or value is None or value == ""


def _apply_forward_migration(docs):
    """Pure-Python re-implementation of forward_migration_project_type.js's
    update, for testing the migration's selection/idempotency semantics
    without a live MongoDB (the real script is mongosh-only)."""
    modified = 0
    for doc in docs:
        if _empty_filter_matches(doc):
            doc["project_type"] = "apartment"
            modified += 1
    return modified


def test_migration_scenario_a_building_type_correction():
    docs = [
        {"id": 1, "name": "Empty type", "other_attr": "keep-me"},
        {"id": 2, "name": "Null type", "project_type": None, "other_attr": "keep-me"},
        {"id": 3, "name": "Blank type", "project_type": "", "other_attr": "keep-me"},
        {"id": 4, "name": "Already apartment", "project_type": "apartment", "other_attr": "keep-me"},
        {"id": 5, "name": "Already house", "project_type": "house", "other_attr": "keep-me"},
    ]

    modified = _apply_forward_migration(docs)

    assert modified == 3
    by_id = {d["id"]: d for d in docs}
    assert by_id[1]["project_type"] == "apartment"
    assert by_id[2]["project_type"] == "apartment"
    assert by_id[3]["project_type"] == "apartment"
    assert by_id[4]["project_type"] == "apartment"
    assert by_id[5]["project_type"] == "house"
    # Other attributes untouched.
    assert all(d["other_attr"] == "keep-me" for d in docs)


def test_migration_is_idempotent():
    docs = [
        {"id": 1, "name": "Empty type"},
        {"id": 2, "name": "Already house", "project_type": "house"},
    ]
    first_pass = _apply_forward_migration(docs)
    second_pass = _apply_forward_migration(docs)

    assert first_pass == 1
    assert second_pass == 0
    assert docs[0]["project_type"] == "apartment"
    assert docs[1]["project_type"] == "house"
