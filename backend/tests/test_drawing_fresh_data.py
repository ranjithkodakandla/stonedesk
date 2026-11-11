import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

from app import main as app_main


def test_reverse_map_piece_uses_current_dimensions_not_stale_stored_params():
    # A generator-created piece's drawing_template_params can drift from its
    # actual current length/width if someone edits the piece directly (e.g.
    # via the Source Data table) without reopening the Drawing Generator.
    # The combined-project PDF must always reflect the piece's current
    # fields, never the stale params frozen at generation time.
    piece = {
        "id": 1, "part": "Kitchen - Island Tops", "sink_type": "No Sink",
        "length": 90, "width": 40,  # current, edited dimensions
        "drawing_template_id": "island_standard",
        "drawing_template_params": {"length": 96, "width": 42, "overhang": 12},  # stale
    }
    mapped = app_main._reverse_map_piece(piece, [piece])
    assert mapped["drawing_template_params"]["length"] == 90
    assert mapped["drawing_template_params"]["width"] == 40
    # Template-only param with no flat-field equivalent is preserved from storage.
    assert mapped["drawing_template_params"]["overhang"] == 12


def test_reverse_map_piece_recomputes_splash_inference_from_current_siblings():
    top = {
        "id": 1, "part": "Kitchen - Island Tops", "sink_type": "No Sink",
        "length": 90, "width": 40, "drawing": "Island A",
        "drawing_template_id": "island_standard",
        "drawing_template_params": {"length": 90, "width": 40, "include_backsplash": False},
    }
    backsplash = {"id": 2, "part": "Kitchen Back Splash", "drawing": "Island A", "width": 4}
    mapped = app_main._reverse_map_piece(top, [top, backsplash])
    # A backsplash sibling was added after generation — must be picked up now.
    assert mapped["drawing_template_params"]["include_backsplash"] is True


def test_manually_entered_piece_still_reverse_mapped_from_scratch():
    piece = {"id": 1, "part": "Kitchen - Island Tops", "sink_type": "No Sink", "length": 72, "width": 36}
    mapped = app_main._reverse_map_piece(piece, [piece])
    assert mapped["drawing_template_id"] == "island_standard"
    assert mapped["drawing_template_params"]["length"] == 72
    assert mapped["drawing_template_params"]["width"] == 36


def test_piece_with_no_matching_template_returns_none():
    piece = {"id": 1, "part": "Something Unmappable"}
    assert app_main._reverse_map_piece(piece, [piece]) is None
