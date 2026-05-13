"""
Island-only operational plan preview (no persistence).

Uses existing Phase A island bundling + batching. Pull suggestions use all
island bundles in the project so underloaded crates can show nearby flats.
"""
from __future__ import annotations

from typing import Any, Dict, List, Set

from ..planning_engine import thickness_inches
from .phase_a_island import (
    build_island_bundles_indexed_by_dispatch,
    operational_planner_enabled,
    pack_phase_a_islands,
)
from .packing import sort_pieces_by_dispatch


def _norm_set(values: Any) -> Set[str]:
    if not values:
        return set()
    return {str(v).strip() for v in values if str(v).strip()}


def filter_pieces_by_location(
    pieces: List[Dict[str, Any]],
    buildings: Any,
    floors: Any,
    flats: Any,
) -> List[Dict[str, Any]]:
    """Empty filter lists = no filter on that axis."""
    bs, fs, fls = _norm_set(buildings), _norm_set(floors), _norm_set(flats)
    out: List[Dict[str, Any]] = []
    for p in pieces:
        if bs and str(p.get("building") or "").strip() not in bs:
            continue
        if fs and str(p.get("floor") or "").strip() not in fs:
            continue
        if fls and str(p.get("flat") or "").strip() not in fls:
            continue
        out.append(p)
    return out


def _piece_to_bundle(bundles: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    m: Dict[int, Dict[str, Any]] = {}
    for b in bundles:
        for pid in b.get("all_piece_ids") or []:
            m[int(pid)] = b
    return m


def _suggested_pull_rows(
    spec: Dict[str, Any],
    bundles_full: List[Dict[str, Any]],
    limit: int = 12,
) -> List[Dict[str, Any]]:
    pull_ids = spec.get("pull_candidate_piece_ids") or []
    pid_bundle = _piece_to_bundle(bundles_full)
    seen: Set[str] = set()
    rows: List[Dict[str, Any]] = []
    for pid in pull_ids:
        b = pid_bundle.get(int(pid))
        if not b:
            continue
        bid = str(b.get("bundle_id") or "")
        if not bid or bid in seen:
            continue
        seen.add(bid)
        rows.append({
            "bundle_id": bid,
            "building": b.get("building") or "",
            "floor": b.get("floor") or "",
            "flat": b.get("flat") or "",
            "weight_kg": float(b.get("total_weight_kg") or 0),
            "label": f"Flat {b.get('flat') or '?'} ({float(b.get('total_weight_kg') or 0):.0f} kg)",
        })
        if len(rows) >= limit:
            break
    return rows


def _slab_stack_meta(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in pieces:
        t = thickness_inches(str(p.get("thickness") or default_thickness))
        out.append({
            "part_no": str(p.get("part_no") or ""),
            "thickness_in": round(t, 3),
            "qty": max(1, int(p.get("qty", 1) or 1)),
        })
    return out


def _expanded_groups(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Group pieces by flat for review panel."""
    by_flat: Dict[str, List[Dict[str, Any]]] = {}
    for p in spec.get("pieces") or []:
        fk = str(p.get("flat") or "").strip() or "—"
        by_flat.setdefault(fk, []).append(p)
    groups: List[Dict[str, Any]] = []
    for flat, plist in sorted(by_flat.items(), key=lambda x: x[0]):
        mains = {int(p["id"]) for p in spec.get("main_pieces") or []}
        part_rows = []
        for p in sorted(plist, key=lambda x: (str(x.get("part_no") or ""), x["id"])):
            pid = int(p["id"])
            role = "main" if pid in mains else "waterfall_or_splash"
            desc = str(p.get("part") or "").lower()
            if "waterfall" in desc or str(p.get("part_no") or "").upper().endswith(("-WL", "-WR")):
                role = "waterfall"
            part_rows.append({
                "id": pid,
                "part_no": str(p.get("part_no") or ""),
                "part": str(p.get("part") or ""),
                "role": role,
            })
        groups.append({"flat": flat, "parts": part_rows})
    return groups


def _human_scope_label(body: Dict[str, Any]) -> str:
    bits: List[str] = []
    b = body.get("buildings") or []
    f = body.get("floors") or []
    fl = body.get("flats") or []
    if b:
        bits.append("Bldg " + ", ".join(str(x) for x in b))
    if f:
        bits.append("Fl " + ", ".join(str(x) for x in f))
    if fl:
        bits.append("Units " + ", ".join(str(x) for x in fl))
    return " · ".join(bits) if bits else "all parts in project (no location filter)"


def _review_one(
    spec: Dict[str, Any],
    bundles_full: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
) -> Dict[str, Any]:
    dims = spec.get("dimensions") or {}
    el = float(dims.get("external_length") or 0)
    ew = float(dims.get("external_width") or 0)
    eh = float(dims.get("external_height") or 0)
    wt = float(spec.get("total_weight_kg") or 0)
    pieces = spec.get("pieces") or []
    bundles_meta = spec.get("part_bundles") or []
    op = str(spec.get("operational_status") or spec.get("weight_band_status") or "")
    pdbg = spec.get("planner_debug") or {}
    trans = pdbg.get("batching_transparency") or {}

    return {
        "name": spec.get("name"),
        "dispatch_group": spec.get("dispatch_group"),
        "serial": spec.get("serial"),
        "category": spec.get("category"),
        "total_weight_kg": round(wt, 1),
        "dimensions_in": {
            "L": round(el, 1),
            "W": round(ew, 1),
            "H": round(eh, 1),
            "label": f"{round(el)} × {round(ew)} × {round(eh)}",
        },
        "status": op.upper() if op else "UNKNOWN",
        "bundle_count": len(bundles_meta),
        "slab_count": len(pieces),
        "slab_stack": _slab_stack_meta(pieces, thickness),
        "expanded": _expanded_groups(spec),
        "suggested_pulls": _suggested_pull_rows(spec, bundles_full),
        "target_weight_kg": {
            "ideal_center": 1900,
            "lo": 1800,
            "hi": 2000,
            "acceptable_lo": 1400,
            "acceptable_hi": 2200,
        },
        "warnings": list(spec.get("warnings") or []),
        "part_bundles": bundles_meta,
        "optimization_debug": {
            "target_ideal_center_kg": trans.get("ideal_center_kg", 1900),
            "target_ideal_band_kg": trans.get("ideal_band_kg", [1800, 2000]),
            "acceptable_band_kg": trans.get("acceptable_band_kg", [1400, 2200]),
            "actual_weight_kg": round(wt, 1),
            "flat_bonus_cost_units": trans.get("flat_bonus_cost_units"),
            "material_bonus_cost_units": trans.get("material_bonus_cost_units"),
            "why_summary_lines": trans.get("summary_lines") or [],
            "batching_decisions": trans.get("decisions") or [],
            "batching_model": trans.get("model"),
        },
    }


def build_island_operational_review(
    project: Dict[str, Any],
    all_pieces: List[Dict[str, Any]],
    body: Dict[str, Any],
) -> Dict[str, Any]:
    """
    body keys: buildings[], floors[], flats[] (each optional; empty = no filter).
    dispatch_selection optional — defaults from project.
    """
    if not operational_planner_enabled():
        raise ValueError(
            "Island operational planner is disabled. Set environment variable PLANNER_V3_OPERATIONAL=1 on the API server."
        )

    dispatch_selection = body.get("dispatch_selection") or project.get("dispatch_selection") or {}
    basis = (dispatch_selection or {}).get("basis", "flat")

    scoped = filter_pieces_by_location(
        all_pieces,
        body.get("buildings"),
        body.get("floors"),
        body.get("flats"),
    )
    if not scoped:
        return {
            "message": "no pieces in scope",
            "crates": [],
            "piece_count": 0,
            "scoped_piece_count": 0,
        }

    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)

    ordered_all = sort_pieces_by_dispatch(all_pieces, dispatch_selection)
    _, _, bundles_full, _ = build_island_bundles_indexed_by_dispatch(
        ordered_all, material, thickness, color, basis
    )

    allowed_ids = {int(p["id"]) for p in scoped}
    filtered_ordered = [p for p in ordered_all if int(p["id"]) in allowed_ids]

    from .bundles import island_bundle_adjacency_sort_key

    by_dk, _, _, _ = build_island_bundles_indexed_by_dispatch(
        filtered_ordered, material, thickness, color, basis
    )

    scoped_bundles: List[Dict[str, Any]] = []
    seen_bid: Set[str] = set()
    for _dk, blist in by_dk.items():
        for b in blist or []:
            bid = str(b.get("bundle_id") or "")
            if bid in seen_bid:
                continue
            seen_bid.add(bid)
            scoped_bundles.append(b)
    scoped_bundles.sort(key=island_bundle_adjacency_sort_key)

    scope_label = _human_scope_label(body)
    dispatch_label = f"Scoped island mix ({scope_label})"

    specs: List[Dict[str, Any]] = []
    serial = 1
    if scoped_bundles:
        ic, serial = pack_phase_a_islands(
            scoped_bundles,
            dispatch_label,
            material,
            thickness,
            color,
            wood,
            serial,
            bundles_full,
            collect_batching_trace=True,
        )
        specs.extend(ic)

    review = [_review_one(s, bundles_full, material, thickness, color) for s in specs]

    out: Dict[str, Any] = {
        "message": "ok",
        "piece_count": len(all_pieces),
        "scoped_piece_count": len(scoped),
        "dispatch_basis": basis,
        "crate_count": len(review),
        "crates": review,
        "batching": {
            "mode": "global_within_scope",
            "scope_label": scope_label,
            "scoped_island_bundle_count": len(scoped_bundles),
            "explanation": (
                "One greedy batching pass over every island PartBundle in the selected scope. "
                "Dispatch / flat is not a hard wall: bundles are sorted by building→floor→flat→bundle_id, "
                "then merged to approach the kg ideal using squared-error cost minus same-flat (1200) and "
                "material-batch (800) cost bonuses."
            ),
        },
    }
    if body.get("include_raw_specs"):
        out["raw_crate_specs"] = specs
    return out


def location_options_from_pieces(pieces: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    buildings = sorted({str(p.get("building") or "").strip() for p in pieces if str(p.get("building") or "").strip()})
    floors = sorted({str(p.get("floor") or "").strip() for p in pieces if str(p.get("floor") or "").strip()})
    flats = sorted({str(p.get("flat") or "").strip() for p in pieces if str(p.get("flat") or "").strip()})
    return {"buildings": buildings, "floors": floors, "flats": flats}
