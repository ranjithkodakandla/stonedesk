from app.services.deterministic_packing import compute_crate_dimensions


def test_splashes_place_side_by_side_instead_of_stacking_when_width_allows():
    main = [{"length": 60, "width": 20, "qty": 1, "thickness": "3CM"}]
    splash = [{"length": 60, "width": 4, "qty": 4, "thickness": "3CM"}]

    stacked = compute_crate_dimensions(main, [], "3CM")
    with_splash = compute_crate_dimensions(main, splash, "3CM")

    # 4 splashes at 4" wide each fit side by side in the available width,
    # so they add only one slab-thickness of height, not four.
    added_height = with_splash["internal_height"] - stacked["internal_height"]
    assert added_height < 4 * 1.181


def test_splashes_fall_back_to_stacking_when_side_by_side_does_not_fit():
    main = [{"length": 20, "width": 11, "qty": 1, "thickness": "3CM"}]
    splash = [{"length": 20, "width": 20, "qty": 3, "thickness": "3CM"}]

    dims = compute_crate_dimensions(main, splash, "3CM")

    # Splash pieces are wider than the available crate width, so they
    # must stack: all 3 rows contribute to height.
    assert dims["internal_height"] > 3 * 1.181


def test_internal_width_is_clamped_to_min_10_inches():
    main = [{"length": 20, "width": 2, "qty": 1, "thickness": "3CM"}]
    dims = compute_crate_dimensions(main, [], "3CM")
    assert dims["internal_width"] == 10.0


def test_internal_width_is_clamped_to_max_26_inches():
    main = [{"length": 60, "width": 40, "qty": 1, "thickness": "3CM"}]
    dims = compute_crate_dimensions(main, [], "3CM")
    assert dims["internal_width"] == 26.0
