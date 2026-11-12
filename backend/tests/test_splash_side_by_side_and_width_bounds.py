"""Covers two meeting-notes fixes:

1. Splash side-by-side packing: splash pieces of the same thickness that fit
   end-to-end within a row's length budget should share one stacked layer
   instead of always being split into fixed-size groups
   (group_splash_pieces_side_by_side in dimensions.py, used by
   _chunk_splashes in packing.py/bundles.py).
2. Crate internal width must stay within [10", 26"] regardless of how wide
   the raw row-thickness stack comes out to
   (CRATE_INTERNAL_WIDTH_MIN_IN / CRATE_INTERNAL_WIDTH_MAX_IN in
   dimensions.py).
"""
from app.services.planner_v3.dimensions import (
    CRATE_INTERNAL_WIDTH_MAX_IN,
    CRATE_INTERNAL_WIDTH_MIN_IN,
    _pack_main_rows_within_width_band,
    group_main_pieces_into_rows,
    group_splash_pieces_side_by_side,
    horizontal_crate_dimensions,
)


def _main(length=80, width=25.5, thickness="3CM"):
    return {"id": "main-1", "length": length, "width": width, "thickness": thickness}


def _splash(idx, length, width=4, thickness="3CM"):
    return {"id": f"splash-{idx}", "length": length, "width": width, "thickness": thickness}


def test_short_splashes_of_same_thickness_share_one_row_instead_of_a_fixed_group_size():
    # Five short back splashes (15" each) comfortably fit side by side within
    # an 80"-long row (15*5 + 4*1" gaps = 79" <= 80"). The old fixed
    # group-of-4 chunker would have forced a second, stacked layer here even
    # though there was plenty of length left.
    splashes = [_splash(i, length=15) for i in range(5)]
    layers = group_splash_pieces_side_by_side(splashes, usable_length=80, default_thickness="3CM")
    assert len(layers) == 1
    assert len(layers[0]) == 5


def test_splashes_that_do_not_fit_one_row_spill_into_a_second_stacked_layer():
    # Each piece is 50" long — only one fits per row within a 60"-long budget,
    # so three pieces need three separate (stacked) layers.
    splashes = [_splash(i, length=50) for i in range(3)]
    layers = group_splash_pieces_side_by_side(splashes, usable_length=60, default_thickness="3CM")
    assert len(layers) == 3
    assert all(len(layer) == 1 for layer in layers)


def test_splashes_of_different_thickness_never_share_a_layer():
    thin = [_splash(0, length=15, thickness="2CM")]
    thick = [_splash(1, length=15, thickness="3CM")]
    layers = group_splash_pieces_side_by_side(thin + thick, usable_length=80, default_thickness="3CM")
    assert len(layers) == 2
    thicknesses_per_layer = [{p["thickness"] for p in layer} for layer in layers]
    assert {"2CM"} in thicknesses_per_layer
    assert {"3CM"} in thicknesses_per_layer


def test_side_by_side_splash_packing_reduces_crate_height_vs_forced_stacking():
    main_pieces = [_main()]
    packed_layers = [[_splash(i, length=15) for i in range(5)]]  # one shared layer
    stacked_layers = [[_splash(i, length=15)] for i in range(5)]  # five forced layers

    packed_dims = horizontal_crate_dimensions(main_pieces, packed_layers, "3CM", wood_thickness=1.25)
    stacked_dims = horizontal_crate_dimensions(main_pieces, stacked_layers, "3CM", wood_thickness=1.25)

    assert packed_dims["internal_height"] < stacked_dims["internal_height"]


def test_internal_width_is_clamped_to_the_minimum_when_pieces_are_very_thin():
    # A single thin piece would otherwise compute a sub-10" internal width.
    pieces = [{"id": "p1", "length": 40, "width": 20, "thickness": "0.5CM"}]
    dims = horizontal_crate_dimensions(pieces, [], "0.5CM", wood_thickness=1.25)
    assert dims["internal_width"] == CRATE_INTERNAL_WIDTH_MIN_IN


def test_identical_pieces_that_cannot_merge_report_true_width_with_a_warning_instead_of_a_silent_clamp():
    # 20 identical 90"-long pieces never share a row (no distinct shorter
    # length exists to combine them into), so growing the row-length budget
    # can't reduce the row count — the true width (well past 26") must be
    # reported with a warning, never silently clamped to a number that
    # wouldn't actually hold the pieces.
    pieces = [
        {"id": f"p{i}", "length": 90, "width": 30, "thickness": "4CM"}
        for i in range(20)
    ]
    dims = horizontal_crate_dimensions(pieces, [], "4CM", wood_thickness=1.25)
    assert dims["internal_width"] > CRATE_INTERNAL_WIDTH_MAX_IN
    assert any("26" in w for w in dims["warnings"])


def test_growing_the_row_length_budget_merges_more_pieces_per_row_and_pulls_width_back_into_band():
    # 20 pieces of 29" plus one 30" piece. At the base row-length cap
    # (30+6=36"), two 29s don't fit a row together (29+1+29=59 > 36), so
    # every 29" piece would get its own row -> 21 rows -> width way past
    # 26". Growing the cap to the sum of the two distinct lengths
    # (30+1+29+6=66") lets pairs of 29s share a row (29+1+29=59 <= 66),
    # roughly halving the row count and pulling width back under 26"
    # without the caller ever being warned.
    main = {"id": "main-30", "length": 30, "width": 25, "thickness": "4CM"}
    shorts = [{"id": f"s{i}", "length": 29, "width": 25, "thickness": "4CM"} for i in range(20)]
    pieces = [main] + shorts

    base_cap_rows = group_main_pieces_into_rows(pieces, usable_length=36.0)
    assert len(base_cap_rows) == 21  # confirms the naive base-cap packing really would be this wide

    rows, warnings = _pack_main_rows_within_width_band(pieces, "4CM")
    assert len(rows) < len(base_cap_rows)
    assert warnings == []

    dims = horizontal_crate_dimensions(pieces, [], "4CM", wood_thickness=1.25)
    assert dims["internal_width"] <= CRATE_INTERNAL_WIDTH_MAX_IN
    assert dims["warnings"] == []


def test_three_or_four_shorter_pieces_merge_into_one_longer_row_to_pull_width_back_into_band():
    # One 68" main piece plus four 25" pieces. Two 25s alone (25+1+25=51")
    # already fit the 68-based row budget (68+6=74"), but packing only two
    # per row still leaves 3 rows total (68-row, and two 25-pairs) -> width
    # would be 3 row-thicknesses. Growing the row-length budget to merge
    # three 25s together (25+1+25+1+25=77" > 74") lets all four 25s share
    # just two rows (or even one, if budget grows enough), pulling the
    # total row count — and so the width — down further.
    main = {"id": "main-68", "length": 68, "width": 25, "thickness": "3CM"}
    shorts = [{"id": f"s{i}", "length": 25, "width": 25, "thickness": "3CM"} for i in range(4)]
    dims = horizontal_crate_dimensions([main] + shorts, [], "3CM", wood_thickness=1.25)
    # Row-merging (helped by growing the length budget where needed) must
    # bring width comfortably inside the 10-26" structural band, not leave
    # it high from treating every distinct length as its own row/thickness
    # slot with no further consolidation.
    assert CRATE_INTERNAL_WIDTH_MIN_IN <= dims["internal_width"] <= CRATE_INTERNAL_WIDTH_MAX_IN
