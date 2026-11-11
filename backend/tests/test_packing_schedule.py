import pytest

from app.services.planner_v3.packing_schedule import build_packing_schedule


def _reference_pieces():
    pieces = {}
    for i in range(6):
        pid = f"single-{i}"
        pieces[pid] = {"id": pid, "part_no": f"RNG-{i:02d}", "length": 79, "width": 25.5, "thickness": "3CM"}
    for i in range(6):
        lid, sid = f"pair-{i}-long", f"pair-{i}-short"
        pieces[lid] = {"id": lid, "part_no": f"RNG-L{i:02d}", "length": 49, "width": 25.5, "thickness": "3CM"}
        pieces[sid] = {"id": sid, "part_no": f"RNG-S{i:02d}", "length": 19, "width": 25.5, "thickness": "3CM"}
    return pieces


def test_scenario_g_schedule_matches_the_reference_packing_drawing():
    pieces_by_id = _reference_pieces()
    crate = {
        "planner_v3_orientation": "horizontal",
        "internal_length": 85.0,
        "main_layer_piece_ids": list(pieces_by_id.keys()),
        "planner_v3_splash_layers": [],
    }
    schedule = build_packing_schedule(crate, pieces_by_id)

    assert schedule["unassigned_piece_ids"] == []
    rows = schedule["rows"]
    assert len(rows) == 12

    single_rows = [r for r in rows if r["quantity"] == 1]
    double_rows = [r for r in rows if r["quantity"] == 2]
    assert len(single_rows) == 6
    assert len(double_rows) == 6
    for r in single_rows:
        assert r["dimensions"][0]["length"] == 79
    for r in double_rows:
        lengths = sorted(d["length"] for d in r["dimensions"])
        assert lengths == [19, 49]

    # Row numbers and packing sequence are assigned once each, in order, no gaps.
    assert [r["row"] for r in rows] == list(range(1, 13))
    assert [r["sequence"] for r in rows] == list(range(1, 13))
    # Every schedule row is tagged "main" (no splash layers in this fixture).
    assert all(r["layer"] == "main" for r in rows)

    # Every row's slot_thickness/standing_height reflect the real physical
    # packing model (pieces stand upright, thickness stacks sideways): all
    # rows here share the same 3CM thickness and 25.5" standing width.
    for r in rows:
        assert r["slot_thickness_in"] == pytest.approx(1.18)
        assert r["standing_height_in"] == pytest.approx(25.5)

    assert schedule["internal_length"] == 85.0

    all_piece_ids = [pid for r in rows for pid in r["piece_ids"]]
    assert sorted(all_piece_ids) == sorted(pieces_by_id.keys())


def test_slot_thickness_is_the_widest_piece_in_a_shared_row():
    pieces_by_id = {
        "thin": {"id": "thin", "length": 40, "width": 25.5, "thickness": "2CM"},
        "thick": {"id": "thick", "length": 30, "width": 20, "thickness": "3CM"},
    }
    crate = {
        "planner_v3_orientation": "horizontal",
        "internal_length": 76.0,
        "main_layer_piece_ids": ["thin", "thick"],
        "planner_v3_splash_layers": [],
    }
    schedule = build_packing_schedule(crate, pieces_by_id)
    assert len(schedule["rows"]) == 1
    row = schedule["rows"][0]
    # Thicker of the two pieces determines the slot; taller of the two
    # determines the standing height — never averaged, never the thinner one.
    assert row["slot_thickness_in"] == pytest.approx(1.18)
    assert row["standing_height_in"] == pytest.approx(25.5)


def test_splash_layers_become_their_own_schedule_rows():
    pieces_by_id = {
        "top-1": {"id": "top-1", "length": 79, "width": 25.5, "thickness": "3CM"},
        "splash-1": {"id": "splash-1", "length": 79, "width": 4, "thickness": "3CM"},
    }
    crate = {
        "planner_v3_orientation": "horizontal",
        "internal_length": 85.0,
        "main_layer_piece_ids": ["top-1"],
        "planner_v3_splash_layers": [["splash-1"]],
    }
    schedule = build_packing_schedule(crate, pieces_by_id)
    layers = [r["layer"] for r in schedule["rows"]]
    assert layers == ["main", "splash_1"]


def test_missing_piece_is_reported_as_unassigned_not_silently_dropped():
    pieces_by_id = {"top-1": {"id": "top-1", "length": 79, "width": 25.5, "thickness": "3CM"}}
    crate = {
        "planner_v3_orientation": "horizontal",
        "internal_length": 85.0,
        "main_layer_piece_ids": ["top-1", "deleted-piece"],
        "planner_v3_splash_layers": [],
    }
    schedule = build_packing_schedule(crate, pieces_by_id)
    assert schedule["unassigned_piece_ids"] == ["deleted-piece"]
    all_piece_ids = [pid for r in schedule["rows"] for pid in r["piece_ids"]]
    assert "deleted-piece" not in all_piece_ids
    assert "top-1" in all_piece_ids


def test_sink_cutout_info_passes_through_dimensions_when_present():
    pieces_by_id = {
        "top-1": {
            "id": "top-1", "length": 79, "width": 25.5, "thickness": "3CM",
            "sink_type": "Single Bowl", "sink_offset_left": 20, "sink_length": 30, "sink_width": 18,
        },
        "top-2": {"id": "top-2", "length": 79, "width": 25.5, "thickness": "3CM"},
    }
    crate = {
        "planner_v3_orientation": "horizontal",
        "internal_length": 85.0,
        "main_layer_piece_ids": ["top-1", "top-2"],
        "planner_v3_splash_layers": [],
    }
    schedule = build_packing_schedule(crate, pieces_by_id)
    by_piece = {d["piece_id"]: d for r in schedule["rows"] for d in r["dimensions"]}
    assert by_piece["top-1"]["sink_type"] == "Single Bowl"
    assert by_piece["top-1"]["sink_offset_left"] == 20
    assert by_piece["top-1"]["sink_length"] == 30
    assert by_piece["top-1"]["sink_width"] == 18
    # A piece with no sink still gets the field, defaulted, never omitted.
    assert by_piece["top-2"]["sink_type"] == "No Sink"
