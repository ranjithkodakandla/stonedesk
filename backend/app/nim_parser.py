"""
NIM Vision-based PDF parser for StoneDesk.

Uses NVIDIA NIM (meta/llama-3.2-90b-vision-instruct) to extract stone piece
dimensions from CAD fabrication drawings via a 3-pass chain-of-thought approach:

  Pass 1 – Layout: identify all stone piece rectangles without reading numbers
  Pass 2 – Dimensions: read outer callout values per piece, aided by PDF text hints
  Pass 3 – JSON: output structured result

Integration:
  - Called from main.py upload_pdf() when NVIDIA_NIM_API_KEY env var is set
  - parse_pdf_nim() returns the same {rows, metadata, ...} shape as pdf_parser.parse_pdf()
  - drawing/unit come from the same title-block parse pdf_parser.py uses, and each
    piece is expanded once per building/floor/flat destination from the same
    schedule-matrix parse, so NIM rows match pdf_parser's row-count convention.
  - Extraction method tag: "nim_vision"
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

from .pdf_parser import _spans as _pdf_spans, _parse_title_block, _parse_matrix

# ── Constants ─────────────────────────────────────────────────────────────────

NIM_URL     = "https://integrate.api.nvidia.com/v1/chat/completions"
NIM_MODEL   = "meta/llama-3.2-90b-vision-instruct"
NIM_TIMEOUT = 240      # seconds – 90B model can be slow
RENDER_SCALE = 2.0     # 144 DPI — sufficient for the model; 3x caused timeouts

# SSL context — no CA verification for local dev; production Cloud Run uses
# Google's trusted CA bundle, so verify_mode=CERT_REQUIRED there.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode    = ssl.CERT_NONE

# ── Prompts ───────────────────────────────────────────────────────────────────

_SYSTEM = (
    "You are a precision CAD drawing reader specialising in stone countertop "
    "fabrication drawings. You assign pre-extracted dimension text to the correct "
    "piece rectangles using the image as visual context."
)

_LAYOUT_PROMPT = """Look at this stone countertop fabrication drawing.

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

_DIMENSION_PROMPT = """Now, for each piece you described above, read its OUTER dimension callouts.

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

_EXTRACT_JSON_TMPL = """Based on your layout description and dimension readings above,
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

# ── Regex for inch dimension text ──────────────────────────────────────────────

_BRACKET  = r'(?:\s*\[\d+(?:\s*mm)?\])?'
_INCH_STR = re.compile(
    r'^(?:(?:\d+\s+\d+/\d+|\d+\.\d+|\d+)\s*"' + _BRACKET + r')$'
)
_INCH_STR2 = re.compile(
    r'^(?:(?:\d+\s+\d+/\d+|\d+\.\d+|\d+)\s*(?:in|")' + _BRACKET + r')$',
    re.IGNORECASE,
)


def _parse_inch(s: str) -> Optional[float]:
    """'110 3/4"' → 110.75, '25 3/8"' → 25.375, '30"' → 30.0"""
    s = re.sub(r'\s*\[.*?\]', '', s).strip().rstrip('"').strip()
    s = re.sub(r'\s*in\s*$', '', s, flags=re.IGNORECASE).strip()
    try:
        if ' ' in s:
            parts = s.split()
            return float(parts[0]) + float(parts[1].split('/')[0]) / float(parts[1].split('/')[1])
        if '/' in s:
            n, d = s.split('/')
            return float(n) / float(d)
        return float(s)
    except Exception:
        return None


_APPLIANCE_KEYWORD_RE = re.compile(
    r"cooktop|dishwasher|faucet|warmer|hood|microwave|farm|prep|oven|\bsink\b|\brange\b",
    re.IGNORECASE,
)
# Interior cutout/offset numbers (cooktop cutout width, faucet-hole spacing, etc.)
# always sit within ~1 inch of visual space of the appliance label they belong to;
# real outer piece callouts are drawn well outside the piece, always much farther
# from any interior appliance label. Empirically (Haven/Saltwell drawings) interior
# offsets measured 18-41pt from the nearest appliance keyword while every real
# outer callout measured 72pt+, so 55pt is a safe midpoint cutoff.
_APPLIANCE_PROXIMITY_PT = 55.0


def _extract_page_dims(page) -> Tuple[List[float], Dict[float, int]]:
    """
    Extract inch-measurement values from PDF text layer.

    Returns (filtered_dims, raw_counts):
      filtered_dims — values >= 4", with small values (< 10") requiring >= 2 occurrences,
                      double-small sums removed (e.g. 4+4=8 -> 8 excluded), and values
                      that ONLY ever appear right next to an appliance/fixture label
                      (cooktop, sink, range, ...) removed as interior cutout offsets.
      raw_counts    — occurrence count for every value seen before filtering.
    """
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    counts: Dict[float, int] = {}
    occurrences: Dict[float, List[Tuple[float, float]]] = {}
    keyword_positions: List[Tuple[float, float]] = []
    for b in blocks:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if not raw:
                    continue
                if _APPLIANCE_KEYWORD_RE.search(raw):
                    x0, y0, x1, y1 = span["bbox"]
                    keyword_positions.append(((x0 + x1) / 2, (y0 + y1) / 2))
                if not re.search(r'\d', raw):
                    continue
                if re.search(r"[ØRø]|\d'-\d|scale|1'-0", raw, re.IGNORECASE):
                    continue
                if _INCH_STR.match(raw) or _INCH_STR2.match(raw):
                    v = _parse_inch(raw)
                    if v is not None and v >= 4.0:
                        k = round(v, 4)
                        counts[k] = counts.get(k, 0) + 1
                        x0, y0, x1, y1 = span["bbox"]
                        occurrences.setdefault(k, []).append(((x0 + x1) / 2, (y0 + y1) / 2))

    values = [v for v in counts if v >= 10.0 or counts[v] >= 2]

    # Remove doubled-small sums (e.g. 4+4=8 → 8 is a faucet offset)
    sub_dims: set = set()
    for a in values:
        if a >= 10.0 or counts[a] < 2:
            continue
        c = round(a + a, 4)
        match = next((v for v in values if abs(c - v) <= 0.2), None)
        if match and counts[match] <= 2:
            sub_dims.add(match)

    # Remove values that ONLY ever occur right next to an appliance/fixture label
    # (e.g. a cooktop cutout's "20"/"29" width) -- these are interior offsets, not
    # outer piece dimensions, even though they pass the count/size filters above.
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
    return filtered, counts


def _dim_occurrences(page) -> List[Dict]:
    """Every individual inch-dimension text occurrence with its position, in
    the same coordinate space as get_text() (used for geometric matching)."""
    occ: List[Dict] = []
    for b in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if not raw or not re.search(r'\d', raw):
                    continue
                if re.search(r"[ØRø]|\d'-\d|scale|1'-0", raw, re.IGNORECASE):
                    continue
                if _INCH_STR.match(raw) or _INCH_STR2.match(raw):
                    v = _parse_inch(raw)
                    if v is not None and v >= 4.0:
                        x0, y0, x1, y1 = span["bbox"]
                        occ.append({"value": round(v, 4), "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2})
    return occ


def _occ_dist(a: Dict, b: Dict) -> float:
    return ((a["cx"] - b["cx"]) ** 2 + (a["cy"] - b["cy"]) ** 2) ** 0.5


def _grow_main_cluster(occ: List[Dict], roots: List[float], max_depth: int = 2) -> set:
    """
    Identify occurrences that are internal edge-splits of the main piece's own
    two outer dimensions (`roots`), e.g. an L-shape's 112" top edge printed
    elsewhere as "49" + "63" (63 itself further printed as "30" + "33").

    A candidate decomposition pair (a_occ, b_occ) for a value v = a + b is only
    accepted if BOTH occurrences are close to EACH OTHER (drawn as a stacked
    pair describing the same edge) AND their midpoint is close to the main
    shape's cluster built so far -- using midpoint-to-cluster distance alone
    is not enough, since two far-apart occurrences can have a midpoint that
    coincidentally lands near the cluster.

    Returns the set of occurrence ids (python `id()`) consumed into the main
    shape -- these are NOT real standalone pieces and must be excluded before
    pairing up whatever dimension text remains for the other pieces.
    """
    by_value: Dict[float, List[Dict]] = {}
    for o in occ:
        by_value.setdefault(o["value"], []).append(o)

    consumed_ids: set = set()
    cluster_points: List[Dict] = []
    queue: List[Tuple[Dict, int]] = []
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


# A real piece's length+width callouts are always drawn immediately flanking
# its own small rectangle. Calibrated against every drawing tested: the
# farthest legitimate pair seen was 184.4pt (a backsplash's own two callouts,
# drawn on opposite sides of a long thin strip); the closest confirmed-bogus
# "pairing" (an orphan internal reference number with no real partner, forced
# together with an unrelated leftover value) was 266.5pt. 220pt sits safely
# between the two.
_MAX_PAIR_DISTANCE_PT = 220.0


def _confident_pairing(occs: List[Dict], margin: float = 1.4) -> Tuple[Optional[List[Dict]], Optional[str]]:
    """
    Greedy nearest-neighbor pairing of leftover dimension occurrences into
    (length, width) pieces, with two safety gates:

      1. CONFIDENCE MARGIN: a pair is only accepted if EVERY occurrence's
         distance to its assigned partner is clearly smaller (by `margin`)
         than its distance to every other still-unpaired occurrence. If any
         pairing is ambiguous (a close second-best alternative exists), the
         whole result is rejected -- returning (None, reason) -- rather than
         silently guessing wrong. This is deliberately conservative: on
         drawings where two different pieces happen to share one dimension
         value (e.g. two pieces both 25.5" on one side), nearest-neighbor
         pairing can silently cross-match the wrong pair.

      2. ABSOLUTE DISTANCE CEILING: even an unambiguous "closest available"
         pair can be bogus when it's really an orphan internal reference
         number with no real partner (nothing else left to pair it with but
         something unrelated). Such forced pairs are always far apart
         (see _MAX_PAIR_DISTANCE_PT) -- these are dropped as noise rather
         than kept as a fabricated piece, without rejecting the rest of the
         (otherwise confident) pairing.
    """
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
            # Neither of these has a real partner left -- drop both as noise
            # rather than fabricate a piece out of two unrelated numbers.
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


def _appliance_keyword_positions(page) -> List[Tuple[float, float]]:
    positions = []
    for b in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "").strip()
                if raw and _APPLIANCE_KEYWORD_RE.search(raw):
                    x0, y0, x1, y1 = span["bbox"]
                    positions.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return positions


def _geometric_leftover_pieces(page, main_length: float, main_width: float) -> Optional[List[Dict]]:
    """
    Supplementary, non-vision extraction path for the OTHER pieces on a sheet
    once the main piece's own two dimensions are known (reliably, from vision).

    Deliberately does NOT restrict to the (pre-filtered) `known_dims` list --
    that filter requires >=2 occurrences for values under 10" to avoid noise
    like radii/note references, which also throws away genuine small-piece
    dimensions that only print once (e.g. a 7.5" filler strip). This method
    has its own independent noise defenses (main-shape decomposition,
    appliance-keyword proximity, confidence-margin pairing, distance ceiling)
    so it can safely work from the fuller occurrence set instead.

    Only ever returns a result when it can pair up every remaining dimension
    occurrence with high confidence (see _confident_pairing) -- otherwise
    returns None so the caller falls back to the vision model's own answer.
    """
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
        return None
    pairs, _err = _confident_pairing(leftover)
    return pairs


def _compute_subdim_pairs(known_dims: List[float], counts: Dict[float, int]) -> Tuple[List[Tuple], Dict[float, int]]:
    """Find (a, b, c) triples where a+b ≈ c in the dim list."""
    values = sorted(counts.keys())
    tol, pairs, seen = 0.2, [], set()
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


def _build_verified_dims_context(known_dims: List[float],
                                 sub_dim_pairs: List[Tuple],
                                 dim_counts: Dict[float, int]) -> str:
    """
    Build the dim-hint prefix for Pass 2.

    Pre-filters sub-dim values OUT of the preferred list so the model never
    receives contradictory instructions (list + exclude the same value).
    """
    excl: set = set()
    pair_strs: list = []
    if sub_dim_pairs and known_dims:
        max_dim   = max(known_dims)
        threshold = 0.60 * max_dim
        dc        = dim_counts or {}
        for a, b, c in sub_dim_pairs:
            if c < threshold:
                continue
            pair_strs.append(f"  {a}\" + {b}\" = {c}\"  → use {c}\" as the outer callout")
            if dc.get(a, 1) == 1:
                excl.add(a)
            if dc.get(b, 1) == 1:
                excl.add(b)

    prefix = ""
    if known_dims:
        valid_dims = [v for v in known_dims if v not in excl]
        dim_str    = ", ".join(f'{v}"' for v in valid_dims)
        prefix = (
            f"VERIFIED OUTER DIMENSION VALUES from this PDF's text layer "
            f"(sub-dimensions and internal offsets have already been removed from this list):\n"
            f"  {dim_str}\n"
            f"Every length_in and width_in you report MUST be one of these values "
            f"(or null if genuinely unreadable).  Do NOT use a value not in this list.\n\n"
        )
    if pair_strs and excl:
        excl_str = ", ".join(f'{v}"' for v in sorted(excl))
        prefix += (
            f"NOTE — the following values were found in the PDF text but are "
            f"SUB-DIMENSIONS (they subdivide a single edge, not outer callouts):\n"
            + "\n".join(pair_strs) + "\n"
            f"  These have been excluded from the verified list above: {excl_str}\n\n"
        )
    return prefix


# ── Rendering ──────────────────────────────────────────────────────────────────

def _detect_content_rotation(page) -> int:
    """Return 0/90/180/270 prerotate angle for pages where ALL text is rotated."""
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
        if avg_dy > 0.5:
            return 270
        if avg_dx < -0.5:
            return 180
        return 0
    except Exception:
        return 0


def _render_page_png(page, scale: float = RENDER_SCALE) -> Tuple[bytes, Tuple[int, int], int]:
    """Render a page to PNG bytes.  Returns (png, (w, h), rotation_applied)."""
    extra_rot = _detect_content_rotation(page)
    mat = fitz.Matrix(scale, scale)
    if extra_rot:
        mat = fitz.Matrix(scale, scale).prerotate(extra_rot)
    pix  = page.get_pixmap(matrix=mat, alpha=False)
    png  = pix.tobytes("png")
    size = (pix.width, pix.height)
    return png, size, extra_rot


# ── NIM API ───────────────────────────────────────────────────────────────────

def _nim_call(messages: list, max_tokens: int, api_key: str) -> dict:
    payload = {
        "model": NIM_MODEL,
        "messages": messages,
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


def _nim_extract_page(png_bytes: bytes, api_key: str,
                      known_dims: List[float],
                      sub_dim_pairs: List[Tuple],
                      dim_counts: Dict[float, int]) -> Tuple[List[Dict], float, str, int]:
    """
    3-pass CoT extraction for one page.
    Returns (pieces_list, elapsed_s, debug_analysis_text, layout_piece_count).
    """
    b64      = base64.b64encode(png_bytes).decode()
    data_url = f"data:image/png;base64,{b64}"

    t0 = time.time()

    # Pass 1 — layout
    msgs = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": data_url}},
            {"type": "text",      "text": _LAYOUT_PROMPT},
        ]},
    ]
    r1     = _nim_call(msgs, 768, api_key)
    layout = r1["choices"][0]["message"]["content"]

    # Count pieces described in layout (used to anchor JSON output count and,
    # downstream, to cap how many pieces the pruning safety net may drop).
    # NOTE: counting occurrences of "**Position:" (not anchored to a literal
    # leading newline, which rarely matches -- the model usually writes
    # "1. **Position:**" with the list marker in between) is the primary
    # signal; the numbered-list-line count is a fallback for when the model
    # skips the "**Position:**" label entirely.
    n_pieces = layout.count("**Position:")
    if n_pieces == 0:
        n_pieces = len(re.findall(r'^\s*\d+\.', layout, re.MULTILINE))
    n_pieces = max(1, n_pieces)

    # Pass 2 — dimension reading
    dim_ctx = _build_verified_dims_context(known_dims, sub_dim_pairs, dim_counts)
    msgs.append({"role": "assistant", "content": layout})
    msgs.append({"role": "user",      "content": dim_ctx + _DIMENSION_PROMPT})
    r2        = _nim_call(msgs, 1024, api_key)
    dims_text = r2["choices"][0]["message"]["content"]

    # Pass 3 — JSON
    extract_prompt = _EXTRACT_JSON_TMPL.format(n_pieces=n_pieces)
    msgs.append({"role": "assistant", "content": dims_text})
    msgs.append({"role": "user",      "content": extract_prompt})
    r3      = _nim_call(msgs, 1024, api_key)
    content = r3["choices"][0]["message"]["content"]
    elapsed = round(time.time() - t0, 1)

    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[:-1])
    cleaned = cleaned.strip()

    pieces = json.loads(cleaned)
    if isinstance(pieces, dict):
        pieces = pieces.get("pieces", pieces.get("items", [pieces]))

    analysis = f"=== PASS 1 (layout) ===\n{layout}\n\n=== PASS 2 (dimensions) ===\n{dims_text}"
    return pieces, elapsed, analysis, n_pieces


def _flag_and_prune_pieces(pieces: List[Dict], raw_counts: Dict[float, int],
                            expected_count: Optional[int] = None) -> List[Dict]:
    """
    Two independent safety nets over the vision model's raw piece list, both
    driven by how many times each dimension value actually appears in the PDF
    text layer (raw_counts):

    1. EXACT-DUPLICATE PAIRS: if two or more pieces end up with the identical
       (length, width) pair, that's a real "value swap" between two distinct
       physical pieces (seen on drawings with adjacent similarly-sized pieces,
       e.g. two range counters) -- the model picked the same wrong value for
       both instead of each piece's own value. We have no reliable way to know
       WHICH one is right, so instead of guessing (dropping one loses a real
       piece; keeping both loses correctness for one) we keep both and flag
       them for manual review via low confidence + a note.

    2. OVER-ALLOCATION: among the remaining (non-duplicate) pieces, a piece
       whose length_in/width_in would use a value more times than it is
       physically printed on the page is suspicious. This catches a phantom
       EXTRA piece (seen on drawings with 4+ pieces) whose values recombine
       other real pieces' numbers into a nonsensical pair that doesn't match
       any single other piece exactly (so rule 1 above can't catch it) -- e.g.
       a phantom piece using piece #1's length with piece #3's width.

       BUT an over-allocated value does not always mean the piece is fake --
       it can also mean a REAL piece's dimension was simply misread as a value
       that coincidentally matches another real piece's value (e.g. reading a
       side-splash's 21.625" as 22.5" because the main top is also 22.5").
       Deleting the piece in that case would silently drop a real physical
       piece from the order, which is worse than a wrong number a reviewer can
       catch. So we only actually DROP pieces while doing so still leaves at
       least `expected_count` (the layout pass's own piece count) pieces
       standing -- i.e. only the genuine excess above what the model itself
       said should be on the page. Any further over-allocated piece is instead
       flagged for review, never deleted.
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

    groups: Dict[Any, List[Dict]] = {}
    for p in pieces:
        pr = pair(p)
        if pr is not None:
            groups.setdefault(pr, []).append(p)

    dropped_ids = set()
    review_ids = set()
    for pr, group in groups.items():
        if len(group) < 2:
            continue
        labeled_members = [id(p) for p in group if labeled(p)]
        unlabeled_members = [id(p) for p in group if not labeled(p)]
        if len(labeled_members) == 1 and unlabeled_members:
            # one labeled "real" piece + blank-label duplicate(s) -> the blank
            # one(s) are a hallucinated repeat of the same piece; drop them
            dropped_ids.update(unlabeled_members)
        else:
            # two+ distinctly-labeled pieces sharing a pair (or all blank) --
            # a genuine value swap between real pieces; can't tell which is
            # wrong, so keep all and flag for manual review
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


# ── Row construction ──────────────────────────────────────────────────────────

_CATEGORY_KEYWORDS = {
    "Vanity":   ["vanity", "bathroom", "bath"],
    "Kitchen":  ["kitchen", "cook", "counter", "island", "range"],
    "Laundry":  ["laundry", "wash", "utility"],
    "Island":   ["island"],
    "Splashes": ["splash", "backsplash"],
    "Hearth":   ["hearth", "fireplace"],
    "Bar":      ["bar"],
}


def _infer_category(text: str) -> str:
    t = text.lower()
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        if any(k in t for k in keywords):
            return cat
    return ""


def _dim_str(v: Optional[float]) -> str:
    if v is None:
        return ""
    return str(int(v)) if v == int(v) else str(v)


def _build_nim_row(piece: Dict, row_id: int, page_num: int, project: Dict) -> Dict:
    """Convert a NIM extracted piece dict into a row compatible with parse_pdf() output."""
    part     = piece.get("part_name", "") or ""
    part_no  = piece.get("part_no", "") or ""
    if not part and part_no:
        part = ""   # part_no is not a text description

    length   = _dim_str(piece.get("length_in"))
    width    = _dim_str(piece.get("width_in"))
    sink_raw = (piece.get("sink_type") or "").strip()
    sink     = sink_raw if sink_raw else "No Sink"

    category = _infer_category(part)

    sq_ft = 0.0
    if length and width:
        try:
            sq_ft = round(float(length) * float(width) / 144, 2)
        except Exception:
            pass

    thickness = (piece.get("thickness") or project.get("thickness") or "3CM").strip() or "3CM"

    needs_review = bool(piece.get("_needs_review"))
    conf = {
        "part_no": 0.85 if part_no else 0.0,
        "length":  (0.4 if needs_review else 0.90) if length else 0.0,
        "width":   (0.4 if needs_review else 0.90) if width  else 0.0,
        "sink":    0.85 if sink_raw else 0.5,
    }
    notes = ("Verify dimensions -- matches another piece on this page exactly; "
              "the AI reader may have swapped values between two similar pieces."
              if needs_review else "")

    return {
        "_id":           row_id,
        "_page_num":     page_num,
        "_source":       "nim_vision",
        "_confidence":   conf,
        "_shape_bbox":   [0, 0, 0, 0],
        "drawing":       piece.get("drawing", "") or project.get("drawing", ""),
        "unit":          piece.get("unit", "") or project.get("unit", ""),
        "building":      piece.get("building", ""),
        "floor":         piece.get("floor", ""),
        "flat":          piece.get("flat", ""),
        "part_no":       part_no,
        "part":          part,
        "category":      category,
        "length":        length,
        "width":         width,
        "thickness":     thickness,
        "qty":           "1",
        "sq_ft":         str(sq_ft) if sq_ft > 0 else "",
        "sink_type":     sink,
        "sink_cut":      "-",
        "tap_holes":     "-",
        "grooves":       "-",
        "edge":          "None",
        "edge_area":     "",
        "radius":        "-",
        "notes":         notes,
        "weight_override": "",
    }


_COMPLEX_PAGE_PIECE_THRESHOLD = 5  # 6+ piece kitchen-style sheets are where
                                    # vision reliably undercounts/misreads small
                                    # pieces -- see _apply_geometric_supplement


def _apply_geometric_supplement(pieces: List[Dict], page) -> List[Dict]:
    """
    On complex sheets (many small, visually-similar pieces beyond one large
    main piece -- e.g. an L-shaped kitchen counter with several backsplash/
    filler strips), the vision model reliably gets the single largest piece
    right but frequently miscounts or misreads the several smaller ones
    (missing pieces entirely, or inventing values that don't appear in the
    PDF text at all).

    This recovers the small pieces geometrically from the PDF's own text
    positions instead of trusting the vision model's reading of them: seed a
    "main shape" cluster from the (reliable) largest piece's own two
    dimensions, subtract out whatever text is an internal edge-split of that
    shape, and pair up everything left over by proximity.

    Only engages when there are enough pieces that vision is known to
    struggle (_COMPLEX_PAGE_PIECE_THRESHOLD), and only ever REPLACES the
    non-main pieces when the geometric pairing succeeds with high confidence
    for every remaining piece (_confident_pairing's gate) -- otherwise this
    is a no-op and the vision model's original result stands unchanged.
    """
    if fitz is None or page is None or len(pieces) < _COMPLEX_PAGE_PIECE_THRESHOLD:
        return pieces

    def area(p):
        l, w = p.get("length_in"), p.get("width_in")
        return (l or 0) * (w or 0)

    main = max(pieces, key=area)
    if not main.get("length_in") or not main.get("width_in"):
        return pieces

    try:
        geo_pieces = _geometric_leftover_pieces(page, main["length_in"], main["width_in"])
    except Exception:
        return pieces
    if geo_pieces is None:
        return pieces

    new_pieces = [main]
    for gp in geo_pieces:
        new_pieces.append({
            "part_no": "", "part_name": "",
            "length_in": gp["length_in"], "width_in": gp["width_in"],
            "sink_type": "",
        })
    return new_pieces


def _page_title_and_destinations(page) -> Tuple[Dict, List[Dict]]:
    """
    Parse the same title block (drawing #, unit, thickness) and building/floor/
    flat schedule matrix that pdf_parser.py's coordinate-based parser uses, so
    NIM-corrected rows carry the exact same labels and get expanded to the same
    row count -- one row per (piece x destination), not one row per piece.
    """
    try:
        all_spans = _pdf_spans(page)
        title = _parse_title_block(all_spans)
        destinations = _parse_matrix(all_spans) or [{"building": "", "floor": "", "flat": ""}]
    except Exception:
        title, destinations = {}, [{"building": "", "floor": "", "flat": ""}]
    return title, destinations


def _expand_pieces_by_destination(pieces: List[Dict], title: Dict,
                                   destinations: List[Dict]) -> List[Dict]:
    """
    Mirrors pdf_parser.py's Layer 5 expansion: each identified piece is a single
    physical part TYPE that gets built once per unit (building/floor/flat) that
    uses this drawing. Tag every piece with the page's drawing #/unit/thickness
    (from the title block) before expanding, then emit one row per destination.
    """
    drawing_no = title.get("part_no", "")
    unit       = title.get("unit", "")
    thickness  = title.get("thickness", "")

    expanded: List[Dict] = []
    for p in pieces:
        base = dict(p)
        base.setdefault("drawing", "")
        base.setdefault("unit", "")
        base.setdefault("thickness", "")
        if not base["drawing"]:
            base["drawing"] = drawing_no
        if not base["unit"]:
            base["unit"] = unit
        if not base["thickness"]:
            base["thickness"] = thickness
        for dest in destinations:
            expanded.append({
                **base,
                "building": dest.get("building", ""),
                "floor":    dest.get("floor", ""),
                "flat":     dest.get("flat", ""),
            })
    return expanded


# ── Public API ────────────────────────────────────────────────────────────────

def parse_page_nim(pdf_bytes: bytes,
                   page_index: int,
                   project: Optional[Dict] = None,
                   api_key: Optional[str] = None) -> Dict:
    """
    Parse a SINGLE PDF page using NIM vision extraction (~60-90s).

    This is the primary production entry point.  The full-PDF parse_pdf_nim()
    is too slow for typical multi-page drawings (20-44 pages × 70s = hours).
    Instead the frontend calls this endpoint per-page on demand (e.g. when the
    coordinate-based parser returned 0 pieces for a page).

    Returns:
      {
        "rows":               [...],   # same shape as parse_pdf() rows
        "page_index":         int,
        "extraction_method":  "nim_vision",
        "elapsed_s":          float,
        "analysis":           str,     # debug: Pass1+Pass2 text
        "error":              str | None,
      }
    """
    project = project or {}
    api_key = api_key or os.environ.get("NVIDIA_NIM_API_KEY", "")

    if not fitz:
        return {"rows": [], "error": "PyMuPDF (fitz) not installed",
                "page_index": page_index, "extraction_method": "nim_vision"}
    if not api_key:
        return {"rows": [], "error": "NVIDIA_NIM_API_KEY not set",
                "page_index": page_index, "extraction_method": "nim_vision"}

    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_index < 0 or page_index >= doc.page_count:
            return {"rows": [], "error": f"Page index {page_index} out of range (0-{doc.page_count-1})",
                    "page_index": page_index, "extraction_method": "nim_vision"}
        page = doc[page_index]

        known_dims, raw_counts = _extract_page_dims(page)
        sub_pairs, _           = _compute_subdim_pairs(known_dims, raw_counts)
        png, (pw, ph), rot     = _render_page_png(page)
        title, destinations    = _page_title_and_destinations(page)

        pieces, elapsed, analysis, n_pieces_expected = _nim_extract_page(
            png, api_key, known_dims, sub_pairs, raw_counts
        )
        pieces = _flag_and_prune_pieces(pieces, raw_counts, n_pieces_expected)
        pieces = _apply_geometric_supplement(pieces, page)
        pieces = _expand_pieces_by_destination(pieces, title, destinations)
        doc.close()

        rows = []
        for i, p in enumerate(pieces):
            row = _build_nim_row(p, i + 1, page_index + 1, project)
            rows.append(row)

        return {
            "rows":              rows,
            "page_index":        page_index,
            "extraction_method": "nim_vision",
            "elapsed_s":         elapsed,
            "analysis":          analysis,
            "page_width":        pw,
            "page_height":       ph,
            "rotation":          rot,
            "known_dims":        known_dims,
            "error":             None,
        }

    except Exception as e:
        return {
            "rows":              [],
            "page_index":        page_index,
            "extraction_method": "nim_vision",
            "elapsed_s":         0.0,
            "analysis":          "",
            "error":             str(e),
        }


def parse_pdf_nim(pdf_bytes: bytes,
                  project: Optional[Dict] = None,
                  api_key: Optional[str] = None) -> Dict:
    """
    Parse a PDF using NIM vision-based extraction.

    Returns the same {rows, metadata, extraction_method, row_count,
    overall_confidence, review_data} shape as pdf_parser.parse_pdf().

    Building / floor / flat fields are left empty — the frontend review
    UI allows users to fill these in before saving.
    """
    project = project or {}
    api_key = api_key or os.environ.get("NVIDIA_NIM_API_KEY", "")

    if not fitz:
        return {
            "rows": [], "metadata": {}, "extraction_method": "none",
            "row_count": 0, "overall_confidence": 0.0,
            "error": "PyMuPDF (fitz) not installed",
        }
    if not api_key:
        return {
            "rows": [], "metadata": {}, "extraction_method": "none",
            "row_count": 0, "overall_confidence": 0.0,
            "error": "NVIDIA_NIM_API_KEY not set",
        }

    result_rows: List[Dict] = []
    page_reports: List[Dict] = []
    page_dims_meta: Dict[int, List[float]] = {}
    row_id = 1

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num, page in enumerate(doc, start=1):
            page_dims_meta[page_num] = [page.rect.width, page.rect.height]
            page_report: Dict[str, Any] = {
                "page_num":   page_num,
                "template":   "nim_vision",
                "warnings":   [],
                "errors":     [],
                "elapsed_s":  0.0,
                "analysis":   "",
            }
            try:
                known_dims, raw_counts = _extract_page_dims(page)
                sub_pairs, _           = _compute_subdim_pairs(known_dims, raw_counts)
                png, (pw, ph), rot     = _render_page_png(page)
                title, destinations    = _page_title_and_destinations(page)

                page_report["page_width"]  = pw
                page_report["page_height"] = ph
                page_report["rotation"]    = rot
                page_report["known_dims"]  = known_dims

                pieces, elapsed, analysis, n_pieces_expected = _nim_extract_page(
                    png, api_key, known_dims, sub_pairs, raw_counts
                )
                pieces = _flag_and_prune_pieces(pieces, raw_counts, n_pieces_expected)
                pieces = _apply_geometric_supplement(pieces, page)
                pieces = _expand_pieces_by_destination(pieces, title, destinations)
                page_report["elapsed_s"] = elapsed
                page_report["analysis"]  = analysis
                page_report["pieces_extracted"] = len(pieces)

                for p in pieces:
                    row = _build_nim_row(p, row_id, page_num, project)
                    result_rows.append(row)
                    row_id += 1

            except json.JSONDecodeError as e:
                page_report["errors"].append(f"JSON parse error: {e}")
                page_report["warnings"].append("NIM returned non-JSON response")
            except Exception as e:
                page_report["errors"].append(str(e))
                page_report["warnings"].append(f"page {page_num} extraction failed: {e}")

            page_reports.append(page_report)
        doc.close()
    except Exception as e:
        return {
            "rows": [], "metadata": {"error": str(e)},
            "extraction_method": "nim_vision",
            "row_count": 0, "overall_confidence": 0.0,
            "error": str(e),
        }

    # Overall confidence
    overall = 0.0
    if result_rows:
        scores = []
        for r in result_rows:
            c = r.get("_confidence", {})
            if c:
                scores.append(sum(c.values()) / len(c))
        if scores:
            overall = round(sum(scores) / len(scores), 2)

    # review_data (piece bboxes) — NIM doesn't detect bboxes, so shapes list is empty
    _review_pages: Dict[int, Dict] = {}
    for r in result_rows:
        pn = r.get("_page_num", 1)
        if pn not in _review_pages:
            pw, ph = page_dims_meta.get(pn, [792.0, 612.0])
            _review_pages[pn] = {
                "page_num": pn, "page_width": pw, "page_height": ph, "shapes": [],
            }

    return {
        "rows":               result_rows,
        "metadata":           {
            "page_reports":   page_reports,
            "page_summary":   {
                "total_pages": len(page_reports),
                "nim_pages":   len(page_reports),
            },
            "template_counts": {"nim_vision": len(page_reports)},
        },
        "extraction_method":  "nim_vision",
        "row_count":          len(result_rows),
        "overall_confidence": overall,
        "review_data":        {
            "pages": sorted(_review_pages.values(), key=lambda p: p["page_num"])
        },
        "debug": {
            "enabled": True,
            "pages":   page_reports,
        },
    }
