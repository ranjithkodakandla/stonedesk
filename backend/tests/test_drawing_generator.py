import pytest

from app.services import drawing_templates as dt
from app.services.drawing_engine import render_svg, render_pdf_bytes


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
    assert "Sink" in svg
    assert "Island A" in svg


def test_render_pdf_bytes_produces_valid_pdf_header():
    geo = dt.build_geometry("island_standard", {"length": 96, "width": 42, "overhang": 12})
    pdf_bytes = render_pdf_bytes(geo, {"part": "Island A"})
    assert pdf_bytes[:5] == b"%PDF-"
