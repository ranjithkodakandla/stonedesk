from typing import Any, Dict, List, Optional, Tuple

# 20ft / 40ft interior working limits (inches / kg nominal) — payload cap passed separately
CONTAINER_20FT = {
    "max_length": 233.0,
    "max_width": 92.0,
    "max_clear_height": 100.0,
    "max_kg": 24000.0,
}
CONTAINER_40FT = {
    "max_length": 470.0,
    "max_width": 92.0,
    "max_clear_height": 100.0,
    "max_kg": 24000.0,
}
GAP = 3.0
_GRID_STEP = 3.0


def _overlap(ax: float, ay: float, al: float, aw: float, bx: float, by: float, bl: float, bw: float) -> bool:
    return not (ax + al <= bx or bx + bl <= ax or ay + aw <= by or by + bw <= ay)


def _crate_footprint(crate: Dict[str, Any]) -> Tuple[float, float, float]:
    """Returns (floor depth along container x, floor width along y, stack height)."""
    el = float(crate["dimensions"]["external_length"])
    ew = float(crate["dimensions"]["external_width"])
    eh = float(crate["dimensions"]["external_height"])
    return el, ew, eh


def _rects_overlap_floor(
    ax: float, ay: float, al: float, aw: float, rects: List[Dict[str, float]],
) -> bool:
    for r in rects:
        if _overlap(ax, ay, al, aw, r["x"], r["y"], r["fl"], r["fw"]):
            return True
    return False


def _find_floor_slot(
    *,
    fl: float,
    fw: float,
    L: float,
    W: float,
    x_min: float,
    occupied: List[Dict[str, float]],
) -> Optional[Tuple[float, float]]:
    x_max = L - fl
    y_max = W - fw
    if x_max < x_min - 0.01 or y_max < -0.01:
        return None
    x = x_min
    while x <= x_max + 0.01:
        y = 0.0
        while y <= y_max + 0.01:
            if not _rects_overlap_floor(x, y, fl, fw, occupied):
                return round(x, 1), round(y, 1)
            y += _GRID_STEP
        x += _GRID_STEP
    return None


def linear_manual_sort_placements(
    placements: List[Dict[str, Any]],
    merged_crates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Physical load order: horizontal crates (B/C/D) first, then islands (A); within each group by x then y.
    Used for manual_container_plan loading_order / unload_order.
    """

    def sort_key(pl: Dict[str, Any]) -> Tuple[int, float, float]:
        ci = pl.get("crate_index")
        is_island = 0
        try:
            if ci is not None and 0 <= int(ci) < len(merged_crates):
                if str(merged_crates[int(ci)].get("planner_v3_crate_class") or "").upper() == "A":
                    is_island = 1
        except (TypeError, ValueError):
            pass
        return (is_island, float(pl.get("x", 0) or 0), float(pl.get("y", 0) or 0))

    return sorted(placements, key=sort_key)


def _merge_interior(base: Dict[str, float], override: Optional[Dict[str, Any]]) -> Dict[str, float]:
    out = dict(base)
    if not override:
        return out
    for k in ("max_length", "max_width", "max_clear_height", "max_kg"):
        if k in override and override[k] is not None:
            try:
                out[k] = float(override[k])
            except (TypeError, ValueError):
                pass
    return out


def layout_in_container(
    crate_specs: List[Dict[str, Any]],
    max_payload_kg: Optional[float] = None,
    interior: Optional[Dict[str, Any]] = None,
    crate_index_base: int = 0,
) -> Dict[str, Any]:
    """
    Single-container **single-layer** floor plan (no stacking).

    Loading sequence (stone warehouse):
    - B/C/D horizontal crates first from the **back wall** (low x), filling the floor.
    - Class A (vertical island) crates **after**, in dispatch order, starting just forward of the
      horizontal block — progressing toward the **door end** (high x).
    """
    box = _merge_interior(CONTAINER_20FT, interior)
    L = box["max_length"]
    W = box["max_width"]
    H_MAX = box["max_clear_height"]
    default_cap = float(CONTAINER_20FT["max_kg"])
    cap = float(max_payload_kg) if max_payload_kg is not None else default_cap
    if cap < 5000:
        cap = default_cap
    cap = max(20000.0, min(32000.0, cap))
    MAX_KG = cap

    horiz = [c for c in crate_specs if c.get("crate_class") != "A"]
    islands = [c for c in crate_specs if c.get("crate_class") == "A"]

    placements: List[Dict[str, Any]] = []
    warnings: List[str] = [
        "Single-layer floor — B/C/D from back wall (low x), islands toward doors (high x); no crate-on-crate stacking."
    ]
    total_kg = sum(float(c.get("total_weight_kg", 0) or 0) for c in crate_specs)

    occupied: List[Dict[str, float]] = []
    unplaced: List[int] = []

    def place_one(idx: int, _c: Dict[str, Any], x: float, y: float, fl: float, fw: float, ch: float) -> None:
        placements.append({
            "crate_index": idx,
            "x": x,
            "y": y,
            "floor_l": fl,
            "floor_w": fw,
            "stack_level": 0,
            "rotated": False,
            "height_in": round(ch, 1),
            "elevation_in": 0.0,
        })
        occupied.append({"x": x, "y": y, "fl": fl, "fw": fw})

    # --- Phase 1: B / C / D from back wall (x ≈ 0) ---
    for c in horiz:
        idx = crate_index_base + crate_specs.index(c)
        fl, fw, ch = _crate_footprint(c)
        if ch > H_MAX + 0.01:
            warnings.append(
                f"Crate {c.get('name', '')} height {round(ch, 1)} in exceeds clear height {H_MAX} in — review vertical clearance."
            )
        slot = _find_floor_slot(fl=fl, fw=fw, L=L, W=W, x_min=0.0, occupied=occupied)
        if slot is None:
            unplaced.append(idx)
            warnings.append(
                f"Crate index {idx} ({c.get('name', '')}) did not fit single-layer floor — use larger equipment or split."
            )
            continue
        place_one(idx, c, slot[0], slot[1], fl, fw, ch)

    horiz_extent = 0.0
    for r in occupied:
        horiz_extent = max(horiz_extent, r["x"] + r["fl"])

    gap_applied = 0.0
    island_phase_ok = not bool(islands)

    # --- Phase 2: Islands (A) after horizontals; gap is dynamic (try GAP then 0) before unplaced ---
    if islands:
        gap_options = (GAP, 0.0) if occupied else (0.0,)
        for i, gap_try in enumerate(gap_options):
            occ_try = [dict(r) for r in occupied]
            pl_try = [dict(p) for p in placements]
            x_min_strip = horiz_extent + (gap_try if occupied else 0.0)
            failed = False
            for c in islands:
                idx = crate_index_base + crate_specs.index(c)
                fl, fw, ch = _crate_footprint(c)
                if ch > H_MAX + 0.01:
                    warnings.append(
                        f"Crate {c.get('name', '')} height {round(ch, 1)} in exceeds clear height {H_MAX} in — review vertical clearance."
                    )
                slot = _find_floor_slot(fl=fl, fw=fw, L=L, W=W, x_min=x_min_strip, occupied=occ_try)
                if slot is None:
                    failed = True
                    break
                pl_try.append({
                    "crate_index": idx,
                    "x": slot[0],
                    "y": slot[1],
                    "floor_l": fl,
                    "floor_w": fw,
                    "stack_level": 0,
                    "rotated": False,
                    "height_in": round(ch, 1),
                    "elevation_in": 0.0,
                })
                occ_try.append({"x": slot[0], "y": slot[1], "fl": fl, "fw": fw})
            if not failed:
                placements = pl_try
                occupied = occ_try
                gap_applied = gap_try if occupied else 0.0
                island_phase_ok = True
                if gap_try == 0.0 and i > 0 and occupied:
                    warnings.append(
                        f"Horizontal/island separation gap reduced to 0″ (nominal {GAP:.0f}″) so all crates fit within the container interior."
                    )
                break
        if not island_phase_ok:
            for c in islands:
                idx = crate_index_base + crate_specs.index(c)
                unplaced.append(idx)
            warnings.append(
                "Island (A) crates could not be placed on the floor even with zero gap after the horizontal block — split loads or use a longer container."
            )

    used_len = 0.0
    used_w = 0.0
    for pl in placements:
        used_len = max(used_len, pl["x"] + pl["floor_l"])
        used_w = max(used_w, pl["y"] + pl["floor_w"])

    floor_area = L * W
    bbox_area = max(0.0, used_len * used_w)
    length_util = round(100.0 * used_len / L, 1) if L else 0.0
    weight_util = round(100.0 * total_kg / MAX_KG, 1) if MAX_KG else 0.0
    floor_util_approx = round(100.0 * bbox_area / floor_area, 1) if floor_area else 0.0

    suggest_40ft = False
    ctype = "40ft" if interior and float(interior.get("max_length") or 0) >= 400 else "20ft"
    if ctype == "20ft" and total_kg < MAX_KG * 0.92 and (length_util < 72 or unplaced or weight_util < 75):
        suggest_40ft = bool(unplaced or length_util < 65)
    if unplaced:
        suggest_40ft = True

    if total_kg > MAX_KG:
        warnings.append(
            f"Total in this container {round(total_kg)} kg exceeds {int(MAX_KG):,} kg payload cap — split load."
        )

    remaining_payload = max(0.0, MAX_KG - total_kg)
    remaining_floor = max(0.0, floor_area - bbox_area)

    if not islands:
        island_strip_start = round(L, 1)
    elif island_phase_ok:
        island_strip_start = round(horiz_extent + gap_applied, 1)
    else:
        island_strip_start = round(horiz_extent, 1)

    return {
        "container_type": ctype,
        "container_interior_in": {"length": L, "width": W, "max_clear_height": H_MAX},
        "placements": placements,
        "unplaced_crate_indices": unplaced,
        "total_weight_kg": round(total_kg, 1),
        "max_weight_kg": MAX_KG,
        "used_length_in": round(used_len, 1),
        "used_width_in": round(used_w, 1),
        "length_utilization_pct": length_util,
        "weight_utilization_pct": weight_util,
        "floor_utilization_pct_approx": floor_util_approx,
        "remaining_payload_kg": round(remaining_payload, 1),
        "remaining_floor_area_sq_in_approx": round(remaining_floor, 1),
        "suggest_40ft": suggest_40ft,
        "warnings": warnings,
        "single_layer_floor": True,
        "linear_horiz_block_end_x_in": round(horiz_extent, 1),
        "linear_island_strip_start_x_in": island_strip_start,
        "horizontal_to_island_gap_in": round(gap_applied, 1) if islands and island_phase_ok else None,
        "loading_model": "linear_back_to_doors_single_layer",
        "island_zone_depth_in": 0.0,
        "horizontal_zone_start_x": 0.0,
        "layout_2d": {
            "interior_length_in": L,
            "interior_width_in": W,
            "placements": placements,
        },
    }


def _plan_score_tuple(plan: Dict[str, Any]) -> Tuple[int, int, float]:
    """Lower is better: minimize unplaced crates, container count; maximize utilization."""
    containers = plan.get("containers") or []
    unplaced = sum(len(c.get("unplaced_crate_indices") or []) for c in containers)
    n = len(containers)
    if not n:
        return (9999, 9999, 0.0)
    w_sum = sum(float(c.get("weight_utilization_pct") or 0) for c in containers)
    f_sum = sum(float(c.get("floor_utilization_pct_approx") or 0) for c in containers)
    util = (w_sum + 0.35 * f_sum) / n
    return (unplaced, n, -util)


def _optimize_container_load_strategy(
    crate_specs: List[Dict[str, Any]],
    cap: float,
    strategy: str,
) -> Dict[str, Any]:
    """
    Greedy multi-container pack for one strategy label:
    mixed_20_first | mixed_40_first | twenty_only | forty_only
    """
    queue = list(crate_specs)
    out_containers: List[Dict[str, Any]] = []
    global_warnings: List[str] = []
    idx = 0
    full_count = len(crate_specs)

    def largest_20() -> int:
        return _largest_fit_prefix(queue, CONTAINER_20FT, cap)

    def largest_40() -> int:
        return _largest_fit_prefix(queue, CONTAINER_40FT, cap)

    while queue:
        base = full_count - len(queue)
        placed = False

        if strategy == "mixed_20_first":
            n20 = largest_20()
            if n20 > 0:
                subset = queue[:n20]
                queue = queue[n20:]
                lay = layout_in_container(
                    subset, max_payload_kg=cap, interior=CONTAINER_20FT, crate_index_base=base
                )
                out_containers.append(_wrap_container(lay, idx, "20ft", subset))
                idx += 1
                placed = True
            else:
                n40 = largest_40()
                if n40 > 0:
                    subset = queue[:n40]
                    queue = queue[n40:]
                    lay = layout_in_container(
                        subset, max_payload_kg=cap, interior=CONTAINER_40FT, crate_index_base=base
                    )
                    out_containers.append(_wrap_container(lay, idx, "40ft", subset))
                    idx += 1
                    placed = True

        elif strategy == "mixed_40_first":
            n40 = largest_40()
            if n40 > 0:
                subset = queue[:n40]
                queue = queue[n40:]
                lay = layout_in_container(
                    subset, max_payload_kg=cap, interior=CONTAINER_40FT, crate_index_base=base
                )
                out_containers.append(_wrap_container(lay, idx, "40ft", subset))
                idx += 1
                placed = True
            else:
                n20 = largest_20()
                if n20 > 0:
                    subset = queue[:n20]
                    queue = queue[n20:]
                    lay = layout_in_container(
                        subset, max_payload_kg=cap, interior=CONTAINER_20FT, crate_index_base=base
                    )
                    out_containers.append(_wrap_container(lay, idx, "20ft", subset))
                    idx += 1
                    placed = True

        elif strategy == "twenty_only":
            n20 = largest_20()
            if n20 > 0:
                subset = queue[:n20]
                queue = queue[n20:]
                lay = layout_in_container(
                    subset, max_payload_kg=cap, interior=CONTAINER_20FT, crate_index_base=base
                )
                out_containers.append(_wrap_container(lay, idx, "20ft", subset))
                idx += 1
                placed = True

        elif strategy == "forty_only":
            n40 = largest_40()
            if n40 > 0:
                subset = queue[:n40]
                queue = queue[n40:]
                lay = layout_in_container(
                    subset, max_payload_kg=cap, interior=CONTAINER_40FT, crate_index_base=base
                )
                out_containers.append(_wrap_container(lay, idx, "40ft", subset))
                idx += 1
                placed = True

        if placed:
            continue

        subset = [queue[0]]
        queue = queue[1:]
        tw = float(subset[0].get("total_weight_kg") or 0)
        if tw > cap:
            global_warnings.append(
                f"Crate {subset[0].get('name', '')} weight {round(tw)} kg exceeds payload cap {int(cap):,} kg — split manually."
            )

        if strategy == "twenty_only":
            interior = CONTAINER_20FT
            ctype = "20ft"
        else:
            interior = CONTAINER_40FT
            ctype = "40ft"

        lay = layout_in_container(subset, max_payload_kg=cap, interior=interior, crate_index_base=base)
        if lay.get("unplaced_crate_indices"):
            global_warnings.append(
                f"Crate {subset[0].get('name', '')} could not be placed in {ctype} layout — verify dimensions."
            )
        out_containers.append(_wrap_container(lay, idx, ctype, subset))
        idx += 1

    return {"containers": out_containers, "warnings": global_warnings}


def _largest_fit_prefix(queue: List[Dict[str, Any]], box: Dict[str, Any], cap: float) -> int:
    """Max n such that first n crates fit in one container (weight + geometry)."""
    for n in range(len(queue), 0, -1):
        subset = queue[:n]
        w = sum(float(c.get("total_weight_kg", 0) or 0) for c in subset)
        if w > cap + 0.01:
            continue
        lay = layout_in_container(subset, max_payload_kg=cap, interior=box, crate_index_base=0)
        if not lay.get("unplaced_crate_indices"):
            return n
    return 0


def optimize_container_load(
    crate_specs: List[Dict[str, Any]],
    max_payload_kg: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Compare several greedy fleet strategies (20′-only, 40′-only, mixed with 20′-first, mixed with 40′-first)
    and return the plan with the best logistics score (fewer unplaced crates, fewer containers, higher util).
    """
    default_cap = float(CONTAINER_20FT["max_kg"])
    cap = float(max_payload_kg) if max_payload_kg is not None else default_cap
    if cap < 5000:
        cap = default_cap
    cap = max(20000.0, min(32000.0, cap))

    labels = ("mixed_20_first", "mixed_40_first", "twenty_only", "forty_only")
    candidates: List[Dict[str, Any]] = []
    best_plan: Optional[Dict[str, Any]] = None
    best_key: Optional[Tuple[int, int, float]] = None
    best_label = "mixed_20_first"

    for label in labels:
        plan = _optimize_container_load_strategy(crate_specs, cap, label)
        key = _plan_score_tuple(plan)
        n20 = sum(1 for c in plan.get("containers") or [] if c.get("type") == "20ft")
        n40 = sum(1 for c in plan.get("containers") or [] if c.get("type") == "40ft")
        candidates.append(
            {
                "strategy": label,
                "container_count": len(plan.get("containers") or []),
                "count_20ft": n20,
                "count_40ft": n40,
                "unplaced_crates": key[0],
                "score": {"unplaced": key[0], "containers": key[1], "neg_util": round(key[2], 3)},
            }
        )
        if best_key is None or key < best_key:
            best_key = key
            best_plan = plan
            best_label = label

    assert best_plan is not None
    out = dict(best_plan)
    opt_warnings = list(out.get("warnings") or [])
    opt_warnings.insert(
        0,
        f"Container fleet optimizer chose “{best_label}” after comparing 20′-only, 40′-only, and mixed fills.",
    )
    out["warnings"] = opt_warnings
    out["optimization"] = {
        "chosen_strategy": best_label,
        "score": {"unplaced": best_key[0], "containers": best_key[1], "neg_util": round(best_key[2], 3)},
        "candidates": candidates,
    }
    return out


def _wrap_container(
    layout: Dict[str, Any],
    ordinal: int,
    ctype: str,
    subset: List[Dict[str, Any]],
) -> Dict[str, Any]:
    tw = sum(float(c.get("total_weight_kg", 0) or 0) for c in subset)
    cap = float(layout.get("max_weight_kg") or 0)
    cidx = sorted({int(p["crate_index"]) for p in layout.get("placements", []) if "crate_index" in p})
    return {
        "container_id": f"C{ordinal + 1:03d}",
        "type": ctype,
        "crate_indices": cidx,
        "subset_size": len(subset),
        "used_weight_kg": round(tw, 1),
        "payload_limit_kg": cap,
        "remaining_payload_kg": float(layout.get("remaining_payload_kg") or 0),
        "weight_utilization_pct": float(layout.get("weight_utilization_pct") or 0),
        "floor_utilization_pct_approx": float(layout.get("floor_utilization_pct_approx") or 0),
        "remaining_floor_area_sq_in_approx": float(layout.get("remaining_floor_area_sq_in_approx") or 0),
        **layout,
        "container_type": ctype,
    }
