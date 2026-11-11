"""Builds a human-readable packing schedule for one crate: which pieces go
in which row, in which layer, in what order — the same shape as a real
factory packing drawing (see the supplied Kitchen And Range Tops reference:
rows 1-6 one piece each, rows 7-12 two pieces each). This is a derived VIEW
over data the planner already persists on the crate document
(main_layer_piece_ids, planner_v3_splash_layers, internal_length) — it does
not change packing, weight, or dimension behavior, and nothing here is
persisted separately: it's recomputed on request from the same stored
assignment every time, so it can never drift from what was actually packed.
"""
from typing import Any, Dict, List, Optional

from ..planning_engine import thickness_inches
from .dimensions import group_main_pieces_into_rows


def _row_entry(row_index: int, layer: str, pieces: List[Dict[str, Any]], sequence: int, orientation: str) -> Dict[str, Any]:
    # Physical packing model (horizontal_crate_dimensions): each row is a
    # thickness-slot — pieces stand upright, leaning side by side, wrapped
    # in foam (see the supplied factory photos). A row's "slot thickness" is
    # the widest piece thickness in it (how much of the crate's width axis
    # it consumes); its "standing height" is the tallest piece's width (the
    # short edge standing upright). These are what a cross-section view
    # needs to draw the row as an actual upright slab, not a flat bar.
    slot_thickness = max((thickness_inches(str(p.get("thickness") or "3CM")) for p in pieces), default=0.0)
    standing_height = max((float(p.get("width") or 0) for p in pieces), default=0.0)
    return {
        "row": row_index,
        "layer": layer,
        "piece_ids": [p.get("id") for p in pieces],
        "dimensions": [
            {
                "piece_id": p.get("id"),
                "part_no": p.get("part_no", ""),
                "length": p.get("length"),
                "width": p.get("width"),
                "thickness": p.get("thickness"),
            }
            for p in pieces
        ],
        "quantity": len(pieces),
        "orientation": orientation,
        "sequence": sequence,
        "slot_thickness_in": round(slot_thickness, 3),
        "standing_height_in": round(standing_height, 2),
    }


def build_packing_schedule(crate: Dict[str, Any], pieces_by_id: Dict[Any, Dict[str, Any]]) -> Dict[str, Any]:
    """Returns {"rows": [...], "unassigned_piece_ids": [...]} for one crate.
    `pieces_by_id` only needs to cover the ids this crate references.
    Pieces referenced on the crate but missing from pieces_by_id (e.g. a
    piece deleted after the plan was generated) are reported in
    unassigned_piece_ids instead of silently dropped."""
    orientation = str(crate.get("planner_v3_orientation") or "horizontal")
    internal_length = float(crate.get("internal_length") or 0.0)

    def _resolve(piece_ids: Optional[List[Any]]) -> (List[Dict[str, Any]], List[Any]):
        resolved, missing = [], []
        for pid in piece_ids or []:
            p = pieces_by_id.get(pid)
            (resolved if p is not None else missing).append(p if p is not None else pid)
        return resolved, missing

    main_pieces, missing_main = _resolve(crate.get("main_layer_piece_ids"))
    usable_length = internal_length or (max((p.get("length") or 0) for p in main_pieces) + 6 if main_pieces else 0)

    rows: List[Dict[str, Any]] = []
    unassigned: List[Any] = list(missing_main)
    sequence = 1
    row_index = 1

    for row_pieces in group_main_pieces_into_rows(main_pieces, usable_length=usable_length or 1):
        rows.append(_row_entry(row_index, "main", row_pieces, sequence, orientation))
        row_index += 1
        sequence += 1

    splash_layers = crate.get("planner_v3_splash_layers") or []
    for layer_idx, layer_piece_ids in enumerate(splash_layers, start=1):
        layer_pieces, missing_layer = _resolve(layer_piece_ids)
        unassigned.extend(missing_layer)
        for row_pieces in group_main_pieces_into_rows(layer_pieces, usable_length=usable_length or 1):
            rows.append(_row_entry(row_index, f"splash_{layer_idx}", row_pieces, sequence, orientation))
            row_index += 1
            sequence += 1

    return {
        "rows": rows,
        "unassigned_piece_ids": unassigned,
        "internal_length": internal_length,
        "internal_width": float(crate.get("internal_width") or 0.0),
        "internal_height": float(crate.get("internal_height") or 0.0),
    }
