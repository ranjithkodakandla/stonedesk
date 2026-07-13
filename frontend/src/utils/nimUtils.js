// Shared helpers for merging NIM (AI vision) parsed rows into the coordinate
// parser's row set. nim_parser.py doesn't know the drawing #/unit name (that's
// frontend-only page context), so it leaves them blank -- tagNimRows borrows
// them from an existing coordinate-parser row already on the same page.

export function tagNimRows(nimRows, pageNum, existingRows) {
  const existingForPage = existingRows.find(r => r._page_num === pageNum);
  return nimRows.map((r, i) => ({
    ...r,
    drawing: r.drawing || existingForPage?.drawing || '',
    unit:    r.unit    || existingForPage?.unit    || '',
    _page_num: pageNum,
    _id: Date.now() + i,
    _source: 'nim_vision',
  }));
}

/** Replace all rows belonging to `pageNum` with the freshly tagged NIM rows. */
export function mergeNimRowsForPage(existingRows, nimRows, pageNum) {
  const tagged = tagNimRows(nimRows, pageNum, existingRows);
  const without = existingRows.filter(r => r._page_num !== pageNum);
  return [...without, ...tagged];
}
