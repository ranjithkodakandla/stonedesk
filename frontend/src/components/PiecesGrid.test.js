import { describe, it, expect } from 'vitest';
import { newRow, dupeRow, reindexAutoPartNos, isSplashPart } from './PiecesGrid';

describe('dupeRow (manual + matrix-generated part duplication)', () => {
  it('gives the duplicate a new unique _id, independent of the source row', () => {
    const source = newRow();
    const copy = dupeRow(source);
    expect(copy._id).not.toBe(source._id);
  });

  it('increments the part number', () => {
    const source = { ...newRow(), part_no: 'DRW-01' };
    const copy = dupeRow(source);
    expect(copy.part_no).toBe('DRW-02');
  });

  it('deep-copies edge_map so editing the copy does not mutate the original', () => {
    const source = { ...newRow(), edge_map: { top: 'polished', bottom: 'none', left: 'none', right: 'none' } };
    const copy = dupeRow(source);
    copy.edge_map.top = 'none';
    expect(source.edge_map.top).toBe('polished');
  });

  it('deep-copies radius_corners so overriding one corner on the copy leaves the source untouched', () => {
    const source = { ...newRow(), radius_corners: { top_left: true, top_right: false, bottom_left: false, bottom_right: false } };
    const copy = dupeRow(source);
    copy.radius_corners.top_right = true;
    expect(source.radius_corners.top_right).toBe(false);
    expect(copy.radius_corners.top_left).toBe(true); // unrelated corner unaffected
  });

  it('deep-copies tap_hole_positions arrays and their position objects', () => {
    const source = { ...newRow(), tap_hole_positions: [{ x: 4, y: 2 }] };
    const copy = dupeRow(source);
    copy.tap_hole_positions[0].x = 99;
    expect(source.tap_hole_positions[0].x).toBe(4);
  });

  it('deep-copies sink_numbers, groove_positions, and dest_qty_overrides independently', () => {
    const source = {
      ...newRow(),
      sink_numbers: ['SK-1'],
      groove_positions: [{ x: 1, y: 1 }],
      dest_qty_overrides: { 'B1-1-101': 2 },
    };
    const copy = dupeRow(source);
    copy.sink_numbers.push('SK-2');
    copy.groove_positions[0].x = 5;
    copy.dest_qty_overrides['B1-1-101'] = 9;

    expect(source.sink_numbers).toEqual(['SK-1']);
    expect(source.groove_positions[0].x).toBe(1);
    expect(source.dest_qty_overrides['B1-1-101']).toBe(2);
  });

  it('works the same for a matrix-generated row (no special-casing by origin)', () => {
    // A row produced by matrix entry looks identical in shape to a manually
    // entered one by the time it reaches the grid — dupeRow has no notion
    // of where a row came from, so it must duplicate both the same way.
    const matrixRow = {
      ...newRow(),
      part_no: 'MTX-03',
      part: 'Kitchen - Perimeter Tops',
      edge_map: { top: 'polished', bottom: 'polished', left: 'none', right: 'none' },
      radius_corners: { top_left: true, top_right: true, bottom_left: false, bottom_right: false },
    };
    const copy = dupeRow(matrixRow);
    expect(copy._id).not.toBe(matrixRow._id);
    expect(copy.part_no).toBe('MTX-04');
    copy.edge_map.left = 'polished';
    expect(matrixRow.edge_map.left).toBe('none');
  });
});

describe('reindexAutoPartNos (predictable part numbering, no unintended duplicates)', () => {
  it('assigns sequential numeric suffixes to non-splash auto rows', () => {
    const rows = [newRow(), newRow(), newRow()];
    const result = reindexAutoPartNos(rows, 'DRW');
    expect(result.map((r) => r.part_no)).toEqual(['DRW-01', 'DRW-02', 'DRW-03']);
  });

  it('assigns letter suffixes to splash parts, independent of numeric rows', () => {
    const top = { ...newRow(), part: 'Kitchen - Perimeter Tops' };
    const splash = { ...newRow(), part: 'Kitchen - Back Splash' };
    const result = reindexAutoPartNos([top, splash], 'DRW');
    expect(result[0].part_no).toBe('DRW-01');
    expect(result[1].part_no).toBe('DRW-A');
    expect(isSplashPart(splash.part)).toBe(true);
  });

  it('does not renumber an existing auto part number unless forceReassign is set', () => {
    const existing = { ...newRow(), part_no: 'DRW-01' };
    const fresh = newRow();
    const result = reindexAutoPartNos([existing, fresh], 'DRW');
    expect(result[0].part_no).toBe('DRW-01'); // untouched
    expect(result[1].part_no).toBe('DRW-02'); // continues after the max seen
  });

  it('never assigns the same part number twice across repeated incremental edits', () => {
    let rows = [newRow()];
    rows = reindexAutoPartNos(rows, 'DRW');
    rows = [...rows, newRow()];
    rows = reindexAutoPartNos(rows, 'DRW');
    rows = [...rows, newRow()];
    rows = reindexAutoPartNos(rows, 'DRW');

    const partNos = rows.map((r) => r.part_no);
    expect(new Set(partNos).size).toBe(partNos.length);
    expect(partNos).toEqual(['DRW-01', 'DRW-02', 'DRW-03']);
  });

  it('leaves manually-edited part numbers alone (_partNoAuto=false)', () => {
    const manual = { ...newRow(), part_no: 'CUSTOM-99', _partNoAuto: false };
    const auto = newRow();
    const result = reindexAutoPartNos([manual, auto], 'DRW');
    expect(result[0].part_no).toBe('CUSTOM-99');
    expect(result[1].part_no).toBe('DRW-01');
  });
});
