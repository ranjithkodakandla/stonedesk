"""
Hard geometry feasibility gate before container optimization / manifest persistence.

Outcomes per crate: ``valid``, ``rebuild_attempted``, or ``rejected``.
Conservative floor envelope uses the shorter dry container length (20′) so crates must fit the smallest fleet box.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .container_layout import CONTAINER_20FT


def _fits_floor(fl: float, fw: float, L: float, W: float) -> bool:
    """Crate may rotate on deck — compare sorted edges."""
    if fl <= 0 or fw <= 0 or L <= 0 or W <= 0:
        return False
    ce = sorted([fl, fw])
    box = sorted([L, W])
    return ce[0] <= box[0] + 0.02 and ce[1] <= box[1] + 0.02


def _oriented_rect_fits_interior(el: float, ew: float, eh: float, L: float, W: float, H: float, tol: float = 0.02) -> bool:
    """
    True iff the crate can be orthogonally rotated to fit inside an L×W×H interior box.
    Used for **vertical island cassettes** where no single axis is always ``clear height``.
    """
    if el <= 0 or ew <= 0 or eh <= 0 or L <= 0 or W <= 0 or H <= 0:
        return False
    ce = sorted([el, ew, eh])
    bx = sorted([L, W, H])
    return ce[0] <= bx[0] + tol and ce[1] <= bx[1] + tol and ce[2] <= bx[2] + tol


def _try_refresh_dimensions(crate: Dict[str, Any], *, default_thickness: str, wood_thickness: float) -> bool:
    """Single rebuild attempt — recomputes dims from BOM when orientation is known."""
    try:
        from .dimensions import horizontal_crate_dimensions, island_vertical_dimensions
    except ImportError:
        return False

    ori = str(crate.get("orientation") or "").lower()
    if ori == "horizontal":
        mains = list(crate.get("main_pieces") or [])
        spl_flat = list(crate.get("splash_pieces") or [])
        layers_src = crate.get("splash_layers") or []
        fixed_layers: List[List[Dict[str, Any]]] = []
        for lay in layers_src:
            if isinstance(lay, list) and lay and isinstance(lay[0], dict):
                fixed_layers.append(lay)
        if not fixed_layers and spl_flat:
            for i in range(0, len(spl_flat), 4):
                fixed_layers.append(spl_flat[i : i + 4])

        dims = horizontal_crate_dimensions(mains, fixed_layers, default_thickness, wood_thickness)
        crate["dimensions"] = dims
        return True

    if ori == "vertical":
        pcs = list(crate.get("pieces") or [])
        if not pcs:
            return False
        cat = str(crate.get("category") or "").lower()
        if cat == "island":
            try:
                from .phase_a_island import operational_planner_enabled
            except ImportError:
                operational_planner_enabled = lambda: False  # type: ignore[misc, assignment]
            from .dimensions import island_cassette_dimensions_operational, island_vertical_dimensions

            if operational_planner_enabled() or "Operational Phase A" in str(crate.get("grouping_reason") or ""):
                dims = island_cassette_dimensions_operational(pcs, default_thickness, wood_thickness)
            else:
                dims = island_vertical_dimensions(pcs, default_thickness, wood_thickness)
            crate["dimensions"] = dims
            return True
        dims = island_vertical_dimensions(pcs, default_thickness, wood_thickness)
        crate["dimensions"] = dims
        return True

    return False


def validate_crate_geometry(
    crate: Dict[str, Any],
    *,
    interior: Dict[str, Any],
    max_main_bed_slabs: int = 10,
) -> Dict[str, Any]:
    dims = crate.get("dimensions") or {}
    el = float(dims.get("external_length") or 0)
    ew = float(dims.get("external_width") or 0)
    eh = float(dims.get("external_height") or 0)
    L = float(interior["max_length"])
    W = float(interior["max_width"])
    H = float(interior["max_clear_height"])
    ori = str(crate.get("orientation") or "").lower()
    errs: List[str] = []

    mains = crate.get("main_pieces") or []
    if ori == "horizontal" and len(mains) > max_main_bed_slabs:
        errs.append("too_many_main_bed_slabs")

    if el <= 0 or ew <= 0 or eh <= 0:
        errs.append("missing_or_zero_dimensions")

    cat = str(crate.get("category") or "").lower()
    # Vertical **island** cassettes: L/W/H from BOM are not "flat footprint + up"; any axis may align with
    # container length / width / clear height after rotation — use 3D oriented fit vs 20′ envelope.
    if ori == "vertical" and cat == "island":
        if not _oriented_rect_fits_interior(el, ew, eh, L, W, H):
            errs.append("island_vertical_exceeds_interior_envelope")
    elif ori == "vertical":
        if eh > H + 0.01:
            errs.append("vertical_height_exceeds_clearance")
        if not _fits_floor(el, ew, L, W):
            errs.append("footprint_exceeds_floor_envelope")
    elif ori == "horizontal":
        if eh > H + 0.01:
            errs.append("horizontal_height_exceeds_clearance")
        if not _fits_floor(el, ew, L, W):
            errs.append("footprint_exceeds_floor_envelope")
    else:
        errs.append("unknown_orientation")

    outcome = "valid" if not errs else "rejected"
    out: Dict[str, Any] = {
        "outcome": outcome,
        "errors": errs,
        "envelope_in": {"length": L, "width": W, "clear_height": H},
        "external_in": {"length": el, "width": ew, "height": eh},
        "orientation": ori,
    }
    if ori == "vertical" and cat == "island":
        out["island_envelope_check"] = "oriented_box_20ft"
    elif ori == "vertical":
        out["vertical_envelope_check"] = "footprint_plus_clear_height"
    return out


def partition_crates_for_manifest(
    crate_specs: List[Dict[str, Any]],
    *,
    project: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Returns (manifest_eligible, rejected, geometry_debug_rows).

    Rejected crates must not enter ``optimize_container_load`` — avoids phantom indices / ghost manifests.
    """
    interior = dict(CONTAINER_20FT)
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)
    thickness = str(project.get("thickness", "3CM") or "3CM")

    manifest: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    geo_rows: List[Dict[str, Any]] = []

    for c in crate_specs:
        dbg = c.setdefault("planner_debug", {})

        if c.get("planner_v3_geometry_blocked"):
            gv = {
                "outcome": "rejected",
                "errors": ["emit_gate_blocked_geometry"],
                "rebuild_attempted": False,
            }
            dbg["geometry_validation"] = gv
            dbg.setdefault("container_placement", {"status": "skipped_geometry_blocked"})
            c["planner_manifest_eligible"] = False
            c["unshippable_reason"] = "emit_gate_blocked_geometry"
            rejected.append(c)
            geo_rows.append({"serial": c.get("serial"), **gv})
            continue

        gv0 = validate_crate_geometry(c, interior=interior)
        rebuild_attempted = False

        if gv0["outcome"] != "valid":
            ok = _try_refresh_dimensions(c, default_thickness=thickness, wood_thickness=wood)
            rebuild_attempted = ok
            gv1 = validate_crate_geometry(c, interior=interior) if ok else gv0
            if gv1["outcome"] == "valid" and rebuild_attempted:
                gv1["outcome"] = "rebuild_attempted"
                gv1["prior_errors"] = gv0["errors"]
            gv = gv1
            gv["rebuild_attempted"] = rebuild_attempted
        else:
            gv = gv0
            gv["rebuild_attempted"] = False

        dbg["geometry_validation"] = gv

        final_out = gv.get("outcome")
        if final_out in ("valid", "rebuild_attempted"):
            c["planner_manifest_eligible"] = True
            c.pop("unshippable_reason", None)
            dbg.setdefault("container_placement", {"status": "pending"})
            manifest.append(c)
        else:
            c["planner_manifest_eligible"] = False
            c["unshippable_reason"] = ",".join(gv.get("errors") or [])
            dbg["container_placement"] = {"status": "rejected_geometry", "reason": c["unshippable_reason"]}
            rejected.append(c)

        geo_rows.append({"serial": c.get("serial"), **gv})

    return manifest, rejected, geo_rows


def enrich_placement_results(manifest_crates: List[Dict[str, Any]], load_plan: Dict[str, Any]) -> None:
    """After optimize, stamp placement outcome onto ``planner_debug`` using layout placements vs crate indices."""
    containers = load_plan.get("containers") or []
    placed_ix: Dict[int, str] = {}
    for cont in containers:
        cid = str(cont.get("container_id") or "")
        for pl in cont.get("placements") or []:
            try:
                ix = int(pl.get("crate_index"))
            except (TypeError, ValueError, KeyError):
                continue
            placed_ix[ix] = cid

    for ix, cr in enumerate(manifest_crates):
        pd = cr.setdefault("planner_debug", {})
        if ix in placed_ix:
            pd["container_placement"] = {
                "status": "placed",
                "container_id": placed_ix[ix],
                "crate_index": ix,
            }
        else:
            pd["container_placement"] = {
                "status": "unplaced_or_blocked_layout",
                "crate_index": ix,
            }


def count_placed_a_crates(load_plan: Dict[str, Any], manifest_crates: List[Dict[str, Any]]) -> int:
    n = 0
    for cont in load_plan.get("containers") or []:
        for pl in cont.get("placements") or []:
            try:
                ix = int(pl["crate_index"])
            except (TypeError, ValueError, KeyError):
                continue
            if 0 <= ix < len(manifest_crates):
                if str(manifest_crates[ix].get("crate_class") or "").upper() == "A":
                    n += 1
    return n
