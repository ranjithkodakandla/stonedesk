/** Groups physical sheets sharing an identical placement signature into a
 * single pattern stamped with how many physical sheets use it — the JS twin
 * of the backend's _dedupe_sheet_patterns, so the on-screen view and the
 * PDF agree on what "one sheet" means. */
export function buildPatternList(result) {
  const patterns = [];
  (result?.groups || []).forEach((group) => {
    const byKey = new Map();
    const order = [];
    (group.sheets || []).forEach((sheet) => {
      const key = [...sheet.placements]
        .map((p) => [Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.w * 100), Math.round(p.h * 100)].join(','))
        .sort()
        .join('|');
      if (!byKey.has(key)) {
        byKey.set(key, { group, sheet, qty: 0 });
        order.push(key);
      }
      byKey.get(key).qty += 1;
    });
    order.forEach((key) => patterns.push(byKey.get(key)));
  });
  return patterns;
}

export const PANEL_PALETTE = [
  '#cddced', '#edd9cd', '#d9edd4', '#ede6c8',
  '#ded4ed', '#edcdde', '#cdede9', '#e5e5cd',
];

export function colorForSizes(sizeKeys) {
  const map = {};
  sizeKeys.forEach((k, i) => { map[k] = PANEL_PALETTE[i % PANEL_PALETTE.length]; });
  return map;
}
