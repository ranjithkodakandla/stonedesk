import pytest

from app.services import drawing_templates as dt
from app.services.drawing_engine import render_svg, render_pdf_bytes, render_pdf_bundle


def test_lists_expected_templates():
    ids = {t["id"] for t in dt.list_templates()}
    assert {"island_standard", "island_with_sink"} <= ids


def test_standard_island_geometry_scales_with_dimensions():
    geo_a = dt.build_geometry("island_standard", {"length": 96, "width": 42, "overhang": 12})
    geo_b = dt.build_geometry("island_standard", {"length": 84, "width": 36, "overhang": 12})
    assert geo_a["width_in"] == 96 and geo_a["height_in"] == 42
    assert geo_b["width_in"] == 84 and geo_b["height_in"] == 36
    assert geo_a["outline"][2] == [96, 42]
    assert geo_b["outline"][2] == [84, 36]


def test_standard_island_out_of_range_length_is_rejected():
    errors = dt.validate_params("island_standard", {"length": 400, "width": 42, "overhang": 12})
    assert errors and "Length" in errors[0]


def test_standard_island_piece_fields_map_to_canonical_shape():
    fields = dt.build_piece_fields("island_standard", {"length": 96, "width": 42, "overhang": 12})
    assert fields["category"] == "Kitchen - Island Tops"
    assert fields["length"] == 96
    assert fields["width"] == 42
    assert fields["sink_type"] == "No Sink"


def test_island_with_sink_generates_cutout_and_offsets():
    params = {"length": 96, "width": 42, "sink_length": 30, "sink_width": 18, "sink_offset_left": 20}
    geo = dt.build_geometry("island_with_sink", params)
    fields = dt.build_piece_fields("island_with_sink", params)
    assert geo["cutouts"][0]["rect"][:2] == [20, 12]  # x, y (centered vertically: (42-18)/2)
    assert fields["sink_offset_left"] == 20
    assert fields["sink_offset_right"] == 96 - 20 - 30


def test_island_with_sink_rejects_sink_too_close_to_edge():
    params = {"length": 96, "width": 42, "sink_length": 30, "sink_width": 18, "sink_offset_left": 1}
    errors = dt.validate_params("island_with_sink", params)
    assert any("left edge" in e for e in errors)


def test_island_with_sink_rejects_sink_wider_than_countertop_allows():
    params = {"length": 96, "width": 42, "sink_length": 30, "sink_width": 40, "sink_offset_left": 20}
    errors = dt.validate_params("island_with_sink", params)
    assert any("too wide" in e for e in errors)


def test_unknown_template_raises():
    with pytest.raises(dt.TemplateError):
        dt.get_template("does_not_exist")


def test_render_svg_contains_dimensions_and_cutout():
    geo = dt.build_geometry("island_with_sink", {"length": 96, "width": 42, "sink_length": 30, "sink_width": 18, "sink_offset_left": 20})
    svg = render_svg(geo, {"part": "Island A"})
    assert svg.startswith("<svg")
    assert "Polish" in svg
    assert "Island A" in svg


def test_render_pdf_bytes_produces_valid_pdf_header():
    geo = dt.build_geometry("island_standard", {"length": 96, "width": 42, "overhang": 12})
    pdf_bytes = render_pdf_bytes(geo, {"part": "Island A"})
    assert pdf_bytes[:5] == b"%PDF-"


def test_vanity_top_assembly_bundles_backsplash_and_side_splashes_by_default():
    assembly = dt.build_assembly("vanity_top", {"length": 55, "depth": 22.5})
    roles = {item["role"] for item in assembly}
    assert roles == {"top", "backsplash", "side_splash_left", "side_splash_right"}
    top = next(i for i in assembly if i["role"] == "top")["fields"]
    assert top["category"] == "Vanity - Top"
    backsplash = next(i for i in assembly if i["role"] == "backsplash")["fields"]
    assert backsplash["category"] == "Vanity - Back Splash"
    assert backsplash["length"] == 55


def test_vanity_top_accessories_can_be_excluded():
    assembly = dt.build_assembly("vanity_top", {"length": 55, "depth": 22.5, "include_backsplash": False, "include_side_splash": False})
    roles = {item["role"] for item in assembly}
    assert roles == {"top"}


def test_kitchen_l_top_assembly_bundles_two_backsplashes_and_two_side_splashes():
    assembly = dt.build_assembly("kitchen_l_top", {"left_run": 63, "right_run": 49, "depth": 25.5})
    roles = [item["role"] for item in assembly]
    assert roles.count("backsplash") + roles.count("backsplash_right") == 2
    assert "side_splash_left" in roles and "side_splash_right" in roles
    top = next(i for i in assembly if i["role"] == "top")["fields"]
    assert top["category"] == "Kitchen - Perimeter Tops"


def test_island_assembly_never_includes_splash_accessories():
    # Islands don't get backsplash/side splash in real fab drawings.
    assembly = dt.build_assembly("island_standard", {"length": 96, "width": 42})
    assert len(assembly) == 1 and assembly[0]["role"] == "top"


def test_build_piece_fields_back_compat_returns_top_only():
    fields = dt.build_piece_fields("vanity_top", {"length": 55, "depth": 22.5})
    assert fields["category"] == "Vanity - Top"


def test_render_pdf_bundle_produces_one_page_per_item():
    import fitz

    items = [
        {"geometry": dt.build_geometry("vanity_top", {"length": 55, "depth": 22.5}), "meta": {"part": "Vanity A"}},
        {"geometry": dt.build_geometry("island_standard", {"length": 96, "width": 42}), "meta": {"part": "Island A"}},
        {"geometry": dt.build_geometry("kitchen_l_top", {"left_run": 63, "right_run": 49}), "meta": {"part": "Kitchen A"}},
    ]
    pdf_bytes = render_pdf_bundle(items)
    assert pdf_bytes[:5] == b"%PDF-"
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert doc.page_count == 3
    texts = [doc[i].get_text() for i in range(3)]
    assert "Vanity A" in texts[0]
    assert "Island A" in texts[1]
    assert "Kitchen A" in texts[2]
    doc.close()


def test_render_pdf_bytes_with_single_destination_shows_destination_row():
    import fitz

    geo = dt.build_geometry("island_standard", {"length": 96, "width": 42})
    pdf_bytes = render_pdf_bytes(geo, {"part": "Island A", "building": "13", "floor": "1", "flat": "103"})
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = doc[0].get_text()
    doc.close()
    assert "Bldg 13" in text and "Flat 103" in text
    assert "Bldg #'s / Floor" not in text  # single destination: no matrix table


def test_render_pdf_bytes_with_matrix_destinations_shows_table_not_row():
    import fitz

    geo = dt.build_geometry("island_standard", {"length": 96, "width": 42})
    destinations = [
        {"building": "13", "floor": "1", "flat": "103"},
        {"building": "13", "floor": "1", "flat": "107"},
        {"building": "14", "floor": "2", "flat": "203"},
    ]
    pdf_bytes = render_pdf_bytes(geo, {"part": "Island A", "destinations": destinations})
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = doc[0].get_text()
    doc.close()
    assert "Bldg #'s / Floor" in text
    assert "103" in text and "107" in text and "203" in text
    assert "3 destinations" in text  # sidebar points at the table instead of listing them inline
