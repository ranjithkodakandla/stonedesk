import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

from app import main as app_main


def _reset():
    app_main.projects_col.docs.clear()
    app_main.pieces_col.docs.clear()
    app_main.crates_col.docs.clear()


def test_packing_schedule_endpoint_reproduces_scenario_g():
    _reset()
    project = app_main.create_project()
    piece_ids = []
    for i in range(6):
        p = app_main.create_piece(project["id"], app_main.PieceCreate(
            part="Kitchen - Range Tops", category="Kitchen - Range Tops",
            length=79, width=25.5, thickness="3CM",
        ))
        piece_ids.append(p["id"])
    for i in range(6):
        p1 = app_main.create_piece(project["id"], app_main.PieceCreate(
            part="Kitchen - Range Tops", category="Kitchen - Range Tops",
            length=49, width=25.5, thickness="3CM",
        ))
        p2 = app_main.create_piece(project["id"], app_main.PieceCreate(
            part="Kitchen - Range Tops", category="Kitchen - Range Tops",
            length=19, width=25.5, thickness="3CM",
        ))
        piece_ids.extend([p1["id"], p2["id"]])

    app_main.crates_col.insert_one({
        "id": 1, "project_id": project["id"], "crate_id": "C-1",
        "planner_v3_orientation": "horizontal",
        "internal_length": 85.0,
        "main_layer_piece_ids": piece_ids,
        "planner_v3_splash_layers": [],
    })

    result = app_main.get_crate_packing_schedule(project["id"], 1)
    assert result["crate_id"] == "C-1"
    assert result["unassigned_piece_ids"] == []
    rows = result["rows"]
    assert len(rows) == 12
    assert len([r for r in rows if r["quantity"] == 1]) == 6
    assert len([r for r in rows if r["quantity"] == 2]) == 6


def test_packing_schedule_endpoint_404s_for_missing_crate():
    _reset()
    project = app_main.create_project()
    try:
        app_main.get_crate_packing_schedule(project["id"], 999)
        assert False, "expected HTTPException"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
