"""
Recompute v3 crate dimensions / layers / weights after manual assignment changes,
then re-run multi-container layout and persist planner_v3_layout + manual_container_plan.

Checkpoint 4 — instant recalc after bundle/piece moves.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Tuple

from .classify import classify_piece
from .container_layout import linear_manual_sort_placements, optimize_container_load
from .dimensions import (
    horizontal_crate_dimensions,
    island_cassette_dimensions_operational,
    island_vertical_dimensions,
    total_piece_weight,
)
from .engine import _payload_cap_kg
from .packing import TYPE_SPECS, _merge_splash_tiers_for_two_layer_cap
from .persist import enrich_layout_with_crates
from .geometry_gate import count_placed_a_crates
from .phase_a_island import operational_planner_enabled
from .summary_metrics import build_planner_summary

_SPLASH_CHUNK = 4


def _category_for_crate(crate: Dict[str, Any]) -> str:
    fam = str(crate.get("packing_family") or "").strip().lower()
    if fam in TYPE_SPECS:
        return fam
    letter = str(crate.get("planner_v3_crate_class") or "").upper()
    return {"A": "island", "B": "perimeter", "C": "range", "D": "vanity"}.get(letter, "misc")


def _chunk_splashes(splashes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    if not splashes:
        return []
    out: List[List[Dict[str, Any]]] = []
    for i in range(0, len(splashes), _SPLASH_CHUNK):
        out.append(splashes[i : i + _SPLASH_CHUNK])
    return out


def _partition_mains_splashes(pieces: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[List[Dict[str, Any]]]]:
    mains: List[Dict[str, Any]] = []
    splashes: List[Dict[str, Any]] = []
    for p in pieces:
        _, is_sp = classify_piece(p)
        if is_sp:
            splashes.append(p)
        else:
            mains.append(p)
    return mains, _chunk_splashes(splashes)


def _compute_v3_crate_patch(
    crate: Dict[str, Any],
    pieces: List[Dict[str, Any]],
    project: Dict[str, Any],
) -> Dict[str, Any]:
    """Mongo $set fields for a v3 crate from current piece assignments."""
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)

    cat = _category_for_crate(crate)
    spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
    max_kg = float(spec["max_kg"])
    min_kg = float(spec["min_kg"])

    cls = str(crate.get("planner_v3_crate_class") or "D")
    orientation = str(crate.get("planner_v3_orientation") or "horizontal")
    wt = total_piece_weight(pieces, material, thickness, color)

    warnings: List[str] = []
    if wt > max_kg:
        warnings.append(f"Crate exceeds target max {max_kg:.0f} kg ({round(wt)} kg).")
    if pieces and wt < min_kg:
        warnings.append(f"Crate under target min {min_kg:.0f} kg ({round(wt)} kg).")

    band = "ideal" if min_kg <= wt <= max_kg else ("below_ideal" if wt < min_kg else "above_ideal")

    if cls == "A" or orientation == "vertical":
        mains, splash_layers = _partition_mains_splashes(pieces)
        if operational_planner_enabled():
            dims = island_cassette_dimensions_operational(pieces, thickness, wood)
        else:
            dims = island_vertical_dimensions(pieces, thickness, wood)
        splash_ids_layers = [[p["id"] for p in lay] for lay in splash_layers]
        main_ids = [p["id"] for p in mains]
        splash_flat = [p["id"] for lay in splash_layers for p in lay]
    else:
        mains, splash_layers = _partition_mains_splashes(pieces)
        splash_layers = _merge_splash_tiers_for_two_layer_cap(splash_layers, cat, warnings)
        dims = horizontal_crate_dimensions(mains, splash_layers, thickness, wood)
        splash_ids_layers = [[p["id"] for p in lay] for lay in splash_layers]
        main_ids = [p["id"] for p in mains]
        splash_flat = [p["id"] for lay in splash_layers for p in lay]

    sqft = sum(
        (float(p.get("length", 0) or 0) * float(p.get("width", 0) or 0) / 144.0) * max(1, int(p.get("qty", 1) or 1))
        for p in pieces
    )

    return {
        "max_weight": max_kg,
        "internal_length": dims["internal_length"],
        "internal_width": dims["internal_width"],
        "internal_height": dims["internal_height"],
        "external_length": dims["external_length"],
        "external_width": dims["external_width"],
        "external_height": dims["external_height"],
        "wood_thickness": dims.get("wood_thickness", wood),
        "weight": round(wt, 2),
        "sqft": round(sqft, 2),
        "weight_band_status": band,
        "packing_warnings": warnings,
        "main_layer_piece_ids": main_ids,
        "splash_layer_piece_ids": splash_flat,
        "planner_v3_splash_layers": splash_ids_layers,
        "splash_layer": len(splash_flat) > 0,
        "planner_notes": "; ".join(warnings) if warnings else crate.get("planner_notes", ""),
    }


def _layout_spec_from_crate(crate: Dict[str, Any], pieces: List[Dict[str, Any]], project: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal crate dict for optimize_container_load / footprint."""
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")
    wt = total_piece_weight(pieces, material, thickness, color)
    el = float(crate.get("external_length") or 0)
    ew = float(crate.get("external_width") or 0)
    eh = float(crate.get("external_height") or 0)
    if not pieces or el <= 0 or ew <= 0 or eh <= 0:
        el, ew, eh = max(el, 18.0), max(ew, 18.0), max(eh, 18.0)
    return {
        "dimensions": {
            "external_length": el,
            "external_width": ew,
            "external_height": eh,
        },
        "total_weight_kg": wt,
        "crate_class": crate.get("planner_v3_crate_class") or "D",
        "orientation": crate.get("planner_v3_orientation") or "horizontal",
        "name": crate.get("name", ""),
    }


def run_planner_recompute(
    project_id: int,
    project: Dict[str, Any],
    pieces: List[Dict[str, Any]],
    crates: List[Dict[str, Any]],
    assignments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Returns payload for API + mongo writes (caller applies updates).
    """
    pieces_by_id = {p["id"]: p for p in pieces}
    by_crate: Dict[int, List[Dict[str, Any]]] = {}
    for a in assignments:
        pid = a.get("piece_id")
        cid = a.get("crate_id")
        p = pieces_by_id.get(pid)
        if p is None or cid is None:
            continue
        by_crate.setdefault(int(cid), []).append(p)

    crates_sorted = sorted(crates, key=lambda c: (c.get("dispatch_order", 9999), c["id"]))

    crate_updates: List[Tuple[int, Dict[str, Any]]] = []
    merged: List[Dict[str, Any]] = []

    for c in crates_sorted:
        cid = c["id"]
        cpieces = by_crate.get(cid, [])
        row = dict(c)
        if c.get("locked"):
            merged.append(row)
            continue
        if c.get("packing_mode") == "v3" and cpieces:
            patch = _compute_v3_crate_patch(c, cpieces, project)
            crate_updates.append((cid, patch))
            row.update(patch)
        elif c.get("packing_mode") == "v3" and not cpieces:
            # empty v3 crate — keep dims but zero weight
            patch = {
                "weight": 0.0,
                "sqft": 0.0,
                "main_layer_piece_ids": [],
                "splash_layer_piece_ids": [],
                "planner_v3_splash_layers": [],
                "splash_layer": False,
                "packing_warnings": ["Crate has no assigned pieces."],
            }
            crate_updates.append((cid, patch))
            row.update(patch)
        merged.append(row)

    crate_specs = [_layout_spec_from_crate(m, by_crate.get(m["id"], []), project) for m in merged]

    cap = _payload_cap_kg(project)
    locked_any = any(bool(c.get("locked")) for c in crates_sorted)
    stored_containers = project.get("planner_v3_containers") or []
    if not stored_containers and project.get("planner_v3_layout"):
        pl0 = project.get("planner_v3_layout") or {}
        if pl0.get("placements") is not None:
            stored_containers = [pl0]

    if locked_any and stored_containers:
        load_plan = {
            "containers": [deepcopy(c) for c in stored_containers],
            "warnings": [
                "Container slots frozen while at least one crate is locked. Unlock all crates to re-run the fleet optimizer.",
            ],
            "optimization": {
                "chosen_strategy": "frozen",
                "score": None,
                "candidates": [],
            },
        }
    else:
        load_plan = optimize_container_load(crate_specs, max_payload_kg=cap, project=project)

    containers = load_plan.get("containers") or []

    idx_to_crate_id = {i: merged[i].get("crate_id") for i in range(len(merged))}

    manual_plan_containers: List[Dict[str, Any]] = []
    enriched_layouts: List[Dict[str, Any]] = []
    for ci, cont in enumerate(containers):
        if not cont:
            continue
        pls = cont.get("placements") or []
        manual_placements: List[Dict[str, Any]] = []
        sorted_pls = linear_manual_sort_placements(pls, merged)
        for order_idx, pl in enumerate(sorted_pls, start=1):
            try:
                cidx = int(pl.get("crate_index"))
            except (TypeError, ValueError):
                cidx = None
            cid_code = idx_to_crate_id.get(cidx) if cidx is not None else None
            if not cid_code:
                continue
            manual_placements.append({
                "crate_id": cid_code,
                "x": float(pl.get("x", 0) or 0),
                "y": float(pl.get("y", 0) or 0),
                "rotated": bool(pl.get("rotated", False)),
                "stack_level": int(pl.get("stack_level", 0) or 0),
                "loading_order": order_idx,
                "unload_order": max(1, len(sorted_pls) - order_idx + 1),
            })
        ctype = str(cont.get("type") or cont.get("container_type") or "20ft")
        manual_plan_containers.append({
            "id": f"V3-{ctype.upper()}-{project_id}-{ci + 1}",
            "type": ctype,
            "container_id": cont.get("container_id"),
            "placements": manual_placements,
        })
        enriched_layouts.append(enrich_layout_with_crates(cont, merged))

    layout_persist = next(
        (e for e in enriched_layouts if (e.get("placements") or [])),
        enriched_layouts[0] if enriched_layouts else {},
    )
    manual_plan = {"containers": manual_plan_containers}

    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")

    summary_crates: List[Dict[str, Any]] = []
    for m in merged:
        cat = _category_for_crate(m)
        summary_crates.append({
            "category": cat,
            "crate_class": str(m.get("planner_v3_crate_class") or ""),
            "name": str(m.get("crate_id") or m.get("name") or ""),
            "total_weight_kg": float(m.get("weight") or 0),
            "max_weight": float(m.get("max_weight") or TYPE_SPECS.get(cat, TYPE_SPECS["misc"])["max_kg"]),
            "dimensions": {
                "external_length": float(m.get("external_length") or 0),
                "external_width": float(m.get("external_width") or 0),
                "external_height": float(m.get("external_height") or 0),
            },
        })

    indexed_for_islands = [{"crate_class": str(m.get("planner_v3_crate_class") or "")} for m in merged]
    placed_islands = count_placed_a_crates(load_plan, indexed_for_islands)
    first_layout0: Dict[str, Any] = containers[0] if containers else {}
    island_strip_x = None
    if placed_islands > 0 and first_layout0:
        island_strip_x = float(first_layout0.get("linear_island_strip_end_x_in") or 0.0)

    manifest_notes = {
        "placed_island_crate_count": placed_islands,
        "layout_island_strip_end_x_in": island_strip_x,
        "manifest_eligible_crate_count": len(merged),
        "rejected_manifest_crate_count": 0,
    }

    summary = build_planner_summary(
        pieces,
        summary_crates,
        load_plan,
        material=material,
        thickness=thickness,
        color=color,
        rejected_crates=[],
        manifest_notes=manifest_notes,
    )

    top_warnings: List[str] = list(load_plan.get("warnings") or [])
    for w in summary.get("warnings") or []:
        if w not in top_warnings:
            top_warnings.append(w)

    return {
        "crate_updates": crate_updates,
        "manual_plan": manual_plan,
        "layout_persist": layout_persist,
        "enriched_layouts": enriched_layouts,
        "summary": summary,
        "warnings": top_warnings,
        "container_count": len(containers),
        "container_optimization": load_plan.get("optimization"),
        "response": {
            "message": "Planner recalculated",
            "planner_v3": {
                "container": layout_persist,
                "containers": enriched_layouts,
                "summary": summary,
                "suggest_40ft": False,
                "warnings": top_warnings,
                "container_optimization": load_plan.get("optimization"),
            },
        },
    }
