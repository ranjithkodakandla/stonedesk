import { describe, it, expect } from 'vitest';
import {
  estimateLeaningFamilyBundleDimensions,
  CRATE_INTERNAL_WIDTH_MIN_IN,
  CRATE_INTERNAL_WIDTH_MAX_IN,
} from './crateEstimator';

function main(length, width, thickness = '3CM') {
  return { length, width, thickness, part: 'Top' };
}

describe('estimateLeaningFamilyBundleDimensions width band', () => {
  it('floors internal width to 10" when the raw row-thickness stack is very thin', () => {
    const dims = estimateLeaningFamilyBundleDimensions([main(40, 20, '2CM')]);
    expect(dims.internal_width).toBe(CRATE_INTERNAL_WIDTH_MIN_IN);
  });

  it('grows the row-length budget to merge more pieces per row, pulling width down even when it cannot reach the band', () => {
    // 20 pieces of 29" plus one 30" piece. At the base row-length budget
    // (30"), two 29s don't fit a row together (29+1+29=59 > 30), so every
    // 29" piece gets its own row -> 21 rows. Growing the budget to the sum
    // of the two distinct lengths (30+1+29=60) lets pairs of 29s share a
    // row (10 pairs + the 30 = 11 rows), a real improvement even though
    // this crate's own foam-gap-per-row model still leaves width above 26"
    // here (reported honestly, with a warning, rather than clamped).
    const pieces = [main(30, 25, '4CM'), ...Array.from({ length: 20 }, () => main(29, 25, '4CM'))];
    const dims = estimateLeaningFamilyBundleDimensions(pieces);

    const noGrowthWidth = 21 * parseFloat((1.57).toFixed(2)) + 20 * 1 + 4; // 21 singleton rows, no merging
    expect(dims.internal_width).toBeLessThan(noGrowthWidth);
    expect(dims.warnings.some((w) => w.includes('26'))).toBe(true);
  });

  it('reports the true width with a warning instead of silently clamping when pieces cannot merge at all', () => {
    // 20 identical 90"-long pieces never share a row — there's no distinct
    // shorter length to combine them into, so growing the budget can't
    // reduce row count.
    const pieces = Array.from({ length: 20 }, () => main(90, 30, '4CM'));
    const dims = estimateLeaningFamilyBundleDimensions(pieces);
    expect(dims.internal_width).toBeGreaterThan(CRATE_INTERNAL_WIDTH_MAX_IN);
    expect(dims.warnings.some((w) => w.includes('26'))).toBe(true);
  });
});
