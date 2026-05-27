/**
 * Shared leaning-supported load geometry for engineering compositor (presentation only).
 * Matches operational lean model: ~15° from vertical into A-frame support.
 */
import React from 'react';

export const LEAN_DEG = 15;
export const LEAN_TAN = Math.tan((LEAN_DEG * Math.PI) / 180);
export const LEAN_COS = Math.cos((LEAN_DEG * Math.PI) / 180);

export const COS30 = 0.866;
export const SIN30 = 0.5;

export function iso(cx, cy, x, y, z, k) {
  return { x: cx + (x - z) * COS30 * k, y: cy - y * k + (x + z) * SIN30 * k };
}

export function packingPattern(island, crateClass) {
  if (island) return 'island';
  if (crateClass === 'vanity_vertical') return 'vanity';
  return 'kitchen';
}

export function patternSubtitle(pattern) {
  if (pattern === 'island') return 'LEANING SUPPORTED LOAD · ISLAND CASSETTE';
  if (pattern === 'vanity') return 'LEANING SUPPORTED LOAD · VANITY FAMILY';
  return 'LEANING SUPPORTED LOAD · KITCHEN FAMILY';
}

export function patternBanner(pattern, pieceCount) {
  if (pattern === 'island') return `LEANING SUPPORTED CASSETTE · ${pieceCount} SLABS`;
  if (pattern === 'vanity') return `COMPACT FAMILY BUNDLE · ${pieceCount} PARTS`;
  return `TOP-CENTRIC FAMILY BUNDLE · ${pieceCount} PARTS`;
}

/** Draw one leaning slab panel in isometric (face toward opening). */
export function drawLeaningSlab(g, cx, cy, k, x, y, z, slabW, slabH, thickZ, opts = {}) {
  const {
    fill = 'url(#granite)',
    stroke = '#334155',
    label,
    sub,
    foam = false,
    opacity = 1,
    keyPrefix = 'slab',
  } = opts;
  const leanOff = slabH * LEAN_TAN;
  const zBack = z + leanOff;

  const bl = iso(cx, cy, x, y, z, k);
  const br = iso(cx, cy, x + slabW, y, z, k);
  const fr = iso(cx, cy, x + slabW, y, z + thickZ, k);
  const fl = iso(cx, cy, x, y, z + thickZ, k);
  const tbl = iso(cx, cy, x, y + slabH, zBack, k);
  const tbr = iso(cx, cy, x + slabW, y + slabH, zBack, k);
  const tfr = iso(cx, cy, x + slabW, y + slabH, zBack + thickZ, k);
  const tfl = iso(cx, cy, x, y + slabH, zBack + thickZ, k);

  const foamFill = foam ? 'url(#foamHatch)' : fill;
  const poly = (pts, f, s, sw, id, op = 1) => (
    <polygon key={id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={f} fillOpacity={op} stroke={s} strokeWidth={sw} />
  );

  g.push(poly([fl, fr, tfr, tfl], foamFill, foam ? '#b45309' : stroke, foam ? 1 : 1.1, `${keyPrefix}-face`, opacity));
  g.push(poly([fr, br, tbr, tfr], foam ? '#fcd34d' : '#64748b', stroke, 0.85, `${keyPrefix}-sd`, foam ? 0.9 : 0.55));
  g.push(poly([bl, br, tbr, tbl], foamFill, foam ? '#b45309' : stroke, 0.9, `${keyPrefix}-bt`, opacity));

  if (label) {
    const c = { x: (fl.x + tfl.x + fr.x + tfr.x) / 4, y: (fl.y + tfl.y + fr.y + tfr.y) / 4 };
    g.push(<text key={`${keyPrefix}-lb`} x={c.x} y={c.y - (sub ? 3 : 0)} textAnchor="middle" fontSize="9" fontWeight="800" fill={foam ? '#78350f' : '#111'}>{label}</text>);
    if (sub) g.push(<text key={`${keyPrefix}-sub`} x={c.x} y={c.y + 9} textAnchor="middle" fontSize="7" fill="#444">{sub}</text>);
  }
}

/** Thin foam sheet between slabs (depth-wise). */
export function drawFoamSheet(g, cx, cy, k, x, y, z, w, h, depth, gapIn, key) {
  drawLeaningSlab(g, cx, cy, k, x, y, z, w, h, Math.max(depth, 0.8), {
    foam: true,
    label: `${gapIn}″ FOAM`,
    sub: 'inter-piece separator',
    keyPrefix: key,
  });
}

/** 2D depth-section leaning panel (side elevation looking along crate length). */
export function drawLeanSectionPanel(g, x, baseY, z, w, h, thick, opts = {}) {
  const { fill = 'url(#granite)', stroke = '#334155', label, foam = false, key = 'sp' } = opts;
  const leanOff = h * LEAN_TAN;
  const pts = `${x},${baseY} ${x + w},${baseY} ${x + w + leanOff},${baseY - h} ${x + leanOff},${baseY - h}`;
  g.push(
    <g key={key}>
      <polygon points={pts} fill={foam ? 'url(#foamHatch)' : fill} stroke={stroke} strokeWidth="1.5" />
      {thick > 0 && !foam && (
        <line x1={x + w} y1={baseY} x2={x + w + leanOff + thick * 0.15} y2={baseY - h} stroke="#fff" strokeOpacity="0.35" />
      )}
      {label && <text x={x + w / 2 + leanOff / 2} y={baseY - h / 2 + 3} textAnchor="middle" fontSize="8" fontWeight="700" fill="#111">{label}</text>}
    </g>,
  );
  return z + thick;
}
