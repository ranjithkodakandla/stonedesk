from typing import Any, Dict, List, Optional, Tuple

# Standard dry interior working envelopes — warehouse rule for StoneDesk v3 (inches / kg).
CONTAINER_20FT = {
    "max_length": 233.0,
    "max_width": 92.0,
    "max_clear_height": 100.0,
    "max_kg": 24000.0,
}

CONTAINER_40FT = {
    "max_length": 473.0,
    "max_width": 92.0,
    "max_clear_height": 100.0,
    # Payload planning cap stays aligned with v3 stone rule unless project overrides via max_payload_kg.
    "max_kg": 27000.0,
}

V3_PAYLOAD_CAP_KG = float(CONTAINER_20FT["max_kg"])

GAP = 3.0
_GRID_STEP = 3.0

# Fractional x zoning along interior length L (x=0 back wall; doors at high x).
# Islands (A) stay within [0, island_zone_end_frac·L]; horizontals start at horizontal_zone_start_frac·L minimum.
ZONE_TEMPLATE_BY_FT: Dict[str, Dict[str, float]] = {
    "20ft": {"island_zone_end_frac": 0.58, "horizontal_zone_start_frac": 0.58},
    "40ft": {"island_zone_end_frac": 0.62, "horizontal_zone_start_frac": 0.62},
}


def _overlap(ax: float, ay: float, al: float, aw: float, bx: float, by: float, bl: float, bw: float) -> bool:
    return not (ax + al <= bx or bx + bl <= ax or ay + aw <= by or by + bw <= ay)


def _annotate_zone_template_violations(
    crate_specs: List[Dict[str, Any]],
    placements: List[Dict[str, Any]],
    *,
    crate_index_base: int,
    island_x_cap: float,
    horizontal_x_floor: float,
    zone_fracs: Dict[str, float],
    tol_in: float = 2.0,
    enforce_horizontal_band: bool = True,
) -> None:
    for c in crate_specs:
        c.pop("planner_v3_zone_violation", None)
    for pl in placements:
        try:
            gi = int(pl["crate_index"]) - crate_index_base
        except (TypeError, ValueError, KeyError):
            continue
        if gi < 0 or gi >= len(crate_specs):
            continue
        spec_c = crate_specs[gi]
        cc = str(spec_c.get("crate_class") or "").upper()
        x = float(pl.get("x") or 0)
        flv = float(pl.get("floor_l") or 0)
        if cc == "A":
            if x + flv > island_x_cap + tol_in:
                spec_c["planner_v3_zone_violation"] = True
                wmsg = (
                    f"Zone template: island crate footprint ends beyond reserved back strip "
                    f"({zone_fracs['island_zone_end_frac']:.0%} of container length)."
                )
                lw = list(spec_c.get("warnings") or [])
                if wmsg not in lw:
                    lw.append(wmsg)
                    spec_c["warnings"] = lw
        elif cc and cc != "A":
            if enforce_horizontal_band and x < horizontal_x_floor - tol_in:
                spec_c["planner_v3_zone_violation"] = True
                wmsg = (
                    f"Zone template: horizontal crate origin below reserved door-side band start "
                    f"({zone_fracs['horizontal_zone_start_frac']:.0%} of container length)."
                )
                lw = list(spec_c.get("warnings") or [])
                if wmsg not in lw:
                    lw.append(wmsg)
                    spec_c["warnings"] = lw


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
    prefer_high_x: bool = False,
    max_left_x: Optional[float] = None,
) -> Optional[Tuple[float, float]]:
    """``max_left_x`` — optional cap on floor origin x (island zone); must satisfy x + fl ≤ L."""
    x_upper = L - fl
    if max_left_x is not None:
        x_upper = min(x_upper, max_left_x)
    x_max = x_upper
    y_max = W - fw
    if x_max < x_min - 0.01 or y_max < -0.01:
        return None
    xs: List[float] = []
    x = x_min
    while x <= x_max + 0.01:
        xs.append(round(x, 1))
        x += _GRID_STEP
    if prefer_high_x:
        xs.reverse()
    for rx in xs:
        y = 0.0
        while y <= y_max + 0.01:
            if not _rects_overlap_floor(rx, y, fl, fw, occupied):
                return rx, round(y, 1)
            y += _GRID_STEP
    return None


def linear_manual_sort_placements(
    placements: List[Dict[str, Any]],
    merged_crates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Loading into container (deepest / back wall first): class A islands (low x / back),
    then B/C/D toward the door (higher x). Secondary sort by x then y.
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
        # Islands load first → lower phase key (0 before 1).
        phase = 0 if is_island else 1
        return (phase, float(pl.get("x", 0) or 0), float(pl.get("y", 0) or 0))

    return sorted(placements, key=sort_key)


def _crate_spec_at(pl: Dict[str, Any], crate_specs: List[Dict[str, Any]], crate_index_base: int) -> Optional[Dict[str, Any]]:
    try:
        idx = int(pl["crate_index"]) - crate_index_base
        if 0 <= idx < len(crate_specs):
            return crate_specs[idx]
    except (TypeError, ValueError, KeyError):
        pass
    return None


def _try_stack_horizontal(
    *,
    placements: List[Dict[str, Any]],
    crate_specs: List[Dict[str, Any]],
    crate_index_base: int,
    idx: int,
    fl: float,
    fw: float,
    ch: float,
    H_MAX: float,
) -> bool:
    """One-high stacking for horizontal crates on compatible floor footprints."""
    for base in placements:
        if int(base.get("stack_level") or 0) != 0:
            continue
        if base.get("_stack_slot_used"):
            continue
        bs = _crate_spec_at(base, crate_specs, crate_index_base)
        if not bs or str(bs.get("crate_class") or "").upper() == "A":
            continue
        bh = float(base.get("height_in") or 0)
        elev = float(base.get("elevation_in") or 0)
        if elev + bh + ch > H_MAX + 0.01:
            continue
        bfl = float(base.get("floor_l") or 0)
        bfw = float(base.get("floor_w") or 0)
        if fl > bfl + 0.01 or fw > bfw + 0.01:
            continue
        bx = float(base.get("x") or 0)
        by = float(base.get("y") or 0)
        ri = idx - crate_index_base
        cc = str(crate_specs[ri].get("crate_class") or "") if 0 <= ri < len(crate_specs) else ""
        placements.append({
            "crate_index": idx,
            "crate_class": cc,
            "x": bx,
            "y": by,
            "floor_l": fl,
            "floor_w": fw,
            "stack_level": 1,
            "rotated": False,
            "height_in": round(ch, 1),
            "elevation_in": round(elev + bh, 1),
        })
        base["_stack_slot_used"] = True
        return True
    return False


def layout_in_container(
    crate_specs: List[Dict[str, Any]],
    max_payload_kg: Optional[float] = None,
    interior: Optional[Dict[str, Any]] = None,
    crate_index_base: int = 0,
    horizontal_strip_gap_in: float = GAP,
) -> Dict[str, Any]:
    """
    Floor-first layout with optional single stack tier for horizontal crates.

    Coordinate convention (matches UI): **x = 0 at the front wall**, **doors at high x**.
    Business zoning:
    - Class **A** islands → **back / end wall** (**low x** strip).
    - **B / C / D** horizontals → **toward doors** (**high x**), packed door-first; may use one stack tier if height allows.
    """
    box = dict(interior or CONTAINER_20FT)
    L = float(box["max_length"])
    W = float(box["max_width"])
    H_MAX = float(box["max_clear_height"])
    box_payload = float(box.get("max_kg") or V3_PAYLOAD_CAP_KG)

    cap = float(max_payload_kg) if max_payload_kg is not None else V3_PAYLOAD_CAP_KG
    MAX_KG = min(box_payload, max(1000.0, cap))

    ctype = "40ft" if L >= 350.0 else "20ft"
    zone_fracs = ZONE_TEMPLATE_BY_FT.get(ctype, ZONE_TEMPLATE_BY_FT["20ft"])
    island_x_cap = float(zone_fracs["island_zone_end_frac"]) * L
    horizontal_x_floor = float(zone_fracs["horizontal_zone_start_frac"]) * L

    horiz = [c for c in crate_specs if c.get("crate_class") != "A"]
    islands = [c for c in crate_specs if c.get("crate_class") == "A"]

    placements: List[Dict[str, Any]] = []
    warnings: List[str] = [
        "Zoning: islands (A) toward back wall (low x); kitchens / ranges / vanities (B/C/D) toward doors (high x). "
        "Horizontal crates may use one stack tier when clear height allows. "
        f"Template {ctype}: island footprint cap ≈ {zone_fracs['island_zone_end_frac']:.0%} of length from back; "
        f"horizontal band starts ≈ {zone_fracs['horizontal_zone_start_frac']:.0%} toward doors."
    ]
    total_kg = sum(float(c.get("total_weight_kg", 0) or 0) for c in crate_specs)

    occupied: List[Dict[str, float]] = []
    unplaced: List[int] = []

    def place_floor(idx: int, x: float, y: float, fl: float, fw: float, ch: float) -> None:
        ri = idx - crate_index_base
        cc = str(crate_specs[ri].get("crate_class") or "") if 0 <= ri < len(crate_specs) else ""
        placements.append({
            "crate_index": idx,
            "crate_class": cc,
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

    # --- Phase 1: Islands (A) at back wall (low x) ---
    island_extent = 0.0
    for c in islands:
        idx = crate_index_base + crate_specs.index(c)
        fl, fw, ch = _crate_footprint(c)
        if c.get("planner_v3_geometry_blocked"):
            unplaced.append(idx)
            warnings.append(
                f"Crate index {idx} ({c.get('name', '')}) blocked by emit gate (height / geometry) — not placed."
            )
            continue
        if ch > H_MAX + 0.01:
            unplaced.append(idx)
            warnings.append(
                f"Crate {c.get('name', '')} height {round(ch, 1)} in exceeds clear height {H_MAX} in — "
                "not placed (manual handling / geometry exception required)."
            )
            continue
        island_max_left_x = max(0.0, island_x_cap - fl)
        slot = _find_floor_slot(
            fl=fl,
            fw=fw,
            L=L,
            W=W,
            x_min=0.0,
            occupied=occupied,
            prefer_high_x=False,
            max_left_x=island_max_left_x,
        )
        if slot is None:
            unplaced.append(idx)
            warnings.append(
                f"Crate index {idx} ({c.get('name', '')}) did not fit floor beside back-wall island strip."
            )
            continue
        place_floor(idx, slot[0], slot[1], fl, fw, ch)

    for pl in placements:
        rel = int(pl["crate_index"]) - crate_index_base
        if 0 <= rel < len(crate_specs) and crate_specs[rel].get("crate_class") == "A":
            island_extent = max(island_extent, pl["x"] + pl["floor_l"])

    gap_applied = horizontal_strip_gap_in if island_extent > 0.01 else 0.0
    x_min_horiz = island_extent + gap_applied
    # Reserve door-side horizontal band only when islands exist; horizontal-only loads use full deck length.
    if islands:
        x_min_horiz = max(x_min_horiz, horizontal_x_floor)

    # --- Phase 2: Horizontals toward doors (prefer high x on floor) ---
    horiz_floor_failures: List[Tuple[int, Dict[str, Any], float, float, float]] = []
    for c in horiz:
        idx = crate_index_base + crate_specs.index(c)
        fl, fw, ch = _crate_footprint(c)
        if c.get("planner_v3_geometry_blocked"):
            unplaced.append(idx)
            warnings.append(
                f"Crate index {idx} ({c.get('name', '')}) blocked by emit gate — not placed."
            )
            continue
        if ch > H_MAX + 0.01:
            unplaced.append(idx)
            warnings.append(
                f"Crate {c.get('name', '')} height {round(ch, 1)} in exceeds clear height {H_MAX} in — not placed."
            )
            continue
        slot = _find_floor_slot(
            fl=fl,
            fw=fw,
            L=L,
            W=W,
            x_min=x_min_horiz,
            occupied=occupied,
            prefer_high_x=True,
        )
        if slot is None:
            horiz_floor_failures.append((idx, c, fl, fw, ch))
            continue
        place_floor(idx, slot[0], slot[1], fl, fw, ch)

    # --- Phase 3: Stack tier for horizontal leftovers ---
    for idx, _c, fl, fw, ch in horiz_floor_failures:
        ok = _try_stack_horizontal(
            placements=placements,
            crate_specs=crate_specs,
            crate_index_base=crate_index_base,
            idx=idx,
            fl=fl,
            fw=fw,
            ch=ch,
            H_MAX=H_MAX,
        )
        if not ok:
            unplaced.append(idx)
            warnings.append(
                f"Crate index {idx} ({_c.get('name', '')}) did not fit floor or single stack tier — verify layout / split."
            )

    horiz_extent = 0.0
    for r in occupied:
        horiz_extent = max(horiz_extent, r["x"] + r["fl"])

    used_len = 0.0
    used_w = 0.0
    for pl in placements:
        used_len = max(used_len, pl["x"] + pl["floor_l"])
        used_w = max(used_w, pl["y"] + pl["floor_w"])

    floor_area = L * W
    bbox_area = max(0.0, used_len * used_w)
    length_util = round(100.0 * used_len / L, 1) if L else 0.0
    floor_util_approx = round(100.0 * bbox_area / floor_area, 1) if floor_area else 0.0

    placed_global_idx = set()
    for pl in placements:
        try:
            placed_global_idx.add(int(pl["crate_index"]))
        except (TypeError, ValueError, KeyError):
            continue
    placed_kg = 0.0
    for gidx in placed_global_idx:
        gi = gidx - crate_index_base
        if 0 <= gi < len(crate_specs):
            placed_kg += float(crate_specs[gi].get("total_weight_kg") or 0)

    if placements:
        weight_util = round(100.0 * placed_kg / MAX_KG, 1) if MAX_KG else 0.0
        remaining_payload = max(0.0, MAX_KG - placed_kg)
    else:
        weight_util = 0.0
        remaining_payload = MAX_KG if MAX_KG else 0.0

    if total_kg > MAX_KG:
        warnings.append(
            f"Total in this container {round(total_kg)} kg exceeds {int(MAX_KG):,} kg payload cap — split load."
        )

    remaining_floor = max(0.0, floor_area - bbox_area)

    island_strip_end = round(island_extent + gap_applied, 1) if island_extent > 0.01 else 0.0

    any_stack = any(int(p.get("stack_level") or 0) > 0 for p in placements)

    # Retry with zero island→horizontal gap if door-side floor was tight.
    if (
        unplaced
        and islands
        and horizontal_strip_gap_in > 0.01
        and island_extent > 0.01
    ):
        retry = layout_in_container(
            crate_specs,
            max_payload_kg=max_payload_kg,
            interior=interior,
            crate_index_base=crate_index_base,
            horizontal_strip_gap_in=0.0,
        )
        if len(retry.get("unplaced_crate_indices") or []) < len(unplaced):
            rw = list(retry.get("warnings") or [])
            rw.append(
                f"Island / horizontal separation gap reduced from {horizontal_strip_gap_in:.0f}″ to 0″ "
                "so more B/C/D crates fit toward the door."
            )
            retry["warnings"] = rw
            _annotate_zone_template_violations(
                crate_specs,
                retry.get("placements") or [],
                crate_index_base=crate_index_base,
                island_x_cap=island_x_cap,
                horizontal_x_floor=horizontal_x_floor,
                zone_fracs=zone_fracs,
                enforce_horizontal_band=bool(islands),
            )
            return retry

    for pl in placements:
        pl.pop("_stack_slot_used", None)

    _annotate_zone_template_violations(
        crate_specs,
        placements,
        crate_index_base=crate_index_base,
        island_x_cap=island_x_cap,
        horizontal_x_floor=horizontal_x_floor,
        zone_fracs=zone_fracs,
        enforce_horizontal_band=bool(islands),
    )

    return {
        "container_type": ctype,
        "container_interior_in": {"length": L, "width": W, "max_clear_height": H_MAX},
        "placements": placements,
        "unplaced_crate_indices": sorted(set(unplaced)),
        "total_weight_kg": round(total_kg, 1),
        "placed_weight_kg": round(placed_kg, 1),
        "max_weight_kg": MAX_KG,
        "used_length_in": round(used_len, 1),
        "used_width_in": round(used_w, 1),
        "length_utilization_pct": length_util,
        "weight_utilization_pct": weight_util,
        "floor_utilization_pct_approx": floor_util_approx,
        "remaining_payload_kg": round(remaining_payload, 1),
        "remaining_floor_area_sq_in_approx": round(remaining_floor, 1),
        "suggest_40ft": ctype == "20ft" and bool(unplaced),
        "warnings": warnings,
        "single_layer_floor": not any_stack,
        "horizontal_stack_tier_used": any_stack,
        "linear_horiz_block_end_x_in": round(horiz_extent, 1),
        "linear_island_strip_end_x_in": round(island_extent, 1),
        "horizontal_zone_start_x_in": island_strip_end,
        # Legacy UI keys (pre–zoning-fix) — keep populated so 3D / tabs keep working.
        "horizontal_zone_start_x": island_strip_end,
        "linear_island_strip_start_x_in": 0.0,
        "horizontal_to_island_gap_in": round(gap_applied, 1) if island_extent > 0.01 else None,
        "loading_model": "back_wall_islands_door_side_horizontals_optional_stack",
        "layout_2d": {
            "interior_length_in": L,
            "interior_width_in": W,
            "placements": placements,
        },
    }


def _plan_score_tuple(plan: Dict[str, Any], crate_specs: List[Dict[str, Any]]) -> Tuple[int, float]:
    """Lower is better: minimize unplaced crates first, then operational composite (containers + crate quality)."""
    from .emit_gate import operational_score

    containers = plan.get("containers") or []
    unplaced = sum(len(c.get("unplaced_crate_indices") or []) for c in containers)
    if not containers:
        # JSON/API responses cannot serialize ``inf`` — use a finite worst-case tie-breaker.
        return (9999, 1.0e30)
    return (unplaced, operational_score(plan, crate_specs))


def _avg_container_stone_kg(plan: Dict[str, Any]) -> float:
    cs = plan.get("containers") or []
    if not cs:
        return 0.0
    return sum(float(c.get("used_weight_kg") or 0) for c in cs) / len(cs)


def _commercially_weak_twenty(plan: Dict[str, Any], threshold_avg_kg: float) -> bool:
    """True when the 20′ fleet looks under-filled or fragmented on payload."""
    cs = plan.get("containers") or []
    if not cs:
        return False
    avg = _avg_container_stone_kg(plan)
    if avg < threshold_avg_kg:
        return True
    poor = sum(1 for c in cs if float(c.get("weight_utilization_pct") or 0) < 38.0)
    return poor >= max(2, len(cs) // 4)


def _optimize_fleet(crate_specs: List[Dict[str, Any]], box: Dict[str, Any], cap: float) -> Dict[str, Any]:
    queue = list(crate_specs)
    out_containers: List[Dict[str, Any]] = []
    global_warnings: List[str] = []
    idx = 0
    full_count = len(crate_specs)
    ctype = "40ft" if float(box["max_length"]) >= 350.0 else "20ft"

    while queue:
        base = full_count - len(queue)
        n_fit = _largest_fit_prefix(queue, box, cap, index_base=base)
        if n_fit > 0:
            subset = queue[:n_fit]
            queue = queue[n_fit:]
            lay = layout_in_container(subset, max_payload_kg=cap, interior=box, crate_index_base=base)
            out_containers.append(_wrap_container(lay, idx, ctype, subset))
            idx += 1
            continue

        c = queue.pop(0)
        tw = float(c.get("total_weight_kg") or 0)
        if tw > cap:
            global_warnings.append(
                f"Crate {c.get('name', '')} weight {round(tw)} kg exceeds payload cap {int(cap):,} kg — split manually."
            )

        lay = layout_in_container([c], max_payload_kg=cap, interior=box, crate_index_base=base)
        if not lay.get("placements"):
            global_warnings.append(
                f"Crate {c.get('name', '')} omitted from {ctype} manifest — no floor/stack placement "
                f"(geometry / clear height). Crate stays in plan with assignments; no phantom container row."
            )
            continue

        if lay.get("unplaced_crate_indices"):
            global_warnings.append(
                f"Crate {c.get('name', '')} could not be fully placed in {ctype} layout — verify dimensions."
            )
        out_containers.append(_wrap_container(lay, idx, ctype, [c]))
        idx += 1

    return {"containers": out_containers, "warnings": global_warnings}


def _largest_fit_prefix(
    queue: List[Dict[str, Any]], box: Dict[str, Any], cap: float, *, index_base: int
) -> int:
    """Max n such that first n crates fit in one container (weight + geometry)."""
    for n in range(len(queue), 0, -1):
        subset = queue[:n]
        w = sum(float(c.get("total_weight_kg", 0) or 0) for c in subset)
        if w > cap + 0.01:
            continue
        lay = layout_in_container(subset, max_payload_kg=cap, interior=box, crate_index_base=index_base)
        if not lay.get("unplaced_crate_indices"):
            return n
    return 0


def optimize_container_load(
    crate_specs: List[Dict[str, Any]],
    max_payload_kg: Optional[float] = None,
    project: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Greedy multi-container fleet: seed with **20′**, optionally promote to **40′** when
    economic / utilization thresholds fail (see ``twenty_ft_min_economic_fill_kg`` on project).
    """
    cap = float(max_payload_kg) if max_payload_kg is not None else V3_PAYLOAD_CAP_KG
    cap = min(V3_PAYLOAD_CAP_KG, max(1000.0, cap))

    proj = project or {}
    try:
        econ_threshold = float(proj.get("twenty_ft_min_economic_fill_kg", 21000.0) or 21000.0)
    except (TypeError, ValueError):
        econ_threshold = 21000.0

    plan20 = _optimize_fleet(crate_specs, CONTAINER_20FT, cap)
    key20 = _plan_score_tuple(plan20, crate_specs)

    candidates: List[Dict[str, Any]] = [
        {
            "strategy": "twenty_only",
            "container_count": len(plan20.get("containers") or []),
            "count_20ft": len(plan20.get("containers") or []),
            "count_40ft": 0,
            "avg_container_stone_kg": round(_avg_container_stone_kg(plan20), 1),
            "unplaced_crates": key20[0],
            "score": {
                "unplaced": key20[0],
                "operational": round(key20[1], 2),
            },
        }
    ]

    weak = _commercially_weak_twenty(plan20, econ_threshold) or key20[0] > 0

    chosen = dict(plan20)
    chosen_key = key20
    chosen_strategy = "twenty_only"
    selection_notes = (
        f"Selected 20′ fleet — avg stone ≈ {_avg_container_stone_kg(plan20):,.0f} kg / box "
        f"(economic threshold {econ_threshold:,.0f} kg)."
    )

    if weak:
        plan40 = _optimize_fleet(crate_specs, CONTAINER_40FT, cap)
        key40 = _plan_score_tuple(plan40, crate_specs)
        candidates.append(
            {
                "strategy": "forty_only",
                "container_count": len(plan40.get("containers") or []),
                "count_20ft": 0,
                "count_40ft": len(plan40.get("containers") or []),
                "avg_container_stone_kg": round(_avg_container_stone_kg(plan40), 1),
                "unplaced_crates": key40[0],
                "score": {
                    "unplaced": key40[0],
                    "operational": round(key40[1], 2),
                },
            }
        )
        if key40 < chosen_key:
            chosen = dict(plan40)
            chosen_key = key40
            chosen_strategy = "forty_only"
            selection_notes = (
                f"Promoted to 40′ fleet — 20′ plan looked commercially weak vs "
                f"{econ_threshold:,.0f} kg/box target or had geometry/unplaced issues; "
                f"avg stone ≈ {_avg_container_stone_kg(plan40):,.0f} kg / 40′ box."
            )

    opt_warnings = list(chosen.get("warnings") or [])
    opt_warnings.insert(0, selection_notes)
    if weak and chosen_strategy == "twenty_only":
        opt_warnings.insert(
            1,
            "40′ evaluation did not beat the 20′ score tuple — keeping 20′; tune merges/thresholds if needed.",
        )
    chosen["warnings"] = opt_warnings

    chosen["optimization"] = {
        "chosen_strategy": chosen_strategy,
        "selection_reason": selection_notes,
        "twenty_ft_min_economic_fill_kg": econ_threshold,
        "score": {"unplaced": chosen_key[0], "operational": round(chosen_key[1], 2)},
        "candidates": candidates,
    }
    return chosen


def _wrap_container(
    layout: Dict[str, Any],
    ordinal: int,
    ctype: str,
    subset: List[Dict[str, Any]],
) -> Dict[str, Any]:
    tw_subset = sum(float(c.get("total_weight_kg", 0) or 0) for c in subset)
    tw_placed = float(layout.get("placed_weight_kg") if layout.get("placed_weight_kg") is not None else tw_subset)
    cap = float(layout.get("max_weight_kg") or 0)
    cidx = sorted({int(p["crate_index"]) for p in layout.get("placements", []) if "crate_index" in p})
    return {
        "container_id": f"C{ordinal + 1:03d}",
        "type": ctype,
        "crate_indices": cidx,
        "subset_size": len(subset),
        "subset_weight_kg": round(tw_subset, 1),
        "used_weight_kg": round(tw_placed, 1),
        "payload_limit_kg": cap,
        "remaining_payload_kg": float(layout.get("remaining_payload_kg") or 0),
        "weight_utilization_pct": float(layout.get("weight_utilization_pct") or 0),
        "floor_utilization_pct_approx": float(layout.get("floor_utilization_pct_approx") or 0),
        "remaining_floor_area_sq_in_approx": float(layout.get("remaining_floor_area_sq_in_approx") or 0),
        **layout,
        "container_type": ctype,
    }
