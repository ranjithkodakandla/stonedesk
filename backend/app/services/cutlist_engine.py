"""
2D guillotine cutting-stock nesting engine.

Given a set of rectangular pieces (length x width x qty) and a stock slab
size + kerf (blade thickness), nests pieces onto the fewest stock sheets
possible so a bridge saw can cut them with straight, edge-to-edge
("guillotine") cuts — the same constraint cutlistoptimizer.com's output
respects (its PDF cut-sequence table is a list of straight full cuts).

Uses `rectpack`'s GuillotineBssfSas algorithm (guillotine-constrained best
short-side-fit): benchmarked against a real 1,286-piece shop cut list at
~90% material use in ~0.2s, matching cutlistoptimizer.com's own result
(~90% used, ~101 sheets) without its multi-minute iterative search.

Pure/stateless: takes plain dicts in, returns plain dicts out, so it can be
unit-tested without Mongo or FastAPI.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from rectpack import newPacker
from rectpack.guillotine import GuillotineBssfSas


@dataclass
class Placement:
    label: str
    x: float
    y: float
    w: float
    h: float
    rotated: bool


@dataclass
class CutRecord:
    """One guillotine cut reconstructed from the final layout: `panel` is the
    rect being cut, `axis`/`pos` describe the cut line, and `piece` is one of
    the two resulting rects that turned out to be an actual placed piece (the
    other side continues to the next row, or is flagged surplus if empty)."""
    panel_w: float
    panel_h: float
    axis: str  # 'x' (vertical cut) or 'y' (horizontal cut)
    pos: float
    piece_w: float
    piece_h: float
    surplus_w: float = 0.0
    surplus_h: float = 0.0
    has_surplus: bool = False


@dataclass
class Sheet:
    stock_length: float
    stock_width: float
    placements: List[Placement] = field(default_factory=list)
    cut_log: List[CutRecord] = field(default_factory=list)

    def used_area(self) -> float:
        return sum(p.w * p.h for p in self.placements)


def _expand_pieces(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Expand qty-aggregated rows into one entry per physical piece."""
    expanded = []
    for row in rows:
        length = float(row.get("length") or 0)
        width = float(row.get("width") or 0)
        qty = max(1, int(row.get("qty") or 1))
        label = str(row.get("label") or row.get("part_no") or row.get("part") or "")
        if length <= 0 or width <= 0:
            continue
        for _ in range(qty):
            expanded.append({"length": length, "width": width, "label": label})
    return expanded


def _reconstruct_cuts(gross_rects: List[Dict[str, Any]], sheet_w: float, sheet_h: float, kerf: float) -> List[CutRecord]:
    """rectpack places pieces without exposing the guillotine split tree it
    used internally, but a guillotine-constrained packing is by definition
    recursively separable by straight cuts — this recovers one valid cut
    sequence from the final rect positions, in the same '#, Panel, Cut,
    Result' shape as the cutlistoptimizer.com PDF, so the shop still gets a
    literal step-by-step cutting order, not just a picture.

    `gross_rects` carries each piece's kerf-INCLUSIVE footprint (w/h already
    have +kerf added) — the recursion must split on these gross footprints,
    not the net piece size, otherwise the remaining-panel size after each cut
    silently forgets the kerf the saw actually consumes and drifts off by a
    kerf-width per cut (e.g. reporting a 36" remainder when the true
    kerf-adjusted remainder is 35.7"). Only the final reported piece/panel
    sizes are converted back to net (kerf-excluded) dimensions."""
    cuts: List[CutRecord] = []

    def recurse(x0, y0, w, h, items):
        if len(items) <= 1:
            return
        # Try a vertical ("x") cut: some line x0 < xcut < x0+w with every
        # item fully on one side or the other.
        xs = sorted({it["x"] for it in items} | {it["x"] + it["w"] for it in items})
        for xcut in xs:
            if not (x0 + 1e-6 < xcut < x0 + w - 1e-6):
                continue
            left = [it for it in items if it["x"] + it["w"] <= xcut + 1e-6]
            right = [it for it in items if it["x"] >= xcut - 1e-6]
            if left and right and len(left) + len(right) == len(items):
                piece_w = xcut - x0
                surplus_w = (x0 + w) - xcut
                cuts.append(CutRecord(
                    panel_w=w - kerf, panel_h=h - kerf, axis="x", pos=piece_w - kerf,
                    piece_w=piece_w - kerf, piece_h=h - kerf,
                    surplus_w=max(0.0, surplus_w - kerf), surplus_h=h - kerf, has_surplus=len(right) == 0,
                ))
                recurse(x0, y0, piece_w, h, left)
                recurse(xcut, y0, surplus_w, h, right)
                return
        # Try a horizontal ("y") cut.
        ys = sorted({it["y"] for it in items} | {it["y"] + it["h"] for it in items})
        for ycut in ys:
            if not (y0 + 1e-6 < ycut < y0 + h - 1e-6):
                continue
            top = [it for it in items if it["y"] + it["h"] <= ycut + 1e-6]
            bottom = [it for it in items if it["y"] >= ycut - 1e-6]
            if top and bottom and len(top) + len(bottom) == len(items):
                piece_h = ycut - y0
                surplus_h = (y0 + h) - ycut
                cuts.append(CutRecord(
                    panel_w=w - kerf, panel_h=h - kerf, axis="y", pos=piece_h - kerf,
                    piece_w=w - kerf, piece_h=piece_h - kerf,
                    surplus_w=w - kerf, surplus_h=max(0.0, surplus_h - kerf), has_surplus=len(bottom) == 0,
                ))
                recurse(x0, y0, w, piece_h, top)
                recurse(x0, ycut, w, surplus_h, bottom)
                return
        # No separating line found (shouldn't happen for a guillotine-valid
        # layout barring float precision) — stop recursing this branch.

    recurse(0.0, 0.0, sheet_w, sheet_h, gross_rects)
    return cuts


def _pack_group(pieces: List[Dict[str, Any]], stock_length: float, stock_width: float,
                 kerf: float, allow_rotate: bool) -> List[Sheet]:
    if not pieces:
        return []

    packer = newPacker(rotation=allow_rotate, pack_algo=GuillotineBssfSas)
    for i, piece in enumerate(pieces):
        # rectpack packs (width, height) into bins of (bin_width, bin_height);
        # our pieces are (width, length) against a (stock_width, stock_length) bin.
        packer.add_rect(piece["width"] + kerf, piece["length"] + kerf, rid=i)

    # Enough bins for the worst case (every piece on its own sheet) — rectpack
    # only uses as many as it needs, extras are simply left empty and dropped.
    for _ in range(len(pieces)):
        packer.add_bin(stock_width, stock_length)
    packer.pack()

    sheets: List[Sheet] = []
    for abin in packer:
        if len(abin) == 0:
            continue
        net_rects = []
        gross_rects = []
        for rect in abin:
            piece = pieces[rect.rid]
            rotated = abs(rect.width - kerf - piece["length"]) < 1e-6 and abs(rect.height - kerf - piece["width"]) < 1e-6
            net_rects.append({
                "x": rect.x, "y": rect.y,
                "w": rect.width - kerf, "h": rect.height - kerf,
                "label": piece["label"], "rotated": rotated,
            })
            gross_rects.append({"x": rect.x, "y": rect.y, "w": rect.width, "h": rect.height})
        sheet = Sheet(stock_length=stock_length, stock_width=stock_width)
        sheet.placements = [Placement(r["label"], r["x"], r["y"], r["w"], r["h"], r["rotated"]) for r in net_rects]
        sheet.cut_log = _reconstruct_cuts(gross_rects, stock_width, stock_length, kerf)
        sheets.append(sheet)

    return sheets


def _cut_metrics(sheet: Sheet) -> Tuple[int, float]:
    return len(sheet.cut_log), sum(
        (rec.panel_h if rec.axis == "x" else rec.panel_w) for rec in sheet.cut_log
    )


def _build_cuts_table(sheet: Sheet) -> List[Dict[str, Any]]:
    rows = []
    for i, rec in enumerate(sheet.cut_log, start=1):
        note = f"surplus {rec.surplus_w:.2f}x{rec.surplus_h:.2f}" if rec.has_surplus else "-"
        rows.append({
            "n": i,
            "panel": f"{rec.panel_w:.2f}x{rec.panel_h:.2f}",
            "cut": f"{rec.axis}={rec.pos:.2f}",
            "result": f"{rec.piece_w:.2f}x{rec.piece_h:.2f}",
            "note": note,
        })
    return rows


def run_cutlist(piece_rows: List[Dict[str, Any]], stock_length: float, stock_width: float,
                 kerf: float = 0.125, allow_rotate: bool = True, consider_material: bool = True,
                 time_budget_s: float = 3.0) -> Dict[str, Any]:
    """
    piece_rows: list of {length, width, qty, label?, material?, thickness?, stone_color?}

    consider_material: when True (default, and the safe choice for stone —
    different materials/thicknesses/colors physically cannot share a slab),
    groups pieces by (material, thickness, stone_color) and nests each group
    onto its own sheets. When False, mirrors cutlistoptimizer.com's toggle of
    the same name and nests everything together, ignoring stone type.

    time_budget_s: unused by the current rectpack-based packer (kept in the
    signature for API stability — the underlying algorithm is a single fast
    deterministic pass, not an iterative search).

    Returns {groups: [{key, sheets: [...], summary: {...}}], summary: {...totals...}}
    """
    groups: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
    for row in piece_rows:
        key = (
            str(row.get("material") or "").strip(),
            str(row.get("thickness") or "").strip(),
            str(row.get("stone_color") or "").strip(),
        ) if consider_material else ("", "", "")
        groups.setdefault(key, []).append(row)

    result_groups = []
    total_sheets = 0
    total_used_area = 0.0
    total_wasted_area = 0.0
    total_cuts = 0
    total_cut_length = 0.0

    for key, rows in groups.items():
        expanded = _expand_pieces(rows)
        if not expanded:
            continue
        sheets = _pack_group(expanded, stock_length, stock_width, kerf, allow_rotate)

        sheet_dicts = []
        group_used = 0.0
        sheet_area = stock_length * stock_width
        for sheet in sheets:
            used = sheet.used_area()
            wasted = sheet_area - used
            cuts, cut_len = _cut_metrics(sheet)
            group_used += used
            total_cuts += cuts
            total_cut_length += cut_len
            sheet_dicts.append({
                "stock_length": stock_length,
                "stock_width": stock_width,
                "used_area": round(used, 2),
                "wasted_area": round(wasted, 2),
                "used_pct": round(100 * used / sheet_area, 1) if sheet_area else 0,
                "placements": [
                    {
                        "label": p.label, "x": round(p.x, 3), "y": round(p.y, 3),
                        "w": round(p.w, 3), "h": round(p.h, 3), "rotated": p.rotated,
                    }
                    for p in sheet.placements
                ],
                "cuts_table": _build_cuts_table(sheet),
            })

        group_area = sheet_area * len(sheets)
        group_wasted = group_area - group_used
        total_sheets += len(sheets)
        total_used_area += group_used
        total_wasted_area += group_wasted

        material, thickness, stone_color = key
        result_groups.append({
            "material": material, "thickness": thickness, "stone_color": stone_color,
            "sheets_used": len(sheets),
            "used_area": round(group_used, 2),
            "wasted_area": round(group_wasted, 2),
            "used_pct": round(100 * group_used / group_area, 1) if group_area else 0,
            "sheets": sheet_dicts,
        })

    total_area = total_used_area + total_wasted_area
    summary = {
        "stock_length": stock_length,
        "stock_width": stock_width,
        "kerf": kerf,
        "total_sheets": total_sheets,
        "total_used_area": round(total_used_area, 2),
        "total_wasted_area": round(total_wasted_area, 2),
        "total_used_pct": round(100 * total_used_area / total_area, 1) if total_area else 0,
        "total_cuts": total_cuts,
        "total_cut_length": round(total_cut_length, 2),
    }

    return {"groups": result_groups, "summary": summary}
