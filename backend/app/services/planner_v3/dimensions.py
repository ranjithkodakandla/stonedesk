from typing import Any, Dict, List

from ..planning_engine import parse_float, thickness_inches

_WALL = 3.0
_HEIGHT_TOP = 6.0
_FOAM_LAYER = 0.75
_HONEYCOMB_SEP_IN = 1.25
_FORKLIFT_CLEARANCE_IN = 7.0
_BASE_SUPPORT_IN = 2.0
_HEADROOM = 4.0             # matches _HEADROOM below (shared upright-model constant)
_ROW_SEPARATOR_IN = 0.75    # foam between main-top "rows" stacked along width
_SIDE_FRAME = 4.0           # framing on the width/row-stack axis
_ROW_PIECE_GAP_IN = 1.0     # clearance between two pieces sharing one row, laid end to end
_NO_STANDOUT_ROW_CAP_IN = 120.0  # see _row_grouping_cap()

# Flat clearance convention matching the fabricator's own reference packing
# sheets (Stone Size -> Internal Crate Size = +1"/+1"/+2", with +1" height
# headroom per present splash layer on top of that). This replaces the
# previous per-row-foam + side-frame + forklift-clearance model for
# horizontal_crate_dimensions ONLY — the island/cassette functions below
# keep their own existing constants (_BASE_SUPPORT_IN, _HEADROOM,
# _FOAM_LAYER, _HONEYCOMB_SEP_IN, _SIDE_FRAME, _ROW_SEPARATOR_IN), which are
# untouched and still used there.
_KV_LENGTH_CLEARANCE_IN = 1.0
_KV_WIDTH_CLEARANCE_IN = 1.0
_KV_HEIGHT_CLEARANCE_IN = 2.0
_KV_HEADROOM_PER_SPLASH_LAYER_IN = 1.0

# Crate internal width must stay within the fabricator's standard crate stock —
# too narrow and the walls can't be framed, too wide and it stops fitting the
# container's row budget (reference calc: 92" container / 3 rows - framing = 26").
CRATE_INTERNAL_WIDTH_MIN_IN = 10.0
CRATE_INTERNAL_WIDTH_MAX_IN = 26.0


def _max_piece_length(pieces: List[Dict[str, Any]]) -> float:
    if not pieces:
        return 0.0
    return max(parse_float(p.get("length")) for p in pieces)


def _piece_short_edge(p: Dict[str, Any]) -> float:
    L = parse_float(p.get("length"))
    W = parse_float(p.get("width"))
    if L > 0 and W > 0:
        return min(L, W)
    return max(L, W)


def _row_raw_length(row: List[Dict[str, Any]]) -> float:
    """Sum of a row's piece lengths plus the gaps between them — before any
    end-of-crate clearance is added."""
    total = sum(parse_float(p.get("length")) for p in row)
    return total + max(0, len(row) - 1) * _ROW_PIECE_GAP_IN


def _consolidate_same_length_leftovers(rows: List[List[Dict[str, Any]]]) -> List[List[Dict[str, Any]]]:
    """Phase B: a piece that ended up alone in its own row (because the
    Phase-A cap blocked it from joining pieces of its own exact length)
    gets folded into an existing row made ENTIRELY of that same length,
    even though that makes the row longer than the original cap — three
    identical 25" pieces become one clean row of 75" instead of a pair plus
    an awkward leftover single.

    This never merges rows just because doing so would cut the row count:
    it only ever extends a row that ALREADY successfully combined >=2
    pieces of one exact length with ANOTHER piece of that exact length. Six
    identical 79" pieces that never paired up in Phase A (each already a
    singleton on its own) stay six separate rows — there is no multi-piece
    79" row to extend them into, so nothing here merges them. That keeps
    the factory's real packing drawing (six separate 79" rows) intact while
    still cleaning up the leftover-singleton case."""
    def is_homogeneous(row: List[Dict[str, Any]]) -> bool:
        lengths = {round(parse_float(p.get("length")), 3) for p in row}
        return len(lengths) == 1

    changed = True
    while changed:
        changed = False
        for i, row in enumerate(rows):
            if len(row) != 1:
                continue
            singleton_len = round(parse_float(row[0].get("length")), 3)
            target = next(
                (j for j, other in enumerate(rows)
                 if j != i and len(other) >= 2 and is_homogeneous(other)
                 and round(parse_float(other[0].get("length")), 3) == singleton_len),
                None,
            )
            if target is not None:
                rows[target].append(row[0])
                del rows[i]
                changed = True
                break
    return rows


def _row_grouping_cap(pieces: List[Dict[str, Any]]) -> float:
    """The Phase-A row-grouping cap: normally the longest single piece's
    length + clearance — that piece is the crate's natural "standout" size,
    and anything shorter tries to fit within it (e.g. a 67" piece plus
    three 25"s: the 67" sets the cap, the 25"s combine within it).

    But when EVERY selected piece is the exact same length, there is no
    standout at all — every piece ties for "the max" — and deriving the cap
    from that single shared length is uselessly tight: a batch of many
    identical 25" pieces would get a ~31" cap (barely 1 piece), forcing one
    piece per row instead of combining several efficiently. In that
    specific case (and ONLY that case — any batch with more than one
    distinct length keeps the normal cap, so e.g. six identical 79" pieces
    alongside 49"/19" pairs are unaffected), use a 120" floor instead, so
    same-length duplicates can still combine several at a time rather than
    each claiming its own row."""
    if not pieces:
        return 0.0
    normal_cap = _max_piece_length(pieces) + 6.0
    distinct_lengths = {round(parse_float(p.get("length")), 3) for p in pieces}
    if len(distinct_lengths) <= 1:
        return max(normal_cap, _NO_STANDOUT_ROW_CAP_IN)
    return normal_cap


def group_main_pieces_into_rows(
    main_pieces: List[Dict[str, Any]],
    usable_length: float,
) -> List[List[Dict[str, Any]]]:
    """Groups main pieces into packing "rows" — upright thickness-slots laid
    side by side along the crate's length axis, matching the factory's real
    packing drawings (e.g. the Kitchen And Range Tops reference: 6 rows of
    one long piece each, then 6 rows pairing a 49" and a 19" piece that
    together fit the same row). A piece too long to share a row with
    anything gets a row to itself; two or more shorter pieces whose combined
    length (plus a small gap) fits within usable_length share one row
    instead of each claiming a separate thickness-slot, so the crate isn't
    needlessly widened for pieces that could lie end to end.

    Greedy largest-first (Phase A): the biggest unplaced piece starts a new
    row, then the largest remaining piece that still fits within
    usable_length is added, repeating until nothing more fits. A second pass
    (Phase B, _consolidate_same_length_leftovers) then folds any leftover
    same-length singleton into an already-combined row of that same length,
    even past usable_length — see that function's docstring for why this
    never merges dissimilar pieces just to cut the row count."""
    if not main_pieces:
        return []
    remaining = sorted(main_pieces, key=lambda p: parse_float(p.get("length")), reverse=True)
    rows: List[List[Dict[str, Any]]] = []
    while remaining:
        row = [remaining.pop(0)]
        row_length = parse_float(row[0].get("length"))
        i = 0
        while i < len(remaining):
            candidate_length = parse_float(remaining[i].get("length"))
            if row_length + _ROW_PIECE_GAP_IN + candidate_length <= usable_length:
                row.append(remaining.pop(i))
                row_length += _ROW_PIECE_GAP_IN + candidate_length
            else:
                i += 1
        rows.append(row)
    return _consolidate_same_length_leftovers(rows)


def group_splash_pieces_side_by_side(
    splash_pieces: List[Dict[str, Any]],
    usable_length: float,
    default_thickness: str,
) -> List[List[Dict[str, Any]]]:
    """Packs splash pieces of the same material thickness side by side into a
    shared layer when their combined length fits the row-length budget,
    instead of always splitting them into fixed-size stacked groups. Pieces
    never share a layer with a different thickness — mixing thicknesses in
    one layer would leave the thinner piece unsupported, so each thickness
    only stacks a new layer when its own pieces stop fitting side by side."""
    if not splash_pieces:
        return []
    by_thickness: Dict[float, List[Dict[str, Any]]] = {}
    for p in splash_pieces:
        t = round(thickness_inches(str(p.get("thickness") or default_thickness)), 3)
        by_thickness.setdefault(t, []).append(p)

    layers: List[List[Dict[str, Any]]] = []
    for t in sorted(by_thickness):
        layers.extend(group_main_pieces_into_rows(by_thickness[t], usable_length))
    return layers


def horizontal_crate_dimensions(
    main_pieces: List[Dict[str, Any]],
    splash_layers: List[List[Dict[str, Any]]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    Upright crate: main tops stand on edge (short edge = height), stacked
    side-by-side along the width axis (one "row" per main piece, thickness
    accumulates into width). Splashes stack on TOP of the main tops, height-wise.

    Mirrors estimateLeaningFamilyBundleDimensions() in
    frontend/src/utils/crateEstimator.js — keep both in sync manually.
    """
    all_p = main_pieces + [p for layer in splash_layers for p in layer]
    if not all_p:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
        }

    # Phase A uses the longest single piece (+ clearance) as the row-grouping
    # cap. Phase B (inside group_main_pieces_into_rows) can then consolidate
    # leftover same-length singletons into an existing row past that cap —
    # so the crate's actual internal_length must be derived from whatever
    # the longest row ends up being, not frozen at the pre-grouping cap.
    phase_a_cap = _row_grouping_cap(main_pieces) if main_pieces else _max_piece_length(all_p) + 6.0
    rows_for_length = group_main_pieces_into_rows(main_pieces, usable_length=phase_a_cap) if main_pieces else []
    longest_row_raw = max((_row_raw_length(row) for row in rows_for_length), default=0.0)
    internal_length = max(_max_piece_length(all_p), longest_row_raw) + _KV_LENGTH_CLEARANCE_IN

    # Height: main tops stand upright on their short edge; splash layers
    # stack on top, each contributing its own physical stacking height (a
    # splash piece's "width" field — e.g. a 4"-tall back splash — not its
    # material thickness), plus 1" headroom per present layer.
    height_ref = main_pieces if main_pieces else all_p
    main_h = max(_piece_short_edge(p) for p in height_ref)

    splash_h = 0.0
    active_layers = [layer for layer in splash_layers if layer]
    for layer in active_layers:
        layer_h = max(parse_float(p.get("width")) for p in layer)
        splash_h += layer_h + _KV_HEADROOM_PER_SPLASH_LAYER_IN

    internal_height = main_h + splash_h + _KV_HEIGHT_CLEARANCE_IN

    # Width: thickness-stack of main-top "rows". A row is a thickness-slot,
    # not necessarily one piece — two or more pieces short enough to lie end
    # to end within the crate's internal_length share one row instead of
    # each claiming its own slot (see group_main_pieces_into_rows), so e.g.
    # a 49" and a 19" piece pack into the same row a lone 79" piece needs to
    # itself, matching the factory's real packing drawings.
    if main_pieces:
        rows = rows_for_length
        row_thicknesses = [
            max(thickness_inches(str(p.get("thickness") or default_thickness)) for p in row)
            for row in rows
        ]
        internal_width = sum(row_thicknesses) + _KV_WIDTH_CLEARANCE_IN
    else:
        internal_width = thickness_inches(default_thickness) + _KV_WIDTH_CLEARANCE_IN

    internal_width = max(CRATE_INTERNAL_WIDTH_MIN_IN, min(internal_width, CRATE_INTERNAL_WIDTH_MAX_IN))

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _WALL, 1),
        "external_width": round(internal_width + _WALL, 1),
        "external_height": round(internal_height + _HEIGHT_TOP, 1),
        "wood_thickness": wood_thickness,
    }


def island_cassette_dimensions_operational(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    OPTIMIZER coordinate system — do NOT change axis semantics here.

    Used by: recompute_layout.py, geometry_gate.py, phase_a_island.py,
             kitchen_operational_plan.py, container packing solver.

    Axis convention expected by the optimizer:
      internal_length  = cassette DEPTH footprint (Σ thicknesses + framing)
                         ← small value (~15–20"), placed along container length axis
      internal_width   = slab short-edge width (slab WIDTH dimension)
      internal_height  = slab long-edge height (upright slab height)

    For human-readable operational crate cards in the Draft Crate UI use
    leaned_operational_cassette_dimensions() instead — that function uses the
    correct physical orientation (long edge = cassette length, short edge = height).
    """
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "wood_thickness": wood_thickness,
        }

    stack_depth = 0.0
    max_long = 0.0
    max_short = 0.0
    for p in pieces:
        t = thickness_inches(str(p.get("thickness") or default_thickness))
        L = parse_float(p.get("length"))
        W = parse_float(p.get("width"))
        long_e = max(L, W)
        short_e = min(L, W) if L > 0 and W > 0 else max(L, W)
        stack_depth += t
        max_long = max(max_long, long_e)
        max_short = max(max_short, short_e)

    framing_depth = 4.0
    internal_length = min(92.0, stack_depth + framing_depth)
    internal_width = max_short + 6.0
    internal_height = max_long + _BASE_SUPPORT_IN + 6.0

    external_length = round(internal_length + _WALL, 1)
    external_width = round(internal_width + _WALL, 1)
    external_height = round(internal_height + _HEIGHT_TOP + _FORKLIFT_CLEARANCE_IN, 1)

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": external_length,
        "external_width": external_width,
        "external_height": external_height,
        "wood_thickness": wood_thickness,
    }


# ─── Rectangular upright cassette geometry ────────────────────────────────────
# Physical orientation of island slabs in transport:
#   Long edge  → runs horizontally along cassette primary length axis
#   Short edge → becomes effective standing height (upright, no lean correction)
#   Thickness  → accumulates into cassette depth
#
# This is the DISPLAY geometry for Draft Crate UI and operational planning cards.
# DO NOT use for optimizer/container-packing calculations — see
# island_cassette_dimensions_operational() for the optimizer coordinate system.

_SEPARATOR_IN         = 0.75    # kitchen/vanity layer foam (depth stack)
_ISLAND_SEPARATOR_IN  = 0.04    # island cassette: 100µm poly-film face separator
_DEPTH_FRAME          = 4.0     # framing on depth axis
_LENGTH_CLEARANCE = 2.0     # internal end clearance (1" each end)
_END_FRAME        = 2.0     # external end-board thickness (1" each end)
_PALLET_BASE      = 6.0     # pallet / sled base height
# _HEADROOM (head clearance above slabs) defined near top of file, shared with horizontal_crate_dimensions


def leaned_operational_cassette_dimensions(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    OPERATIONAL DISPLAY geometry — mirrors estimateLeanedCassetteDimensions()
    in frontend/src/utils/crateEstimator.js. Keep both in sync manually.

    Physical model (slabs upright, flush against wall supports — no lean angle):
      internal_length = max slab LONG edge + end clearance   [L, fixed primary axis]
      internal_width  = Σ thicknesses + separators + framing  [D, grows with slab count]
      internal_height = max slab SHORT edge + pallet + headroom  [H, no cosine correction]

    Example — 10× 96"×32" @ 3CM:
      internal:  98" × 16.2" × 42.0"
      external: 100" × 22.2" × 55.0"

    vs optimizer coordinates for the same slabs:
      internal:  15.8" × 38" × 104"    ← small footprint, tall (for packing solver)
    """
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "wood_thickness": wood_thickness,
        }

    # Height derives from main pieces (tops); splash pieces (rare for islands) stack on top.
    main_pieces = [p for p in pieces if str(p.get("role", "main")) != "splash"]
    splash_pieces = [p for p in pieces if str(p.get("role", "main")) == "splash"]
    ref_pieces = main_pieces if main_pieces else pieces

    stack_depth = 0.0
    max_long = 0.0
    max_short = 0.0
    n = len(pieces)

    for p in pieces:
        stack_depth += thickness_inches(str(p.get("thickness") or default_thickness))

    for p in ref_pieces:
        L = parse_float(p.get("length"))
        W = parse_float(p.get("width"))
        long_e = max(L, W)
        short_e = min(L, W) if L > 0 and W > 0 else max(L, W)
        max_long = max(max_long, long_e)
        max_short = max(max_short, short_e)

    # L — primary length (fixed by slab footprint, not slab count)
    internal_length = max_long + _LENGTH_CLEARANCE

    # D — cassette depth (grows with slab count + poly-film separators)
    separators = max(0, n - 1) * _ISLAND_SEPARATOR_IN
    internal_width = stack_depth + separators + _DEPTH_FRAME

    # H — height: short edge upright, plus any splash pieces stacked on top (foam + thickness each)
    splash_h = sum(
        _FOAM_LAYER + thickness_inches(str(p.get("thickness") or default_thickness)) for p in splash_pieces
    )
    internal_height = max_short + _PALLET_BASE + _HEADROOM + splash_h

    return {
        "internal_length": round(internal_length, 1),
        "internal_width":  round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _END_FRAME, 1),
        "external_width":  round(internal_width  + _WALL * 2, 1),
        "external_height": round(internal_height + _HEIGHT_TOP + _FORKLIFT_CLEARANCE_IN, 1),
        "wood_thickness":  wood_thickness,
    }


def island_vertical_dimensions(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    Island crate, human-facing physical dimensions: slabs stand upright on
    their short edge. Delegates to leaned_operational_cassette_dimensions()
    (the correct upright axis model, also used by the Draft Crate UI/export)
    so the auto-generated crate plan and the draft-crate builder agree.
    """
    return leaned_operational_cassette_dimensions(pieces, default_thickness, wood_thickness)


def total_piece_weight(pieces: List[Dict[str, Any]], material: str, thickness: str, color: str) -> float:
    from ..planning_engine import piece_weight

    return sum(piece_weight(p, material, thickness, color) for p in pieces)
