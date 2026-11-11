import { describe, it, expect } from 'vitest';
import { deriveCornersFromEdgeChange, effectiveCornerRadius, EDGE_TO_CORNERS } from './PartDrawer';

const NONE = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
const NOT_EXPLICIT = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };

describe('deriveCornersFromEdgeChange (edge polish -> corner radius auto-link)', () => {
  it('selecting an edge auto-selects both of its corners at default', () => {
    const result = deriveCornersFromEdgeChange('top', 'none', 'polished', NONE, NOT_EXPLICIT);
    expect(result.top_left).toBe(true);
    expect(result.top_right).toBe(true);
    expect(result.bottom_left).toBe(false);
    expect(result.bottom_right).toBe(false);
  });

  it.each(Object.keys(EDGE_TO_CORNERS))('selecting the %s edge only touches its own two corners', (side) => {
    const result = deriveCornersFromEdgeChange(side, 'none', 'polished', NONE, NOT_EXPLICIT);
    const touched = Object.entries(result).filter(([, v]) => v).map(([k]) => k).sort();
    expect(touched).toEqual([...EDGE_TO_CORNERS[side]].sort());
  });

  it('removing edge polish (back to none) never changes corner selection', () => {
    const selected = { top_left: true, top_right: true, bottom_left: false, bottom_right: false };
    const result = deriveCornersFromEdgeChange('top', 'polished', 'none', selected, NOT_EXPLICIT);
    expect(result).toEqual(selected);
  });

  it('switching between two non-none edge finishes does not re-trigger auto-selection', () => {
    const selected = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
    // Already polished -> changing to flat_chamfer is not "turning on" from off.
    const result = deriveCornersFromEdgeChange('top', 'polished', 'flat_chamfer', selected, NOT_EXPLICIT);
    expect(result).toEqual(selected);
  });

  it('never overrides a corner the user already explicitly configured', () => {
    const selected = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
    const explicit = { top_left: true, top_right: false, bottom_left: false, bottom_right: false };
    const result = deriveCornersFromEdgeChange('top', 'none', 'polished', selected, explicit);
    expect(result.top_left).toBe(false); // explicit corner left alone
    expect(result.top_right).toBe(true);  // non-explicit corner still auto-selected
  });

  it('changing one edge does not affect a corner only reachable via another edge', () => {
    const selected = { top_left: false, top_right: false, bottom_left: true, bottom_right: false };
    const result = deriveCornersFromEdgeChange('top', 'none', 'polished', selected, NOT_EXPLICIT);
    expect(result.bottom_left).toBe(true); // untouched, preserved exactly
  });
});

describe('effectiveCornerRadius (per-corner independent values, no shared global override)', () => {
  it('uses the explicit per-corner override when present', () => {
    expect(effectiveCornerRadius('top_left', { top_left: 0.25 }, '', 0.125)).toBe(0.25);
  });

  it('falls back to the legacy shared radius_value when no per-corner override exists', () => {
    expect(effectiveCornerRadius('top_left', {}, '0.5', 0.125)).toBe(0.5);
  });

  it('falls back to the configured app default when neither is set', () => {
    expect(effectiveCornerRadius('top_left', {}, '', 0.125)).toBe(0.125);
  });

  it('one corner override does not affect another corner\'s effective radius', () => {
    const overrides = { top_left: 0.5 };
    expect(effectiveCornerRadius('top_left', overrides, '', 0.125)).toBe(0.5);
    expect(effectiveCornerRadius('top_right', overrides, '', 0.125)).toBe(0.125);
  });
});
