#!/usr/bin/env python3
"""
Standalone test script — NIM vision-based PDF dimension extraction.

Strategy (full-page): render each PDF page to a PNG and send to the NIM
vision model asking for ALL piece dimensions in one shot.  This avoids the
shape-detection fragility of the per-piece-crop approach.

Usage:
    python test_nim_parser.py [pdf_path] [page_num]

    e.g.
    python test_nim_parser.py "Concord North drawings (1).pdf" 0
    python test_nim_parser.py "Deforest Yards Bldg I Drawings.pdf" 0

Environment: NVIDIA_NIM_API_KEY loaded from backend/.env
"""

import base64
import io
import json
import os
import sys
import time
from pathlib import Path

# ── Load .env ─────────────────────────────────────────────────────────────────
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

import ssl
import urllib.request
import urllib.error

# macOS: bypass missing root CAs in system Python (local test only)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode    = ssl.CERT_NONE

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF (fitz) not installed.  Run: pip install pymupdf")

# ── Ground truth ──────────────────────────────────────────────────────────────
# (pdf stem lowercased, page index) → list of expected piece dicts
GROUND_TRUTH = {
    ("concord north drawings (1)", 0): [
        {"label": "Vanity Top",    "length_in": 55.000, "width_in": 22.5},
        {"label": "Splash Detail", "length_in": 54.875, "width_in": 4.0},
        {"label": "Side splash",   "length_in": 21.625, "width_in": 4.0},
    ],
    ("deforest yards bldg i drawings", 0): [
        {"label": "main top", "length_in": 110.75, "width_in": 43.5},
        {"label": "①",        "length_in": 33.0,   "width_in": 25.5},
        {"label": "②",        "length_in": 30.0,   "width_in": 25.5},
        {"label": "splash A", "length_in": 25.375, "width_in": 4.0},
        {"label": "splash B", "length_in": 23.25,  "width_in": 4.0},
    ],
    # Haven: 1A-ADA sheet — 4 pieces (main top ①, cooktop slab ②, side splash A, back splash B)
    ("haven pdf drawings (1)", 0): [
        {"label": "①",  "length_in": 98.5,  "width_in": 42.0},
        {"label": "②",  "length_in": 75.0,  "width_in": 25.5},
        {"label": "A",  "length_in": 22.0,  "width_in": 4.0},
        {"label": "B",  "length_in": 75.0,  "width_in": 4.0},
    ],
    # Saltwell VS-01: kitchen island + 2 range counters
    ("2025, aug 15  saltwell springs_print", 0): [
        {"label": "1",  "length_in": 73.75,  "width_in": 37.0},
        {"label": "2",  "length_in": 25.0,   "width_in": 25.0},
        {"label": "3",  "length_in": 24.125, "width_in": 25.0},
    ],
    # Saltwell VS-06: vanity top + back splash A + side splash B
    ("2025, aug 15  saltwell springs_print", 5): [
        {"label": "1",  "length_in": 62.0,   "width_in": 22.0},
        {"label": "A",  "length_in": 62.0,   "width_in": 4.0},
        {"label": "B",  "length_in": 21.25,  "width_in": 4.0},
    ],
}

# ── NIM config ────────────────────────────────────────────────────────────────
NIM_URL     = "https://integrate.api.nvidia.com/v1/chat/completions"
NIM_MODEL   = "meta/llama-3.2-90b-vision-instruct"
NIM_TIMEOUT = 240          # seconds — 90B vision model can be slow

RENDER_SCALE = 2.0         # full-page render DPI multiplier (72×2=144 DPI)

# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a precision CAD drawing reader specialising in stone countertop "
    "fabrication drawings. You assign pre-extracted dimension text to the correct "
    "piece rectangles using the image as visual context."
)

FULLPAGE_PROMPT = """This is a stone countertop fabrication drawing (CAD sheet).

YOUR TASK: Find EVERY stone piece rectangle and return its two OUTER overall dimensions.

=== STEP 1: FIND ALL STONE PIECE RECTANGLES ===
A stone piece is any solid-outline rectangle with dimension callout lines attached, including:
  • Large countertop tops
  • Thin backsplash or side-splash strips (may be only 3"–6" in one direction)
Scan the ENTIRE image. Do NOT skip small or thin pieces.

=== STEP 2: IDENTIFY THE CORRECT OUTER CALLOUTS ===
Each piece has two OUTER dimension callouts:
  • One callout measures the FULL horizontal extent of the piece (corner to corner).
  • One callout measures the FULL vertical extent of the piece (corner to corner).
A valid outer callout:
  • Has a line OUTSIDE the piece, parallel to one edge.
  • Has short tick marks at BOTH ENDS that touch the OUTER corners/edges of the piece.
  • The number in the middle is the TOTAL span of that entire edge.

IMPORTANT — IGNORE THESE:
  (a) Numbers INSIDE the piece (e.g. between dashed sink cutout lines) = positioning offsets.
  (b) Sub-dimension callouts: if a callout only spans PART of an edge (not corner-to-corner),
      it is a sub-division. There will also be a LARGER spanning callout for the full edge.
      Always use the LARGEST value that spans the full edge corner-to-corner.
  (c) Any number with Ø (diameter) or R (radius) prefix — those are for holes/curves.

=== STEP 3: FRACTIONS ===
Read literally: ⅛=0.125 ¼=0.25 ⅜=0.375 ½=0.5 ⅝=0.625 ¾=0.75 ⅞=0.875
"N M/D\"" → decimal.  If genuinely unreadable, use null.
Do NOT use any value not visible in THIS image.

=== OUTPUT ===
JSON array only — no fences, no explanation. One object per piece:
[
  {
    "part_no": "<circled/boxed label e.g. '①','②','A', or ''>",
    "part_name": "<text label e.g. 'Vanity Top', or ''>",
    "length_in": <larger outer callout as float>,
    "width_in": <smaller outer callout as float>,
    "sink_type": "<sink model from dashed cutout e.g. 'CS-1417', or ''>"
  }
]"""


# ── NIM call ──────────────────────────────────────────────────────────────────

LAYOUT_PROMPT = """Look at this stone countertop fabrication drawing.

FOCUS ONLY on the stone piece drawing area (the open white space with piece outlines and
dimension callout lines).  IGNORE the title block, specification panel, legend, border
frame, and any tables or boxes in the margin — those are not stone pieces.

WITHOUT reading any dimension numbers yet, list every solid-outline STONE PIECE rectangle
in the DRAWING AREA.  Stone pieces have dimension callout lines (with tick marks) attached
to their outer edges.  A typical countertop sheet has 2–6 stone pieces — if you find more
than 6, you are probably counting title-block cells or border elements; recount carefully.

For each stone piece rectangle, describe:
  1. Position in the drawing area (top-left, bottom-right, alongside which piece, etc.)
  2. Relative physical size:
       • "large slab"  — occupies a large area (both sides clearly substantial)
       • "medium slab" — smaller than the large slab but still chunky (not a thin strip)
       • "thin strip"  — visually a narrow sliver in ONE direction, regardless of length.
                         A backsplash or side-splash may be 60"+ long yet only 4" wide —
                         it is STILL a thin strip because one side is very narrow.
                         If one side looks like a sliver (≈ 4"–6" thick), it is a thin strip.
  3. Label: any circled number (①, ②) or letter (A, B) inside or beside the piece
  4. Has a dashed inner rectangle (sink/faucet cutout) INSIDE it? YES or NO

List from largest to smallest (large slabs first, thin strips last).

IMPORTANT: Do NOT include dashed-outline rectangles or anything you identify as being
INSIDE another piece — those are sink/faucet cutout features of the containing piece,
not separate stone pieces."""

DIMENSION_PROMPT = """Now, for each piece you described above, read its OUTER dimension callouts.

A dimension callout is a line OUTSIDE the piece, parallel to one of its edges.  It has short
TICK MARKS at both ends that touch the OUTER CORNERS of that specific piece.  The number in
the middle is the measurement.

RULES:
  A) TRACE EACH CALLOUT TO ITS PIECE via the tick marks.  Adjacent pieces share the same
     region of the drawing and each has its OWN callouts — do not mix them up.
     Especially for adjacent pieces that look similar in one dimension (e.g. two range
     counters side-by-side): each piece's callout lines end exactly at THAT piece's corners,
     not the neighbor's.  Re-check carefully before assigning a value to a piece.
  B) For THIN STRIPS (backsplash / side-splash pieces — any piece where one side is
     visually a sliver): the narrow cross-section MUST be ≤ 8".  If you find yourself
     reading a value > 8" for a thin strip's short side, you have picked up the wrong
     callout.  Look for the short line segment outside the strip with tick marks at both
     of the strip's narrow-side corners.
  C) INTERIOR DIMENSIONS — completely ignore any number that is:
       • Located inside the piece boundary (not outside it)
       • Positioned between the dashed lines of a sink/cooktop cutout
       • A faucet/tap hole offset (small values like 1.5", 2.25", etc.)
       • Part of a sink-depth or reach measurement inside the countertop
     These interior numbers look like callouts but measure internal features, NOT the
     outer piece edge.  Only outer callouts with extension lines crossing the piece
     boundary and tick marks on the exterior are valid.
  D) When two nearby callouts have very similar values (e.g. 54⅞" vs 55"), re-read each
     one carefully.  Each callout's tick marks end at that specific piece's corners.
  E) If multiple callouts appear on one edge, use the LARGEST (full corner-to-corner span).
  F) Text like '30" ELECTRIC COOKTOP', '33" FARM SINK', '24" DISHWASHER', '18" PREP SINK'
     etc. are APPLIANCE SIZE LABELS printed inside the piece — NOT dimension callouts.

For each piece (same order as before), report:
  • Horizontal outer callout value
  • Vertical outer callout value
  • Sink model number (if the piece has a dashed cutout, look for text near the cutout)"""

EXTRACT_JSON_PROMPT_TMPL = """Based on your layout description and dimension readings above,
output ONLY a valid JSON array — no markdown, no explanation.
Return EXACTLY {n_pieces} object(s) — one per stone piece in your layout description above.
Do NOT add or remove any pieces.
[
  {{
    "part_no": "<circled label e.g. '①','A', or ''>",
    "part_name": "<text label e.g. 'Vanity Top', or ''>",
    "length_in": <larger of the two outer measurements, as float>,
    "width_in": <smaller of the two outer measurements, as float>,
    "sink_type": "<sink model number or ''>"
  }}
]"""


def call_nim_cot(png_bytes: bytes, api_key: str,
                 known_dims: list[float] | None = None,
                 sub_dim_pairs: list[tuple] | None = None,
                 dim_counts: dict[float, int] | None = None) -> tuple:
    """
    Three-pass chain-of-thought extraction:
      Pass 1 (Layout): describe pieces by physical size/position WITHOUT reading numbers.
      Pass 2 (Dimensions): read callout values for each identified piece; inject known_dims
                           and sub-dim pairs to exclude.
      Pass 3 (JSON): convert the dimension reading into structured JSON.
    Returns (results_list, elapsed_seconds, combined_analysis_text).
    """
    b64      = base64.b64encode(png_bytes).decode()
    data_url = f"data:image/png;base64,{b64}"

    def _nim_call(msgs, max_tokens):
        payload = {
            "model": NIM_MODEL,
            "messages": msgs,
            "max_tokens": max_tokens,
            "temperature": 0.0,
        }
        body = json.dumps(payload).encode()
        req  = urllib.request.Request(
            NIM_URL, data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {api_key}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=NIM_TIMEOUT, context=_ssl_ctx) as resp:
            return json.loads(resp.read().decode())

    t0 = time.time()

    # ── Pass 1: layout description (no numbers) ───────────────────────────────
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text",      "text": LAYOUT_PROMPT},
            ],
        },
    ]
    r1       = _nim_call(messages, max_tokens=768)
    layout   = r1["choices"][0]["message"]["content"]

    # ── Pass 2: dimension reading, with known_dims + sub-dim exclusions ───────
    #
    # Pre-compute the excluded sub-dim set BEFORE building the preferred-values
    # list so we never send contradictory instructions (list a value as preferred
    # AND tell the model to ignore it).
    excl: set[float] = set()
    pair_strs: list[str] = []
    if sub_dim_pairs and known_dims:
        max_dim   = max(known_dims)
        threshold = 0.60 * max_dim
        dc        = dim_counts or {}
        for a, b, c in sub_dim_pairs:
            if c < threshold:
                continue
            pair_strs.append(f"  {a}\" + {b}\" = {c}\"  → use {c}\" as the outer callout")
            # Only exclude a component if it appears exactly once (i.e. it is only
            # a sub-dim, not also a real standalone callout on another piece).
            if dc.get(a, 1) == 1:
                excl.add(a)
            if dc.get(b, 1) == 1:
                excl.add(b)

    dim_prefix = ""
    if known_dims:
        # Send ONLY the valid (non-excluded) values as the preferred set, so there
        # is no contradiction with the sub-dim exclusion notice below.
        valid_dims = [v for v in known_dims if v not in excl]
        dim_str    = ", ".join(f'{v}"' for v in valid_dims)
        dim_prefix = (
            f"VERIFIED OUTER DIMENSION VALUES from this PDF's text layer "
            f"(sub-dimensions and internal offsets have already been removed from this list):\n"
            f"  {dim_str}\n"
            f"Every length_in and width_in you report MUST be one of these values "
            f"(or null if genuinely unreadable).  Do NOT use a value not in this list.\n\n"
        )
    if pair_strs and excl:
        excl_str   = ", ".join(f'{v}"' for v in sorted(excl))
        dim_prefix += (
            f"NOTE — the following values were found in the PDF text but are "
            f"SUB-DIMENSIONS (they subdivide a single edge, not outer callouts):\n"
            + "\n".join(pair_strs) + "\n"
            f"  These have been excluded from the verified list above: {excl_str}\n\n"
        )
    messages.append({"role": "assistant", "content": layout})
    messages.append({"role": "user",
                     "content": dim_prefix + DIMENSION_PROMPT})

    r2        = _nim_call(messages, max_tokens=1024)
    dims_text = r2["choices"][0]["message"]["content"]

    # ── Pass 3: JSON extraction ───────────────────────────────────────────────
    # Count the pieces the model described in Pass 1 so we can anchor the JSON
    # output to exactly that many objects (prevents spurious additions).
    n_pieces = layout.count("**Position:")
    if n_pieces == 0:
        import re as _re2
        n_pieces = len(_re2.findall(r'^\s*\d+\.', layout, _re2.MULTILINE))
    n_pieces = max(1, n_pieces)
    extract_prompt = EXTRACT_JSON_PROMPT_TMPL.format(n_pieces=n_pieces)

    messages.append({"role": "assistant", "content": dims_text})
    messages.append({"role": "user",      "content": extract_prompt})

    r3      = _nim_call(messages, max_tokens=1024)
    content = r3["choices"][0]["message"]["content"]
    elapsed = round(time.time() - t0, 1)

    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[:-1])
    cleaned = cleaned.strip()

    result = json.loads(cleaned)
    if isinstance(result, dict):
        result = result.get("pieces", result.get("items", [result]))

    combined = f"=== PASS 1 (layout) ===\n{layout}\n\n=== PASS 2 (dimensions) ===\n{dims_text}"
    return result, elapsed, combined, n_pieces


def prune_overallocated_pieces(pieces: list[dict], raw_counts: dict[float, int],
                                expected_count: int | None = None) -> list[dict]:
    """
    Two safety nets driven by how many times each dimension value actually
    appears in the PDF text layer (see nim_parser.py's _flag_and_prune_pieces
    for the full rationale):
      1. Exact-duplicate (length,width) pairs across pieces -> a value SWAP
         between two real pieces; can't tell which is wrong, so keep both and
         flag (_needs_review) instead of dropping either.
      2. Remaining pieces that over-allocate a scarce value -> only actually
         DROP while doing so still leaves >= expected_count (the layout
         pass's own piece count) pieces standing (a genuine excess/phantom).
         Any further over-allocated piece is flagged for review instead of
         deleted, since it may be a REAL piece with just a misread value.
    """
    if expected_count is None:
        expected_count = len(pieces)
    max_drops = max(0, len(pieces) - expected_count)
    def pair(p):
        lv, wv = p.get("length_in"), p.get("width_in")
        if lv is None or wv is None:
            return None
        return tuple(sorted([round(lv, 4), round(wv, 4)]))

    def labeled(p):
        return bool((p.get("part_no") or "").strip() or (p.get("part_name") or "").strip())

    groups: dict = {}
    for p in pieces:
        pr = pair(p)
        if pr is not None:
            groups.setdefault(pr, []).append(p)

    dropped_ids, review_ids = set(), set()
    for pr, group in groups.items():
        if len(group) < 2:
            continue
        labeled_members = [id(p) for p in group if labeled(p)]
        unlabeled_members = [id(p) for p in group if not labeled(p)]
        if len(labeled_members) == 1 and unlabeled_members:
            dropped_ids.update(unlabeled_members)
        else:
            review_ids.update(id(p) for p in group)

    budget = dict(raw_counts)
    drops_used = 0
    kept = []
    for p in pieces:
        if id(p) in dropped_ids:
            continue
        if id(p) in review_ids:
            p = dict(p)
            p["_needs_review"] = True
            kept.append(p)
            continue
        lv, wv = p.get("length_in"), p.get("width_in")
        vals = [round(v, 4) for v in (lv, wv) if v is not None]
        if any(budget.get(v, 0) <= 0 for v in vals):
            if drops_used < max_drops:
                drops_used += 1
                continue
            p = dict(p)
            p["_needs_review"] = True
            kept.append(p)
            continue
        for v in vals:
            budget[v] = budget.get(v, 0) - 1
        kept.append(p)
    return kept


# ── Geometric supplement for complex multi-piece sheets ───────────────────────
# See app/nim_parser.py's _apply_geometric_supplement for the full rationale:
# vision reliably gets the single largest piece right but often miscounts or
# misreads several smaller pieces on complex (6+ piece) sheets. This recovers
# them from the PDF's own text positions instead, only ever replacing the
# non-main pieces when it can pair up every remaining dimension with high
# confidence -- otherwise it's a no-op.

_COMPLEX_PAGE_PIECE_THRESHOLD = 5


def _dim_occurrences(page) -> list[dict]:
    occ = []
    for b in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if not raw or not _re.search(r'\d', raw):
                    continue
                if _re.search(r"[ØRø]|\d'-\d|scale|1'-0", raw, _re.IGNORECASE):
                    continue
                if _INCH_STR.match(raw) or _INCH_STR2.match(raw):
                    v = _parse_inch_str(raw)
                    if v is not None and v >= 4.0:
                        x0, y0, x1, y1 = span["bbox"]
                        occ.append({"value": round(v, 4), "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2})
    return occ


def _occ_dist(a, b):
    return ((a["cx"] - b["cx"]) ** 2 + (a["cy"] - b["cy"]) ** 2) ** 0.5


def _grow_main_cluster(occ, roots, max_depth=2):
    by_value = {}
    for o in occ:
        by_value.setdefault(o["value"], []).append(o)

    consumed_ids = set()
    cluster_points = []
    queue = []
    for v in roots:
        cands = by_value.get(round(v, 4), [])
        if cands:
            o = cands[0]
            consumed_ids.add(id(o))
            cluster_points.append(o)
            queue.append((o, 0))

    distinct_values = sorted(by_value.keys())
    while queue:
        cur, depth = queue.pop(0)
        if depth >= max_depth:
            continue
        v = cur["value"]
        found = None
        for a in distinct_values:
            b = round(v - a, 4)
            if b < a or b not in by_value:
                continue
            if a == v or b == v:
                continue
            found = (a, b)
            break
        if not found:
            continue
        a, b = found
        cx = sum(p["cx"] for p in cluster_points) / len(cluster_points)
        cy = sum(p["cy"] for p in cluster_points) / len(cluster_points)
        best, best_score = None, float("inf")
        for a_occ in by_value.get(a, []):
            if id(a_occ) in consumed_ids:
                continue
            for b_occ in by_value.get(b, []):
                if id(b_occ) in consumed_ids:
                    continue
                if a == b and a_occ is b_occ:
                    continue
                mutual = _occ_dist(a_occ, b_occ)
                mx = (a_occ["cx"] + b_occ["cx"]) / 2
                my = (a_occ["cy"] + b_occ["cy"]) / 2
                to_cluster = ((mx - cx) ** 2 + (my - cy) ** 2) ** 0.5
                score = mutual + to_cluster
                if score < best_score:
                    best_score, best = score, (a_occ, b_occ)
        if best is None:
            continue
        a_occ, b_occ = best
        consumed_ids.add(id(a_occ))
        consumed_ids.add(id(b_occ))
        cluster_points.append(a_occ)
        cluster_points.append(b_occ)
        queue.append((a_occ, depth + 1))
        queue.append((b_occ, depth + 1))

    return consumed_ids


_MAX_PAIR_DISTANCE_PT = 220.0  # see app/nim_parser.py's _confident_pairing for calibration


def _confident_pairing(occs, margin=1.4):
    remaining = list(occs)
    pairs = []
    while len(remaining) >= 2:
        best, best_d = None, float("inf")
        for i in range(len(remaining)):
            for j in range(i + 1, len(remaining)):
                d = _occ_dist(remaining[i], remaining[j])
                if d < best_d:
                    best_d, best = d, (i, j)
        i, j = best
        a, b = remaining[i], remaining[j]
        if best_d > _MAX_PAIR_DISTANCE_PT:
            # neither has a real partner left -- drop both as noise instead
            # of fabricating a piece out of two unrelated numbers
            for idx in sorted((i, j), reverse=True):
                remaining.pop(idx)
            continue
        for idx, other in ((i, a), (j, b)):
            alt_d = min(
                (_occ_dist(other, remaining[k]) for k in range(len(remaining)) if k not in (i, j)),
                default=float("inf"),
            )
            if alt_d < best_d * margin:
                return None, (f"ambiguous pairing near value {other['value']} -- "
                              f"chosen dist={best_d:.1f}, next-closest alt dist={alt_d:.1f}")
        pairs.append({"length_in": max(a["value"], b["value"]),
                       "width_in":  min(a["value"], b["value"])})
        for idx in sorted((i, j), reverse=True):
            remaining.pop(idx)
    return pairs, None


def _appliance_keyword_positions(page):
    positions = []
    for b in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if raw and _APPLIANCE_KEYWORD_RE.search(raw):
                    x0, y0, x1, y1 = span["bbox"]
                    positions.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return positions


def geometric_leftover_pieces(page, main_length, main_width):
    """Deliberately does NOT restrict to known_dims (which requires >=2
    occurrences for values <10in) -- that throws away genuine single-print
    small-piece dimensions. This method has its own independent noise
    defenses instead (main-shape decomposition, appliance-keyword proximity,
    confidence-margin pairing, distance ceiling)."""
    all_occ = _dim_occurrences(page)
    kw_pos = _appliance_keyword_positions(page)
    if kw_pos:
        occ = [o for o in all_occ
               if min(((o["cx"] - kx) ** 2 + (o["cy"] - ky) ** 2) ** 0.5 for kx, ky in kw_pos)
               > _APPLIANCE_PROXIMITY_PT]
    else:
        occ = all_occ
    consumed = _grow_main_cluster(occ, [main_length, main_width])
    leftover = [o for o in occ if id(o) not in consumed]
    if len(leftover) < 2:
        return None, "too few leftover occurrences"
    pairs, err = _confident_pairing(leftover)
    return pairs, err


def apply_geometric_supplement(pieces, page):
    if len(pieces) < _COMPLEX_PAGE_PIECE_THRESHOLD:
        return pieces, "below complexity threshold, skipped"

    def area(p):
        l, w = p.get("length_in"), p.get("width_in")
        return (l or 0) * (w or 0)

    main = max(pieces, key=area)
    if not main.get("length_in") or not main.get("width_in"):
        return pieces, "main piece missing dims"

    geo_pieces, err = geometric_leftover_pieces(page, main["length_in"], main["width_in"])
    if geo_pieces is None:
        return pieces, f"rejected: {err}"

    new_pieces = [main]
    for gp in geo_pieces:
        new_pieces.append({"part_no": "", "part_name": "",
                            "length_in": gp["length_in"], "width_in": gp["width_in"],
                            "sink_type": ""})
    return new_pieces, "applied"


def call_nim_fullpage(png_bytes: bytes, api_key: str,
                      known_dims: list[float] | None = None) -> list:
    """Send a full-page PNG to NIM and return the parsed piece list."""
    b64      = base64.b64encode(png_bytes).decode()
    data_url = f"data:image/png;base64,{b64}"

    user_text = FULLPAGE_PROMPT
    if known_dims:
        dim_str = ", ".join(
            f'{v}"' if v == int(v) else f'{v}"'
            for v in known_dims
        )
        user_text = (
            "VERIFIED DIMENSION VALUES — these inch measurements were extracted "
            "directly from the PDF text layer of this page. Every length_in and "
            "width_in you return MUST be one of these values (choose the best match "
            "from this set; do not invent values not in this list):\n"
            f"  {dim_str}\n\n"
        ) + user_text

    payload = {
        "model": NIM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text",      "text": user_text},
                ],
            },
        ],
        "max_tokens": 1024,
        "temperature": 0.0,
    }

    body = json.dumps(payload).encode()
    req  = urllib.request.Request(
        NIM_URL,
        data=body,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    t0 = time.time()
    with urllib.request.urlopen(req, timeout=NIM_TIMEOUT, context=_ssl_ctx) as resp:
        raw = resp.read().decode()
    elapsed = time.time() - t0

    outer   = json.loads(raw)
    content = outer["choices"][0]["message"]["content"]

    # Strip markdown fences if the model added them
    cleaned = content.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:])
    if cleaned.endswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[:-1])
    cleaned = cleaned.strip()

    result = json.loads(cleaned)
    if isinstance(result, dict):
        # Model may return {"pieces": [...]} or just [...]
        result = result.get("pieces", result.get("items", [result]))
    return result, round(elapsed, 1)


# ── Dimension text extraction ─────────────────────────────────────────────────

import re as _re

# Match: integer or mixed-number inch string (e.g. '55"', '22.5"', '110 3/4"', '25 3/8"')
# Optionally followed by [NNN] or [NNN mm] bracket (Saltwell uses [940] without "mm")
_BRACKET = r'(?:\s*\[\d+(?:\s*mm)?\])?'
_INCH_STR = _re.compile(
    r'^(?:(?:\d+\s+\d+/\d+|\d+\.\d+|\d+)\s*"' + _BRACKET + r')$'
)
# Also match with "in" suffix
_INCH_STR2 = _re.compile(
    r'^(?:(?:\d+\s+\d+/\d+|\d+\.\d+|\d+)\s*(?:in|")' + _BRACKET + r')$',
    _re.IGNORECASE,
)

# Interior cutout/offset numbers (cooktop cutout width, faucet-hole spacing, etc.)
# sit close to the appliance/fixture label they belong to; real outer piece
# callouts are always drawn well outside the piece, much farther from any
# interior appliance label. See _APPLIANCE_PROXIMITY_PT usage below.
_APPLIANCE_KEYWORD_RE = _re.compile(
    r"cooktop|dishwasher|faucet|warmer|hood|microwave|farm|prep|oven|\bsink\b|\brange\b",
    _re.IGNORECASE,
)
_APPLIANCE_PROXIMITY_PT = 55.0


def _parse_inch_str(s: str) -> float | None:
    """Convert e.g. '110 3/4"' → 110.75, '25 3/8"' → 25.375, '30"' → 30.0"""
    s = _re.sub(r'\s*\[.*?\]', '', s).strip().rstrip('"').strip()
    s = _re.sub(r'\s*in\s*$', '', s, flags=_re.IGNORECASE).strip()
    try:
        if ' ' in s:
            parts = s.split()
            return float(parts[0]) + float(parts[1].split('/')[0]) / float(parts[1].split('/')[1])
        elif '/' in s:
            n, d = s.split('/')
            return float(n) / float(d)
        else:
            return float(s)
    except Exception:
        return None


def _get_piece_shapes_display(pdf_path: str, page_idx: int) -> list[tuple]:
    """
    Return LEAF piece shapes in display coords — shapes that don't contain other
    detected shapes. Container/border shapes (which would include the outer frame
    of a grouped panel) are excluded so they don't falsely mark callout text as
    "inside" an internal area.
    """
    doc  = fitz.open(pdf_path)
    page = doc[page_idx]
    mat  = page.transformation_matrix
    page_area = page.rect.width * page.rect.height

    raw_shapes = []
    for d in page.get_drawings():
        r = d.get("rect")
        if not r:
            continue
        x0,y0,x1,y1 = float(r[0]),float(r[1]),float(r[2]),float(r[3])
        area = abs((x1-x0)*(y1-y0))
        if area < 800 or area > 0.75 * page_area:
            continue
        # Exclude very elongated shapes (title bars, annotation lines)
        w,h = abs(x1-x0), abs(y1-y0)
        if max(w,h) / max(min(w,h), 0.1) > 6:
            continue
        dr = fitz.Rect(x0,y0,x1,y1) * mat
        dx0,dy0 = min(dr.x0,dr.x1), min(dr.y0,dr.y1)
        dx1,dy1 = max(dr.x0,dr.x1), max(dr.y0,dr.y1)
        raw_shapes.append((dx0,dy0,dx1,dy1))
    doc.close()

    # Keep only LEAF shapes (not containers of other shapes)
    def contains(outer, inner, tol=5):
        return (outer[0]-tol <= inner[0] and outer[1]-tol <= inner[1]
                and outer[2]+tol >= inner[2] and outer[3]+tol >= inner[3])

    leaf = []
    for i, s in enumerate(raw_shapes):
        is_container = any(
            j != i and contains(s, other)
            for j, other in enumerate(raw_shapes)
        )
        if not is_container:
            leaf.append(s)

    return leaf


def extract_piece_dims(pdf_path: str, page_idx: int) -> list[float]:
    """
    Extract dimension values from PDF text as a hint for the vision model.

    Algorithm:
      1. Collect all inch measurement strings (e.g. '110 3/4"', '43 1/2"', '27"').
         Keep counts of how many times each unique value appears.
      2. Filter: keep values >= 4.0". For small values (< 10"), require count >= 2
         (splash widths appear on every piece; single-occurrence small values are
         usually radii or note references).
      3. Rule B only — remove doubled-small values: if a_small + a_small ≈ V where
         a_small < 10" and count(a_small) >= 2 and count(V) <= 2, then V is likely
         a faucet offset (e.g. 4+4=8" on Deforest) rather than a piece edge.

    NOTE: The broad sum-pair cascade (Rule A) is intentionally NOT applied here.
    It caused false removals when internal measurements coincidentally summed to a
    value that was itself a sub-dim (e.g. Haven: 22+25.5=47.5, where 47.5 is a
    sub-dim of 98.5 — but 22" and 25.5" are real piece dimensions).
    Instead, the model receives the fuller list with a "PREFER" (not "MUST") constraint
    and uses visual context to reject internal sub-callouts.
    """
    doc  = fitz.open(pdf_path)
    page = doc[page_idx]
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    doc.close()

    # --- Step 1: collect raw values with counts + positions, and appliance/fixture
    # keyword positions (cooktop, sink, range, ...) ---
    counts: dict[float, int] = {}
    occurrences: dict[float, list[tuple]] = {}
    keyword_positions: list[tuple] = []
    for b in blocks:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if not raw:
                    continue
                if _APPLIANCE_KEYWORD_RE.search(raw):
                    x0, y0, x1, y1 = span["bbox"]
                    keyword_positions.append(((x0 + x1) / 2, (y0 + y1) / 2))
                if not _re.search(r'\d', raw):
                    continue
                if _re.search(r"[ØRø]|\d'-\d|scale|1'-0", raw, _re.IGNORECASE):
                    continue
                if _INCH_STR.match(raw) or _INCH_STR2.match(raw):
                    v = _parse_inch_str(raw)
                    if v is not None and v >= 4.0:
                        k = round(v, 4)
                        counts[k] = counts.get(k, 0) + 1
                        x0, y0, x1, y1 = span["bbox"]
                        occurrences.setdefault(k, []).append(((x0 + x1) / 2, (y0 + y1) / 2))

    # For small dimensions (< 10"), require at least 2 occurrences.
    values = [v for v in counts if v >= 10.0 or counts[v] >= 2]

    # --- Rule B only: remove doubled-small sums ---
    # e.g. 4+4=8 → 8 is a faucet offset, not a piece dimension.
    sub_dims: set[float] = set()
    tol = 0.2
    for a in values:
        if a >= 10.0:
            continue
        if counts[a] < 2:
            continue
        c = round(a + a, 4)
        match = next((v for v in values if abs(c - v) <= tol), None)
        if match is not None and counts[match] <= 2:
            sub_dims.add(match)

    # --- Rule C: remove values that ONLY ever occur right next to an appliance/
    # fixture label (cooktop, sink, range, ...) -- these are interior cutout
    # offsets, not outer piece dimensions, even though they pass the filters above.
    if keyword_positions:
        for v in values:
            if v in sub_dims:
                continue
            pts = occurrences.get(v, [])
            if pts and all(
                min(((x - kx) ** 2 + (y - ky) ** 2) ** 0.5 for kx, ky in keyword_positions)
                <= _APPLIANCE_PROXIMITY_PT
                for x, y in pts
            ):
                sub_dims.add(v)

    filtered = sorted(v for v in values if v not in sub_dims)
    return filtered


def compute_subdim_pairs(pdf_path: str, page_idx: int) -> tuple[list[tuple], dict[float, int]]:
    """
    Find (a, b, c) triples where a + b ≈ c and all three appear in the text.
    Also returns the raw occurrence counts so callers can decide whether each
    component is a true sub-dim (count == 1) or a multi-use value (count >= 2).
    Returns (pairs_list, counts_dict), pairs sorted by c descending.
    """
    doc   = fitz.open(pdf_path)
    page  = doc[page_idx]
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    doc.close()

    counts: dict[float, int] = {}
    for b in blocks:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if not raw or not _re.search(r'\d', raw):
                    continue
                if _re.search(r"[ØRø]|\d'-\d|scale|1'-0", raw, _re.IGNORECASE):
                    continue
                if _INCH_STR.match(raw) or _INCH_STR2.match(raw):
                    v = _parse_inch_str(raw)
                    if v is not None and v >= 4.0:
                        k = round(v, 4)
                        counts[k] = counts.get(k, 0) + 1

    values = sorted(counts.keys())
    tol    = 0.2
    pairs  = []
    seen   = set()
    for i, a in enumerate(values):
        for j, b in enumerate(values):
            if j < i:
                continue
            c = round(a + b, 4)
            match = next((v for v in values if abs(c - v) <= tol and v != a and v != b), None)
            if match is None:
                continue
            key = (min(a, b), max(a, b), match)
            if key not in seen:
                seen.add(key)
                pairs.append(key)
    pairs.sort(key=lambda t: -t[2])
    return pairs, counts


# ── Rendering ─────────────────────────────────────────────────────────────────

def _detect_content_rotation(page) -> int:
    """
    Heuristic: detect if the ENTIRE drawing content is plotted rotated.
    Returns 0 / 90 / 180 / 270 — the prerotate angle to apply.

    Key insight: well-formed CAD drawings always have SOME horizontal text
    (project title, notes, material labels).  If essentially ALL text blocks
    share the same non-horizontal direction, the drawing itself is rotated —
    not just the vertical dimension callouts.  We only correct in that case.

    In PyMuPDF, line['dir'] = (cos θ, sin θ) in screen coords (y-down):
      dir ≈ (1,  0) → normal left-to-right          → no correction
      dir ≈ (-1, 0) → right-to-left (upside-down)   → prerotate 180
      dir ≈ (0,  1) → top-to-bottom (CW 90°)        → prerotate 270
      dir ≈ (0, -1) → bottom-to-top (CCW 90°)       → prerotate 90 (only if
                                                         no horizontal blocks)
    """
    try:
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        dirs_x, dirs_y = [], []
        for b in blocks:
            for line in b.get("lines", []):
                d = line.get("dir", (1, 0))
                dirs_x.append(d[0])
                dirs_y.append(d[1])
        if not dirs_x:
            return 0
        avg_dx = sum(dirs_x) / len(dirs_x)
        avg_dy = sum(dirs_y) / len(dirs_y)
        # avg_dy > 0.5: dominant text direction is top-to-bottom (CW 90° rotation).
        # This unambiguously indicates the drawing is plotted sideways.
        # Apply 270° (≡ −90°) to bring it upright.
        if avg_dy > 0.5:
            return 270
        # avg_dy < -0.5: dominant text is bottom-to-top.  This is ALSO the standard
        # CAD convention for vertical dimension callouts in upright drawings, so we
        # cannot reliably distinguish rotation from convention here.  Do not correct.
        # avg_dx < -0.5: dominant text is right-to-left → upside-down.
        if avg_dx < -0.5:
            return 180
        return 0
    except Exception:
        return 0


def render_page_png(pdf_path: str, page_idx: int, scale: float) -> tuple:
    """
    Render a PDF page to PNG bytes at the given scale.
    Auto-corrects 180° upside-down content (common in some CAD exports).
    Returns (png_bytes, (width_px, height_px), rotation_applied).
    """
    doc  = fitz.open(pdf_path)
    page = doc[page_idx]

    extra_rot = _detect_content_rotation(page)
    mat = fitz.Matrix(scale, scale)
    if extra_rot:
        mat = fitz.Matrix(scale, scale).prerotate(extra_rot)

    pix  = page.get_pixmap(matrix=mat, alpha=False)
    png  = pix.tobytes("png")
    size = (pix.width, pix.height)
    doc.close()
    return png, size, extra_rot


# ── Comparison ────────────────────────────────────────────────────────────────

def compare(extracted: list, truth: list) -> bool:
    """
    Value-based comparison: for each truth piece, find the best-matching extracted
    piece (by sorted {L,W} pair, toleranced to ±0.1"). Reports each truth piece
    as matched or missing, and flags spurious extracted pieces.
    """
    tol = 0.13  # accept ⅛" (0.125") rounding, which is within stone fabrication tolerance

    def fmt(v):
        return f"{v:.3f}" if v is not None else " null"

    def sorted_pair(l, w):
        if l is None or w is None:
            return None
        return tuple(sorted([float(l), float(w)]))

    ex_pairs  = [sorted_pair(e.get("length_in"), e.get("width_in")) for e in extracted]
    tr_pairs  = [sorted_pair(t.get("length_in"), t.get("width_in")) for t in truth]

    def close(ep, tp):
        return (ep and tp and
                abs(ep[0]-tp[0]) <= tol and abs(ep[1]-tp[1]) <= tol)

    print(f"\n  {'EXPECTED label':<28} {'L':>8} {'W':>8}  |  "
          f"{'BEST MATCH':<28} {'L':>8} {'W':>8}  MATCH")
    print("  " + "-" * 112)

    matched_ex_idx = set()
    ok_all = True
    for ti, tr in enumerate(truth):
        tr_name = tr.get("label", "?")[:28]
        tr_l, tr_w = tr.get("length_in"), tr.get("width_in")
        tp = tr_pairs[ti]

        # Find the closest unused extracted piece
        best_idx, best_diff = None, float("inf")
        for ei, ep in enumerate(ex_pairs):
            if ei in matched_ex_idx or not ep or not tp:
                continue
            diff = abs(ep[0]-tp[0]) + abs(ep[1]-tp[1])
            if diff < best_diff:
                best_diff, best_idx = diff, ei

        if best_idx is not None and close(ex_pairs[best_idx], tp):
            ex = extracted[best_idx]
            matched_ex_idx.add(best_idx)
            ex_name = (ex.get("part_name") or ex.get("part_no") or "?")[:28]
            ex_l, ex_w = ex.get("length_in"), ex.get("width_in")
            print(f"  {tr_name:<28} {fmt(tr_l):>8} {fmt(tr_w):>8}  |  "
                  f"{ex_name:<28} {fmt(ex_l):>8} {fmt(ex_w):>8}  ✓")
        else:
            # Show closest even if not a match
            if best_idx is not None:
                ex = extracted[best_idx]
                ex_name = (ex.get("part_name") or ex.get("part_no") or "?")[:28]
                ex_l, ex_w = ex.get("length_in"), ex.get("width_in")
                print(f"  {tr_name:<28} {fmt(tr_l):>8} {fmt(tr_w):>8}  |  "
                      f"{ex_name:<28} {fmt(ex_l):>8} {fmt(ex_w):>8}  ✗ (closest)")
            else:
                print(f"  {tr_name:<28} {fmt(tr_l):>8} {fmt(tr_w):>8}  |  "
                      f"{'(missing)':<28} {'':>8} {'':>8}  ✗")
            ok_all = False

    # Report spurious extracted pieces
    spurious = [i for i in range(len(extracted)) if i not in matched_ex_idx]
    if spurious:
        print(f"\n  Spurious extracted pieces (not in ground truth):")
        for i in spurious:
            ex = extracted[i]
            ex_name = (ex.get("part_name") or ex.get("part_no") or "?")[:28]
            print(f"    [{i+1}] {ex_name}  L={ex.get('length_in')} W={ex.get('width_in')}")
        ok_all = False

    print()
    return ok_all


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    pdf_default = (
        "/Users/ranjithkodakandla/Downloads/Virgin Surfaces/"
        "Virgin Surfaces - Project/PDF/Concord North drawings (1).pdf"
    )
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else pdf_default
    page_idx = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
    if not api_key:
        sys.exit("NVIDIA_NIM_API_KEY not set.")

    print(f"\n{'='*64}")
    print(f"  PDF  : {Path(pdf_path).name}")
    print(f"  Page : {page_idx}   Scale: {RENDER_SCALE}x")
    print(f"  Model: {NIM_MODEL}")
    print(f"{'='*64}\n")

    # 1. Render full page + extract dimension hints
    print("Step 1: Rendering page …", end=" ", flush=True)
    png_bytes, (pw, ph), rot = render_page_png(pdf_path, page_idx, RENDER_SCALE)
    size_kb = len(png_bytes) / 1024
    rot_note = f"  (auto-rotated {rot}°)" if rot else ""
    print(f"{pw}×{ph}px  {size_kb:.0f}KB{rot_note}")

    known_dims              = extract_piece_dims(pdf_path, page_idx)
    sub_dim_pairs, dim_counts = compute_subdim_pairs(pdf_path, page_idx)
    print(f"  Extracted dims: {known_dims}")
    if sub_dim_pairs:
        print(f"  Sub-dim pairs : {sub_dim_pairs}")

    # Debug: show raw counts before filtering (useful for diagnosing which values got dropped)
    _raw = {}
    _doc = fitz.open(pdf_path)
    _pg  = _doc[page_idx]
    _blks = _pg.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    _doc.close()
    for _b in _blks:
        for _ln in _b.get("lines", []):
            for _sp in _ln.get("spans", []):
                _r = _sp.get("text", "").strip()
                if not _r or not _re.search(r'\d', _r): continue
                if _re.search(r"[ØRø]|\d'-\d|scale|1'-0", _r, _re.IGNORECASE): continue
                if _INCH_STR.match(_r) or _INCH_STR2.match(_r):
                    _v = _parse_inch_str(_r)
                    if _v is not None and _v >= 4.0:
                        _k = round(_v, 4)
                        _raw[_k] = _raw.get(_k, 0) + 1
    print(f"  Raw dim counts: { {k: _raw[k] for k in sorted(_raw)} }")

    # Save for inspection
    page_file = f"/tmp/page_{page_idx}.png"
    with open(page_file, "wb") as f:
        f.write(png_bytes)
    print(f"  Saved page render → {page_file}")

    # 2. Call NIM (chain-of-thought two-pass)
    print(f"\nStep 2: Calling NIM ({NIM_MODEL}) — 2-pass CoT …", end=" ", flush=True)
    try:
        results, elapsed, analysis, n_pieces_expected = call_nim_cot(
            png_bytes, api_key,
            known_dims=known_dims,
            sub_dim_pairs=sub_dim_pairs,
            dim_counts=dim_counts)
        print(f"{elapsed}s")
        print(f"\n  --- Pass 1 analysis ---\n{analysis}\n  --- end analysis ---\n")
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback; traceback.print_exc()
        return

    # 2b. Prune pieces that over-allocate a scarce dimension value (hallucinated
    # phantom pieces reusing another piece's value beyond its raw occurrence count)
    before = len(results)
    results = prune_overallocated_pieces(results, dim_counts, n_pieces_expected)
    if len(results) != before:
        print(f"  Pruned {before - len(results)} over-allocated (likely phantom) piece(s)")

    # 2c. On complex (6+ piece) sheets, try to geometrically recover the small
    # pieces from PDF text positions instead of trusting vision's reading of them
    _doc2 = fitz.open(pdf_path)
    _page2 = _doc2[page_idx]
    results, geo_status = apply_geometric_supplement(results, _page2)
    _doc2.close()
    print(f"  Geometric supplement: {geo_status}")

    # 3. Print raw extraction
    print(f"\nStep 3: Extracted {len(results)} piece(s) (JSON):\n")
    print(json.dumps(results, indent=2, ensure_ascii=False))

    # 4. Compare with ground truth
    stem   = Path(pdf_path).stem.lower()
    gt_key = (stem, page_idx)
    ok_all = None
    if gt_key in GROUND_TRUTH:
        print("\nStep 4: Comparing vs. ground truth …")
        ok_all = compare(results, GROUND_TRUTH[gt_key])
        if ok_all:
            print("  ALL CORRECT ✓")
        else:
            print("  Some errors — see ✗ rows above.")
    else:
        print(f"\n(No ground truth for '{stem}' page {page_idx} — raw output above.)")

    print(f"\n{'='*64}\n")


if __name__ == "__main__":
    main()
