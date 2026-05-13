from typing import Any, Dict, List, Optional, Set, Tuple

from ..planning_engine import piece_weight
from .bundles import island_bundle_adjacency_sort_key
from .classify import build_families, classify_piece, flat_key
from .container_layout import CONTAINER_20FT
from .dimensions import horizontal_crate_dimensions, island_vertical_dimensions, total_piece_weight
from .dispatch import dispatch_group_label, sort_pieces_by_dispatch
from .emit_gate import finalize_emit_gates, needs_merge_absorption
from .phase_a_island import (
    build_island_bundles_indexed_by_dispatch,
    operational_planner_enabled,
    pack_phase_a_islands,
)
from .phase_bc_horizontal import (
    pack_phase_b_kitchen_range_operational,
    pack_phase_c_vanity_operational,
)

SPLASHES_PER_LAYER = 4

# Safety: horizontal B/C/D/misc — max **main-bed** slabs per crate (splashes stack above; do not count toward this split).
_MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE = 10

# Dispatch-batch consolidation uses same cap so sequential_ideal_batches cannot merge units that would exceed mains-per-crate rule at emit.
OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP = _MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE

# Warehouse bands (kg): ``min_kg`` is practical soft floor for batching; ``max_kg`` is hard ceiling.
TYPE_SPECS: Dict[str, Dict[str, Any]] = {
    "island": {"min_kg": 1400, "max_kg": 2200, "letter": "A", "label": "Island (vertical)"},
    "perimeter": {"min_kg": 1100, "max_kg": 2200, "letter": "B", "label": "Perimeter kitchen & splashes"},
    "range": {"min_kg": 700, "max_kg": 1800, "letter": "C", "label": "Range tops & splashes"},
    "vanity": {"min_kg": 600, "max_kg": 1600, "letter": "D", "label": "Vanity tops & splashes"},
    "misc": {"min_kg": 400, "max_kg": 1200, "letter": "D", "label": "Misc / splashes"},
}

def _merge_splash_tiers_for_two_layer_cap(
    splash_layers: List[List[Dict[str, Any]]],
    category: str,
    warnings: List[str],
) -> List[List[Dict[str, Any]]]:
    """Preserve splash tiers — honeycomb separators are modeled in ``horizontal_crate_dimensions``."""
    _ = category, warnings
    return splash_layers


def _piece_order_index(ordered_pieces: List[Dict[str, Any]]) -> Dict[int, int]:
    return {p["id"]: i for i, p in enumerate(ordered_pieces)}


def _family_sort_key(fam: Dict[str, Any], idx: Dict[int, int]) -> int:
    ids = [p["id"] for p in fam["all_pieces"]]
    return min(idx.get(i, 999999) for i in ids)


def _bootstrap_horizontal_planner_debug(category: str, pieces: List[Dict[str, Any]]) -> Dict[str, Any]:
    from .classify import extract_family_prefix, normalize_part_number_token

    fam_ids: List[str] = []
    for p in pieces:
        pn, _ = normalize_part_number_token(str(p.get("part_no") or ""))
        pref, _ = extract_family_prefix(pn)
        if pref and pref not in fam_ids:
            fam_ids.append(pref)
    uk_map = {
        "perimeter": "perimeter_unit",
        "range": "range_unit",
        "vanity": "vanity_unit",
        "misc": "misc_unit",
    }
    return {
        "source_bundle_ids": [],
        "source_family_ids": fam_ids[:48],
        "source_unit_ids": [],
        "unit_kind": uk_map.get(category, "misc_unit"),
        "absorption_history": [],
        "emit_gate_verdict": None,
        "geometry_validation": None,
        "container_placement": None,
        "emit_reason": "horizontal_emit",
    }


def _chunk_splashes(splashes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    if not splashes:
        return []
    layers: List[List[Dict[str, Any]]] = []
    for i in range(0, len(splashes), SPLASHES_PER_LAYER):
        layers.append(splashes[i : i + SPLASHES_PER_LAYER])
    return layers


def _family_weight(fam: Dict[str, Any], material: str, thickness: str, color: str) -> float:
    return total_piece_weight(fam["all_pieces"], material, thickness, color)


def _emit_one_horizontal_crate(
    *,
    letter: str,
    label: str,
    category: str,
    dispatch_group: str,
    serial: int,
    main_pieces: List[Dict[str, Any]],
    splash_layers: List[List[Dict[str, Any]]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    warnings: List[str],
    grouping_extra: str = "",
) -> Dict[str, Any]:
    spl_flat = [p for layer in splash_layers for p in layer]
    pieces = main_pieces + spl_flat
    wt = total_piece_weight(pieces, material, thickness, color)
    spec = TYPE_SPECS.get(category, TYPE_SPECS["misc"])
    lo, hi = spec["min_kg"], spec["max_kg"]
    band = "ideal" if lo <= wt <= hi else ("below_ideal" if wt < lo else "above_ideal")
    if wt > spec["max_kg"]:
        warnings.append(f"Crate {letter}-{serial} exceeds target max {spec['max_kg']} kg ({round(wt)} kg).")

    dims = horizontal_crate_dimensions(main_pieces, splash_layers, thickness, wood_thickness)

    splash_ids_by_layer = [[p["id"] for p in layer] for layer in splash_layers]
    layers_model: List[Dict[str, Any]] = [
        {"role": "main_layer", "layer_index": 0, "piece_ids": [p["id"] for p in main_pieces]},
        {
            "role": "splash_layer",
            "layer_index": 1,
            "sublayers": splash_ids_by_layer,
            "piece_ids": [p["id"] for p in spl_flat],
        },
    ]

    grp = f"{label}; splashes in {len(splash_layers)} layer(s)" if splash_layers else label
    if grouping_extra:
        grp = f"{grp} — {grouping_extra}"

    return {
        "crate_class": letter,
        "crate_type_label": f"[{letter}-Type] {label}",
        "category": category,
        "orientation": "horizontal",
        "serial": serial,
        "dispatch_group": dispatch_group,
        "name": f"[{letter}] {label} — {dispatch_group} #{serial}",
        "pieces": pieces,
        "main_pieces": main_pieces,
        "splash_pieces": spl_flat,
        "splash_layers": [[p["id"] for p in layer] for layer in splash_layers],
        "layers": layers_model,
        "max_weight": float(spec["max_kg"]),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "packing_mode": "v3",
        "grouping_reason": grp,
        "warnings": list(warnings),
        "main_layer_piece_ids": [p["id"] for p in main_pieces],
        "splash_layer_piece_ids": [p["id"] for p in spl_flat],
        "splash_layer": len(splash_layers) > 0,
        "dimensions": dims,
        "planner_debug": _bootstrap_horizontal_planner_debug(category, pieces),
    }


def _emit_horizontal_crates(
    *,
    letter: str,
    label: str,
    category: str,
    dispatch_group: str,
    serial_start: int,
    main_pieces: List[Dict[str, Any]],
    splash_layers: List[List[Dict[str, Any]]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    warnings: List[str],
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Emit one or more horizontal crates. Split only when **main bed** piece count exceeds the cap.
    Splashes stay on the **last** chunk of this emit (same batch), matching warehouse flat-pack rules.
    """
    merged_splash = _merge_splash_tiers_for_two_layer_cap(splash_layers, category, warnings)
    out: List[Dict[str, Any]] = []
    serial = serial_start
    mains = list(main_pieces)

    if len(mains) <= _MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE:
        out.append(
            _emit_one_horizontal_crate(
                letter=letter,
                label=label,
                category=category,
                dispatch_group=dispatch_group,
                serial=serial,
                main_pieces=mains,
                splash_layers=merged_splash,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                warnings=warnings,
            )
        )
        return out, serial + 1

    split_warn = (
        f"EXCEPTION family split: max {_MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE} main-bed slabs per crate — "
        "splashes stacked on the final crate of this batch."
    )
    wsplit = list(warnings) + [split_warn]
    part = 1
    for i in range(0, len(mains), _MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE):
        chunk_mains = mains[i : i + _MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE]
        is_last = i + len(chunk_mains) >= len(mains)
        chunk_splash = merged_splash if is_last else []
        extra = f"mains split part {part}" if len(mains) > _MAX_MAIN_PIECES_PER_HORIZONTAL_CRATE else ""
        out.append(
            _emit_one_horizontal_crate(
                letter=letter,
                label=label,
                category=category,
                dispatch_group=dispatch_group,
                serial=serial,
                main_pieces=chunk_mains,
                splash_layers=chunk_splash,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                warnings=wsplit,
                grouping_extra=extra,
            )
        )
        serial += 1
        part += 1
    return out, serial


def _emit_island_crate(
    *,
    families: List[Dict[str, Any]],
    dispatch_group: str,
    serial: int,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> Dict[str, Any]:
    mains: List[Dict[str, Any]] = []
    spl: List[Dict[str, Any]] = []
    for fam in families:
        mains.extend(fam["main_pieces"])
        spl.extend(fam["splash_pieces"])
    pieces = mains + spl
    wt = total_piece_weight(pieces, material, thickness, color)
    spec = TYPE_SPECS["island"]
    warnings: List[str] = []
    if wt > spec["max_kg"]:
        warnings.append(f"Island crate exceeds {spec['max_kg']} kg ({round(wt)} kg).")
    if wt < spec["min_kg"] and len(pieces) > 0:
        warnings.append(f"Island crate under {spec['min_kg']} kg ({round(wt)} kg) — partial batch.")
    band = "ideal" if spec["min_kg"] <= wt <= spec["max_kg"] else ("below_ideal" if wt < spec["min_kg"] else "above_ideal")

    dims = island_vertical_dimensions(pieces, thickness, wood_thickness)
    letter = spec["letter"]
    label = spec["label"]
    eh = float(dims.get("external_height") or 0)
    h_clear = float(CONTAINER_20FT["max_clear_height"])
    if eh > h_clear + 0.01:
        warnings.append(
            f"EXCEPTION over-height island cassette: external height {eh:.1f} in exceeds "
            f"{h_clear:.1f} in clear — blocked from container placement until geometry is revised."
        )

    return {
        "crate_class": letter,
        "crate_type_label": f"[{letter}-Type] {label}",
        "category": "island",
        "orientation": "vertical",
        "serial": serial,
        "dispatch_group": dispatch_group,
        "name": f"[{letter}] {label} — {dispatch_group} #{serial}",
        "pieces": pieces,
        "main_pieces": mains,
        "splash_pieces": spl,
        "splash_layers": [[p["id"] for p in spl]] if spl else [],
        "max_weight": float(spec["max_kg"]),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "packing_mode": "v3",
        "grouping_reason": "Island vertical cassette",
        "warnings": warnings,
        "main_layer_piece_ids": [p["id"] for p in mains],
        "splash_layer_piece_ids": [p["id"] for p in spl],
        "splash_layer": len(spl) > 0,
        "dimensions": dims,
    }


def _pack_islands(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    island_fams = [f for f in families if f["category"] == "island"]
    island_fams.sort(key=lambda f: _family_sort_key(f, order_idx))
    crates: List[Dict[str, Any]] = []
    serial = serial_start
    cur: List[Dict[str, Any]] = []
    cur_wt = 0.0
    max_kg = TYPE_SPECS["island"]["max_kg"]
    max_slabs = 14

    def flush() -> None:
        nonlocal cur, cur_wt, serial
        if not cur:
            return
        crates.append(
            _emit_island_crate(
                families=cur,
                dispatch_group=dispatch_group,
                serial=serial,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
            )
        )
        serial += 1
        cur = []
        cur_wt = 0.0

    for fam in island_fams:
        fw = _family_weight(fam, material, thickness, color)
        next_ct = sum(len(f["main_pieces"]) + len(f["splash_pieces"]) for f in cur)
        next_ct += len(fam["main_pieces"]) + len(fam["splash_pieces"])
        if cur and (cur_wt + fw > max_kg or next_ct > max_slabs):
            flush()
        cur.append(fam)
        cur_wt += fw
    flush()
    return crates, serial


def _unit_weight(unit: Dict[str, Any], material: str, thickness: str, color: str) -> float:
    flat = [p for layer in unit["splash_layers"] for p in layer]
    return total_piece_weight(unit["mains"] + flat, material, thickness, color)


def _merge_units_batch(batch: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[List[Dict[str, Any]]]]:
    mains: List[Dict[str, Any]] = []
    splash_layers: List[List[Dict[str, Any]]] = []
    for u in batch:
        mains.extend(u["mains"])
        splash_layers.extend(u["splash_layers"])
    return mains, splash_layers


def _horizontal_units_from_families(
    families: List[Dict[str, Any]],
    category: str,
    material: str,
    thickness: str,
    color: str,
    order_idx: Dict[int, int],
) -> List[Dict[str, Any]]:
    """One unit = one packable chunk (family or split) with splashes on the final chunk only."""
    spec = TYPE_SPECS.get(category, TYPE_SPECS["misc"])
    cats = [f for f in families if f["category"] == category]
    cats.sort(key=lambda f: _family_sort_key(f, order_idx))
    units: List[Dict[str, Any]] = []

    for fam in cats:
        mains = list(fam["main_pieces"])
        splashes = list(fam["splash_pieces"])
        splash_layers = _chunk_splashes(splashes)
        wt = total_piece_weight(mains + splashes, material, thickness, color)

        if wt <= spec["max_kg"]:
            units.append({
                "mains": mains,
                "splash_layers": splash_layers,
                "family_category": category,
            })
            continue

        remaining = list(mains)
        while remaining:
            chunk_mains: List[Dict[str, Any]] = []
            chunk_wt = 0.0
            while remaining:
                p = remaining[0]
                pw = piece_weight(p, material, thickness, color)
                if chunk_mains and chunk_wt + pw > spec["max_kg"]:
                    break
                chunk_mains.append(remaining.pop(0))
                chunk_wt += pw
            attach_layers = splash_layers if not remaining else []
            units.append({
                "mains": chunk_mains,
                "splash_layers": attach_layers,
                "family_category": category,
            })

    return units


def _pack_perimeter_range_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """
    B-type: perimeter units first; pull range units to reach 1400–2200 kg and to fill toward max.
    C-type: remaining range units; pull perimeter if needed for 800–1800 kg band.
    """
    p_units = _horizontal_units_from_families(
        families, "perimeter", material, thickness, color, order_idx
    )
    r_units = _horizontal_units_from_families(
        families, "range", material, thickness, color, order_idx
    )
    b_spec = TYPE_SPECS["perimeter"]
    c_spec = TYPE_SPECS["range"]
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while p_units or r_units:
        if p_units:
            batch: List[Dict[str, Any]] = []
            wt = 0.0
            while p_units:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"] and batch:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw

            warnings: List[str] = []
            while r_units and wt < b_spec["min_kg"]:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"]:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw
                warnings.append("Range tops added to reach B-type target weight band.")

            range_fill = False
            while r_units:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"]:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw
                range_fill = True
            if range_fill:
                warnings.append("Additional range tops included to fill B-type crate toward max weight.")

            mains, splash_layers = _merge_units_batch(batch)
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
            crates.extend(emitted)
        else:
            batch = []
            wt = 0.0
            while r_units:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"] and batch:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw

            warnings = []
            while p_units and wt < c_spec["min_kg"]:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"]:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw
                warnings.append("Perimeter kitchens added to reach C-type target weight band.")

            perimeter_fill = False
            while p_units:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"]:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw
                perimeter_fill = True
            if perimeter_fill:
                warnings.append("Additional perimeter kitchens included to fill C-type crate toward max weight.")

            mains, splash_layers = _merge_units_batch(batch)
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
                warnings=warnings,
            )
            crates.extend(emitted)

    return crates, serial


def _pack_vanity_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """Merge multiple vanity families into crates toward 700–1600 kg."""
    spec = TYPE_SPECS["vanity"]
    units = _horizontal_units_from_families(
        families, "vanity", material, thickness, color, order_idx
    )
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while units:
        batch: List[Dict[str, Any]] = []
        wt = 0.0
        while units:
            u = units[0]
            uw = _unit_weight(u, material, thickness, color)
            if wt + uw > spec["max_kg"] and batch:
                break
            units.pop(0)
            batch.append(u)
            wt += uw

        mains, splash_layers = _merge_units_batch(batch)
        warn: List[str] = []
        if len(batch) > 1:
            warn.append("Multiple vanity runs merged to approach D-type target weight.")
        emitted, serial = _emit_horizontal_crates(
            letter=spec["letter"],
            label=spec["label"],
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
        crates.extend(emitted)

    return crates, serial


def _pack_misc_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """Merge misc / orphan splash units into fewer crates up to max_kg (same pattern as vanity)."""
    spec = TYPE_SPECS["misc"]
    units = _horizontal_units_from_families(
        families, "misc", material, thickness, color, order_idx
    )
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while units:
        batch: List[Dict[str, Any]] = []
        wt = 0.0
        while units:
            u = units[0]
            uw = _unit_weight(u, material, thickness, color)
            if wt + uw > spec["max_kg"] and batch:
                break
            units.pop(0)
            batch.append(u)
            wt += uw

        mains, splash_layers = _merge_units_batch(batch)
        warn: List[str] = []
        if len(batch) > 1:
            warn.append("Misc splash pieces merged to reduce small crate count.")
        emitted, serial = _emit_horizontal_crates(
            letter=spec["letter"],
            label=spec["label"],
            category="misc",
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
        crates.extend(emitted)

    return crates, serial


def _can_merge_horiz_absorb(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if str(a.get("orientation") or "") != "horizontal" or str(b.get("orientation") or "") != "horizontal":
        return False
    if a.get("dispatch_group") != b.get("dispatch_group"):
        return False
    if a.get("crate_class") != b.get("crate_class"):
        return False
    return str(a.get("category") or "") == str(b.get("category") or "")


def _merge_horizontal_crates_pair(
    a: Dict[str, Any],
    b: Dict[str, Any],
    *,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> Dict[str, Any]:
    pieces = list(a.get("pieces") or []) + list(b.get("pieces") or [])
    mains: List[Dict[str, Any]] = []
    splashes: List[Dict[str, Any]] = []
    for p in pieces:
        _, is_sp = classify_piece(p)
        if is_sp:
            splashes.append(p)
        else:
            mains.append(p)
    splash_layers = _chunk_splashes(splashes)
    cat = str(a.get("category") or b.get("category") or "misc")
    spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
    letter = str(spec["letter"])
    label = str(spec["label"])
    dispatch_group = str(a.get("dispatch_group") or b.get("dispatch_group") or "")
    serial = int(a.get("serial") or b.get("serial") or 1)
    merged_warn = list(a.get("warnings") or []) + list(b.get("warnings") or [])
    merged_warn.append("Underweight absorption: merged adjacent crates in same dispatch/class.")
    da = dict(a.get("planner_debug") or {})
    db = dict(b.get("planner_debug") or {})
    hist = list(da.get("absorption_history") or [])
    hist.append(
        {
            "action": "merge_horizontal_pair",
            "guest_serial": b.get("serial"),
            "guest_bundle_ids": db.get("source_bundle_ids") or [],
            "guest_family_ids": db.get("source_family_ids") or [],
        }
    )
    merged_dbg = {
        **da,
        "absorption_history": hist + list(db.get("absorption_history") or []),
        "source_bundle_ids": sorted({
            str(x) for x in ((da.get("source_bundle_ids") or []) + (db.get("source_bundle_ids") or []))
            if x is not None and str(x) != ""
        }),
        "source_family_ids": sorted({
            str(x) for x in ((da.get("source_family_ids") or []) + (db.get("source_family_ids") or []))
            if x is not None and str(x) != ""
        }),
        "source_unit_ids": sorted({
            str(x) for x in ((da.get("source_unit_ids") or []) + (db.get("source_unit_ids") or []))
            if x is not None and str(x) != ""
        }),
    }
    cr = _emit_one_horizontal_crate(
        letter=letter,
        label=label,
        category=cat,
        dispatch_group=dispatch_group,
        serial=serial,
        main_pieces=mains,
        splash_layers=splash_layers,
        material=material,
        thickness=thickness,
        color=color,
        wood_thickness=wood_thickness,
        warnings=merged_warn,
    )
    pb_a = a.get("part_bundles") or []
    pb_b = b.get("part_bundles") or []
    if pb_a or pb_b:
        cr["part_bundles"] = list(pb_a) + list(pb_b)
    if a.get("phase_lock"):
        cr["phase_lock"] = a.get("phase_lock")
    cr["planner_debug"] = merged_dbg
    return cr


def _absorb_underweight_pass(
    crates: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    i = 0
    while i < len(crates):
        c = crates[i]
        cat = str(c.get("category") or "misc")
        letter = str(c.get("crate_class") or "")
        spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
        wt = float(c.get("total_weight_kg") or 0)
        if (
            letter in ("B", "C", "D")
            and wt > 0
            and wt < float(spec["min_kg"])
            and i + 1 < len(crates)
            and _can_merge_horiz_absorb(c, crates[i + 1])
        ):
            nxt = crates[i + 1]
            nw = float(nxt.get("total_weight_kg") or 0)
            max_k = max(float(c.get("max_weight") or spec["max_kg"]), float(nxt.get("max_weight") or spec["max_kg"]))
            if wt + nw <= max_k + 0.01:
                out.append(
                    _merge_horizontal_crates_pair(
                        c,
                        nxt,
                        material=material,
                        thickness=thickness,
                        color=color,
                        wood_thickness=wood_thickness,
                    )
                )
                i += 2
                continue
        out.append(c)
        i += 1
    return out


def _finalize_weight_bands(
    crates: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    cur = crates
    while True:
        nxt = _absorb_underweight_pass(cur, material, thickness, color, wood_thickness)
        if len(nxt) == len(cur) and all(a is b for a, b in zip(nxt, cur)):
            cur = nxt
            break
        cur = nxt
    for c in cur:
        cat = str(c.get("category") or "misc")
        spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
        wt = float(c.get("total_weight_kg") or 0)
        if wt <= 0:
            continue
        if wt < float(spec["min_kg"]) or wt > float(spec["max_kg"]):
            w = list(c.get("warnings") or [])
            msg = f"EXCEPTION weight band: {round(wt)} kg vs target {spec['min_kg']}–{spec['max_kg']} kg ({cat})."
            if msg not in w:
                w.append(msg)
            c["warnings"] = w
    return cur


_HOST_ABS_RANK = {"perimeter": 0, "range": 1, "vanity": 2}


def _crate_anchor_flat_key(crate: Dict[str, Any]) -> str:
    for p in crate.get("main_pieces") or []:
        return flat_key(p)
    for p in crate.get("pieces") or []:
        return flat_key(p)
    return ""


def _cross_category_misc_absorption(
    crates: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    """Merge small/misc horizontal crates into B/C/D hosts same dispatch (same-flat preference)."""
    from .emit_gate import needs_merge_absorption

    cur = list(crates)
    note = "Remainder absorption: misc merged into compatible perimeter/range/vanity crate same dispatch."
    while True:
        merged_once = False
        for i, guest in enumerate(cur):
            if str(guest.get("category") or "") != "misc":
                continue
            if str(guest.get("orientation") or "") != "horizontal":
                continue
            if guest.get("planner_v3_geometry_blocked"):
                continue
            gw = float(guest.get("total_weight_kg") or 0)
            if gw <= 0:
                continue
            gf = _crate_anchor_flat_key(guest)
            best_key = None
            best_j: Optional[int] = None
            for j, host in enumerate(cur):
                if i == j:
                    continue
                hc = str(host.get("category") or "")
                if hc not in _HOST_ABS_RANK:
                    continue
                if str(host.get("orientation") or "") != "horizontal":
                    continue
                if host.get("dispatch_group") != guest.get("dispatch_group"):
                    continue
                if host.get("planner_v3_geometry_blocked"):
                    continue
                hw = float(host.get("total_weight_kg") or 0)
                spec = TYPE_SPECS.get(hc, TYPE_SPECS["misc"])
                max_k = max(float(host.get("max_weight") or spec["max_kg"]), float(spec["max_kg"]))
                if hw + gw > max_k + 0.01:
                    continue
                hf = _crate_anchor_flat_key(host)
                tier_flat = 0 if gf and hf and gf == hf else 1
                want_fill = 0 if needs_merge_absorption(host) else 1
                cat_rank = _HOST_ABS_RANK[hc]
                headroom = max_k - hw - gw
                cand_key = (tier_flat, want_fill, cat_rank, -headroom)
                if best_key is None or cand_key < best_key:
                    best_key = cand_key
                    best_j = j
            if best_j is None:
                continue
            host = cur[best_j]
            merged = _merge_horizontal_crates_pair(
                host,
                guest,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
            )
            wlist = list(merged.get("warnings") or [])
            if note not in wlist:
                wlist.append(note)
            merged["warnings"] = wlist
            hi, lo = max(i, best_j), min(i, best_j)
            cur.pop(hi)
            cur.pop(lo)
            cur.insert(lo, merged)
            merged_once = True
            break
        if not merged_once:
            return cur


def _forward_absorption_until_stable(
    crates: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    """Second-pass merge: absorb underfilled / soft-underweight horizontals into later compatible units (same dispatch)."""
    cur = list(crates)
    note = (
        "Dispatch-batch absorption: merged underfilled / underweight crate with later compatible unit "
        "(remainder absorption pass)."
    )
    while True:
        merged_once = False
        for i in range(len(cur)):
            c = cur[i]
            if c.get("planner_v3_geometry_blocked"):
                continue
            if str(c.get("orientation") or "") != "horizontal":
                continue
            if not needs_merge_absorption(c):
                continue
            cat = str(c.get("category") or "misc")
            spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
            wt = float(c.get("total_weight_kg") or 0)
            for j in range(i + 1, len(cur)):
                b = cur[j]
                if not _can_merge_horiz_absorb(c, b):
                    continue
                nw = float(b.get("total_weight_kg") or 0)
                max_k = max(
                    float(c.get("max_weight") or spec["max_kg"]),
                    float(b.get("max_weight") or spec["max_kg"]),
                )
                if wt + nw > max_k + 0.01:
                    continue
                merged = _merge_horizontal_crates_pair(
                    c,
                    b,
                    material=material,
                    thickness=thickness,
                    color=color,
                    wood_thickness=wood_thickness,
                )
                wlist = list(merged.get("warnings") or [])
                if note not in wlist:
                    wlist.append(note)
                merged["warnings"] = wlist
                cur = cur[:i] + [merged] + cur[i + 1 : j] + cur[j + 1 :]
                merged_once = True
                break
            if merged_once:
                break
        if not merged_once:
            return cur


def _finalize_emit_pipeline(
    crates: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    cur = _finalize_weight_bands(crates, material, thickness, color, wood_thickness)
    cur = _forward_absorption_until_stable(cur, material, thickness, color, wood_thickness)
    cur = _cross_category_misc_absorption(cur, material, thickness, color, wood_thickness)
    finalize_emit_gates(cur)
    return cur


def _renumber_serials(crates: List[Dict[str, Any]]) -> None:
    for i, c in enumerate(crates, start=1):
        c["serial"] = i


def _group_families_by_dispatch(
    families: List[Dict[str, Any]], basis: str
) -> "OrderedDict[str, List[Dict[str, Any]]]":
    from collections import OrderedDict

    grouped: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
    for fam in families:
        ref = fam["main_pieces"][0] if fam["main_pieces"] else fam["splash_pieces"][0]
        dk = dispatch_group_label(ref, basis)
        grouped.setdefault(dk, []).append(fam)
    return grouped


def _dispatch_key_order(pieces: List[Dict[str, Any]], basis: str) -> List[str]:
    order: List[str] = []
    seen = set()
    for p in pieces:
        dk = dispatch_group_label(p, basis)
        if dk not in seen:
            seen.add(dk)
            order.append(dk)
    return order


def build_crates(
    pieces: List[Dict[str, Any]],
    project: Dict[str, Any],
    dispatch_selection: Dict[str, Any],
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = project.get("stone_color", "") or ""

    ordered = sort_pieces_by_dispatch(pieces, dispatch_selection)
    basis = (dispatch_selection or {}).get("basis", "flat")
    order_idx = _piece_order_index(ordered)

    # --- Operational Phase A (bundles + island cassette) — PLANNER_V3_OPERATIONAL=1 ---
    if operational_planner_enabled():
        by_dk, island_ids, bundles_all, _flat_index = build_island_bundles_indexed_by_dispatch(
            ordered, material, thickness, color, basis
        )
        remaining = [p for p in ordered if p["id"] not in island_ids]
        families_rem = build_families(remaining)
        grouped = _group_families_by_dispatch(families_rem, basis)
        dk_order = _dispatch_key_order(ordered, basis)

        all_crates: List[Dict[str, Any]] = []
        serial = 1

        # One global island greedy pass across all dispatch keys (same-flat / material are soft merge bonuses only).
        all_ib: List[Dict[str, Any]] = []
        seen_bid: Set[str] = set()
        for dispatch_group in dk_order:
            for b in by_dk.get(dispatch_group, []) or []:
                bid = str(b.get("bundle_id") or "")
                if bid in seen_bid:
                    continue
                seen_bid.add(bid)
                all_ib.append(b)
        all_ib.sort(key=island_bundle_adjacency_sort_key)
        if all_ib:
            ic, serial = pack_phase_a_islands(
                all_ib,
                "Island mix (operational global)",
                material,
                thickness,
                color,
                wood_thickness,
                serial,
                bundles_all,
            )
            all_crates.extend(ic)

        for dispatch_group in dk_order:
            fams = grouped.get(dispatch_group, [])
            pr, serial = pack_phase_b_kitchen_range_operational(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(pr)
            vb, serial = pack_phase_c_vanity_operational(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(vb)
            mc, serial = _pack_misc_bins(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(mc)

        all_crates = _finalize_emit_pipeline(all_crates, material, thickness, color, wood_thickness)
        _renumber_serials(all_crates)
        return all_crates

    # --- Legacy v3 (family-based island pack) ---
    grouped = _group_families_by_dispatch(build_families(ordered), basis)

    all_crates = []
    serial = 1
    for dispatch_group, fams in grouped.items():
        ic, serial = _pack_islands(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(ic)
        pr, serial = _pack_perimeter_range_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(pr)
        vb, serial = _pack_vanity_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(vb)
        mc, serial = _pack_misc_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(mc)

    all_crates = _finalize_emit_pipeline(all_crates, material, thickness, color, wood_thickness)
    _renumber_serials(all_crates)
    return all_crates
