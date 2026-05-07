"""
PDF parsing module for StoneDesk.

Template A: Coordinate-based parser for CAD fabrication drawing sheets.
  - Landscape letter (792×612 pts)
  - Title block: y < 115
  - Center dimensions: x < 450, y > 120, text contains 'in ['
  - Matrix (Bldg/Flat): x > 460, y 130–300
  - Multi-page: each page → one part with multiple building/flat destinations

Falls back to table-based extraction (pdfplumber) for non-Template-A PDFs.
"""

import io
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
_MATRIX_X_MIN = 460.0
_MATRIX_Y_MIN = 130.0
_MATRIX_Y_MAX = 300.0

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
_BLD_X_MIN = 475
_BLD_X_MAX = 492   # building number labels column
_FLAT_HDR_Y_MIN = 208
_FLAT_HDR_Y_MAX = 220
_FLOOR_Y_MIN = 270
_FLOOR_Y_MAX = 285
_TOTAL_X_MIN = 568


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


# ── Template A: title block ───────────────────────────────────────────────────

def _parse_title_block(spans: List[Dict]) -> Dict:
    title_spans = [s for s in spans if s["y0"] < _TITLE_Y_MAX]

    part_no = ""
    unit = ""
    desc_lines: List[Tuple[float, str]] = []   # (y0, text)
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
                desc_lines.append((s["y0"], t))

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

    # Sort description lines by y
    desc_lines.sort(key=lambda x: x[0])
    desc_parts = [d[1] for d in desc_lines]

    # Description line 1 → part name, line 2 → sub-description, line 3 → category hint
    part_name = desc_parts[0] if len(desc_parts) > 0 else ""
    desc2 = desc_parts[1] if len(desc_parts) > 1 else ""
    cat_hint = desc_parts[2] if len(desc_parts) > 2 else ""

    # Category inference
    combined_text = " ".join([part_name, desc2, cat_hint]).lower()
    category = _infer_category(combined_text)

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

    project_name = " ".join(project_texts).strip()

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
        "unit":        unit,
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

    plain_dims: List[float] = []
    radius_val = ""
    tap_holes = "-"
    tap_count = 0

    for s in dim_spans:
        t = s["text"]
        prefix_m = re.match(r"^([RØO])", t.strip(), re.IGNORECASE)
        is_radius = bool(prefix_m and prefix_m.group(1).upper() == "R")
        is_tap = bool(prefix_m and prefix_m.group(1).upper() in ("Ø", "O"))

        val = _parse_inch_value(t)
        if val is None:
            continue

        if is_radius:
            radius_val = str(val)
        elif is_tap:
            tap_count += 1
            tap_holes = str(int(tap_count))
        else:
            plain_dims.append(val)

    # Largest two plain dims = length × width
    plain_dims.sort(reverse=True)
    length = str(plain_dims[0]) if len(plain_dims) > 0 else ""
    width  = str(plain_dims[1]) if len(plain_dims) > 1 else ""

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


# ── Template A: matrix ────────────────────────────────────────────────────────

def _parse_matrix(spans: List[Dict]) -> List[Dict]:
    """
    Parse the building/floor/flat matrix.
    Returns a list of {building, floor, flat} dicts — one per occupied cell.

    Strategy: find all building label rows (x≈481, 1-2 digit numbers ≤99),
    then for each building row collect all 3-digit flat numbers in its y-band.
    This handles both "header row" and "repeating cell" matrix formats.
    """
    matrix_spans = [
        s for s in spans
        if s["x0"] > _MATRIX_X_MIN and _MATRIX_Y_MIN < s["y0"] < _MATRIX_Y_MAX
    ]

    if not matrix_spans:
        return []

    # ── 1. Building rows — x≈481 (narrow band), 1-2 digit numbers ≤99 ──────────
    bld_rows: List[Dict] = []  # {y_mid, building}
    for s in matrix_spans:
        if not (_BLD_X_MIN <= s["x0"] <= _BLD_X_MAX):
            continue
        t = s["text"].strip()
        if re.match(r"^\d{1,2}$", t) and int(t) <= 99:
            bld_rows.append({"y_mid": s["cy"], "building": t})

    if not bld_rows:
        return []

    # ── 2. All 2-4 digit numeric cells right of building column, left of totals ─
    all_flat_cells = [
        s for s in matrix_spans
        if s["x0"] > 488 and s["x0"] < _TOTAL_X_MIN
        and re.match(r"^\d{2,4}$", s["text"].strip())
    ]

    if not all_flat_cells:
        return []

    # ── 3. For each building row, collect flat numbers in its y-band (±14 pts) ──
    destinations: List[Dict] = []
    seen: set = set()

    for bld in bld_rows:
        y_mid = bld["y_mid"]
        building = bld["building"]

        row_cells = [s for s in all_flat_cells if abs(s["cy"] - y_mid) <= 14]

        for cell in row_cells:
            flat = cell["text"].strip()
            floor = flat[0] if flat and flat[0].isdigit() else ""

            key = (building, flat)
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

    if "ovg" in combined or "overage" in combined:
        return "Overage"
    return _infer_category(combined)


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

def _parse_template_a_page(page, project: Dict) -> List[Dict]:
    """Parse one Template A page → list of row dicts (one per building/flat)."""
    all_spans = _spans(page)

    title = _parse_title_block(all_spans)
    dims = _parse_dimensions(all_spans)
    destinations = _parse_matrix(all_spans)

    category = _classify_page(title, all_spans)
    if category == "Overage":
        return []  # skip overage pages

    thickness = title.get("thickness") or project.get("thickness", "3CM")
    length = dims.get("length", "")
    width = dims.get("width", "")

    sq_ft = 0.0
    if length and width:
        try:
            sq_ft = round(float(length) * float(width) / 144, 2)
        except (ValueError, TypeError):
            pass

    conf = {**title.get("_confidence", {}), **dims.get("_confidence", {})}

    base = {
        "_source":     "template_a",
        "_confidence": conf,
        "drawing":     title.get("part_no", ""),
        "unit":        title.get("unit", ""),
        "part_no":     title.get("part_no", ""),
        "part":        title.get("part", ""),
        "category":    category,
        "length":      length,
        "width":       width,
        "thickness":   thickness,
        "qty":         "1",
        "sq_ft":       str(sq_ft) if sq_ft > 0 else "",
        "sink_type":   title.get("sink_type", "No Sink"),
        "sink_cut":    "-",
        "tap_holes":   dims.get("tap_holes", "-"),
        "grooves":     "-",
        "edge":        "None",
        "edge_area":   "",
        "radius":      dims.get("radius", "-"),
        "notes":       "",
    }

    if not destinations:
        # No matrix found — still return the part with blank destination
        return [{**base, "building": "", "floor": "", "flat": ""}]

    rows = []
    for dest in destinations:
        rows.append({
            **base,
            "building": dest.get("building", ""),
            "floor":    dest.get("floor", ""),
            "flat":     dest.get("flat", ""),
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

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        row_id = 1

        for page in doc:
            if _is_template_a(page):
                page_rows = _parse_template_a_page(page, project)
                for r in page_rows:
                    r["_id"] = row_id
                    row_id += 1
                result_rows.extend(page_rows)
                if page_rows:
                    methods_used.add("template_a")
            # (non-Template-A pages handled below via pdfplumber on full doc)

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

    # Deduplicate by (drawing, building, flat) for Template A rows
    if "template_a" in methods_used:
        seen_keys = set()
        deduped = []
        for r in result_rows:
            key = (r.get("drawing", ""), r.get("building", ""), r.get("flat", ""))
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

    return {
        "rows":               result_rows,
        "metadata":           {},
        "extraction_method":  method_str,
        "row_count":          len(result_rows),
        "overall_confidence": overall,
    }
