import { describe, it, expect } from 'vitest';
import { computeCrateDimensions, DEFAULT_DIM_CONFIG } from './CrateFilterPlanner';

const rangeTop = (id, length, width = 25.5, thickness = '3CM') => ({
  id, part: 'Kitchen - Range Tops', category: 'range', length, width, thickness,
});

describe('computeCrateDimensions (the actual "Filter parts and build crates" screen)', () => {
  it('reproduces the reference 18-piece drawing: crate sized by rows, not raw piece count', () => {
    const parts = [
      ...Array.from({ length: 6 }, (_, i) => rangeTop(`s${i}`, 79)),
      ...Array.from({ length: 6 }, (_, i) => rangeTop(`l${i}`, 49)),
      ...Array.from({ length: 6 }, (_, i) => rangeTop(`sh${i}`, 19)),
    ];
    const dims = computeCrateDimensions(parts, DEFAULT_DIM_CONFIG);
    // Width must reflect 12 thickness-slots (rows), not 18 raw pieces —
    // this is the exact bug: the old code used Math.max() of thicknesses,
    // as if only one piece's worth of material existed regardless of count.
    const perRowThickness = 1.18; // 3CM
    const expectedWidth = 12 * perRowThickness + DEFAULT_DIM_CONFIG.kv.widthMargin * 2;
    expect(dims.internal_width).toBeCloseTo(expectedWidth, 1);
    expect(dims.internal_width).toBeLessThan(18 * perRowThickness + DEFAULT_DIM_CONFIG.kv.widthMargin * 2);
  });

  it('consolidates three identical leftover pieces past the original cap (67 + 3x25)', () => {
    const parts = [rangeTop('big', 67), rangeTop('a', 25), rangeTop('b', 25), rangeTop('c', 25)];
    const dims = computeCrateDimensions(parts, DEFAULT_DIM_CONFIG);
    // 3x25 (77" raw) now determines length, not the original 67" piece.
    const expectedLength = 77 + DEFAULT_DIM_CONFIG.kv.lengthMargin * 2;
    expect(dims.internal_length).toBeCloseTo(expectedLength, 1);
  });

  it('accounts for every piece selected, not just the extremes (multiple identical pieces stack real thickness)', () => {
    // Before this fix, selecting 1 part vs 20 identical parts produced the
    // SAME crate height (Math.max of thickness) — a textbook "generic
    // bounding box, oblivious to piece count" bug. Now more same-length
    // pieces (more rows, since none pair up within this length) widen the
    // crate, which a static bounding box could never do.
    // Piece count chosen so the resulting width clears the 10" structural
    // floor (otherwise both cases would floor to the same number and the
    // comparison would tell us nothing about per-piece accounting).
    const one = computeCrateDimensions([rangeTop('p0', 40)], DEFAULT_DIM_CONFIG);
    const many = computeCrateDimensions(
      Array.from({ length: 16 }, (_, i) => rangeTop(`p${i}`, 40)),
      DEFAULT_DIM_CONFIG,
    );
    expect(many.internal_width).toBeGreaterThan(one.internal_width);
  });

  it('never merges six identical pieces into one giant row just to cut row count', () => {
    const parts = Array.from({ length: 6 }, (_, i) => rangeTop(`p${i}`, 79));
    const dims = computeCrateDimensions(parts, DEFAULT_DIM_CONFIG);
    const expectedLength = 79 + DEFAULT_DIM_CONFIG.kv.lengthMargin * 2;
    expect(dims.internal_length).toBeCloseTo(expectedLength, 1); // not 6*79+gaps
  });

  it('combines many identical pieces sensibly (no standout piece) instead of one row each', () => {
    // No distinct longer piece anywhere in the selection — deriving the
    // row cap from a single 15" piece would force one piece per row for
    // all 5, which isn't "smart stacking." The 120" no-standout floor
    // should let them combine into far fewer rows.
    // 100 identical pieces so the real (consolidated) row count still clears
    // the 10" structural floor — otherwise a too-small piece count would
    // floor to the same 10" regardless of how well rows combined, telling
    // us nothing about the consolidation behavior under test.
    const parts = Array.from({ length: 100 }, (_, i) => rangeTop(`p${i}`, 15));
    const dims = computeCrateDimensions(parts, DEFAULT_DIM_CONFIG);
    const perRowThickness = 1.18;
    const oneRowPerPieceWidth = 100 * perRowThickness + DEFAULT_DIM_CONFIG.kv.widthMargin * 2;
    expect(dims.internal_width).toBeGreaterThan(10);
    expect(dims.internal_width).toBeLessThan(oneRowPerPieceWidth);
  });

  it('floors internal width to 10" for a single thin piece', () => {
    const dims = computeCrateDimensions([rangeTop('p0', 20, 20, '2CM')], DEFAULT_DIM_CONFIG);
    expect(dims.internal_width).toBe(10);
  });

  it('grows the row-length budget to merge more pieces per row, pulling width down toward the 26" band', () => {
    // 20 pieces of 29" plus one 30" piece. At the base row-length budget
    // (30+1=31"), two 29s don't fit a row together (29+1+29=59 > 31), so
    // every 29" piece would get its own row. Growing the budget to the sum
    // of the two distinct lengths (30+1+29+1=61") lets pairs of 29s share a
    // row, roughly halving the row count.
    const withoutGrowthRows = 21; // 1 main + 20 singleton 29" rows if nothing merged
    const parts = [rangeTop('main', 30, 25, '4CM'), ...Array.from({ length: 20 }, (_, i) => rangeTop(`s${i}`, 29, 25, '4CM'))];
    const dims = computeCrateDimensions(parts, DEFAULT_DIM_CONFIG);
    const noGrowthWidth = withoutGrowthRows * 1.57 + DEFAULT_DIM_CONFIG.kv.widthMargin * 2;
    expect(dims.internal_width).toBeLessThan(noGrowthWidth);
  });
});
