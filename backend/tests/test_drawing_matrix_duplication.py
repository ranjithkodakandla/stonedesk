import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

from app import main as app_main
from app.main import DrawingToPieceRequest, create_piece_from_drawing


def _reset_collections():
    app_main.projects_col.docs.clear()
    app_main.pieces_col.docs.clear()
    app_main.counters_col.docs.clear()


def _new_project():
    return app_main.create_project()


BASE_PARAMS = {"length": 96, "width": 42, "overhang": 12}


def test_single_destination_resave_updates_in_place_not_duplicate():
    _reset_collections()
    project = _new_project()
    req = DrawingToPieceRequest(
        template_id="island_standard", params=BASE_PARAMS, part="Island A",
        building="B1", floor="1", flat="101",
    )
    first = create_piece_from_drawing(project["id"], req)
    assert len(first["pieces"]) >= 1
    piece_ids = first["piece_ids"]

    req2 = req.model_copy(update={"piece_ids": piece_ids, "params": {**BASE_PARAMS, "length": 90}})
    second = create_piece_from_drawing(project["id"], req2)

    all_pieces = app_main.pieces_col.find({"project_id": project["id"]})
    assert len(all_pieces) == len(first["pieces"])  # no duplicates inserted
    assert second["piece_ids"] == piece_ids  # same ids reused


def test_matrix_destinations_get_independent_piece_ids_no_collision():
    _reset_collections()
    project = _new_project()
    req = DrawingToPieceRequest(
        template_id="island_standard", params=BASE_PARAMS, part="Island A",
        destinations=[
            {"building": "B1", "floor": "1", "flat": "101"},
            {"building": "B1", "floor": "1", "flat": "102"},
            {"building": "B1", "floor": "2", "flat": "201"},
        ],
    )
    result = create_piece_from_drawing(project["id"], req)

    assert len(result["destinations"]) == 3
    all_piece_ids = [d["piece_ids"]["top"] for d in result["destinations"]]
    assert len(set(all_piece_ids)) == 3  # each destination has its own piece, not overwritten

    all_pieces = app_main.pieces_col.find({"project_id": project["id"]})
    assert len(all_pieces) == 3


def test_matrix_resave_with_returned_piece_ids_is_idempotent():
    _reset_collections()
    project = _new_project()
    req = DrawingToPieceRequest(
        template_id="island_standard", params=BASE_PARAMS, part="Island A",
        destinations=[
            {"building": "B1", "floor": "1", "flat": "101"},
            {"building": "B1", "floor": "1", "flat": "102"},
        ],
    )
    first = create_piece_from_drawing(project["id"], req)
    assert len(app_main.pieces_col.find({"project_id": project["id"]})) == 2

    # Resubmit the same matrix, now passing back the piece_ids from the
    # first save — must update in place, not create a second batch.
    dests_with_ids = [
        {**d, "piece_ids": d["piece_ids"]} for d in first["destinations"]
    ]
    req2 = req.model_copy(update={"destinations": dests_with_ids, "params": {**BASE_PARAMS, "length": 84}})
    create_piece_from_drawing(project["id"], req2)

    all_pieces = app_main.pieces_col.find({"project_id": project["id"]})
    assert len(all_pieces) == 2  # still 2, not 4


def test_matrix_destination_with_no_piece_ids_still_creates_fresh():
    _reset_collections()
    project = _new_project()
    req = DrawingToPieceRequest(
        template_id="island_standard", params=BASE_PARAMS, part="Island A",
        destinations=[{"building": "B1", "floor": "1", "flat": "101"}],
    )
    first = create_piece_from_drawing(project["id"], req)
    # Resubmitting without piece_ids (today's default UI behavior) is still
    # supported and still creates a fresh batch, same as before this change.
    second = create_piece_from_drawing(project["id"], req)

    all_pieces = app_main.pieces_col.find({"project_id": project["id"]})
    assert len(all_pieces) == len(first["pieces"]) + len(second["pieces"])
