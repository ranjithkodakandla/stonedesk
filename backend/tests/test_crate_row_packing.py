"""Reproduces the supplied Kitchen And Range Tops packing drawing (Scenario
G): internal crate dims 80 x 15 x 32.5in, 18 pieces packed as 6 single-piece
rows (79 x 25.5 x 3CM) plus 6 two-piece rows (49 x 25.5 x 3CM paired with
19 x 25.5 x 3CM). This is a reproducible test fixture built from the
drawing's own numbers, not a hardcoded packing rule — any pieces with these
relative lengths should pack the same way."""
from app.services.planner_v3.dimensions import group_main_pieces_into_rows, horizontal_crate_dimensions


def _reference_18_pieces():
    pieces = []
    for i in range(6):
        pieces.append({"id": f"single-{i}", "length": 79, "width": 25.5, "thickness": "3CM"})
    for i in range(6):
        pieces.append({"id": f"pair-{i}-long", "length": 49, "width": 25.5, "thickness": "3CM"})
        pieces.append({"id": f"pair-{i}-short", "length": 19, "width": 25.5, "thickness": "3CM"})
    return pieces


def test_reference_18_pieces_pack_into_6_single_and_6_double_rows():
    pieces = _reference_18_pieces()
    assert len(pieces) == 18

    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])

    assert len(rows) == 12
    single_rows = [r for r in rows if len(r) == 1]
    double_rows = [r for r in rows if len(r) == 2]
    assert len(single_rows) == 6
    assert len(double_rows) == 6
    for row in single_rows:
        assert row[0]["length"] == 79
    for row in double_rows:
        lengths = sorted(p["length"] for p in row)
        assert lengths == [19, 49]

    # Every piece is accounted for exactly once — no overlaps, nothing dropped.
    all_ids = [p["id"] for row in rows for p in row]
    assert sorted(all_ids) == sorted(p["id"] for p in pieces)
    assert len(all_ids) == len(set(all_ids)) == 18


def test_a_lone_long_piece_never_shares_a_row_it_cannot_fit_in():
    pieces = [
        {"id": "long", "length": 79, "width": 25.5, "thickness": "3CM"},
        {"id": "also-long", "length": 70, "width": 25.5, "thickness": "3CM"},
    ]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    # 79 + 1.0 gap + 70 = 150, far beyond any single piece's own length-derived
    # crate length — these must stay in separate rows.
    assert len(rows) == 2


def test_many_short_pieces_fill_one_row_before_starting_the_next():
    pieces = [{"id": f"short-{i}", "length": 15, "width": 25.5, "thickness": "3CM"} for i in range(5)]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    # internal_length = 15 + 6 = 21; each additional piece needs +1 gap +15,
    # so only one 15" piece fits per row at a time once 15 is already placed
    # (15 + 1 + 15 = 31 > 21) — same number of rows as pieces in this case,
    # which is correct: the crate is sized to its own longest piece (15"),
    # leaving no spare room to pair two of them.
    assert len(rows) == 5


def test_internal_width_reflects_row_count_not_raw_piece_count():
    pieces = _reference_18_pieces()
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    # Width must be sized for 12 thickness-slots (rows), not 18 — pairing
    # the short pieces is the whole point of the fix.
    import math
    from app.services.planner_v3.dimensions import _ROW_SEPARATOR_IN, _SIDE_FRAME
    from app.services.planning_engine import thickness_inches

    expected_width = round(12 * thickness_inches("3CM") + 11 * _ROW_SEPARATOR_IN + _SIDE_FRAME, 1)
    assert dims["internal_width"] == expected_width

    # Sanity: strictly narrower than the old one-row-per-piece formula would
    # have given for these same 18 pieces (18 slots instead of 12).
    old_one_row_per_piece_width = round(18 * thickness_inches("3CM") + 17 * _ROW_SEPARATOR_IN + _SIDE_FRAME, 1)
    assert dims["internal_width"] < old_one_row_per_piece_width
