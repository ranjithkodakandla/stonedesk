import { describe, it, expect } from 'vitest';
import { deriveCornersFromEdgeMap, effectiveCornerRadius, EDGE_TO_CORNERS, CORNER_TO_EDGES } from './PartDrawer';

const NONE = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
const ALL_NONE_EDGES = { top: 'none', bottom: 'none', left: 'none', right: 'none' };
const NOT_EXPLICIT = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };

describe('deriveCornersFromEdgeMap (edge polish -> corner radius auto-link)', () => {
  it('selecting only one of a corner\'s two edges does not round it', () => {
    const edgeMap = { ...ALL_NONE_EDGES, top: 'polished' };
    const result = deriveCornersFromEdgeMap(edgeMap, NONE, NOT_EXPLICIT);
    expect(result.top_left).toBe(false);
    expect(result.top_right).toBe(false);
    expect(result.bottom_left).toBe(false);
    expect(result.bottom_right).toBe(false);
  });

  it('a corner rounds once both of its edges are selected (intersection, not union)', () => {
    // Left, right, bottom polished, top not — matches the reported case:
    // only bottom_left and bottom_right should round (each sits at the
    // intersection of two selected edges); top_left/top_right each touch
    // the unselected top edge, so neither should round.
    const edgeMap = { top: 'none', bottom: 'polished', left: 'polished', right: 'polished' };
    const result = deriveCornersFromEdgeMap(edgeMap, NONE, NOT_EXPLICIT);
    expect(result.top_left).toBe(false);
    expect(result.top_right).toBe(false);
    expect(result.bottom_left).toBe(true);
    expect(result.bottom_right).toBe(true);
  });

  it.each(Object.keys(CORNER_TO_EDGES))('%s only rounds when both its own two edges are selected', (corner) => {
    const [edgeA, edgeB] = CORNER_TO_EDGES[corner];
    const bothSelected = { ...ALL_NONE_EDGES, [edgeA]: 'polished', [edgeB]: 'polished' };
    const result = deriveCornersFromEdgeMap(bothSelected, NONE, NOT_EXPLICIT);
    expect(result[corner]).toBe(true);
    Object.keys(NONE).filter((c) => c !== corner).forEach((other) => {
      expect(result[other]).toBe(false);
    });
  });

  it('turning an edge back off un-rounds a corner no longer at an intersection', () => {
    const selected = { top_left: false, top_right: false, bottom_left: true, bottom_right: true };
    const edgeMapAfterTurningLeftOff = { top: 'none', bottom: 'polished', left: 'none', right: 'polished' };
    const result = deriveCornersFromEdgeMap(edgeMapAfterTurningLeftOff, selected, NOT_EXPLICIT);
    expect(result.bottom_left).toBe(false); // left no longer selected, so its intersection with bottom is gone
    expect(result.bottom_right).toBe(true); // bottom + right still both selected
  });

  it('never overrides a corner the user already explicitly configured', () => {
    const selected = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
    const explicit = { top_left: true, top_right: false, bottom_left: false, bottom_right: false };
    const edgeMap = { ...ALL_NONE_EDGES, top: 'polished', left: 'polished' };
    const result = deriveCornersFromEdgeMap(edgeMap, selected, explicit);
    expect(result.top_left).toBe(false); // explicit corner left alone, even though top+left are now both selected
    expect(result.top_right).toBe(false); // top alone isn't enough (needs right too)
  });

  it.each(Object.keys(EDGE_TO_CORNERS))('EDGE_TO_CORNERS and CORNER_TO_EDGES agree for %s', (side) => {
    EDGE_TO_CORNERS[side].forEach((corner) => {
      expect(CORNER_TO_EDGES[corner]).toContain(side);
    });
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
