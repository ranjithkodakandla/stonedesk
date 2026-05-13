"""
Checkpoint 2 — Phase B (perimeter kitchen + range merge) and Phase C (vanity), operational path only.
Uses PartBundle-shaped rows + sequential ideal-weight batching (lazy-imports packing helpers).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

_IDEAL_PERIMETER_KG = 1900.0
_IDEAL_RANGE_KG = 1300.0
_IDEAL_VANITY_KG = 1150.0


def _unit_anchor_piece(u: Dict[str, Any]) -> Dict[str, Any]:
    """Location / sort reference — first main, else first splash (splash-only units)."""
    mains = u.get("mains") or []
    if mains:
        return mains[0]
    for lay in u.get("splash_layers") or []:
        for p in lay:
            return p
    return {}


def pack_phase_b_kitchen_range_operational(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    from ..planning_engine import sortable_token

    from .adjacency import adjacency_tier
    from .bundles import build_horizontal_bundles_from_families, horizontal_bundle_whole_units
    from .geometry_compat import range_into_kitchen_geometry_ok
    from .classify import flat_key
    from .packing import (
        OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP,
        TYPE_SPECS,
        _emit_horizontal_crates,
        _merge_units_batch,
        _unit_weight,
    )
    from .scored_packing import sequential_ideal_batches

    b_spec = TYPE_SPECS["perimeter"]
    c_spec = TYPE_SPECS["range"]

    p_bundles = build_horizontal_bundles_from_families(families, "perimeter", material, thickness, color)
    r_bundles = build_horizontal_bundles_from_families(families, "range", material, thickness, color)

    p_units: List[Dict[str, Any]] = []
    for b in p_bundles:
        p_units.extend(horizontal_bundle_whole_units(b, "perimeter", material, thickness, color))

    r_units: List[Dict[str, Any]] = []
    for b in r_bundles:
        r_units.extend(horizontal_bundle_whole_units(b, "range", material, thickness, color))

    def enrich_unit(u: Dict[str, Any]) -> Dict[str, Any]:
        ref = _unit_anchor_piece(u)
        fk = flat_key(ref)
        mb = str(ref.get("stone_color") or "").strip() or color
        tw = _unit_weight(u, material, thickness, color)
        out = dict(u)
        out["flat_key"] = fk
        out["building"] = str(ref.get("building") or "").strip()
        out["floor"] = str(ref.get("floor") or "").strip()
        out["flat"] = str(ref.get("flat") or "").strip()
        out["material_batch_key"] = mb
        out["total_weight_kg"] = round(tw, 1)
        return out

    p_units = [enrich_unit(u) for u in p_units]
    r_units = [enrich_unit(u) for u in r_units]

    def unit_fifo_sort_key(u: Dict[str, Any]):
        ref = _unit_anchor_piece(u)
        ids = [p["id"] for p in u["mains"]] + [p["id"] for lay in u["splash_layers"] for p in lay]
        return (
            sortable_token(ref.get("building")),
            sortable_token(ref.get("floor")),
            sortable_token(ref.get("flat")),
            u.get("flat_key") or "",
            min(order_idx.get(i, 999999) for i in ids) if ids else 999999,
        )

    p_units.sort(key=unit_fifo_sort_key)
    r_units.sort(key=unit_fifo_sort_key)

    r_available = list(r_units)

    def unit_adj_ref(u: Dict[str, Any]) -> Dict[str, Any]:
        m = _unit_anchor_piece(u)
        return {
            "building": m.get("building"),
            "floor": m.get("floor"),
            "flat": m.get("flat"),
            "flat_key": u.get("flat_key"),
            "bundle_id": str(u.get("bundle_id") or ""),
        }

    _main_slots = lambda u: len(u.get("mains") or [])

    p_batches = sequential_ideal_batches(
        p_units,
        weight_fn=lambda u: float(u["total_weight_kg"]),
        min_kg=float(b_spec["min_kg"]),
        max_kg=float(b_spec["max_kg"]),
        ideal_kg=_IDEAL_PERIMETER_KG,
        same_flat_key_fn=lambda u: u.get("flat_key") or "",
        material_key_fn=lambda u: u.get("material_batch_key") or "",
        main_sum_fn=_main_slots,
        main_cap=OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP,
    )

    crates: List[Dict[str, Any]] = []
    serial = serial_start

    for batch in p_batches:
        warnings: List[str] = []
        batch_list = list(batch)
        wt = sum(float(u["total_weight_kg"]) for u in batch_list)
        ref_d = unit_adj_ref(batch_list[0])

        def r_sort_key(u: Dict[str, Any]):
            return adjacency_tier(ref_d, unit_adj_ref(u))

        while wt < float(b_spec["min_kg"]) and r_available:
            r_sorted = sorted(r_available, key=r_sort_key)
            placed = False
            for u in r_sorted:
                uw = float(u["total_weight_kg"])
                if wt + uw <= float(b_spec["max_kg"]):
                    if not range_into_kitchen_geometry_ok(
                        batch_list, u, default_thickness=thickness, wood_thickness=wood_thickness
                    ):
                        continue
                    batch_list.append(u)
                    wt += uw
                    r_available.remove(u)
                    warnings.append("Range tops added to reach B-type target weight band.")
                    placed = True
                    break
            if not placed:
                break

        while wt < _IDEAL_PERIMETER_KG and r_available:
            r_sorted = sorted(r_available, key=r_sort_key)
            placed = False
            for u in r_sorted:
                uw = float(u["total_weight_kg"])
                if wt + uw > float(b_spec["max_kg"]):
                    continue
                tier = adjacency_tier(ref_d, unit_adj_ref(u))[0]
                if tier > 2:
                    continue
                if not range_into_kitchen_geometry_ok(
                    batch_list, u, default_thickness=thickness, wood_thickness=wood_thickness
                ):
                    continue
                batch_list.append(u)
                wt += uw
                r_available.remove(u)
                warnings.append(
                    "Range tops merged into kitchen crate — under ideal weight; adjacency preferred."
                )
                placed = True
                break
            if not placed:
                break

        mains, splash_layers = _merge_units_batch(batch_list)
        bids = list({u.get("bundle_id") for u in batch_list if u.get("bundle_id")})
        emitted, serial = _emit_horizontal_crates(
            letter=b_spec["letter"],
            label=b_spec["label"],
            category="perimeter",
            dispatch_group=dispatch_group,
            serial_start=serial,
            main_pieces=mains,
            splash_layers=splash_layers,
            material=material,
            thickness=thickness,
            color=color,
            wood_thickness=wood_thickness,
            warnings=warnings,
        )
        for cr in emitted:
            cr["phase_lock"] = "B"
            cr["part_bundles"] = [{"bundle_id": bid} for bid in bids]
            cr.setdefault("planner_debug", {})["source_bundle_ids"] = [str(x) for x in bids if x]
        crates.extend(emitted)

    if r_available:
        r_ordered = sorted(r_available, key=unit_fifo_sort_key)
        r_batches = sequential_ideal_batches(
            r_ordered,
            weight_fn=lambda u: float(u["total_weight_kg"]),
            min_kg=float(c_spec["min_kg"]),
            max_kg=float(c_spec["max_kg"]),
            ideal_kg=_IDEAL_RANGE_KG,
            same_flat_key_fn=lambda u: u.get("flat_key") or "",
            material_key_fn=lambda u: u.get("material_batch_key") or "",
            main_sum_fn=_main_slots,
            main_cap=OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP,
        )
        for rb in r_batches:
            mains, splash_layers = _merge_units_batch(rb)
            bids = list({u.get("bundle_id") for u in rb if u.get("bundle_id")})
            emitted, serial = _emit_horizontal_crates(
                letter=c_spec["letter"],
                label=c_spec["label"],
                category="range",
                dispatch_group=dispatch_group,
                serial_start=serial,
                main_pieces=mains,
                splash_layers=splash_layers,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                warnings=[],
            )
            for cr in emitted:
                cr["phase_lock"] = "B"
                cr["part_bundles"] = [{"bundle_id": bid} for bid in bids]
                cr.setdefault("planner_debug", {})["source_bundle_ids"] = [str(x) for x in bids if x]
            crates.extend(emitted)

    return crates, serial


def pack_phase_c_vanity_operational(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    from ..planning_engine import sortable_token

    from .bundles import build_horizontal_bundles_from_families, horizontal_bundle_whole_units
    from .classify import flat_key
    from .packing import (
        OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP,
        TYPE_SPECS,
        _emit_horizontal_crates,
        _merge_units_batch,
        _unit_weight,
    )
    from .scored_packing import sequential_ideal_batches

    v_spec = TYPE_SPECS["vanity"]

    v_bundles = build_horizontal_bundles_from_families(families, "vanity", material, thickness, color)

    v_units: List[Dict[str, Any]] = []
    for b in v_bundles:
        v_units.extend(horizontal_bundle_whole_units(b, "vanity", material, thickness, color))

    def enrich_unit(u: Dict[str, Any]) -> Dict[str, Any]:
        ref = _unit_anchor_piece(u)
        fk = flat_key(ref)
        mb = str(ref.get("stone_color") or "").strip() or color
        tw = _unit_weight(u, material, thickness, color)
        out = dict(u)
        out["flat_key"] = fk
        out["material_batch_key"] = mb
        out["total_weight_kg"] = round(tw, 1)
        return out

    v_units = [enrich_unit(u) for u in v_units]

    def unit_fifo_sort_key(u: Dict[str, Any]):
        ref = _unit_anchor_piece(u)
        ids = [p["id"] for p in u["mains"]] + [p["id"] for lay in u["splash_layers"] for p in lay]
        return (
            sortable_token(ref.get("building")),
            sortable_token(ref.get("floor")),
            sortable_token(ref.get("flat")),
            u.get("flat_key") or "",
            min(order_idx.get(i, 999999) for i in ids) if ids else 999999,
        )

    v_units.sort(key=unit_fifo_sort_key)

    _v_main_slots = lambda u: len(u.get("mains") or [])

    v_batches = sequential_ideal_batches(
        v_units,
        weight_fn=lambda u: float(u["total_weight_kg"]),
        min_kg=float(v_spec["min_kg"]),
        max_kg=float(v_spec["max_kg"]),
        ideal_kg=_IDEAL_VANITY_KG,
        same_flat_key_fn=lambda u: u.get("flat_key") or "",
        material_key_fn=lambda u: u.get("material_batch_key") or "",
        main_sum_fn=_v_main_slots,
        main_cap=OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP,
    )

    crates: List[Dict[str, Any]] = []
    serial = serial_start

    for vb in v_batches:
        mains, splash_layers = _merge_units_batch(vb)
        bids = list({u.get("bundle_id") for u in vb if u.get("bundle_id")})
        warn: List[str] = []
        if len(vb) > 1:
            warn.append("Multiple vanity runs merged toward ideal D-type weight.")
        emitted, serial = _emit_horizontal_crates(
            letter=v_spec["letter"],
            label=v_spec["label"],
            category="vanity",
            dispatch_group=dispatch_group,
            serial_start=serial,
            main_pieces=mains,
            splash_layers=splash_layers,
            material=material,
            thickness=thickness,
            color=color,
            wood_thickness=wood_thickness,
            warnings=warn,
        )
        for cr in emitted:
            cr["phase_lock"] = "C"
            cr["part_bundles"] = [{"bundle_id": bid} for bid in bids]
            cr.setdefault("planner_debug", {})["source_bundle_ids"] = [str(x) for x in bids if x]
        crates.extend(emitted)

    return crates, serial
