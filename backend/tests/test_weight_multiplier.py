import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

import pytest

from app import main as app_main
from app.services import planning_engine as pe


def _reset():
    app_main.projects_col.docs.clear()


def test_weight_factor_uses_per_thickness_multiplier_when_set():
    token = pe.set_project_weight_multiplier({"2CM": 5.5, "3CM": 7.75})
    try:
        assert pe.weight_factor("Granite", "2CM", "Kashmir White") == 5.5
        assert pe.weight_factor("Granite", "3CM", "Kashmir White") == 7.75
    finally:
        pe.reset_project_weight_multiplier(token)


def test_weight_factor_falls_back_to_density_for_a_thickness_with_no_multiplier():
    token = pe.set_project_weight_multiplier({"2CM": 5.5})  # 3CM intentionally unset
    try:
        # 3CM has no override -> falls through to density-based calc (Kashmir White is a known color).
        density_based = pe.weight_factor("Granite", "3CM", "Kashmir White")
        assert density_based != 5.5
        assert density_based > 0
    finally:
        pe.reset_project_weight_multiplier(token)


def test_weight_factor_uses_density_when_no_multiplier_map_set_at_all():
    token = pe.set_project_weight_multiplier(None)
    try:
        assert pe.weight_factor("Granite", "2CM", "Kashmir White") == pe.weight_factor("Granite", "2CM", "Kashmir White")
        # Sanity: matches the plain density formula, not some leftover override.
        expected = round(2600 * 0.02 * 0.0929, 3)
        assert pe.weight_factor("Granite", "2CM", "Kashmir White") == expected
    finally:
        pe.reset_project_weight_multiplier(token)


def test_patch_weight_multiplier_endpoint_persists_only_2cm_and_3cm():
    _reset()
    project = app_main.create_project()
    result = app_main.patch_weight_multiplier(project["id"], {
        "weight_multiplier_kg_per_sqft_by_thickness": {"2CM": 5.5, "3CM": 7.75, "Mixed": 99},
    })
    # Only 2CM/3CM are accepted; an unsupported key like "Mixed" is ignored.
    assert result["weight_multiplier_kg_per_sqft_by_thickness"] == {"2CM": 5.5, "3CM": 7.75}
    stored = app_main.projects_col.find_one({"id": project["id"]})
    assert stored["weight_multiplier_kg_per_sqft_by_thickness"] == {"2CM": 5.5, "3CM": 7.75}


def test_patch_weight_multiplier_rejects_non_positive_values():
    _reset()
    project = app_main.create_project()
    with pytest.raises(Exception):
        app_main.patch_weight_multiplier(project["id"], {
            "weight_multiplier_kg_per_sqft_by_thickness": {"2CM": -1},
        })


def test_patch_weight_multiplier_clears_a_thickness_when_omitted():
    _reset()
    project = app_main.create_project()
    app_main.patch_weight_multiplier(project["id"], {
        "weight_multiplier_kg_per_sqft_by_thickness": {"2CM": 5.5, "3CM": 7.75},
    })
    result = app_main.patch_weight_multiplier(project["id"], {
        "weight_multiplier_kg_per_sqft_by_thickness": {"2CM": 5.5},
    })
    assert result["weight_multiplier_kg_per_sqft_by_thickness"] == {"2CM": 5.5}


def test_density_override_endpoint_no_longer_exists():
    assert not hasattr(app_main, "patch_density_override")
    assert not hasattr(app_main, "set_project_density_override")
    assert not hasattr(app_main, "reset_project_density_override")


def test_project_response_no_longer_exposes_density_override_field():
    doc = {"id": 1, "name": "x"}
    resp = app_main.project_response(doc)
    assert "density_override_kg_m3" not in resp
    assert "weight_multiplier_kg_per_sqft_by_thickness" in resp
