// Pure 3D placement of packing-schedule rows, so it can be unit-tested
// without a DOM/WebGL context. Axes (inches): X = crate length (piece
// length runs this way), Y = crate height (standing height, up), Z = crate
// width (the thickness-stacking axis — each row is one Z-slot). This is the
// same physical model as buildCrossSectionLayout (CratePackingSchedule.jsx),
// just in 3D instead of flattened to a 2D cross-section.
export const PIECE_GAP_IN = 1.0; // matches backend group_main_pieces_into_rows' _ROW_PIECE_GAP_IN
export const ROW_GAP_IN = 0.75; // matches backend horizontal_crate_dimensions' _ROW_SEPARATOR_IN

export const buildSlab3DLayout = (rows) => {
  let zCursor = 0;
  const slabs = [];
  for (const row of rows || []) {
    const thicknessIn = row.slot_thickness_in || 0;
    const heightIn = row.standing_height_in || 0;
    let xCursor = 0;
    for (const piece of row.dimensions || []) {
      const lengthIn = Number(piece.length) || 0;
      slabs.push({
        row: row.row,
        pieceId: piece.piece_id,
        piece,
        xIn: xCursor,
        zIn: zCursor,
        lengthIn,
        thicknessIn,
        heightIn,
      });
      xCursor += lengthIn + PIECE_GAP_IN;
    }
    zCursor += thicknessIn + ROW_GAP_IN;
  }
  return { slabs, totalDepthIn: Math.max(0, zCursor - ROW_GAP_IN) };
};
