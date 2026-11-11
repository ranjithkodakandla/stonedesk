import os
import re
from pathlib import Path

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

from app.services import planning_engine as pe

FRONTEND_THICKNESS_FILE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "thicknessConstants.js"
)


def _parse_frontend_thickness_table():
    """Extracts the THICKNESS_INCH object literal from the single shared
    frontend module, so this test fails if backend and frontend values ever
    drift again (the original bug: 4 independently-maintained copies, 3 of
    them with a '4CM' entry the backend lacked)."""
    text = FRONTEND_THICKNESS_FILE.read_text()
    match = re.search(r"THICKNESS_INCH\s*=\s*\{(.*?)\};", text, re.DOTALL)
    assert match, "Could not find THICKNESS_INCH in thicknessConstants.js"
    body = match.group(1)
    pairs = re.findall(r"['\"]?([\w.]+)['\"]?\s*:\s*([\d.]+)", body)
    return {k: float(v) for k, v in pairs}


def test_frontend_and_backend_thickness_tables_are_now_a_single_source_of_truth():
    frontend = _parse_frontend_thickness_table()
    # Keys that have no backend equivalent (unit-label aliases like '2.0CM')
    # are expected to resolve to the same inches value as their canonical
    # label, so only compare canonical labels the backend actually knows.
    canonical_keys = {"2CM", "3CM", "4CM", "Mixed"}
    for key in canonical_keys:
        assert key in frontend, f"{key} missing from frontend thicknessConstants.js"
        assert key in pe.THICKNESS_INCHES, f"{key} missing from backend THICKNESS_INCHES"
        assert frontend[key] == pe.THICKNESS_INCHES[key], (
            f"Thickness drift for {key}: frontend={frontend[key]}, backend={pe.THICKNESS_INCHES[key]}"
        )


def test_backend_4cm_thickness_no_longer_silently_falls_back_to_mixed():
    # Before this fix, a piece with thickness="4CM" reaching the backend hit
    # THICKNESS_INCHES.get(thickness, THICKNESS_INCHES["Mixed"]) and silently
    # used 0.98" instead of 1.57" — a ~60% thickness (and therefore weight)
    # understatement, while the frontend displayed the correct 1.57".
    assert pe.thickness_inches("4CM") == 1.57
    assert pe.thickness_inches("4CM") != pe.THICKNESS_INCHES["Mixed"]


def test_reproduces_meeting_weight_scenario_24_pieces_20mm_75in_vanity():
    # From the Nov 10 factory review (~00:47): ~24 pieces, ~20mm (2CM)
    # thickness, a 75" dimension example, operator challenged the displayed
    # weight. 20mm = 2CM here (2cm = 20mm); reproduce with a representative
    # vanity top and confirm the canonical formula gives a physically
    # sane answer, using a known color density so the result is exact
    # rather than approximate (weight_factor only hits the lossy
    # WEIGHT_FACTORS table for materials/colors with no density entry).
    piece = {"length": 75, "width": 22, "qty": 1}
    weight_one = pe.piece_weight(piece, "Granite", "2CM", "Kashmir White")

    # Kashmir White density = 2600 kg/m3 (planning_engine.COLOR_DENSITIES).
    # factor = density * thickness_m * sqft->sqm = 2600 * 0.02 * 0.0929
    expected_factor = 2600 * 0.02 * 0.0929
    area_sqft = __import__("math").ceil((75 * 22 / 144.0) * 10) / 10
    expected_one = area_sqft * expected_factor
    assert weight_one == pe.parse_float(round(expected_one, 3), 0.0) or abs(weight_one - expected_one) < 0.01

    total_24 = weight_one * 24
    # Sanity bounds: ~55 kg for one 75"x22"x2CM granite piece is physically
    # reasonable (two people can carry it); 24 of them should land in the
    # low thousands of kg, not off by an order of magnitude either way.
    assert 800 < total_24 < 3000
