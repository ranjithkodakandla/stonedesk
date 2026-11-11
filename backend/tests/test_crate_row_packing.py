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


def test_many_identical_short_pieces_combine_using_the_no_standout_floor():
    # Five identical 15" pieces, nothing else in the selection: there is no
    # standout "longest piece" (everything ties), so deriving the cap from
    # a single 15" piece (15+6=21") would force one piece per row — five
    # thin, wasteful rows for pieces that obviously belong together. The
    # 120" no-standout floor lets them combine properly instead.
    pieces = [{"id": f"short-{i}", "length": 15, "width": 25.5, "thickness": "3CM"} for i in range(5)]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    # 5*15 + 4*1 = 79 <= 120 — all five fit in a single row.
    assert len(rows) == 1
    assert len(rows[0]) == 5


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


def test_three_identical_leftover_pieces_consolidate_past_the_original_cap():
    # Real example: a 67" piece (the longest single piece) plus three
    # identical 25" pieces. Capping every row at "longest piece + clearance"
    # would pair two 25s (50" <= cap) and strand the third alone — wasting a
    # whole extra row. The three 25s should instead consolidate into one
    # clean 75"-ish row, growing the crate past its original 67"-based cap.
    pieces = [
        {"id": "big", "length": 67, "width": 25.5, "thickness": "3CM"},
        {"id": "a", "length": 25, "width": 25.5, "thickness": "3CM"},
        {"id": "b", "length": 25, "width": 25.5, "thickness": "3CM"},
        {"id": "c", "length": 25, "width": 25.5, "thickness": "3CM"},
    ]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])

    assert len(rows) == 2  # not 3 — the big piece alone, all three 25s together
    by_length = sorted(rows, key=len)
    assert len(by_length[0]) == 1 and by_length[0][0]["id"] == "big"
    assert len(by_length[1]) == 3
    assert sorted(p["id"] for p in by_length[1]) == ["a", "b", "c"]

    # Crate length grew to fit the 3x25 row (25*3 + 2 gaps of 1" = 77") plus
    # the standard 6" end clearance — not capped at the original 67" piece.
    assert dims["internal_length"] == 83.0


def test_identical_pieces_that_never_paired_up_at_all_stay_separate():
    # Six identical 79" pieces (same lengths as the reference drawing's
    # single rows) with NO other pieces at all: none of them ever forms a
    # multi-piece row in Phase A (79+1+79 always exceeds the cap), so there
    # is nothing for the consolidation pass to extend — they must stay six
    # separate rows, never merged just because it would cut the row count.
    pieces = [{"id": f"p{i}", "length": 79, "width": 25.5, "thickness": "3CM"} for i in range(6)]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    assert len(rows) == 6
    assert all(len(row) == 1 for row in rows)
    assert dims["internal_length"] == 85.0  # unchanged: 79 + 6, no consolidation applies


def test_dissimilar_leftover_pieces_never_merge_with_each_other():
    # A leftover singleton (67") and a leftover singleton of a DIFFERENT
    # length (19", with nothing else to pair with) must never merge with
    # each other — consolidation only ever extends an existing SAME-length
    # multi-piece row, it never combines two unrelated leftovers.
    pieces = [
        {"id": "big", "length": 67, "width": 25.5, "thickness": "3CM"},
        {"id": "odd", "length": 19, "width": 25.5, "thickness": "3CM"},
    ]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    assert len(rows) == 2
    assert all(len(row) == 1 for row in rows)


def test_no_standout_floor_does_not_apply_when_a_distinct_longer_piece_exists():
    # Mixed lengths (67 + three 25s) ALWAYS has a standout (67 is clearly
    # longer than the 25s) — the 120" floor must never kick in here, or it
    # would change the already-verified 67-alone / 25x3-combined result.
    pieces = [
        {"id": "big", "length": 67, "width": 25.5, "thickness": "3CM"},
        {"id": "a", "length": 25, "width": 25.5, "thickness": "3CM"},
        {"id": "b", "length": 25, "width": 25.5, "thickness": "3CM"},
        {"id": "c", "length": 25, "width": 25.5, "thickness": "3CM"},
    ]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    assert len(rows) == 2
    by_len = sorted(rows, key=len)
    assert len(by_len[0]) == 1 and by_len[0][0]["id"] == "big"
    assert len(by_len[1]) == 3
    assert dims["internal_length"] == 83.0  # unchanged from the dedicated consolidation test


def test_no_standout_floor_does_not_apply_to_the_reference_18_piece_drawing():
    # The reference drawing has three distinct lengths (79, 49, 19) — even
    # though six pieces tie for the max (79), that is not a "no standout"
    # case (49/19 are clearly shorter), so the 120" floor must not apply —
    # the six 79" pieces must stay six separate rows, exactly as before.
    pieces = _reference_18_pieces()
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    assert len(rows) == 12
    assert dims["internal_length"] == 85.0


def test_no_standout_floor_still_respects_a_single_piece_longer_than_120():
    # If the one shared length itself already exceeds 120", the floor must
    # never shrink the cap below what a single piece needs.
    pieces = [{"id": f"p{i}", "length": 150, "width": 25.5, "thickness": "3CM"} for i in range(3)]
    dims = horizontal_crate_dimensions(pieces, [], "3CM", wood_thickness=1.25)
    rows = group_main_pieces_into_rows(pieces, usable_length=dims["internal_length"])
    # 150+1+150 = 301, far beyond even a 156" cap (150+6) — still one piece per row.
    assert len(rows) == 3
    assert all(len(row) == 1 for row in rows)
