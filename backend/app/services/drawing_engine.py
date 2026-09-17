"""
Renders template geometry (see drawing_templates.py) to SVG and PDF.

Geometry is plain data — an outline polygon, rectangular/oval cutouts,
dimension-line hints, edge finish marks, and bundled accessory pieces
(backsplash/side splash), all in inches — so the same geometry produced for
a live browser preview can also be turned into a downloadable SVG or a
fabrication-style PDF without recomputation.

The PDF title block (Edge Type Key Code, Material, Sink Info, Project,
Title, Date/Drawn By/Scale/Work Ticket #, destination matrix) and drawing
conventions (oval "Polish" sink cutout, eased-edge X marks, rounded front
corner, arrow-style dimension lines) mirror real StoneDesk fab drawings so
a generated drawing looks like the documents fabricators already work
from, not a bare dimensioned rectangle.
"""

from typing import Any, Dict, List, Optional

NA = "N/A"  # avoids the em-dash glyph, which base14 PDF fonts render as a stray bullet


def _unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = (dx ** 2 + dy ** 2) ** 0.5
    return (dx / length, dy / length) if length else (0, 0)


def _is_vertical_accessory(role: str) -> bool:
    # Side splashes stand upright against the cabinet side — real fab
    # drawings draw them as a tall narrow strip (long dimension vertical),
    # while backsplash runs flat along the wall (long dimension horizontal).
    return role.startswith("side_splash")


def _accessory_svg(parts: List[str], accessories: List[Dict[str, Any]], start_x: int, start_y: int, scale: float) -> None:
    x = start_x
    px_per_in = 2.4  # accessory strips draw at their own smaller scale to fit the row
    for acc in accessories:
        vertical = _is_vertical_accessory(acc.get("role", ""))
        long_dim, short_dim = min(acc["w"] * px_per_in, 130), min(acc["h"] * px_per_in, 20)
        w, h = (short_dim, long_dim) if vertical else (long_dim, short_dim)
        parts.append(f'<rect x="{x:.1f}" y="{start_y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#f8fafc" stroke="#64748b" stroke-width="1"/>')
        if vertical:
            for fy in (start_y + 6, start_y + h / 2, start_y + h - 6):
                parts.append(f'<text x="{x + w / 2:.1f}" y="{fy:.1f}" font-size="7" font-weight="700" fill="#64748b" text-anchor="middle">X</text>')
            parts.append(f'<line x1="{x - 10:.1f}" y1="{start_y:.1f}" x2="{x - 10:.1f}" y2="{start_y + h:.1f}" stroke="#94a3b8" stroke-width="0.6"/>')
            parts.append(f'<text x="{x - 14:.1f}" y="{start_y + h / 2:.1f}" font-size="7" fill="#94a3b8" text-anchor="end">{acc["h"]:g}"</text>')
        else:
            for fx in (x + 6, x + w / 2, x + w - 6):
                parts.append(f'<text x="{fx:.1f}" y="{start_y + h / 2 + 3:.1f}" font-size="7" font-weight="700" fill="#64748b" text-anchor="middle">X</text>')
            parts.append(f'<line x1="{x:.1f}" y1="{start_y - 10:.1f}" x2="{x + w:.1f}" y2="{start_y - 10:.1f}" stroke="#94a3b8" stroke-width="0.6"/>')
            parts.append(f'<text x="{x + w / 2:.1f}" y="{start_y - 13:.1f}" font-size="7" fill="#94a3b8" text-anchor="middle">{acc["w"]:g}"</text>')
        label = acc.get("label", "")
        parts.append(f'<text x="{x:.1f}" y="{start_y + max(h, 14) + 14:.1f}" font-size="8" fill="#64748b">{label}</text>')
        x += max(w, len(label) * 4.6) + 26


def render_svg(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> str:
    meta = meta or {}
    pad = 40
    w_in = geometry.get("width_in", 96) or 96
    h_in = geometry.get("height_in", 42) or 42
    scale = 6  # px per inch
    accessories = geometry.get("accessories") or []
    accessory_max_h = max((min(a["w"] * 2.4, 130) if _is_vertical_accessory(a.get("role", "")) else min(a["h"] * 2.4, 20) for a in accessories), default=0)
    accessory_row_h = (accessory_max_h + 90) if accessories else 0
    vb_w = max(w_in * scale + pad * 2, 300)
    vb_h = h_in * scale + pad * 2 + accessory_row_h

    def px(pt):
        return pt[0] * scale + pad, pt[1] * scale + pad

    parts = [f'<svg viewBox="0 0 {vb_w:.0f} {vb_h:.0f}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">']
    parts.append(f'<rect x="0" y="0" width="{vb_w:.0f}" height="{vb_h:.0f}" fill="white"/>')

    outline = geometry.get("outline") or []
    if outline:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (px(p) for p in outline))
        parts.append(f'<polygon points="{pts}" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5"/>')

    for mark in geometry.get("edge_marks") or []:
        parts.append(_edge_mark_svg_label(outline, mark, px))

    for cutout in geometry.get("cutouts", []):
        x, y, cw, ch = cutout["rect"]
        (px0, py0) = px((x, y))
        w_px, h_px = cw * scale, ch * scale
        shape = cutout.get("shape", "rect")
        if shape == "oval":
            parts.append(
                f'<ellipse cx="{px0 + w_px / 2:.1f}" cy="{py0 + h_px / 2:.1f}" rx="{w_px / 2:.1f}" ry="{h_px / 2:.1f}" '
                f'fill="white" stroke="#334155" stroke-width="1.2"/>'
            )
        elif shape == "rounded_rect":
            parts.append(
                f'<rect x="{px0:.1f}" y="{py0:.1f}" width="{w_px:.1f}" height="{h_px:.1f}" rx="{min(w_px, h_px) * 0.18:.1f}" '
                f'fill="white" stroke="#334155" stroke-width="1.2"/>'
            )
        else:
            parts.append(
                f'<rect x="{px0:.1f}" y="{py0:.1f}" width="{w_px:.1f}" height="{h_px:.1f}" '
                f'fill="white" stroke="#334155" stroke-width="1.2" stroke-dasharray="4,2"/>'
            )
        label = cutout.get("label")
        if label:
            parts.append(f'<text x="{px0 + w_px / 2:.1f}" y="{py0 + h_px / 2:.1f}" '
                          f'font-size="10" fill="#334155" text-anchor="middle" dominant-baseline="middle">{label}</text>')

    for dim in geometry.get("dimensions", []):
        (fx, fy) = px(dim["from"])
        (tx, ty) = px(dim["to"])
        offset = 16
        side = dim.get("side", "top")
        if side == "top":
            fy -= offset; ty -= offset
        elif side == "left":
            fx -= offset; tx -= offset
        elif side == "bottom":
            fy += offset; ty += offset
        parts.append(f'<line x1="{fx:.1f}" y1="{fy:.1f}" x2="{tx:.1f}" y2="{ty:.1f}" stroke="#64748b" stroke-width="0.75"/>')
        for ex, ey in ((fx, fy), (tx, ty)):
            parts.append(f'<line x1="{ex - 3:.1f}" y1="{ey - 3:.1f}" x2="{ex + 3:.1f}" y2="{ey + 3:.1f}" stroke="#64748b" stroke-width="0.75"/>')
        mx, my = (fx + tx) / 2, (fy + ty) / 2
        parts.append(f'<text x="{mx:.1f}" y="{my - 4:.1f}" font-size="9" fill="#64748b" text-anchor="middle">{dim.get("label", "")}</text>')

    if accessories:
        parts.append(f'<line x1="0" y1="{h_in * scale + pad + 20:.1f}" x2="{vb_w:.0f}" y2="{h_in * scale + pad + 20:.1f}" stroke="#e2e8f0" stroke-width="1"/>')
        _accessory_svg(parts, accessories, pad, h_in * scale + pad + 55, scale)

    title = meta.get("part") or meta.get("template_name") or ""
    if title:
        parts.append(f'<text x="{pad}" y="{pad / 2:.1f}" font-size="12" fill="#0f172a" font-weight="600">{title}</text>')

    parts.append("</svg>")
    return "".join(parts)


def _edge_mark_svg_label(outline, side, px):
    if not outline:
        return ""
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pos = {
        "top": ((x0 + x1) / 2, y0), "bottom": ((x0 + x1) / 2, y1),
        "left": (x0, (y0 + y1) / 2), "right": (x1, (y0 + y1) / 2),
    }.get(side)
    if not pos:
        return ""
    px0, py0 = px(pos)
    return f'<text x="{px0:.1f}" y="{py0:.1f}" font-size="11" font-weight="700" fill="#0f172a" text-anchor="middle" dominant-baseline="middle">X</text>'


def _title_block(page, meta: Dict[str, Any]) -> None:
    """Right-hand sidebar matching real StoneDesk fab drawing title blocks:
    Edge Type Key Code, Material Thickness/Color, Quantity, Sink Info,
    Project, Title, Date/Drawn By/Scale/Work Ticket Number."""
    import fitz

    black = (0.06, 0.09, 0.14)
    gray = (0.4, 0.45, 0.5)
    x0, y0, x1 = 612, 20, 776
    page.draw_rect(fitz.Rect(x0, y0, x1, 592), color=gray, width=0.75)

    def row(y, label, value, value_size=11, gap=14):
        page.insert_text((x0 + 6, y), label, fontsize=7, color=gray)
        page.insert_text((x0 + 6, y + gap), str(value or NA), fontsize=value_size, color=black)
        page.draw_line((x0, y + gap + 6), (x1, y + gap + 6), color=gray, width=0.4)
        return y + gap + 16

    y = y0 + 14
    page.insert_text((x0 + 6, y), "EDGE TYPE & FINISH KEY", fontsize=7, color=gray)
    y += 12
    for line in ["X = Eased & Polished", "B = Full Bullnose", "LB = Laminated Bullnose", "S = Seam"]:
        page.insert_text((x0 + 6, y), line, fontsize=6.5, color=gray)
        y += 9
    page.draw_line((x0, y + 4), (x1, y + 4), color=gray, width=0.4)
    y += 16

    y = row(y, "MATERIAL THICKNESS", meta.get("thickness") or "2CM")
    y = row(y, "MATERIAL COLOR", meta.get("stone_color"))
    y = row(y, "QUANTITY", meta.get("qty", 1))
    y = row(y, "SINK INFO", meta.get("sink_info"), value_size=9)
    y = row(y, "PROJECT", meta.get("project"), value_size=9)
    y = row(y, "TITLE", meta.get("part") or meta.get("template_name"), value_size=9)
    y = row(y, "DATE", meta.get("date"))
    y = row(y, "DRAWN BY", meta.get("drawn_by"))
    y = row(y, "SCALE", meta.get("scale") or "NTS")
    row(y, "WORK TICKET NUMBER", meta.get("work_ticket"), value_size=13)


def _destination_matrix(page, destinations: List[Dict[str, Any]]) -> None:
    """Bottom-left Building x Floor destination count table, as in the real drawings."""
    if not destinations:
        return
    buildings = sorted({d.get("building", "") for d in destinations if d.get("building")})
    floors = sorted({d.get("floor", "") for d in destinations if d.get("floor")})
    if not buildings or not floors:
        return
    gray = (0.4, 0.45, 0.5)
    black = (0.06, 0.09, 0.14)
    x0, y0 = 36, 500
    col_w, row_h = 44, 14
    page.insert_text((x0, y0 - 14), f"Bldg #'s / Floor  -  {len(destinations)} total", fontsize=8, color=gray)
    page.insert_text((x0, y0), "Floor", fontsize=7, color=gray)
    for ci, b in enumerate(buildings):
        page.insert_text((x0 + col_w * (ci + 1), y0), str(b), fontsize=7, color=black)
    for ri, f in enumerate(floors):
        yy = y0 + row_h * (ri + 1)
        page.insert_text((x0, yy), str(f), fontsize=7, color=gray)
        for ci, b in enumerate(buildings):
            count = sum(1 for d in destinations if d.get("building") == b and d.get("floor") == f)
            if count:
                page.insert_text((x0 + col_w * (ci + 1), yy), str(count), fontsize=7, color=black)


def _draw_dimension(page, f, t, offset, side, color, gray):
    if side == "top":
        f = (f[0], f[1] - offset); t = (t[0], t[1] - offset)
    elif side == "left":
        f = (f[0] - offset, f[1]); t = (t[0] - offset, t[1])
    elif side == "bottom":
        f = (f[0], f[1] + offset); t = (t[0], t[1] + offset)
    page.draw_line(f, t, color=gray, width=0.5)
    # Small perpendicular tick marks at each end, like a real dimension line.
    for (ex, ey) in (f, t):
        page.draw_line((ex - 3, ey - 3), (ex + 3, ey + 3), color=gray, width=0.5)
    return f, t


def _edge_mark_pdf(page, outline, side, to_page, color):
    if not outline:
        return
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pos = {
        "top": ((x0 + x1) / 2, y0), "bottom": ((x0 + x1) / 2, y1),
        "left": (x0, (y0 + y1) / 2), "right": (x1, (y0 + y1) / 2),
    }.get(side)
    if not pos:
        return
    px, py = to_page(pos)
    page.insert_text((px - 3, py + 3), "X", fontsize=9, color=color, fontname="hebo")


def render_pdf_bytes(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> bytes:
    import fitz

    meta = meta or {}
    doc = fitz.open()
    page = doc.new_page(width=792, height=612)  # 11x8.5in landscape @ 72dpi

    black = (0.06, 0.09, 0.14)
    gray = (0.4, 0.45, 0.5)

    _title_block(page, meta)

    page.insert_text((36, 36), meta.get("part") or meta.get("template_name", "Countertop Drawing"), fontsize=16, color=black)
    subtitle = " - ".join(str(v) for v in [meta.get("building"), meta.get("floor"), meta.get("flat")] if v)
    if subtitle:
        page.insert_text((36, 54), subtitle, fontsize=10, color=gray)
    page.draw_line((36, 62), (600, 62), color=gray, width=0.5)

    w_in = geometry.get("width_in", 96) or 96
    h_in = geometry.get("height_in", 42) or 42
    draw_x0, draw_y0, draw_x1, draw_y1 = 60, 90, 596, 380
    avail_w, avail_h = draw_x1 - draw_x0, draw_y1 - draw_y0
    scale = min(avail_w / w_in, avail_h / h_in) if w_in and h_in else 1
    rw, rh = w_in * scale, h_in * scale
    rx0 = draw_x0 + (avail_w - rw) / 2
    ry0 = draw_y0 + (avail_h - rh) / 2

    def to_page(pt):
        return rx0 + pt[0] * scale, ry0 + pt[1] * scale

    outline = geometry.get("outline") or []
    corner_radius = (geometry.get("corner_radius") or 0) * scale
    if outline:
        pts = [to_page(p) for p in outline]
        n = len(pts)
        r = min(corner_radius, 14)
        # Build the vertex sequence to actually draw between, chamfering the
        # front-left corner (vertex 0) to indicate the R.5" corner radius
        # called out on real fab drawings — a short diagonal reads clearly
        # at drawing scale without the risk of a mismatched true arc.
        if r > 1 and n >= 3:
            corner = pts[0]
            trim_in = (corner[0] + _unit(corner, pts[-1])[0] * r, corner[1] + _unit(corner, pts[-1])[1] * r)
            trim_out = (corner[0] + _unit(corner, pts[1])[0] * r, corner[1] + _unit(corner, pts[1])[1] * r)
            draw_pts = [trim_out] + pts[1:] + [trim_in, trim_out]
        else:
            draw_pts = pts + [pts[0]]
        for i in range(len(draw_pts) - 1):
            page.draw_line(draw_pts[i], draw_pts[i + 1], color=black, width=1.4)

    for mark in geometry.get("edge_marks") or []:
        _edge_mark_pdf(page, outline, mark, to_page, black)

    for cutout in geometry.get("cutouts", []):
        x, y, cw, ch = cutout["rect"]
        p0 = to_page((x, y))
        p1 = to_page((x + cw, y + ch))
        shape = cutout.get("shape", "rect")
        if shape == "oval":
            page.draw_oval(fitz.Rect(*p0, *p1), color=gray, width=1.0)
        elif shape == "rounded_rect":
            page.draw_rect(fitz.Rect(*p0, *p1), color=gray, width=1.0, radius=0.15)
        else:
            page.draw_rect(fitz.Rect(*p0, *p1), color=gray, width=1.0, dashes="[2 2] 0")
        label = cutout.get("label")
        if label:
            page.insert_text(((p0[0] + p1[0]) / 2 - len(label) * 3, (p0[1] + p1[1]) / 2), label, fontsize=9, color=gray)

    for dim in geometry.get("dimensions", []):
        f, t = _draw_dimension(page, to_page(dim["from"]), to_page(dim["to"]), 16, dim.get("side", "top"), black, gray)
        label = dim.get("label", "")
        mx, my = (f[0] + t[0]) / 2, (f[1] + t[1]) / 2
        page.insert_text((mx - len(label) * 2.5, my - 4), label, fontsize=8, color=gray)

    accessories = geometry.get("accessories") or []
    if accessories:
        ax, ay = 60, 420
        page.insert_text((ax, ay - 22), "Bundled accessories (included with this top):", fontsize=8, color=gray)
        px_per_in = 2.0
        for acc in accessories:
            vertical = _is_vertical_accessory(acc.get("role", ""))
            long_dim, short_dim = min(acc["w"] * px_per_in, 85), min(acc["h"] * px_per_in, 18)
            aw, ah = (short_dim, long_dim) if vertical else (long_dim, short_dim)
            label_w = len(acc.get("label", "")) * 3.6
            page.draw_rect(fitz.Rect(ax, ay, ax + aw, ay + ah), color=gray, width=0.8)
            if vertical:
                for fy in (ay + 8, ay + ah / 2, ay + ah - 8):
                    page.insert_text((ax + aw / 2 - 3, fy + 3), "X", fontsize=7, color=gray, fontname="hebo")
                page.draw_line((ax - 10, ay), (ax - 10, ay + ah), color=gray, width=0.5)
                page.insert_text((ax - 24, ay + ah / 2), f'{acc["h"]:g}"', fontsize=7, color=gray)
            else:
                for fx in (ax + 8, ax + aw / 2, ax + aw - 8):
                    page.insert_text((fx - 3, ay + ah / 2 + 3), "X", fontsize=7, color=gray, fontname="hebo")
                page.draw_line((ax, ay - 8), (ax + aw, ay - 8), color=gray, width=0.5)
                page.insert_text((ax + aw / 2 - 10, ay - 11), f'{acc["w"]:g}"', fontsize=7, color=gray)
            page.insert_text((ax, ay + max(ah, 14) + 12), acc.get("label", ""), fontsize=7, color=gray)
            ax += max(aw, label_w) + 30

    for note_i, note in enumerate(geometry.get("notes", [])):
        page.insert_text((36, 470 + note_i * 14), note, fontsize=9, color=gray)

    _destination_matrix(page, meta.get("destinations") or [])

    page.draw_line((36, 592), (250, 592), color=gray, width=0.6)
    page.insert_text((36, 604), "X   Signature of Approval", fontsize=7, color=gray)
    page.insert_text((300, 604), "Date", fontsize=7, color=gray)

    buf = doc.tobytes()
    doc.close()
    return buf
