"""
PDF parsing module for StoneDesk.

Template A: Coordinate-based parser for CAD fabrication drawing sheets.
  - Landscape letter (792×612 pts)
  - Title block: y < 115
  - Drawing area: x < 455, y > 120  (piece shapes + dimension callouts)
  - Matrix (Bldg/Flat): x > 460, y 130–560
  - Multi-page, multi-piece: each page → N pieces × M destinations = N×M rows

Extraction layers:
  Layer 1 – title block: drawing#, unit, description, material, thickness, sink, qty
  Layer 2 – geometry: detect rectangular piece shapes via vector paths
  Layer 3 – dimension association: attach nearest 'in [' callouts to each shape
  Layer 4 – matrix: parse building/floor/flat schedule (expanded y/x ranges)
  Layer 5 – expansion: piece_count × destinations → final row list

Falls back to pdfplumber table extraction for non-Template-A PDFs.
"""

import io
import os
import re
from typing import Any, Dict, List, Optional, Tuple

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None


# ── Constants ────────────────────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    "Vanity":   ["vanity", "bathroom", "bath", "vanity top"],
    "Kitchen":  ["kitchen", "cook", "counter", "island", "range"],
    "Laundry":  ["laundry", "wash", "utility"],
    "Island":   ["island"],
    "Splashes": ["splash", "backsplash"],
    "Hearth":   ["hearth", "fireplace", "mantle"],
    "Bar":      ["bar top", "bar back", "bar side"],
}

EDGE_TYPES = ["Eased", "Bullnose", "Bevel", "Ogee", "Miter", "Waterfall", "Laminate", "None"]

HEADER_ALIASES: Dict[str, List[str]] = {
    "drawing":   ["drawing", "dwg", "drawing #", "drawing no", "dwg #", "drawing number"],
    "unit":      ["unit", "unit name", "suite", "apt", "apartment name"],
    "building":  ["building", "bldg", "block", "tower"],
    "floor":     ["floor", "level", "flr", "storey"],
    "flat":      ["flat", "unit no", "apartment", "suite no", "flat #", "unit #", "apt #"],
    "part_no":   ["part #", "part no", "item #", "item no", "part number", "piece #"],
    "part":      ["description", "part", "part name", "item description", "piece"],
    "category":  ["category", "cat", "type", "location", "room"],
    "length":    ["length", "len", "l", "long", "l (in)", "length (in)"],
    "width":     ["width", "wid", "w", "wide", "w (in)", "width (in)"],
    "thickness": ["thickness", "thick", "thk", "cm"],
    "qty":       ["qty", "quantity", "count", "pcs", "pieces", "no."],
    "sink_type": ["sink", "sink type", "sink cutout", "bowl"],
    "tap_holes": ["tap holes", "taps", "tap", "faucet holes", "holes"],
    "grooves":   ["grooves", "groove", "channel"],
    "edge":      ["edge", "edge type", "edge profile", "profile"],
    "edge_area": ["edge area", "edge sides", "sides", "polished sides"],
    "radius":    ["radius", "r", "corner radius", "rad"],
    "notes":     ["notes", "note", "remarks", "comments", "special"],
}

# Template A coordinate tolerances
_TITLE_Y_MAX = 115.0
_DIM_X_MAX = 450.0
_DIM_Y_MIN = 120.0
_MATRIX_X_MIN = 455.0
_MATRIX_Y_MIN = 130.0
_MATRIX_Y_MAX = 780.0   # expanded to include bottom-page destination matrices

# Title block x-bands (±tolerance)
_TB = {
    "part_no":       (575, 600, 10.0, 20.0),   # Work Ticket #: x≈582, size≈16
    "unit":          (448, 465, 12.0, 17.0),   # Unit: x≈454, size≈14
    "desc1":         (465, 480, 12.0, 17.0),   # Description line 1: x≈470
    "desc2":         (480, 495, 12.0, 17.0),   # Description line 2: x≈486
    "thickness_val": (155, 200, 14.0, 20.0),   # Thickness value: x≈167, size≈16
    "qty_val":       (240, 290, 15.0, 22.0),   # Quantity: x≈253, size≈18
    "sink":          (290, 370, 8.0, 16.0),    # Sink info: x≈297-358
    "project":       (360, 435, 10.0, 16.0),   # Project name: x≈376-423
    "date":          (522, 540, 5.0, 10.0),    # Date: x≈528, size≈7
}

# Matrix region x-bounds
_BLD_X_MIN = 470         # slightly wider band for building column (was 475)
_BLD_X_MAX = 505         # expanded (was 492)
_FLAT_HDR_Y_MIN = 208
_FLAT_HDR_Y_MAX = 220
_FLOOR_Y_MIN = 270
_FLOOR_Y_MAX = 285
_TOTAL_X_MIN = 740       # expanded: was 568, now captures far-right flat columns
_MATRIX_ROW_TOL = 18.0   # y-band tolerance for flat→building association (was 14)

# Drawing-area shape detection thresholds
_DRAWING_X_MAX = 458.0   # x boundary for piece-shape search
_SHAPE_MIN_AREA = 220.0  # pts² — excludes hairlines and tiny annotation boxes
_SHAPE_MIN_DIM  = 10.0   # pts — minimum width OR height for a candidate shape

# Words that appear in the building column but are NOT building identifiers
_BLD_SKIP_WORDS = {
    "IN", "QT", "QTY", "TOT", "SUM", "BLK", "FLR", "BLD", "FLT", "NO",
    "BLDG", "FLAT", "UNIT", "FLOOR", "TOTAL", "BLOCK", "TOWER",
}

PARSER_DEBUG = os.getenv("PDF_PARSER_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _spans(page) -> List[Dict]:
    """Return all text spans from a page as flat list with bbox fields."""
    result = []
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:
                    continue
                x0, y0, x2, y2 = span["bbox"]
                result.append({
                    "text": text,
                    "x0": x0, "y0": y0, "x2": x2, "y2": y2,
                    "cx": (x0 + x2) / 2,
                    "cy": (y0 + y2) / 2,
                    "size": round(span.get("size", 0), 1),
                })
    return result


def _in_band(span: Dict, x_min: float, x_max: float, size_min: float, size_max: float) -> bool:
    return (x_min <= span["x0"] <= x_max and size_min <= span["size"] <= size_max)


def _normalize_thickness(val: str) -> str:
    if not val:
        return ""
    v = val.strip().upper()
    has_2 = ("2" in v) and ("CM" in v or "20" in v)
    has_3 = ("3" in v) and ("CM" in v or "30" in v)
    if has_2 and has_3:
        return "Mixed"
    if "2" in v and ("CM" in v or "20" in v):
        return "2CM"
    if "3" in v and ("CM" in v or "30" in v):
        return "3CM"
    if "20MM" in v or "20 MM" in v:
        return "2CM"
    if "30MM" in v or "30 MM" in v:
        return "3CM"
    return v


def _normalize_edge(val: str) -> str:
    if not val:
        return "None"
    v = val.strip().title()
    for e in EDGE_TYPES:
        if e.lower() in v.lower():
            return e
    return v or "None"


def _clean_dim(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    m = re.match(r"^([\d.]+)", s)
    return m.group(1) if m else s


def _clean_qty(val: Any) -> int:
    try:
        return max(1, int(float(str(val).strip())))
    except (ValueError, TypeError):
        return 1


def _infer_category(text: str) -> str:
    tl = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in tl for kw in keywords):
            return cat
    return "Other"


def _score_dimension(val: Any) -> float:
    try:
        v = float(str(val).replace('"', "").strip())
        if 3 <= v <= 240:
            return 0.95
        return 0.55 if v > 0 else 0.1
    except (ValueError, TypeError):
        return 0.1


def _score_field(field: str, val: Any) -> float:
    if val is None or str(val).strip() == "":
        return 0.0
    s = str(val).strip()
    if field in ("length", "width"):
        return _score_dimension(s)
    if field == "qty":
        try:
            v = int(float(s))
            return 0.92 if 1 <= v <= 100 else 0.5
        except (ValueError, TypeError):
            return 0.1
    if field == "part_no":
        return 0.9 if re.match(r"^[\w\-\.\/]+$", s) else 0.5
    if field == "category":
        known = ["Vanity", "Kitchen", "Laundry", "Island", "Splashes", "Hearth", "Bar", "Utility", "Other"]
        return 0.95 if s in known else 0.6
    if field == "thickness":
        return 0.95 if s in ("2CM", "3CM", "Mixed") else 0.5
    return 0.8


def _filter_offset_dims(values: List[float], tol: float = 1.5) -> List[float]:
    """
    Remove offset sub-components from a list of dimension values.
    Rule: if a + b ≈ c for any triple (c > a, c > b), a and b are offset
    dimensions (e.g. sink-to-edge distances) and should be discarded.
    Example: [55, 28, 27, 22.5] → 28+27=55 → returns [55, 22.5].
    """
    if len(values) < 3:
        return list(values)
    vals = sorted(set(values), reverse=True)
    to_remove: set = set()
    for i, big in enumerate(vals):
        for j in range(i + 1, len(vals)):
            a = vals[j]
            if a in to_remove:
                continue
            for k in range(j + 1, len(vals)):
                b = vals[k]
                if b in to_remove:
                    continue
                if abs(a + b - big) <= tol:
                    to_remove.add(a)
                    to_remove.add(b)
    return [v for v in vals if v not in to_remove]


def _debug_enabled(project: Optional[Dict] = None) -> bool:
    project = project or {}
    if project.get("parser_debug") or project.get("pdf_debug") or project.get("debug_parser"):
        return True
    return PARSER_DEBUG


def _new_page_report(page_num: int, template: str) -> Dict[str, Any]:
    return {
        "page": page_num,
        "template": template,
        "drawing_no": "",
        "unit": "",
        "category": "",
        "rectangles_found": 0,
        "rectangles_kept": 0,
        "rectangles_filtered": 0,
        "dimensions_found": 0,
        "dimensions_bound": 0,
        "destinations_found": 0,
        "pieces_found": 0,
        "expected_rows": 0,
        "generated_rows": 0,
        "warnings": [],
    }


def _log_page_report(report: Dict[str, Any], debug: bool = False) -> None:
    if not debug:
        return
    warning_str = f" warnings={'; '.join(report['warnings'])}" if report.get("warnings") else ""
    print(
        "[PDF] p{page} {template} drawing={drawing} unit={unit} pieces={pieces} dests={dests} "
        "rows={rows}/{expected} rects={rects}/{kept} dims={dims}/{bound}{warnings}".format(
            page=report.get("page", "?"),
            template=report.get("template", "unknown"),
            drawing=report.get("drawing_no", ""),
            unit=report.get("unit", ""),
            pieces=report.get("pieces_found", 0),
            dests=report.get("destinations_found", 0),
            rows=report.get("generated_rows", 0),
            expected=report.get("expected_rows", 0),
            rects=report.get("rectangles_found", 0),
            kept=report.get("rectangles_kept", 0),
            dims=report.get("dimensions_found", 0),
            bound=report.get("dimensions_bound", 0),
            warnings=warning_str,
        )
    )


def _summarize_page_reports(page_reports: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(page_reports)
    parsed = sum(1 for p in page_reports if p.get("generated_rows", 0) > 0)
    zero_rows = sum(1 for p in page_reports if p.get("generated_rows", 0) == 0)
    overage = sum(1 for p in page_reports if "overage" in " ".join(p.get("warnings", [])).lower())
    blank_or_legend = sum(
        1
        for p in page_reports
        if p.get("generated_rows", 0) == 0 and "overage" not in " ".join(p.get("warnings", [])).lower()
    )
    return {
        "pages_total": total,
        "pages_parsed": parsed,
        "pages_zero_rows": zero_rows,
        "pages_overage": overage,
        "pages_blank_or_legend": blank_or_legend,
    }


def _iter_point_coords(value: Any):
    if value is None:
        return
    if hasattr(value, "x") and hasattr(value, "y"):
        yield float(value.x), float(value.y)
        return
    if hasattr(value, "x0") and hasattr(value, "y0") and hasattr(value, "x1") and hasattr(value, "y1"):
        yield float(value.x0), float(value.y0)
        yield float(value.x1), float(value.y1)
        return
    if isinstance(value, (tuple, list)):
        if len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            yield float(value[0]), float(value[1])
            return
        for item in value:
            yield from _iter_point_coords(item)


def _drawing_bbox(path: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    rect = path.get("rect")
    if rect is not None:
        try:
            x0, y0, x1, y1 = float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])
            if x1 > x0 and y1 > y0:
                return x0, y0, x1, y1
        except Exception:
            pass

    xs: List[float] = []
    ys: List[float] = []
    for item in path.get("items", []) or []:
        for obj in item[1:]:
            for x, y in _iter_point_coords(obj):
                xs.append(x)
                ys.append(y)
    if xs and ys:
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        if x1 > x0 and y1 > y0:
            return x0, y0, x1, y1
    return None


def _classify_dim_role(span: Dict[str, Any], shape: Optional[Tuple[float, float, float, float]]) -> Optional[str]:
    if not shape:
        return None
    sx0, sy0, sx1, sy1 = shape
    cx = (sx0 + sx1) / 2.0
    cy = (sy0 + sy1) / 2.0
    dx = abs(span["cx"] - cx)
    dy = abs(span["cy"] - cy)
    return "length" if dy >= dx else "width"


def _pick_length_width_from_spans(
    spans: List[Dict[str, Any]],
    shape: Optional[Tuple[float, float, float, float]] = None,
    parse_value_fn=None,
) -> Dict[str, Any]:
    parse_value_fn = parse_value_fn or (lambda t: _parse_inch_value(t))
    length_candidates: List[float] = []
    width_candidates: List[float] = []
    all_plain: List[float] = []
    radius_val = ""
    tap_count = 0

    for span in spans:
        t = span.get("text", "")
        prefix_m = re.match(r"^([RØO])", t.strip(), re.IGNORECASE)
        is_radius = bool(prefix_m and prefix_m.group(1).upper() == "R")
        is_tap = bool(prefix_m and prefix_m.group(1).upper() in ("Ø", "O"))
        val = parse_value_fn(t)
        if val is None:
            continue
        if is_radius:
            radius_val = str(val)
            continue
        if is_tap:
            tap_count += 1
            continue

        all_plain.append(val)
        role = _classify_dim_role(span, shape)
        if role == "length":
            length_candidates.append(val)
        elif role == "width":
            width_candidates.append(val)

    unique_plain = sorted(set(all_plain), reverse=True)
    if not unique_plain:
        return {
            "length": "",
            "width": "",
            "radius": radius_val or "-",
            "tap_holes": "-" if tap_count == 0 else str(tap_count),
            "plain_count": 0,
            "bound_count": 0,
        }

    def _pick(vals: List[float]) -> Optional[float]:
        uniq = sorted(set(vals), reverse=True)
        return uniq[0] if uniq else None

    if shape and (length_candidates or width_candidates):
        sx0, sy0, sx1, sy1 = shape
        shape_w = sx1 - sx0
        shape_h = sy1 - sy0
        # On these CAD sheets, the longer physical dimension is usually drawn
        # along the larger visual axis of the shape. Use that to decide whether
        # to prefer the nearest horizontal-vs-vertical callouts.
        if shape_h >= shape_w:
            length = _pick(width_candidates) or unique_plain[0]
            width = _pick(length_candidates) or ""
        else:
            # Shape is wider than tall: horizontal annotations (above/below) → length
            # Vertical annotations (left/right) → width
            length = _pick(length_candidates) or unique_plain[0]
            width  = _pick(width_candidates) if width_candidates else ""
            # Fallback when no width candidate: use offset-pair filter on length
            # candidates to recover the true slab depth (e.g. 22.5 from [55, 28, 27, 22.5])
            if not width and len(length_candidates) >= 3:
                _filt = _filter_offset_dims(length_candidates)
                if len(_filt) >= 2:
                    length, width = _filt[0], _filt[1]
            if not width and len(unique_plain) > 1:
                _others = [v for v in unique_plain if abs(v - float(length or 0)) > 1e-6]
                if _others:
                    width = _others[0]
    else:
        length = _pick(length_candidates) or unique_plain[0]
        remaining = [v for v in unique_plain if abs(v - length) > 1e-6]
        width = _pick(width_candidates) or (remaining[0] if remaining else "")

    return {
        "length": str(length) if length != "" else "",
        "width": str(width) if width != "" else "",
        "radius": radius_val or "-",
        "tap_holes": "-" if tap_count == 0 else str(tap_count),
        "plain_count": len(unique_plain),
        "bound_count": len(length_candidates) + len(width_candidates),
    }


# ── Template A: title block ───────────────────────────────────────────────────

def _parse_title_block(spans: List[Dict]) -> Dict:
    title_spans = [s for s in spans if s["y0"] < _TITLE_Y_MAX]

    part_no = ""
    unit = ""
    desc_lines: List[Tuple[float, float, str]] = []   # (x0, y0, text)
    thickness_val = ""
    qty_val = ""
    sink_texts: List[str] = []
    project_texts: List[str] = []

    for s in title_spans:
        t = s["text"]
        x0, sz = s["x0"], s["size"]

        # Work Ticket # — large text far right
        if _in_band(s, *_TB["part_no"]):
            part_no = t

        # Unit — mid-right
        elif _in_band(s, *_TB["unit"]) and not t.lower().startswith("unit"):
            unit = t

        # Description lines (two x-bands around 470–490)
        elif (_in_band(s, *_TB["desc1"]) or _in_band(s, *_TB["desc2"])):
            # skip obvious labels
            lower = t.lower()
            if not any(kw in lower for kw in ("description", "unit:", "project", "date", "drawing")):
                desc_lines.append((s["x0"], s["y0"], t))

        # Thickness value (label is at x≈154, value is to its right)
        elif _in_band(s, *_TB["thickness_val"]):
            lower = t.lower()
            if "material" not in lower and "thickness" not in lower:
                thickness_val = t

        # Quantity value
        elif _in_band(s, *_TB["qty_val"]):
            lower = t.lower()
            if "quantity" not in lower and "qty" not in lower:
                qty_val = t

        # Sink info
        elif _in_band(s, *_TB["sink"]):
            lower = t.lower()
            if any(kw in lower for kw in ("undermount", "bowl", "model", "cut", "sink", "no sink", "overmount")):
                sink_texts.append(t)

        # Project name
        elif _in_band(s, *_TB["project"]):
            lower = t.lower()
            if not any(kw in lower for kw in ("project", "job", "customer", "date", "drawing", "revision")):
                project_texts.append(t)

    # Description text is laid out visually left-to-right on these sheets.
    # Sorting by y alone flips important phrases like 'Right Wall' and 'Vanity Top'.
    desc_lines.sort(key=lambda x: (x[0], x[1]))
    desc_parts = [d[2] for d in desc_lines]

    part_name = " ".join(desc_parts[:2]).strip() if desc_parts else ""
    desc2 = desc_parts[2] if len(desc_parts) > 2 else ""
    cat_hint = " ".join(desc_parts[3:]).strip() if len(desc_parts) > 3 else ""

    # Category inference should ignore Overage noise unless no real category exists.
    combined_text = " ".join(desc_parts).lower()
    category = _infer_category(re.sub(r"\b(?:ovg|overage)\b", " ", combined_text))
    if category == "Other" and ("ovg" in combined_text or "overage" in combined_text):
        category = "Overage"

    # Sink assembly
    sink_type = "No Sink"
    if sink_texts:
        first = sink_texts[0].strip()
        if "no sink" in first.lower():
            sink_type = "No Sink"
        elif "undermount" in first.lower():
            sink_type = "Undermount"
        elif "overmount" in first.lower():
            sink_type = "Overmount"
        else:
            sink_type = first

    # Thickness normalisation
    raw_thick = ""
    # Sometimes thickness appears as "3CM" or "30MM" directly; sometimes as "1 1/4\"" fractional
    if thickness_val:
        raw_thick = _normalize_thickness(thickness_val)
    if not raw_thick:
        # scan all title block spans for CM/MM mentions
        for s in title_spans:
            m = re.search(r"(\d+)\s*(CM|MM)", s["text"], re.IGNORECASE)
            if m:
                raw_thick = _normalize_thickness(m.group(0))
                break
    if not raw_thick and any("2cm" in s["text"].lower() for s in title_spans) and any("3cm" in s["text"].lower() for s in title_spans):
        raw_thick = "Mixed"

    project_name = " ".join(project_texts).strip()
    unit_display = unit  # keep unit identifier separate from part description

    confidence = {
        "part_no":   _score_field("part_no", part_no),
        "unit":      0.85 if unit else 0.0,
        "part":      0.88 if part_name else 0.0,
        "category":  _score_field("category", category),
        "thickness": _score_field("thickness", raw_thick) if raw_thick else 0.3,
        "qty":       _score_field("qty", qty_val),
    }

    return {
        "part_no":     part_no,
        "unit":        unit_display,
        "part":        part_name,
        "desc2":       desc2,
        "category":    category,
        "thickness":   raw_thick or "3CM",
        "qty":         _clean_qty(qty_val) if qty_val else 1,
        "sink_type":   sink_type,
        "project":     project_name,
        "_confidence": confidence,
    }


# ── Template A: dimensions ────────────────────────────────────────────────────

_DIM_RE = re.compile(r"(R|Ø|O)?([\d.]+(?:/\d+)?)\s*in\s*\[", re.IGNORECASE)
_FRAC_RE = re.compile(r"(\d+)\s+(\d+)/(\d+)")


def _parse_inch_value(text: str) -> Optional[float]:
    """Extract inch value from strings like '54.875 in [1394 mm]' or '23 1/2 in ['."""
    # Try fractional first: "23 1/2 in ["
    m = _FRAC_RE.search(text)
    if m:
        whole = int(m.group(1))
        num = int(m.group(2))
        den = int(m.group(3))
        return round(whole + num / den, 3)
    # Try decimal: "54.875 in ["
    m2 = re.search(r"([\d.]+)\s*in\s*\[", text, re.IGNORECASE)
    if m2:
        try:
            return round(float(m2.group(1)), 3)
        except ValueError:
            pass
    return None


def _parse_dimensions(spans: List[Dict]) -> Dict:
    dim_spans = [
        s for s in spans
        if s["x0"] < _DIM_X_MAX and s["y0"] > _DIM_Y_MIN and "in [" in s["text"]
    ]

    meas = _pick_length_width_from_spans(dim_spans, parse_value_fn=_parse_inch_value)
    length = meas["length"]
    width = meas["width"]
    radius_val = meas["radius"]
    tap_holes = meas["tap_holes"]

    confidence = {
        "length": _score_dimension(length),
        "width":  _score_dimension(width),
    }

    return {
        "length":    length,
        "width":     width,
        "radius":    radius_val or "-",
        "tap_holes": tap_holes,
        "_confidence": confidence,
    }


# ── Layer 2: piece shape detection ───────────────────────────────────────────

def _extract_piece_shapes(
    page,
    drawing_y_min: float = _TITLE_Y_MAX,
    drawing_x_max: float = _DRAWING_X_MAX,
    min_area: float = _SHAPE_MIN_AREA,
    min_short_dim: float = 0.0,
    debug: Optional[Dict[str, Any]] = None,
) -> List[Tuple[float, float, float, float]]:
    """
    Detect stone-piece rectangles from vector paths in the drawing area.
    Returns a list of (x0, y0, x1, y1) tuples sorted by area descending.

    drawing_y_min / drawing_x_max adapt to different page formats.
    min_area filters out annotation boxes (higher value = fewer, larger shapes).
    min_short_dim rejects shapes where EITHER dimension is narrower than the
    threshold — eliminates dimension leader lines (e.g. 16×332pt strips).

    Filters out:
      - shapes outside the drawing area or page bounds
      - full-page frames  (> 90 % of drawing area)
      - annotation boxes  (area < min_area)
      - dimension leaders (min(w,h) < min_short_dim)
      - inner shapes contained by a larger sibling  (sink cutouts, label boxes)
    """
    if fitz is None:
        return []

    page_h = page.rect.height
    max_w = drawing_x_max * 0.92
    max_h = (page_h - drawing_y_min) * 0.88

    candidates: List[Tuple[float, float, float, float, float]] = []  # (x0,y0,x1,y1,area)
    raw_drawings = 0
    no_bbox = 0
    too_small = 0
    outside = 0
    too_large = 0
    for path in page.get_drawings():
        raw_drawings += 1
        r = _drawing_bbox(path)
        if r is None:
            no_bbox += 1
            continue
        x0, y0, x1, y1 = float(r[0]), float(r[1]), float(r[2]), float(r[3])
        w, h = x1 - x0, y1 - y0
        if w < _SHAPE_MIN_DIM or h < _SHAPE_MIN_DIM:
            too_small += 1
            continue
        if min_short_dim > 0 and min(w, h) < min_short_dim:
            too_small += 1
            continue
        # Must start below the title block. Keep the horizontal search broad so
        # real piece outlines on the right half of the sheet are not discarded.
        if y0 < drawing_y_min or y0 >= page_h:
            outside += 1
            continue
        area = w * h
        if area < min_area:
            too_small += 1
            continue
        # Reject full-area frames
        if w > max_w or h > max_h:
            too_large += 1
            continue
        candidates.append((x0, y0, x1, y1, area))

    if not candidates:
        if debug is not None:
            debug.update({
                "rectangles_found": raw_drawings,
                "rectangles_kept": 0,
                "rectangles_filtered": raw_drawings,
                "rectangles_no_bbox": no_bbox,
                "rectangles_too_small": too_small,
                "rectangles_outside": outside,
                "rectangles_too_large": too_large,
            })
        return []

    # Deduplicate near-identical bounding boxes from overlapping paths
    unique: List[Tuple] = []
    for r in sorted(candidates, key=lambda c: c[4], reverse=True):
        if not any(
            abs(r[0] - u[0]) < 3 and abs(r[1] - u[1]) < 3
            and abs(r[2] - u[2]) < 3 and abs(r[3] - u[3]) < 3
            for u in unique
        ):
            unique.append(r)

    # Remove shapes that are entirely inside a larger sibling (e.g. sink cutouts)
    outer: List[Tuple] = []
    for i, r in enumerate(unique):
        inside = False
        for j, u in enumerate(unique):
            if j != i and u[0] < r[0] - 1 and u[1] < r[1] - 1 and u[2] > r[2] + 1 and u[3] > r[3] + 1:
                inside = True
                break
        if not inside:
            outer.append(r)

    # Remove obvious false hits: page-border fragments and tiny overlaps that sit
    # inside a much larger piece. This helps drop left-margin frames and sink cutouts.
    filtered_outer: List[Tuple] = []
    for r in outer:
        rx0, ry0, rx1, ry1, ra = r
        rw, rh = rx1 - rx0, ry1 - ry0
        if rx1 < 50 and ra < 5000:
            continue
        false_inside = False
        for u in outer:
            if u is r:
                continue
            ux0, uy0, ux1, uy1, ua = u
            if ua <= ra:
                continue
            if ra >= ua * 0.30:
                continue
            # Overlap with a larger sibling expanded slightly in all directions.
            ex0, ey0, ex1, ey1 = ux0 - 20, uy0 - 20, ux1 + 20, uy1 + 20
            if rx1 < ex0 or rx0 > ex1 or ry1 < ey0 or ry0 > ey1:
                continue
            overlap_x = max(0.0, min(rx1, ex1) - max(rx0, ex0))
            overlap_y = max(0.0, min(ry1, ey1) - max(ry0, ey0))
            if overlap_x > 0 and overlap_y > 0:
                false_inside = True
                break
        if not false_inside:
            filtered_outer.append(r)

    shapes = [(r[0], r[1], r[2], r[3]) for r in filtered_outer]
    if debug is not None:
        debug.update({
            "rectangles_found": raw_drawings,
            "rectangles_kept": len(shapes),
            "rectangles_filtered": max(raw_drawings - len(shapes), 0),
            "rectangles_no_bbox": no_bbox,
            "rectangles_too_small": too_small,
            "rectangles_outside": outside,
            "rectangles_too_large": too_large,
        })
    return shapes


# ── Layer 3: dimension association (Voronoi nearest-shape) ────────────────────

def _assign_dims_voronoi(
    shapes: List[Tuple[float, float, float, float]],
    dim_spans: List[Dict],
    debug: Optional[Dict[str, Any]] = None,
) -> List[Dict]:
    """
    Assign each dimension span to its nearest piece shape (by distance from
    span centre to shape bounding box).  Each span is assigned to at most one
    shape.  Returns a list of piece dicts — one per shape that received at
    least one plain dimension.
    """
    if not shapes or not dim_spans:
        return []

    def _dist(span: Dict, sx0: float, sy0: float, sx1: float, sy1: float) -> float:
        # Distance from span centre to nearest point on the shape bbox
        cx = max(sx0, min(span["cx"], sx1))
        cy = max(sy0, min(span["cy"], sy1))
        return ((span["cx"] - cx) ** 2 + (span["cy"] - cy) ** 2) ** 0.5

    MAX_ASSIGN_DIST = 220.0  # pts — keep a wider net so distant callouts still bind

    # Exclude dimensions that fall inside any shape bounding box.
    # Interior callouts are sink offsets, notch depths, and hole centers — not
    # overall piece dimensions.  Overall L×W annotations are always placed
    # outside the shape boundary.
    _INSIDE_MARGIN = 5.0
    exterior_dim_spans: List[Dict] = []
    for s in dim_spans:
        cx, cy = s["cx"], s["cy"]
        inside = any(
            sx0 + _INSIDE_MARGIN < cx < sx1 - _INSIDE_MARGIN
            and sy0 + _INSIDE_MARGIN < cy < sy1 - _INSIDE_MARGIN
            for sx0, sy0, sx1, sy1 in shapes
        )
        if not inside:
            exterior_dim_spans.append(s)
    dim_spans = exterior_dim_spans

    # Assign each relevant span to its nearest shape
    span_to_shape: Dict[int, int] = {}
    for i, s in enumerate(dim_spans):
        best_dist = MAX_ASSIGN_DIST
        best_idx = -1
        for j, (sx0, sy0, sx1, sy1) in enumerate(shapes):
            d = _dist(s, sx0, sy0, sx1, sy1)
            if d < best_dist:
                best_dist = d
                best_idx = j
        if best_idx >= 0:
            span_to_shape[i] = best_idx

    # Bucket spans by shape
    buckets: Dict[int, List[Dict]] = {j: [] for j in range(len(shapes))}
    for span_idx, shape_idx in span_to_shape.items():
        buckets[shape_idx].append(dim_spans[span_idx])

    # Extract length/width/radius/tap_holes per shape
    pieces: List[Dict] = []
    for j, (sx0, sy0, sx1, sy1) in enumerate(shapes):
        meas = _pick_length_width_from_spans(
            buckets[j],
            shape=(sx0, sy0, sx1, sy1),
            parse_value_fn=_parse_inch_value,
        )
        if not meas["length"]:
            continue  # shape has no associated dimensions — skip
        pieces.append({
            "shape":     (sx0, sy0, sx1, sy1),
            "length":    meas["length"],
            "width":     meas["width"],
            "radius":    meas["radius"],
            "tap_holes": meas["tap_holes"],
            "_confidence": {
                "length": _score_dimension(meas["length"]),
                "width":  _score_dimension(meas["width"]),
            },
        })

    if debug is not None:
        debug.update({
            "dimensions_found": len(dim_spans),
            "dimensions_bound": sum(1 for piece in pieces if piece.get("length")),
        })

    return pieces


def _piece_name(base: str, idx: int, total: int) -> str:
    """Return piece name: unchanged for single piece, suffixed (A/B/C…) for multiple."""
    if total <= 1:
        return base
    return f"{base} - {chr(65 + idx)}"   # A, B, C, …


def _classify_piece_name(piece: Dict, base_name: str) -> Tuple[str, str]:
    """
    Return (part_name, category) for a piece.

    Splash rule (deterministic):
      if min(length, width) <= 4.5 inches → splash piece
      Orientation is determined from page-coordinate shape geometry:
        shape wider than tall  → Back Splash  (horizontal)
        shape taller than wide → Side Splash  (vertical)

    Otherwise: use title-block description and infer category from keywords.
    """
    try:
        length = float(piece.get("length") or 0)
        width  = float(piece.get("width")  or 0)
    except (ValueError, TypeError):
        return base_name, _infer_category(base_name)

    if length > 0 and width > 0 and min(length, width) <= 4.5:
        shape = piece.get("shape", ())
        if len(shape) == 4:
            sx0, sy0, sx1, sy1 = shape
            if (sx1 - sx0) >= (sy1 - sy0):   # wider than tall in page coordinates
                return "Back Splash", "Splashes"
            return "Side Splash", "Splashes"
        # Fallback if no shape bbox available
        return ("Back Splash" if length >= width else "Side Splash"), "Splashes"

    return base_name, _infer_category(base_name)


# ── Template C: Unit:/Qty: format (single-unit-per-page, XX" [MM] dims) ──────

_TC_DIM_RE = re.compile(r'^[\d.]+"\s*\[\d')   # matches '37.00" [940]', '29.126" [740]'
_TC_BLDG_RE = re.compile(r'Building\s+Type\s+#?(\w+)\s*:\s*(\d+)', re.IGNORECASE)


def _parse_inch_value_c(text: str) -> Optional[float]:
    """Parse inch value from Template C format: '37.00\" [940]', '73.75\" [1873]'."""
    m = re.match(r'^([\d.]+)"\s*\[', text.strip())
    if m:
        try:
            v = float(m.group(1))
            return round(v, 4) if 2 <= v <= 500 else None
        except ValueError:
            pass
    return None


def _is_template_c(page) -> bool:
    """True if the page looks like a Template C fabrication sheet (Unit:/Qty: header + XX\"[MM] dims)."""
    spans = _spans(page)
    has_unit = any(
        re.match(r"Unit\s*:", s["text"].strip(), re.IGNORECASE)
        for s in spans if s["y0"] < 130
    )
    if not has_unit:
        return False
    has_dim = any(
        _TC_DIM_RE.match(s["text"].strip())
        for s in spans if s["y0"] > 130
    )
    return has_dim


def _parse_template_c_page(page, project: Dict, debug: Optional[Dict[str, Any]] = None) -> List[Dict]:
    """
    Parse one Template C page → rows.

    Template C layout (e.g. Saltwell Springs):
      - Title block: 'Unit: A1', 'Qty: N' — single unit type per page
      - Right-side schedule: 'Building Type #N: M' — how many instances per bldg type
      - Drawing area: piece shapes + dimensions in 'XX.XX\" [YYYY]' format
    """
    all_spans = _spans(page)

    # ── Title parsing ─────────────────────────────────────────────────────────
    unit_name = ""
    qty_val = 1
    is_mirrored = False
    for s in all_spans:
        if s["y0"] > 130:
            continue
        t = s["text"].strip()
        m = re.match(r"Unit\s*:\s*(.*)", t, re.IGNORECASE)
        if m:
            unit_name = m.group(1).strip()
            continue
        m = re.match(r"Qty\s*:\s*(\d+)", t, re.IGNORECASE)
        if m:
            qty_val = int(m.group(1))
            continue
        if re.match(r"Mirrored", t, re.IGNORECASE):
            is_mirrored = True

    if not unit_name:
        return []

    if is_mirrored:
        unit_name = unit_name + "-MIR"

    # ── Building type destinations ────────────────────────────────────────────
    # Right-side schedule: 'Building Type #1: 6', 'Building Type #7: 12', …
    destinations: List[Dict] = []
    for s in all_spans:
        m = _TC_BLDG_RE.search(s["text"])
        if m:
            bldg_type = m.group(1)
            # count = int(m.group(2))  # number of instances — stored in notes
            destinations.append({"building": bldg_type, "floor": "", "flat": ""})

    if not destinations:
        # Fallback: single destination using total qty
        destinations = [{"building": "", "floor": "", "flat": ""}]

    # ── Dimension spans ───────────────────────────────────────────────────────
    dim_spans_c = [
        s for s in all_spans
        if s["y0"] > 130
        and _TC_DIM_RE.match(s["text"].strip())
        and _parse_inch_value_c(s["text"]) is not None
    ]

    # ── Piece shape detection ─────────────────────────────────────────────────
    shapes = _extract_piece_shapes(
        page,
        drawing_y_min=150.0,
        drawing_x_max=450.0,
        min_area=1500,
        min_short_dim=35,
    )

    pieces: List[Dict] = []

    if shapes and dim_spans_c:
        _INSIDE_MARGIN = 5.0

        def _inside_any_c(span: Dict) -> bool:
            cx, cy = span["cx"], span["cy"]
            for sx0, sy0, sx1, sy1 in shapes:
                if (sx0 + _INSIDE_MARGIN < cx < sx1 - _INSIDE_MARGIN
                        and sy0 + _INSIDE_MARGIN < cy < sy1 - _INSIDE_MARGIN):
                    return True
            return False

        exterior_dims = [s for s in dim_spans_c if not _inside_any_c(s)]

        def _d2_c(s: Dict, sx0: float, sy0: float, sx1: float, sy1: float) -> float:
            cx = max(sx0, min(s["cx"], sx1))
            cy = max(sy0, min(s["cy"], sy1))
            d2 = (s["cx"] - cx) ** 2 + (s["cy"] - cy) ** 2
            if cx != s["cx"] and cy != s["cy"]:
                d2 += 2500
            return d2

        span_to_shape: Dict[int, int] = {}
        MAX_D2 = 150.0 ** 2
        for i, s in enumerate(exterior_dims):
            best_d2 = MAX_D2
            best_j = -1
            for j, shp in enumerate(shapes):
                d2 = _d2_c(s, *shp)
                if d2 < best_d2:
                    best_d2 = d2
                    best_j = j
            if best_j >= 0:
                span_to_shape[i] = best_j

        buckets: Dict[int, List[Dict]] = {j: [] for j in range(len(shapes))}
        for si, shi in span_to_shape.items():
            buckets[shi].append(exterior_dims[si])

        for j, (sx0, sy0, sx1, sy1) in enumerate(shapes):
            meas = _pick_length_width_from_spans(
                buckets[j],
                shape=(sx0, sy0, sx1, sy1),
                parse_value_fn=_parse_inch_value_c,
            )
            if not meas["length"]:
                continue
            if float(meas["length"]) < 12.0:
                continue
            pieces.append({
                "shape": (sx0, sy0, sx1, sy1),
                "length": meas["length"], "width": meas["width"],
                "radius": meas["radius"], "tap_holes": meas["tap_holes"],
                "_confidence": {"length": _score_dimension(meas["length"]), "width": _score_dimension(meas["width"])},
            })

    if not pieces and dim_spans_c:
        # Fallback: largest two distinct dim values as single piece
        meas = _pick_length_width_from_spans(
            dim_spans_c,
            parse_value_fn=_parse_inch_value_c,
        )
        if meas["length"] and float(meas["length"]) >= 12.0:
            pieces = [{
                "shape": (0.0, 0.0, 0.0, 0.0),
                "length": meas["length"], "width": meas["width"],
                "radius": meas["radius"], "tap_holes": meas["tap_holes"],
                "_confidence": {"length": _score_dimension(meas["length"]), "width": _score_dimension(meas["width"])},
            }]

    if not pieces:
        return []

    n_pieces  = len(pieces)
    thickness = project.get("thickness", "3CM")
    category  = _infer_category(unit_name.lower())

    rows: List[Dict] = []
    for idx, piece in enumerate(pieces):
        length = piece.get("length", "")
        width  = piece.get("width",  "")
        sq_ft  = 0.0
        if length and width:
            try:
                sq_ft = round(float(length) * float(width) / 144, 2)
            except (ValueError, TypeError):
                pass
        part_no_out = f"{unit_name}{chr(65 + idx)}" if n_pieces > 1 else unit_name
        piece_base = {
            "_source":     "template_c",
            "_confidence": piece.get("_confidence", {}),
            "drawing":     unit_name,
            "unit":        unit_name,
            "part_no":     part_no_out,
            "part":        _piece_name(unit_name, idx, n_pieces),
            "category":    category,
            "length":      length,
            "width":       width,
            "thickness":   thickness,
            "qty":         str(qty_val),
            "sq_ft":       str(sq_ft) if sq_ft > 0 else "",
            "sink_type":   "No Sink",
            "sink_cut":    "-",
            "tap_holes":   piece.get("tap_holes", "-"),
            "grooves":     "-",
            "edge":        "None",
            "edge_area":   "",
            "radius":      piece.get("radius", "-"),
            "notes":       "",
        }
        for dest in destinations:
            rows.append({
                **piece_base,
                "building": dest["building"],
                "floor":    dest["floor"],
                "flat":     dest["flat"],
            })

    if debug is not None:
        debug.update({
            "unit": unit_name,
            "drawing_no": unit_name,
            "destinations_found": len(destinations),
            "pieces_found": len(pieces),
            "expected_rows": len(pieces) * len(destinations),
            "generated_rows": len(rows),
            "dimensions_found": len(dim_spans_c),
            "dimensions_bound": len(pieces),
        })

    return rows


def _detect_template(page) -> str:
    if _is_template_a(page):
        return "template_a"
    if _is_template_b(page):
        return "template_b"
    if _is_template_c(page):
        return "template_c"
    return "fallback"


# ── Template B: UNITS: format (A3/A4 sheets, fractional inch dimensions) ─────

_TB_TITLE_Y_MAX = 110.0   # y below which title block lives for Template B
_TB_DIM_RE = re.compile(r"^\d+(?:\s+\d+/\d+)?\s*\"$")  # matches '45"', '47 1/2"', etc.


def _parse_inch_value_b(text: str) -> Optional[float]:
    """Parse inch value from Template B format: '45"', '47 1/2"', '3 3/4"'."""
    t = text.strip().rstrip('"').strip()
    m = _FRAC_RE.search(t)
    if m:
        return round(int(m.group(1)) + int(m.group(2)) / int(m.group(3)), 4)
    m2 = re.match(r"^(\d+(?:\.\d+)?)$", t)
    if m2:
        v = float(m2.group(1))
        return round(v, 4) if 2 <= v <= 300 else None
    return None


def _is_template_b(page) -> bool:
    """True if the page looks like a Template B fabrication sheet (UNITS: / QTY= header).
    Accepts both landscape and portrait orientations — some PDFs mix both."""
    spans = _spans(page)
    for s in spans:
        if s["y0"] > 130:
            continue
        t = s["text"].strip().upper()
        if "UNITS:" in t or re.match(r"QTY\s*=", t, re.IGNORECASE):
            return True
    return False


def _parse_template_b_title(spans: List[Dict]) -> Dict:
    """
    Parse Template B title block.
    Extracts: unit list from 'UNITS: 204, 205, …' (possibly multi-line),
              drawing code (e.g. '1A-ADA', 'TYPE 2', 'TYPE 6B', 'A', 'B-MIR'),
              qty from 'QTY=5' or 'QTY= 6'.

    Drawing code detection is position-based first (large text far right of title
    block) to handle codes with spaces like 'TYPE 2' and avoid picking up
    small dimension fragments that leak into the title y-zone.
    """
    title_spans = sorted(
        [s for s in spans if s["y0"] < _TB_TITLE_Y_MAX], key=lambda x: x["y0"]
    )
    units_parts: List[str] = []
    drawing_code = ""
    qty_val = 0
    collecting_units = False

    # ── Pass 1: extract UNITS list and QTY ──────────────────────────────────
    for s in title_spans:
        t = s["text"].strip()
        m = re.match(r"UNITS\s*:\s*(.*)", t, re.IGNORECASE)
        if m:
            collecting_units = True
            units_parts.append(m.group(1).strip())
            continue
        if collecting_units:
            if re.match(r"^[\d\s,]+$", t):
                units_parts.append(t)
                continue
            collecting_units = False
        m = re.match(r"QTY\s*=\s*(\d+)", t, re.IGNORECASE)
        if m:
            qty_val = int(m.group(1))

    # ── Pass 2: drawing code — prefer large text in the top-right corner ────
    # Typical layout: drawing code is the largest text at x>480, y<95.
    # This handles codes with spaces ('TYPE 2', 'TYPE 6B') that the pattern
    # check below would miss, and avoids tiny dimension fragments (size<15).
    right_candidates = [
        s for s in title_spans
        if s["x0"] > 480 and s["y0"] < 95
        and not re.match(r"QTY\s*=", s["text"].strip(), re.IGNORECASE)
        and s["size"] >= 15
    ]
    if right_candidates:
        # Pick the rightmost / largest
        best = max(right_candidates, key=lambda s: (s["x0"], s["size"]))
        drawing_code = best["text"].strip()
    else:
        # Fallback: scan all title spans for a short alphanumeric code
        for s in title_spans:
            t = s["text"].strip()
            if re.match(r"QTY\s*=", t, re.IGNORECASE):
                continue
            if (re.match(r"^[A-Z0-9][A-Z0-9\-_]*$", t, re.IGNORECASE)
                    and 1 <= len(t) <= 20
                    and not re.match(r"^\d{3,}$", t)
                    and t.upper() not in _BLD_SKIP_WORDS
                    and s["size"] >= 15):
                drawing_code = t
                break

    unit_numbers = re.findall(r"\d{3,4}", " ".join(units_parts))
    return {
        "units":   unit_numbers,
        "drawing": drawing_code,
        "qty":     qty_val or len(unit_numbers),
    }


def _parse_template_b_page(page, project: Dict, debug: Optional[Dict[str, Any]] = None) -> List[Dict]:
    """
    Parse one Template B page → rows.

    Template B layout:
      - Title block (y < ~110): 'UNITS: 204, 205, …', 'QTY=5', drawing code
      - Drawing area: piece shapes + dimensions in 'XX"' / 'XX Y/Z"' format

    Extraction:
      - Destinations: unit numbers from UNITS: text
      - Pieces: shapes detected via vector paths, dimensions assigned by proximity
      - Expansion: pieces × unit destinations = rows
    """
    all_spans = _spans(page)
    title = _parse_template_b_title(all_spans)

    unit_numbers = title.get("units", [])
    drawing_code = title.get("drawing", "")

    # Collect dimension spans in XX" format
    dim_spans_b = [
        s for s in all_spans
        if s["y0"] > _TB_TITLE_Y_MAX
        and _TB_DIM_RE.match(s["text"].strip())
        and _parse_inch_value_b(s["text"]) is not None
    ]

    # Piece shape detection for Template B.
    # drawing_y_min=150: skips header/label rows between 110–150pt.
    # drawing_x_max=450: excludes the legend/notes box at x=449–580 that
    #   appears on every page (x1=580 > 450+20=470 triggers the x-filter).
    # min_short_dim=35: rejects narrow dimension leader lines.
    shapes = _extract_piece_shapes(
        page,
        drawing_y_min=150.0,
        drawing_x_max=450.0,
        min_area=1500,
        min_short_dim=35,
    )

    pieces: List[Dict] = []

    if shapes and dim_spans_b:
        # Exclude dimension spans that fall INSIDE a piece shape's bounding box.
        # In CAD drawings, inside-shape annotations are detail dimensions (notch
        # depths, edge returns); the overall L×W dims are positioned outside.
        _INSIDE_MARGIN = 5.0

        def _inside_any(span: Dict) -> bool:
            cx, cy = span["cx"], span["cy"]
            for sx0, sy0, sx1, sy1 in shapes:
                if (sx0 + _INSIDE_MARGIN < cx < sx1 - _INSIDE_MARGIN
                        and sy0 + _INSIDE_MARGIN < cy < sy1 - _INSIDE_MARGIN):
                    return True
            return False

        exterior_dims = [s for s in dim_spans_b if not _inside_any(s)]

        def _d2(s: Dict, sx0: float, sy0: float, sx1: float, sy1: float) -> float:
            cx = max(sx0, min(s["cx"], sx1))
            cy = max(sy0, min(s["cy"], sy1))
            d2 = (s["cx"] - cx) ** 2 + (s["cy"] - cy) ** 2
            # Corner penalty: when span is outside BOTH x- and y-ranges, another
            # shape may be directly aligned (cx inside its x-range). Penalise the
            # corner case heavily so aligned shapes win over marginally closer corners.
            if cx != s["cx"] and cy != s["cy"]:
                d2 += 2500
            return d2

        span_to_shape: Dict[int, int] = {}
        MAX_D2 = 150.0 ** 2
        for i, s in enumerate(exterior_dims):
            best_d2 = MAX_D2
            best_j = -1
            for j, (sx0, sy0, sx1, sy1) in enumerate(shapes):
                d2 = _d2(s, sx0, sy0, sx1, sy1)
                if d2 < best_d2:
                    best_d2 = d2
                    best_j = j
            if best_j >= 0:
                span_to_shape[i] = best_j

        buckets: Dict[int, List[Dict]] = {j: [] for j in range(len(shapes))}
        for si, shi in span_to_shape.items():
            buckets[shi].append(exterior_dims[si])

        for j, (sx0, sy0, sx1, sy1) in enumerate(shapes):
            meas = _pick_length_width_from_spans(
                buckets[j],
                shape=(sx0, sy0, sx1, sy1),
                parse_value_fn=_parse_inch_value_b,
            )
            if not meas["length"]:
                continue
            if float(meas["length"]) < 12.0:
                continue
            pieces.append({
                "shape": (sx0, sy0, sx1, sy1),
                "length": meas["length"], "width": meas["width"],
                "radius": meas["radius"], "tap_holes": meas["tap_holes"],
                "_confidence": {"length": _score_dimension(meas["length"]), "width": _score_dimension(meas["width"])},
            })

    if not pieces and dim_spans_b:
        # Fallback: take all dimension values, largest two as one piece
        meas = _pick_length_width_from_spans(
            dim_spans_b,
            parse_value_fn=_parse_inch_value_b,
        )
        if meas["length"]:
            pieces = [{
                "shape": (0.0, 0.0, 0.0, 0.0),
                "length": meas["length"], "width": meas["width"],
                "radius": meas["radius"], "tap_holes": meas["tap_holes"],
                "_confidence": {"length": _score_dimension(meas["length"]), "width": _score_dimension(meas["width"])},
            }]

    if not pieces:
        return []

    destinations: List[Dict] = []
    for unit in unit_numbers:
        if unit.isdigit():
            floor = unit[0] if len(unit) == 3 else (unit[:2] if len(unit) >= 4 else "")
        else:
            m = re.match(r"^(\d+)", unit)
            floor = m.group(1) if m else ""
        destinations.append({"building": "", "floor": floor, "flat": unit})
    if not destinations:
        destinations = [{"building": "", "floor": "", "flat": ""}]

    base_name  = drawing_code or "Part"
    thickness  = project.get("thickness", "3CM")
    n_pieces   = len(pieces)
    category   = _infer_category(base_name.lower())

    rows: List[Dict] = []
    for idx, piece in enumerate(pieces):
        length = piece.get("length", "")
        width  = piece.get("width",  "")
        sq_ft  = 0.0
        if length and width:
            try:
                sq_ft = round(float(length) * float(width) / 144, 2)
            except (ValueError, TypeError):
                pass
        part_no_out = f"{drawing_code}{chr(65 + idx)}" if n_pieces > 1 else drawing_code
        piece_base = {
            "_source":     "template_b",
            "_confidence": piece.get("_confidence", {}),
            "drawing":     drawing_code,
            "unit":        "",
            "part_no":     part_no_out,
            "part":        _piece_name(base_name, idx, n_pieces),
            "category":    category,
            "length":      length,
            "width":       width,
            "thickness":   thickness,
            "qty":         "1",
            "sq_ft":       str(sq_ft) if sq_ft > 0 else "",
            "sink_type":   "No Sink",
            "sink_cut":    "-",
            "tap_holes":   piece.get("tap_holes", "-"),
            "grooves":     "-",
            "edge":        "None",
            "edge_area":   "",
            "radius":      piece.get("radius", "-"),
            "notes":       "",
        }
        for dest in destinations:
            rows.append({
                **piece_base,
                "building": dest["building"],
                "floor":    dest["floor"],
                "flat":     dest["flat"],
            })

    if debug is not None:
        debug.update({
            "drawing_no": drawing_code,
            "unit": drawing_code,
            "destinations_found": len(destinations),
            "pieces_found": len(pieces),
            "expected_rows": len(pieces) * len(destinations),
            "generated_rows": len(rows),
            "dimensions_found": len(dim_spans_b),
            "dimensions_bound": len(pieces),
        })

    return rows


# ── Template A: matrix ────────────────────────────────────────────────────────

def _parse_matrix(spans: List[Dict]) -> List[Dict]:
    """
    Parse the building/floor/flat schedule matrix.
    Returns {building, floor, flat} dicts — one per occupied cell.

    Handles two matrix orientations:
      Row-oriented:  Building label at LEFT of its row, flat numbers in same row.
      Column-oriented: Building label at TOP of its column, flat numbers below.

    Strategy: detect building identifiers (1-2 digit numbers / letter codes)
    anywhere in the matrix area, then assign each flat cell to its nearest
    building identifier by 2-D Euclidean distance.  Flat numbers that cannot
    be assigned to any building (e.g. no buildings detected) get building="".

    Key improvements over v1:
      - y-range: 130–560 (was 130–300)
      - Building detection x-range: full matrix width (was narrow left column)
      - Flat detection x-range: full matrix width (was narrow right band)
      - Flat pattern: 3-4 digit numeric (avoids count cells like "13")
        OR 2-char alphanumeric codes (1A, B12)
      - Assignment: 2-D distance (handles both row and column orientation)
    """
    matrix_spans = [
        s for s in spans
        if s["x0"] > _MATRIX_X_MIN and _MATRIX_Y_MIN < s["y0"] < _MATRIX_Y_MAX
    ]

    if not matrix_spans:
        return []

    # ── 1. Find building identifier cells ────────────────────────────────────────
    # Scan the full matrix area.  Building identifiers are short: 1-2 digit
    # numbers ≤99, or 1-3 letter codes (A, B, BLK1, etc.).
    bld_cells: List[Dict] = []  # {y_mid, x_mid, building}
    for s in matrix_spans:
        t = s["text"].strip()
        t_up = t.upper()
        if t_up in _BLD_SKIP_WORDS:
            continue
        # 1–2 digit numbers (1–99) or 1–4 letter codes (A, BLD, BLDA, …)
        if re.match(r"^\d{1,2}$", t):
            n = int(t)
            if 1 <= n <= 99:
                bld_cells.append({"y_mid": s["cy"], "x_mid": s["cx"], "building": t})
        elif re.match(r"^[A-Za-z]{1,4}$", t):
            bld_cells.append({"y_mid": s["cy"], "x_mid": s["cx"], "building": t_up})

    # ── 2. Find flat/unit identifier cells ───────────────────────────────────────
    # Pure numeric: 3-4 digits (101, 1501…) — avoids confusion with 2-digit counts
    # Alphanumeric: digit(s)+letter or letter+digit(s)  (1A, B12, 3B, etc.)
    _FLAT_RE = re.compile(r"^(\d{3,4}|\d{1,2}[A-Za-z]{1,2}|[A-Za-z]{1,2}\d{1,3})$")
    all_flat_cells = [
        s for s in matrix_spans
        if s["x0"] < _TOTAL_X_MIN and _FLAT_RE.match(s["text"].strip())
    ]

    if not all_flat_cells:
        return []

    # ── 3. Assign each flat to its nearest building cell ─────────────────────────
    destinations: List[Dict] = []
    seen: set = set()

    for cell in all_flat_cells:
        flat = cell["text"].strip()

        if bld_cells:
            nearest = min(
                bld_cells,
                key=lambda b: (cell["cx"] - b["x_mid"]) ** 2 + (cell["cy"] - b["y_mid"]) ** 2,
            )
            building = nearest["building"]
        else:
            building = ""

        # Infer floor from leading digits of flat number
        if flat.isdigit():
            floor = flat[0] if len(flat) == 3 else (flat[:2] if len(flat) >= 4 else flat[0] if flat else "")
        else:
            m = re.match(r"^(\d+)", flat)
            floor = m.group(1) if m else ""

        key = (building, floor, flat, round(cell["x0"], 1), round(cell["y0"], 1))
        if key not in seen:
            seen.add(key)
            destinations.append({"building": building, "floor": floor, "flat": flat})

    return destinations


# ── Template A: page classification ──────────────────────────────────────────

def _classify_page(title_data: Dict, spans: List[Dict]) -> str:
    """Return 'Overage', 'Vanity', 'Kitchen', etc. based on title block content."""
    combined = " ".join([
        title_data.get("part", ""),
        title_data.get("desc2", ""),
        " ".join(s["text"] for s in spans if s["y0"] < _TITLE_Y_MAX),
    ]).lower()
    cleaned = re.sub(r"\b(?:ovg|overage)\b", " ", combined)
    category = _infer_category(cleaned)
    if category != "Other":
        return category
    return "Overage" if ("ovg" in combined or "overage" in combined) else "Other"


# ── Template A: detect ────────────────────────────────────────────────────────

def _is_template_a(page) -> bool:
    """
    Returns True if the page looks like a Template A fabrication drawing.
    Heuristic: page is landscape, has 'in [' in center region, and has
    numeric text in title block area far right (Work Ticket).
    """
    w = page.rect.width
    h = page.rect.height
    if not (w > h):  # must be landscape
        return False
    all_spans = _spans(page)
    has_dim = any(
        "in [" in s["text"] and s["x0"] < _DIM_X_MAX and s["y0"] > _DIM_Y_MIN
        for s in all_spans
    )
    has_ticket = any(
        s["x0"] > 570 and s["y0"] < _TITLE_Y_MAX and re.match(r"^\d{3,}", s["text"].strip())
        for s in all_spans
    )
    return has_dim or has_ticket


# ── Template A: full page parse ───────────────────────────────────────────────

def _parse_template_a_page(page, project: Dict, debug: Optional[Dict[str, Any]] = None) -> List[Dict]:
    """
    Parse one Template A page → rows at piece × destination granularity.

    Layer 2 (geometry): detect piece shapes via vector paths.
    Layer 3 (dimensions): assign nearest 'in [' callouts to each shape.
    Layer 5 (expansion): piece_count × destination_count = row count.

    Fallback: if no shapes are detected (e.g. rasterised areas), revert to
    the original single-piece dimension extraction so nothing breaks.
    """
    all_spans = _spans(page)

    title        = _parse_title_block(all_spans)
    destinations = _parse_matrix(all_spans)

    category = _classify_page(title, all_spans)

    thickness  = title.get("thickness") or project.get("thickness", "3CM")
    base_name  = title.get("part", "") or category
    drawing_no = title.get("part_no", "")

    # ── Layer 2+3: detect pieces ────────────────────────────────────────────
    dim_spans = [
        s for s in all_spans
        if s["x0"] < _DIM_X_MAX and s["y0"] > _DIM_Y_MIN and "in [" in s["text"]
    ]

    pieces: List[Dict] = []
    shapes = _extract_piece_shapes(page, min_area=160.0, min_short_dim=8.0, debug=debug)
    if len(shapes) < 13 and len(dim_spans) >= 10:
        relaxed_shapes = _extract_piece_shapes(
            page,
            drawing_y_min=100.0,
            drawing_x_max=page.rect.width,
            min_area=120.0,
            min_short_dim=6.0,
        )
        if len(relaxed_shapes) > len(shapes):
            shapes = relaxed_shapes
            if debug is not None:
                debug.setdefault("warnings", []).append("relaxed shape pass used")
    if shapes and dim_spans:
        pieces = _assign_dims_voronoi(shapes, dim_spans, debug=debug)

    # Fallback to original single-piece parser (keeps backward compatibility)
    if not pieces:
        dims = _parse_dimensions(all_spans)
        if dims.get("length"):
            pieces = [{
                "shape":     (0.0, 0.0, 0.0, 0.0),
                "length":    dims["length"],
                "width":     dims["width"],
                "radius":    dims["radius"],
                "tap_holes": dims["tap_holes"],
                "_confidence": dims["_confidence"],
            }]

    if not pieces:
        return []

    if not destinations:
        destinations = [{"building": "", "floor": "", "flat": ""}]

    title_conf = title.get("_confidence", {})
    n_pieces   = len(pieces)
    _page_sz   = [page.rect.width, page.rect.height]

    # Pre-classify all pieces by geometry so each gets its own name/category.
    # Pieces sharing the same name get A/B/C suffix to stay distinct.
    _classified   = [_classify_piece_name(p, base_name) for p in pieces]
    _name_count: Dict[str, int] = {}
    for _pn, _ in _classified:
        _name_count[_pn] = _name_count.get(_pn, 0) + 1
    _name_seen: Dict[str, int] = {}
    _slab_seq   = 0   # for {drawing}-01, {drawing}-02, …
    _splash_seq = 0   # for {drawing}-A, {drawing}-B, …

    # ── Layer 5: expansion ──────────────────────────────────────────────────
    rows: List[Dict] = []
    for idx, piece in enumerate(pieces):
        pname, pcat = _classified[idx]
        if _name_count[pname] > 1:
            _seen = _name_seen.get(pname, 0)
            final_part_name = f"{pname} - {chr(65 + _seen)}"
            _name_seen[pname] = _seen + 1
        else:
            final_part_name = pname

        length = piece.get("length", "")
        width  = piece.get("width",  "")

        # Splash pieces: enforce width = the small (~4") dimension, length = larger
        if pcat == "Splashes" and length and width:
            try:
                l_f, w_f = float(length), float(width)
                if l_f < w_f:
                    length, width = str(w_f), str(l_f)
                else:
                    width = str(min(l_f, w_f))
            except (ValueError, TypeError):
                pass

        sq_ft = 0.0
        if length and width:
            try:
                sq_ft = round(float(length) * float(width) / 144, 2)
            except (ValueError, TypeError):
                pass

        # Part numbering: {drawing}-01/02/… for slabs, {drawing}-A/B/… for splashes
        if pcat == "Splashes":
            part_no_out = f"{drawing_no}-{chr(65 + _splash_seq)}" if drawing_no else chr(65 + _splash_seq)
            _splash_seq += 1
        else:
            _slab_seq += 1
            part_no_out = f"{drawing_no}-{_slab_seq:02d}" if drawing_no else f"{_slab_seq:02d}"

        piece_conf = {**title_conf, **piece.get("_confidence", {})}

        piece_base = {
            "_source":     "template_a",
            "_confidence": piece_conf,
            "_shape_bbox": list(piece.get("shape", [])),
            "_page_size":  _page_sz,
            "drawing":     drawing_no,
            "unit":        title.get("unit", ""),
            "part_no":     part_no_out,
            "part":        final_part_name,
            "category":    pcat,
            "length":      length,
            "width":       width,
            "thickness":   thickness,
            "qty":         "1",
            "sq_ft":       str(sq_ft) if sq_ft > 0 else "",
            "sink_type":   title.get("sink_type", "No Sink"),
            "sink_cut":    "-",
            "tap_holes":   piece.get("tap_holes", "-"),
            "grooves":     "-",
            "edge":        "None",
            "edge_area":   "",
            "radius":      piece.get("radius", "-"),
            "notes":       "",
        }

        for dest in destinations:
            rows.append({
                **piece_base,
                "building": dest.get("building", ""),
                "floor":    dest.get("floor", ""),
                "flat":     dest.get("flat", ""),
            })

    if debug is not None:
        debug.update({
            "drawing_no": drawing_no,
            "unit": title.get("unit", ""),
            "category": category,
            "destinations_found": len(destinations),
            "pieces_found": len(pieces),
            "expected_rows": len(pieces) * len(destinations),
            "generated_rows": len(rows),
            "dimensions_found": len(dim_spans),
            "dimensions_bound": len(pieces),
        })

    return rows


# ── Table-based fallback (non-Template-A PDFs) ───────────────────────────────

def _normalize_header(h: str) -> Optional[str]:
    nh = str(h or "").strip().lower().replace("\n", " ").replace("  ", " ")
    for field, aliases in HEADER_ALIASES.items():
        if nh in aliases or any(nh == a or nh.startswith(a) for a in aliases):
            return field
    return None


def _extract_tables(pdf_bytes: bytes) -> List[Dict]:
    if not pdfplumber:
        return []
    rows: List[Dict] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                for table in (page.extract_tables() or []):
                    if not table or len(table) < 2:
                        continue
                    col_map: Dict[int, str] = {}
                    for i, h in enumerate(table[0]):
                        field = _normalize_header(str(h or ""))
                        if field:
                            col_map[i] = field
                    if not col_map:
                        continue
                    for row in table[1:]:
                        if not row or all(not str(c or "").strip() for c in row):
                            continue
                        mapped: Dict[str, Any] = {}
                        conf: Dict[str, float] = {}
                        for i, cell in enumerate(row):
                            field = col_map.get(i)
                            if field:
                                val = str(cell or "").strip()
                                mapped[field] = val
                                conf[field] = _score_field(field, val)
                        if mapped and (mapped.get("length") or mapped.get("part") or mapped.get("part_no")):
                            mapped["_confidence"] = conf
                            mapped["_source"] = "table"
                            rows.append(mapped)
    except Exception as e:
        print(f"pdfplumber error: {e}")
    return rows


def _build_row_from_raw(raw: Dict, row_id: int, project: Dict) -> Dict:
    part = raw.get("part", "") or ""
    category = raw.get("category", "") or _infer_category(part)
    length = _clean_dim(raw.get("length", ""))
    width = _clean_dim(raw.get("width", ""))
    qty_int = _clean_qty(raw.get("qty", 1))
    sq_ft = 0.0
    if length and width:
        try:
            sq_ft = round(float(length) * float(width) / 144 * qty_int, 2)
        except (ValueError, TypeError):
            pass
    conf = dict(raw.get("_confidence", {}))
    conf.setdefault("part", 0.7)
    conf.setdefault("length", _score_dimension(length))
    conf.setdefault("width",  _score_dimension(width))
    return {
        "_id":         row_id,
        "_source":     raw.get("_source", "unknown"),
        "_confidence": conf,
        "drawing":     raw.get("drawing", ""),
        "unit":        raw.get("unit", ""),
        "building":    raw.get("building", ""),
        "floor":       raw.get("floor", ""),
        "flat":        raw.get("flat", ""),
        "part_no":     raw.get("part_no", ""),
        "part":        part,
        "category":    category,
        "length":      length,
        "width":       width,
        "thickness":   _normalize_thickness(raw.get("thickness", "") or project.get("thickness", "3CM")) or "3CM",
        "qty":         str(qty_int),
        "sq_ft":       str(sq_ft) if sq_ft > 0 else "",
        "sink_type":   raw.get("sink_type", "") or "No Sink",
        "sink_cut":    raw.get("sink_cut", "") or "-",
        "tap_holes":   raw.get("tap_holes", "") or "-",
        "grooves":     raw.get("grooves", "") or "-",
        "edge":        _normalize_edge(raw.get("edge", "") or "None"),
        "edge_area":   raw.get("edge_area", "") or "",
        "radius":      raw.get("radius", "") or "-",
        "notes":       raw.get("notes", "") or "",
    }


# ── Public API ────────────────────────────────────────────────────────────────

def parse_pdf(pdf_bytes: bytes, project: Optional[Dict] = None) -> Dict:
    """
    Parse a PDF and return structured rows with confidence scores.
    Detects Template A (coordinate-based CAD sheets) per page;
    falls back to pdfplumber table extraction for other formats.
    Returns {rows, metadata, extraction_method, row_count, overall_confidence}.
    """
    project = project or {}

    if not fitz:
        return {
            "rows": [], "metadata": {}, "extraction_method": "none",
            "row_count": 0, "overall_confidence": 0.0,
            "error": "PyMuPDF (fitz) not installed",
        }

    result_rows: List[Dict] = []
    methods_used = set()
    page_reports: List[Dict[str, Any]] = []
    page_dims: Dict[int, List[float]] = {}
    debug_mode = _debug_enabled(project)

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        row_id = 1

        for page_num, page in enumerate(doc, start=1):
            page_dims[page_num] = [page.rect.width, page.rect.height]
            template = _detect_template(page)
            page_report = _new_page_report(page_num, template)
            page_rows: List[Dict[str, Any]] = []
            if template == "template_a":
                page_rows = _parse_template_a_page(page, project, debug=page_report)
                if page_rows:
                    methods_used.add("template_a")
            elif template == "template_b":
                page_rows = _parse_template_b_page(page, project, debug=page_report)
                if page_rows:
                    methods_used.add("template_b")
            elif template == "template_c":
                page_rows = _parse_template_c_page(page, project, debug=page_report)
                if page_rows:
                    methods_used.add("template_c")
            else:
                page_report["warnings"].append("page did not match any template")
            # non-Template pages fall through to pdfplumber below
            for r in page_rows:
                r["_id"] = row_id
                r["_page_num"] = page_num
                row_id += 1
            result_rows.extend(page_rows)
            page_report["generated_rows"] = len(page_rows)
            if not page_report.get("expected_rows"):
                page_report["expected_rows"] = len(page_rows)
            if page_report.get("expected_rows") and page_report.get("generated_rows") < page_report.get("expected_rows"):
                page_report["warnings"].append("generated rows below expected")
            if template != "fallback" and page_report.get("generated_rows", 0) == 0:
                page_report["warnings"].append("template page produced no rows")
            if template != "fallback" and page_report.get("pieces_found", 0) == 0:
                page_report["warnings"].append("no piece shapes bound")
            page_reports.append(page_report)
            _log_page_report(page_report, debug_mode)

        doc.close()
    except Exception as e:
        print(f"Template A parse error: {e}")

    # If Template A found nothing, try table extraction
    if not result_rows:
        raw_rows = _extract_tables(pdf_bytes)
        if raw_rows:
            methods_used.add("table")
            for i, r in enumerate(raw_rows):
                result_rows.append(_build_row_from_raw(r, i + 1, project))

    # Deduplicate only for the table fallback. Template-based parsing should
    # keep every matrix cell row, even when the same flat number appears in
    # multiple positions on the drawing.
    if methods_used == {"table"}:
        seen_keys: set = set()
        deduped = []
        for r in result_rows:
            key = (
                r.get("drawing", ""),
                r.get("part_no", ""),
                r.get("building", ""),
                r.get("floor", ""),
                r.get("flat", ""),
            )
            if key not in seen_keys:
                seen_keys.add(key)
                deduped.append(r)
        result_rows = deduped

    # Overall confidence
    overall = 0.0
    if result_rows:
        scores = []
        for row in result_rows:
            c = row.get("_confidence", {})
            if c:
                scores.append(sum(c.values()) / len(c))
        if scores:
            overall = round(sum(scores) / len(scores), 2)

    method_str = "+".join(sorted(methods_used)) if methods_used else "none"
    page_summary = _summarize_page_reports(page_reports)

    # ── Build review data: unique shapes per page for the frontend overlay ──
    _review_pages: Dict[int, Dict] = {}
    for r in result_rows:
        pn = r.get("_page_num", 1)
        if pn not in _review_pages:
            pw, ph = page_dims.get(pn, [792.0, 612.0])
            _review_pages[pn] = {
                "page_num": pn, "page_width": pw, "page_height": ph, "shapes": [],
            }
        bbox = r.get("_shape_bbox")
        if bbox and len(bbox) == 4 and any(v != 0 for v in bbox):
            bbox_k = tuple(round(v, 1) for v in bbox)
            if not any(tuple(round(v, 1) for v in s["bbox"]) == bbox_k
                       for s in _review_pages[pn]["shapes"]):
                _review_pages[pn]["shapes"].append({
                    "bbox":          list(bbox),
                    "part_no":       r.get("part_no", ""),
                    "part":          r.get("part", ""),
                    "category":      r.get("category", ""),
                    "length":        r.get("length", ""),
                    "width":         r.get("width", ""),
                    "dims_assigned": bool(r.get("length")),
                })
    review_data = {
        "pages": sorted(_review_pages.values(), key=lambda p: p["page_num"])
    }

    return {
        "rows":               result_rows,
        "metadata":           {
            "page_reports": page_reports,
            "page_summary": page_summary,
            "template_counts": {
                "template_a": sum(1 for p in page_reports if p.get("template") == "template_a"),
                "template_b": sum(1 for p in page_reports if p.get("template") == "template_b"),
                "template_c": sum(1 for p in page_reports if p.get("template") == "template_c"),
                "fallback": sum(1 for p in page_reports if p.get("template") == "fallback"),
            },
        },
        "extraction_method":  method_str,
        "row_count":          len(result_rows),
        "overall_confidence": overall,
        "review_data":        review_data,
        "debug": {
            "enabled": debug_mode,
            "pages": page_reports,
            "summary": page_summary,
            "templates": {
                "template_a": sum(1 for p in page_reports if p.get("template") == "template_a"),
                "template_b": sum(1 for p in page_reports if p.get("template") == "template_b"),
                "template_c": sum(1 for p in page_reports if p.get("template") == "template_c"),
                "fallback": sum(1 for p in page_reports if p.get("template") == "fallback"),
            },
        },
    }
