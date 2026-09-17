"""
Renders template geometry (see drawing_templates.py) to SVG and PDF.

Geometry is plain data — an outline polygon, rectangular cutouts, and
dimension-line hints, all in inches — so the same geometry produced for a
live browser preview can also be turned into a downloadable SVG or a
fabrication-style PDF without recomputation.
"""

from typing import Any, Dict, Optional


def render_svg(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> str:
    meta = meta or {}
    pad = 40
    w_in = geometry.get("width_in", 96) or 96
    h_in = geometry.get("height_in", 42) or 42
    scale = 6  # px per inch
    vb_w = w_in * scale + pad * 2
    vb_h = h_in * scale + pad * 2

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

    title = meta.get("part") or meta.get("template_name") or ""
    if title:
        parts.append(f'<text x="{pad}" y="{pad / 2:.1f}" font-size="12" fill="#0f172a" font-weight="600">{title}</text>')

    parts.append("</svg>")
    return "".join(parts)


def render_pdf_bytes(geometry: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> bytes:
    import fitz

    meta = meta or {}
    doc = fitz.open()
    page = doc.new_page(width=792, height=612)  # 11x8.5in landscape @ 72dpi

    black = (0.06, 0.09, 0.14)
    gray = (0.4, 0.45, 0.5)

    page.insert_text((36, 36), meta.get("part") or meta.get("template_name", "Countertop Drawing"), fontsize=16, color=black)
    subtitle = " · ".join(str(v) for v in [meta.get("building"), meta.get("floor"), meta.get("flat")] if v)
    if subtitle:
        page.insert_text((36, 54), subtitle, fontsize=10, color=gray)
    page.draw_line((36, 62), (756, 62), color=gray, width=0.5)

    w_in = geometry.get("width_in", 96) or 96
    h_in = geometry.get("height_in", 42) or 42
    draw_x0, draw_y0, draw_x1, draw_y1 = 60, 100, 732, 480
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

    for note_i, note in enumerate(geometry.get("notes", [])):
        page.insert_text((36, 500 + note_i * 14), note, fontsize=9, color=gray)

    buf = doc.tobytes()
    doc.close()
    return buf
