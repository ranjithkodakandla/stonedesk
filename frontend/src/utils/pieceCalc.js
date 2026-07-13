// Shared sqft/weight estimate formulas, used by both Manual Entry (PiecesGrid)
// and Automated Upload (UploadGrid) so parsed rows get the same live estimates
// a manually-entered row would, without the user having to type them in.

export const WEIGHT_FACTORS = {
  Granite: { '2CM': 5.5, '3CM': 7.5, Mixed: 6.5 },
  Quartz:  { '2CM': 4.75, '3CM': 6.75, Mixed: 5.75 },
  Marble:  { '2CM': 6.0, '3CM': 8.0, Mixed: 7.0 },
};

export const calcSqft = (l, w, qty) => {
  const ll = Number(l) || 0, ww = Number(w) || 0, q = Number(qty) || 1;
  return ll > 0 && ww > 0 ? (ll * ww / 144) * q : 0;
};

export const calcWeight = (l, w, qty, material, rowThickness, projectThickness) => {
  const thick = projectThickness || rowThickness || '3CM';
  const f = (WEIGHT_FACTORS[material] || WEIGHT_FACTORS.Granite)[thick] || 7.5;
  return calcSqft(l, w, qty) * f;
};
