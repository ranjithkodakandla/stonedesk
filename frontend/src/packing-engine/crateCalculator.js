// Slab thickness in inches (nominal)
const SLAB_THICK = { '2CM': 0.79, '3CM': 1.18, Mixed: 0.98 };

export const defaultCalculatorParams = {
  foamSeparatorThickness: 0.5,   // in — between each piece
  woodPanelThickness:     1.25,  // in — side/bottom/top panels
  edgeGuardThickness:     0.375, // in — foam edge guard each side
  forkliftClearance:      4.0,   // in — base clearance for forks
  safetyMargin:           1.0,   // in — each side (length + width)
  cornerReinforcement:    0.75,  // in — extra thickness at corners
  orientation:            'flat', // 'flat' | 'vertical'
};

/**
 * Calculate internal and external crate dimensions from piece list.
 * All values in inches.
 */
export const calculateCrateDimensions = (pieces, params = {}) => {
  const p   = { ...defaultCalculatorParams, ...params };
  const pcs = (pieces || []).filter(pc => Number(pc.length || 0) > 0);
  if (!pcs.length) return null;

  const maxLength = Math.max(...pcs.map(pc => Number(pc.length || 0)));
  const maxWidth  = Math.max(...pcs.map(pc => Number(pc.width  || 0)));

  // Stack height — sum of each slab + foam separator
  let stackHeight = 0;
  pcs.forEach(pc => {
    const slabThick = SLAB_THICK[pc.thickness || '3CM'] || 0.98;
    stackHeight += slabThick + p.foamSeparatorThickness;
  });
  stackHeight = Math.max(stackHeight, 4);

  let innerLength, innerWidth, innerHeight;

  if (p.orientation === 'vertical') {
    // Pieces stand on edge — L along length, W becomes height
    innerLength = maxLength + p.safetyMargin * 2 + p.edgeGuardThickness * 2;
    innerWidth  = stackHeight + p.safetyMargin * 2;
    innerHeight = maxWidth  + p.safetyMargin * 2 + p.forkliftClearance;
  } else {
    // Default flat stacking
    innerLength = maxLength + p.safetyMargin * 2 + p.edgeGuardThickness * 2;
    innerWidth  = maxWidth  + p.safetyMargin * 2 + p.edgeGuardThickness * 2;
    innerHeight = stackHeight + p.forkliftClearance;
  }

  // Outer = inner + panels + corner reinforcement
  const outerLength = innerLength + (p.woodPanelThickness + p.cornerReinforcement) * 2;
  const outerWidth  = innerWidth  + (p.woodPanelThickness + p.cornerReinforcement) * 2;
  const outerHeight = innerHeight + p.woodPanelThickness * 2;

  // Volume
  const innerVolCuIn   = innerLength * innerWidth * innerHeight;
  const shippingCubeFt = (outerLength * outerWidth * outerHeight) / 1728;
  const innerVolCuFt   = innerVolCuIn / 1728;

  // Fill %: total piece footprint × stack height vs inner volume
  const contentVol = pcs.reduce((sum, pc) => {
    const t = SLAB_THICK[pc.thickness || '3CM'] || 0.98;
    return sum + Number(pc.length || 0) * Number(pc.width || 0) * t;
  }, 0);
  const volumeFillPct = innerVolCuIn > 0
    ? Math.round(Math.min(100, (contentVol / innerVolCuIn) * 100))
    : 0;

  const r1 = v => Math.round(v * 10) / 10;

  return {
    internal_length:    r1(innerLength),
    internal_width:     r1(innerWidth),
    internal_height:    r1(innerHeight),
    external_length:    r1(outerLength),
    external_width:     r1(outerWidth),
    external_height:    r1(outerHeight),
    stack_height:       r1(stackHeight),
    shipping_cube_cuft: Math.round(shippingCubeFt * 100) / 100,
    inner_volume_cuft:  Math.round(innerVolCuFt  * 100) / 100,
    volume_fill_pct:    volumeFillPct,
    orientation:        p.orientation,
    piece_count:        pcs.length,
  };
};
