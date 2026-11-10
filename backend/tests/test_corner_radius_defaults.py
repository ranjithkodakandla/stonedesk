import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

from app import main as app_main


def _reset():
    app_main.app_settings_col.docs.clear()


def test_default_corner_radius_falls_back_to_0_125():
    _reset()
    assert app_main.get_fabrication_defaults() == {"default_corner_radius_in": 0.125}


def test_update_fabrication_defaults_persists_and_is_read_back():
    _reset()
    app_main.update_fabrication_defaults(app_main.FabricationDefaultsUpdate(default_corner_radius_in=0.25))
    assert app_main.get_fabrication_defaults() == {"default_corner_radius_in": 0.25}


def test_update_is_idempotent_and_does_not_duplicate_settings_doc():
    _reset()
    app_main.update_fabrication_defaults(app_main.FabricationDefaultsUpdate(default_corner_radius_in=0.25))
    app_main.update_fabrication_defaults(app_main.FabricationDefaultsUpdate(default_corner_radius_in=0.5))
    assert len(app_main.app_settings_col.docs) == 1
    assert app_main.get_fabrication_defaults() == {"default_corner_radius_in": 0.5}


def test_zero_or_negative_override_falls_back_to_builtin_default():
    _reset()
    assert app_main._default_corner_radius_in() == 0.125
    app_main.app_settings_col.insert_one({
        "id": app_main.FABRICATION_DEFAULTS_SETTINGS_ID,
        "default_corner_radius_in": 0,
    })
    assert app_main._default_corner_radius_in() == 0.125
