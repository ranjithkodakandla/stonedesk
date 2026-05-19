"""
Kitchen (B-type perimeter) operational plan preview — no persistence.

Vertical-cassette grouped assembly model:
- All pieces stand vertically (same physics as islands)
- Bundle integrity: main tops stay with their corresponding splash sets
- Sequential ideal batching across the selected scope
- Pull suggestions from the full project kitchen bundle pool

Steps implemented:
  1. Bundle model — perimeter PartBundles with main tops + splash sets
  2. Vertical cassette semantics — island_cassette_dimensions_operational
  3. Weight optimization — sequential_ideal_batches (1900 kg ideal)
  4. Range merge — excluded from preview (handled in full v3 plan)
  5. Underloaded suggestions — adjacency-tier pull candidates
  6. Operational review data — structured per-crate + per-bundle output
"""
from __future__ import annotations

from typing import Any, Dict, List, Set

from ..planning_engine import piece_weight
from .adjacency import ADJACENCY_TIER_LABELS, adjacency_tier, sort_bundles_by_pull_proximity
from .bundles import build_horizontal_bundles_from_families, island_bundle_adjacency_sort_key
from .classify import build_families, classify_piece
from .dimensions import island_cassette_dimensions_operational
from .scored_packing import sequential_ideal_batches

_IDEAL_KG = 1900.0
_IDEAL_LO = 1800.0
_IDEAL_HI = 2000.0
_ACCEPTABLE_LO = 1400.0
_ACCEPTABLE_HI = 2200.0
_MIN_KG = 1400.0
_MAX_KG = 2200.0
_MAIN_CAP = 10  # same cap as full plan's OPERATIONAL_HORIZONTAL_MAIN_PIECES_CAP


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


def _all_pieces_in_batch(bundles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collect all pieces from all bundles in a batch, deduped by piece id."""
    out: List[Dict[str, Any]] = []
    seen: Set[int] = set()
    for b in bundles:
        for p in b.get("all_pieces") or []:
            pid = int(p["id"])
            if pid not in seen:
                seen.add(pid)
                out.append(p)
    return out


def _weight_status(wt: float) -> str:
    if wt < _ACCEPTABLE_LO:
        return "UNDERLOADED"
    if wt > _MAX_KG:
        return "OVERWEIGHT"
    if _IDEAL_LO <= wt <= _IDEAL_HI:
        return "OPTIMAL"
    return "ACCEPTABLE"


def _suggested_pull_rows(
    batch_bundles: List[Dict[str, Any]],
    all_project_bundles: List[Dict[str, Any]],
    exclude_bundle_ids: Set[str],
    limit: int = 12,
) -> List[Dict[str, Any]]:
    """Suggest nearby perimeter kitchen bundles for underloaded crates."""
    if not batch_bundles:
        return []
    ref = batch_bundles[0]
    candidates = [
        b for b in all_project_bundles
        if str(b.get("bundle_id") or "") not in exclude_bundle_ids
    ]
    sorted_cands = sort_bundles_by_pull_proximity(ref, candidates)
    rows: List[Dict[str, Any]] = []
    for b in sorted_cands[:limit]:
        tier, _, _ = adjacency_tier(ref, b)
        tier_label = ADJACENCY_TIER_LABELS.get(tier, f"tier_{tier}")
        rows.append({
            "bundle_id": str(b.get("bundle_id") or ""),
            "building": b.get("building") or "",
            "floor": b.get("floor") or "",
            "flat": b.get("flat") or "",
            "weight_kg": float(b.get("total_weight_kg") or 0),
            "adjacency_tier": tier,
            "adjacency_label": tier_label,
            "main_count": len(b.get("main_pieces") or []),
            "splash_count": len(b.get("splash_pieces") or []),
            "label": (
                f"Flat {b.get('flat') or '?'} · "
                f"{float(b.get('total_weight_kg') or 0):.0f} kg "
                f"({tier_label.replace('_', ' ')})"
            ),
        })
    return rows


def _bundle_review_row(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """Structured row per bundle for the review panel (main tops + their splashes)."""
    mains = bundle.get("main_pieces") or []
    splashes = bundle.get("splash_pieces") or []

    def _piece_row(p: Dict[str, Any], role: str) -> Dict[str, Any]:
        return {
            "id": int(p["id"]),
            "part_no": str(p.get("part_no") or ""),
            "part": str(p.get("part") or ""),
            "length": float(p.get("length") or 0),
            "width": float(p.get("width") or 0),
            "role": role,
        }

    return {
        "bundle_id": str(bundle.get("bundle_id") or ""),
        "flat_key": bundle.get("flat_key") or "",
        "building": bundle.get("building") or "",
        "floor": bundle.get("floor") or "",
        "flat": bundle.get("flat") or "",
        "weight_kg": round(float(bundle.get("total_weight_kg") or 0), 1),
        "main_count": len(mains),
        "splash_count": len(splashes),
        "assembly": (
            [_piece_row(p, "main_top") for p in mains]
            + [_piece_row(p, "splash") for p in splashes]
        ),
    }


def _crate_review(
    crate_idx: int,
    batch: List[Dict[str, Any]],
    all_project_bundles: List[Dict[str, Any]],
    exclude_pull_ids: Set[str],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> Dict[str, Any]:
    all_pieces = _all_pieces_in_batch(batch)
    wt = sum(piece_weight(p, material, thickness, color) for p in all_pieces)
    dims = island_cassette_dimensions_operational(all_pieces, thickness, wood_thickness)
    status = _weight_status(wt)

    main_count = sum(len(b.get("main_pieces") or []) for b in batch)
    splash_count = sum(len(b.get("splash_pieces") or []) for b in batch)

    el = float(dims.get("external_length") or 0)
    ew = float(dims.get("external_width") or 0)
    eh = float(dims.get("external_height") or 0)

    pulls: List[Dict[str, Any]] = []
    if status == "UNDERLOADED":
        pulls = _suggested_pull_rows(batch, all_project_bundles, exclude_pull_ids)

    return {
        "name": f"B-{crate_idx:03d}",
        "category": "perimeter",
        "crate_letter": "B",
        "total_weight_kg": round(wt, 1),
        "dimensions_in": {
            "L": round(el, 1),
            "W": round(ew, 1),
            "H": round(eh, 1),
            "label": f"{round(el)} × {round(ew)} × {round(eh)}",
        },
        "status": status,
        "bundle_count": len(batch),
        "main_top_count": main_count,
        "splash_count": splash_count,
        "slab_count": len(all_pieces),
        "bundles": [_bundle_review_row(b) for b in batch],
        "suggested_pulls": pulls,
        "target_weight_kg": {
            "ideal_center": _IDEAL_KG,
            "lo": _IDEAL_LO,
            "hi": _IDEAL_HI,
            "acceptable_lo": _ACCEPTABLE_LO,
            "acceptable_hi": _ACCEPTABLE_HI,
        },
        "packing_mode": "vertical_cassette_grouped",
        "warnings": [],
    }


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


def build_kitchen_operational_review(
    project: Dict[str, Any],
    all_pieces: List[Dict[str, Any]],
    body: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Preview-only kitchen (B-type) vertical cassette crate plan — no Mongo writes.

    body keys: buildings[], floors[], flats[] (each optional; empty = no filter).

    Returns structured review: per-crate weight, dimensions, status, bundle
    groupings (main tops + their splash sets), and underloaded pull suggestions.

    Range-into-kitchen merge is NOT applied here; it is handled during the full
    v3 plan generation (pack_phase_b_kitchen_range_operational).
    """
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)

    # Full-project kitchen bundles for underloaded pull suggestions.
    all_families_full = build_families(all_pieces)
    all_bundles_full = build_horizontal_bundles_from_families(
        all_families_full, "perimeter", material, thickness, color
    )

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
            "piece_count": len(all_pieces),
            "scoped_piece_count": 0,
        }

    scoped_families = build_families(scoped)
    scoped_bundles = build_horizontal_bundles_from_families(
        scoped_families, "perimeter", material, thickness, color
    )
    if not scoped_bundles:
        return {
            "message": "no kitchen (perimeter) pieces in scope",
            "crates": [],
            "piece_count": len(all_pieces),
            "scoped_piece_count": len(scoped),
        }

    # Sort by building → floor → flat → bundle_id (same as islands).
    scoped_bundles.sort(key=island_bundle_adjacency_sort_key)

    batches = sequential_ideal_batches(
        scoped_bundles,
        weight_fn=lambda b: float(b.get("total_weight_kg") or 0),
        min_kg=_MIN_KG,
        max_kg=_MAX_KG,
        ideal_kg=_IDEAL_KG,
        same_flat_key_fn=lambda b: b.get("flat_key") or "",
        material_key_fn=lambda b: b.get("material_batch_key") or "",
        main_sum_fn=lambda b: len(b.get("main_pieces") or []),
        main_cap=_MAIN_CAP,
    )

    # All assigned bundle IDs across the plan (for pull exclusion).
    all_assigned: Set[str] = {
        str(b.get("bundle_id") or "")
        for batch in batches
        for b in batch
        if b.get("bundle_id")
    }

    crates: List[Dict[str, Any]] = []
    for i, batch in enumerate(batches, start=1):
        this_ids = {str(b.get("bundle_id") or "") for b in batch}
        exclude = all_assigned - this_ids  # exclude this crate's own bundles from pulls
        crates.append(
            _crate_review(
                i, batch, all_bundles_full, exclude,
                material, thickness, color, wood,
            )
        )

    scope_label = _human_scope_label(body)
    return {
        "message": "ok",
        "piece_count": len(all_pieces),
        "scoped_piece_count": len(scoped),
        "crate_count": len(crates),
        "crates": crates,
        "batching": {
            "mode": "global_within_scope",
            "scope_label": scope_label,
            "scoped_kitchen_bundle_count": len(scoped_bundles),
            "explanation": (
                "Sequential batching over every kitchen (perimeter) PartBundle in scope. "
                "Bundles sorted by building→floor→flat. Merged toward 1900 kg ideal using "
                "squared-error cost minus same-flat (1200) and material-batch (800) bonuses. "
                "All pieces stand vertically in grouped cassette assemblies. "
                "Range-into-kitchen merge applies during full plan generation only."
            ),
        },
    }


def location_options_from_pieces(pieces: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Distinct building/floor/flat values from kitchen (perimeter) pieces only."""
    kitchen = [p for p in pieces if classify_piece(p)[0] == "perimeter"]
    buildings = sorted({str(p.get("building") or "").strip() for p in kitchen if str(p.get("building") or "").strip()})
    floors = sorted({str(p.get("floor") or "").strip() for p in kitchen if str(p.get("floor") or "").strip()})
    flats = sorted({str(p.get("flat") or "").strip() for p in kitchen if str(p.get("flat") or "").strip()})
    return {"buildings": buildings, "floors": floors, "flats": flats}
