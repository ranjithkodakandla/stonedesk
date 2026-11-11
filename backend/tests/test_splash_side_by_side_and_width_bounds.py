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


def test_internal_width_is_clamped_to_the_maximum_when_many_thick_rows_stack_up():
    # Many pieces too long to share rows, each thick, driving the raw
    # row-thickness sum well past 26".
    pieces = [
        {"id": f"p{i}", "length": 90, "width": 30, "thickness": "4CM"}
        for i in range(20)
    ]
    dims = horizontal_crate_dimensions(pieces, [], "4CM", wood_thickness=1.25)
    assert dims["internal_width"] == CRATE_INTERNAL_WIDTH_MAX_IN
