"""
Renders template geometry (see drawing_templates.py) to SVG and PDF.

Geometry is plain data — an outline polygon, rectangular cutouts, dimension-
line hints, and bundled accessory pieces (backsplash/side splash), all in
inches — so the same geometry produced for a live browser preview can also
be turned into a downloadable SVG or a fabrication-style PDF without
recomputation.

The PDF title block (Edge Type Key Code, Material, Sink Info, Project,
Title, Date/Drawn By/Scale/Work Ticket #, destination matrix) mirrors the
layout of real StoneDesk fab drawings so a generated drawing looks like the
documents fabricators already work from, not a bare dimensioned rectangle.
"""

from typing import Any, Dict, List, Optional


def _accessory_svg(parts: List[str], accessories: List[Dict[str, Any]], start_x: int, start_y: int, scale: float) -> None:
    x = start_x
    for acc in accessories:
        w, h = acc["w"] * scale * 0.5, acc["h"] * scale * 0.5
        parts.append(f'<rect x="{x:.1f}" y="{start_y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#f8fafc" stroke="#64748b" stroke-width="1"/>')
        parts.append(f'<text x="{x:.1f}" y="{start_y - 6:.1f}" font-size="8" fill="#64748b">{acc.get("label", "")}</text>')
        x += w + 24


def render_svg(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> str:
    meta = meta or {}
    pad = 40
    w_in = geometry.get("width_in", 96) or 96
    h_in = geometry.get("height_in", 42) or 42
    scale = 6  # px per inch
    accessories = geometry.get("accessories") or []
    accessory_row_h = 90 if accessories else 0
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

    for cutout in geometry.get("cutouts", []):
        x, y, cw, ch = cutout["rect"]
        (px0, py0) = px((x, y))
        parts.append(
            f'<rect x="{px0:.1f}" y="{py0:.1f}" width="{cw * scale:.1f}" height="{ch * scale:.1f}" '
            f'fill="white" stroke="#334155" stroke-width="1.2" stroke-dasharray="4,2"/>'
        )
        label = cutout.get("label")
        if label:
            parts.append(f'<text x="{px0 + cw * scale / 2:.1f}" y="{py0 + ch * scale / 2:.1f}" '
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
        page.insert_text((x0 + 6, y + gap), str(value or "—"), fontsize=value_size, color=black)
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

    y = row(y, "MATERIAL THICKNESS", meta.get("thickness", "2CM"))
    y = row(y, "MATERIAL COLOR", meta.get("stone_color", "—"))
    y = row(y, "QUANTITY", meta.get("qty", 1))
    y = row(y, "SINK INFO", meta.get("sink_info", "—"), value_size=9)
    y = row(y, "PROJECT", meta.get("project", "—"), value_size=9)
    y = row(y, "TITLE", meta.get("part") or meta.get("template_name", "—"), value_size=9)
    y = row(y, "DATE", meta.get("date", "—"))
    y = row(y, "DRAWN BY", meta.get("drawn_by", "—"))
    y = row(y, "SCALE", meta.get("scale", "NTS"))
    row(y, "WORK TICKET NUMBER", meta.get("work_ticket", "—"), value_size=13)


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
    page.insert_text((x0, y0 - 14), f"Bldg #'s / Floor  ·  {len(destinations)} total", fontsize=8, color=gray)
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


def render_pdf_bytes(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> bytes:
    import fitz

    meta = meta or {}
    doc = fitz.open()
    page = doc.new_page(width=792, height=612)  # 11x8.5in landscape @ 72dpi

    black = (0.06, 0.09, 0.14)
    gray = (0.4, 0.45, 0.5)

    _title_block(page, meta)

    page.insert_text((36, 36), meta.get("part") or meta.get("template_name", "Countertop Drawing"), fontsize=16, color=black)
    subtitle = " · ".join(str(v) for v in [meta.get("building"), meta.get("floor"), meta.get("flat")] if v)
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
    if outline:
        pts = [to_page(p) for p in outline]
        for i in range(len(pts)):
            page.draw_line(pts[i], pts[(i + 1) % len(pts)], color=black, width=1.4)

    for cutout in geometry.get("cutouts", []):
        x, y, cw, ch = cutout["rect"]
        p0 = to_page((x, y))
        p1 = to_page((x + cw, y + ch))
        page.draw_rect(fitz.Rect(*p0, *p1), color=gray, width=1.0, dashes="[2 2] 0")
        label = cutout.get("label")
        if label:
            page.insert_text(((p0[0] + p1[0]) / 2 - len(label) * 3, (p0[1] + p1[1]) / 2), label, fontsize=9, color=gray)

    for dim in geometry.get("dimensions", []):
        f = to_page(dim["from"])
        t = to_page(dim["to"])
        offset = 16
        side = dim.get("side", "top")
        if side == "top":
            f = (f[0], f[1] - offset); t = (t[0], t[1] - offset)
        elif side == "left":
            f = (f[0] - offset, f[1]); t = (t[0] - offset, t[1])
        elif side == "bottom":
            f = (f[0], f[1] + offset); t = (t[0], t[1] + offset)
        page.draw_line(f, t, color=gray, width=0.5)
        label = dim.get("label", "")
        mx, my = (f[0] + t[0]) / 2, (f[1] + t[1]) / 2
        page.insert_text((mx - len(label) * 2.5, my - 4), label, fontsize=8, color=gray)

    accessories = geometry.get("accessories") or []
    if accessories:
        ax, ay = 60, 410
        page.insert_text((ax, ay - 8), "Bundled accessories (included with this top):", fontsize=8, color=gray)
        for acc in accessories:
            aw, ah = min(acc["w"] * 2, 160), min(acc["h"] * 2, 40)
            page.draw_rect(fitz.Rect(ax, ay, ax + aw, ay + ah), color=gray, width=0.8)
            page.insert_text((ax, ay + ah + 10), acc.get("label", ""), fontsize=7, color=gray)
            ax += aw + 24

    for note_i, note in enumerate(geometry.get("notes", [])):
        page.insert_text((36, 470 + note_i * 14), note, fontsize=9, color=gray)

    _destination_matrix(page, meta.get("destinations") or [])

    page.draw_line((36, 592), (250, 592), color=gray, width=0.6)
    page.insert_text((36, 604), "X   Signature of Approval", fontsize=7, color=gray)
    page.insert_text((300, 604), "Date", fontsize=7, color=gray)

    buf = doc.tobytes()
    doc.close()
    return buf
