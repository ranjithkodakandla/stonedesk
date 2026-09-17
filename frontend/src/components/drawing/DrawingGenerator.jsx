import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { templateForPiece, paramsFromPiece, computePreview } from '../../utils/drawingTemplates';
import DrawingEditor from './DrawingEditor';
import DrawingPreview from './DrawingPreview';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Drawing Generator is a REVIEW GALLERY first, an editor second:
//  - "lifecycle" (inside a project): every part already entered in Source
//    Data shows up here automatically as a card. The user reviews each
//    one, adjusts it if needed, and generates its PDF — they never
//    re-enter dimensions that already exist. "Continue" moves on to
//    Planning once they're done.
//  - "standalone" (from the Dashboard, no project): there's no Source Data
//    to pull from, so the user adds parts here directly, but the same
//    review-gallery pattern applies: add a part, it joins the list, review
//    /edit/download any of them before leaving the page.
const DrawingGenerator = ({ mode = 'standalone', projectId = null, pieces = [], onAdded = () => {}, onContinue = null }) => {
  const [reviewing, setReviewing] = useState(null); // null = gallery, 'new' = blank editor, else an id
  const [drafts, setDrafts] = useState([]); // standalone-only local review list
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  // Combines every generated part into ONE multi-page PDF — one work-ticket
  // style page per part — matching how customers actually receive a fab
  // drawing set today (one AutoCAD-exported PDF covering the whole job),
  // rather than a separate download per piece.
  const downloadAllDrawings = async () => {
    if (!projectId) return;
    setIsDownloadingAll(true);
    setDownloadError(null);
    try {
      const res = await axios.get(`${API_BASE}/projects/${projectId}/drawings/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Drawings.pdf';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const blob = err.response?.data;
      let detail = 'Failed to generate the combined PDF.';
      if (blob instanceof Blob) {
        try { detail = JSON.parse(await blob.text()).detail || detail; } catch { /* keep default */ }
      }
      setDownloadError(detail);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  // Only "top" pieces become cards — a piece's bundled backsplash/side
  // splash accessories are reviewed as part of the top's card, not as
  // separate entries (see the assembly model in drawing_templates.py).
  const drawablePieces = useMemo(
    () => (pieces || []).filter((p) => (!p.assembly_role || p.assembly_role === 'top') && templateForPiece(p)),
    [pieces]
  );

  const items = mode === 'lifecycle' ? drawablePieces : drafts;

  const buildInitialFromPiece = (piece) => {
    const matched = templateForPiece(piece);
    if (!matched) return null;
    const drawingKey = piece.drawing || piece.part;
    const siblings = (pieces || []).filter((p) => (p.drawing || p.part) === drawingKey && p.drawing_template_id === piece.drawing_template_id);
    const pieceIds = {};
    siblings.forEach((p) => { if (p.assembly_role) pieceIds[p.assembly_role] = p.id; });
    if (!pieceIds.top) pieceIds.top = piece.id;
    return {
      templateId: matched.id,
      params: paramsFromPiece(matched, piece),
      part: piece.part || '',
      building: piece.building || '',
      floor: piece.floor || '',
      flat: piece.flat || '',
      qty: piece.qty || 1,
      material: piece.material || 'Granite',
      stoneColor: piece.stone_color || '',
      thickness: piece.thickness || '2CM',
      pieceIds,
    };
  };

  const buildInitialFromDraft = (draft) => draft && {
    templateId: draft.templateId,
    params: draft.params,
    part: draft.part,
    material: draft.material,
    stoneColor: draft.stoneColor,
    thickness: draft.thickness,
    sinkInfo: draft.sinkInfo,
    workTicket: draft.workTicket,
    drawnBy: draft.drawnBy,
    scale: draft.scale,
    projectName: draft.projectName,
    id: draft.id,
  };

  if (reviewing !== null) {
    const initial = reviewing === 'new'
      ? null
      : mode === 'lifecycle'
        ? buildInitialFromPiece(items.find((p) => String(p.id) === String(reviewing)))
        : buildInitialFromDraft(drafts.find((d) => d.id === reviewing));
    return (
      <DrawingEditor
        key={reviewing}
        mode={mode}
        projectId={projectId}
        initial={initial}
        onCancel={() => setReviewing(null)}
        onDone={(result) => {
          if (mode === 'lifecycle') {
            onAdded();
          } else if (result) {
            setDrafts((prev) => {
              const idx = prev.findIndex((d) => d.id === result.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = result;
                return copy;
              }
              return [...prev, result];
            });
          }
          setReviewing(null);
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f172a]">
            {mode === 'lifecycle' ? 'Parts from Source Data' : 'Drawings'}
          </h3>
          <p className="text-sm text-[#64748b]">
            {mode === 'lifecycle'
              ? 'Every part entered so far — review, adjust, and generate a drawing for each.'
              : 'Add a part, review it, and download its drawing. No project needed.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReviewing('new')}
          className="rounded-full bg-[#1d4ed8] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1e40af] shrink-0"
        >
          + New Drawing
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-6 py-12 text-center text-sm text-[#64748b]">
          {mode === 'lifecycle'
            ? 'No island, vanity, or kitchen-top parts yet — add them in Source Data, or click "New Drawing" to create one here.'
            : 'Nothing added yet. Click "New Drawing" to create your first countertop.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <PartCard
              key={item.id}
              mode={mode}
              item={item}
              onReview={() => setReviewing(item.id)}
            />
          ))}
        </div>
      )}

      {downloadError && (
        <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
          {downloadError}
        </div>
      )}

      {mode === 'lifecycle' && items.length > 0 && (
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={downloadAllDrawings}
            disabled={isDownloadingAll}
            className={`rounded-full border px-6 py-3 text-sm font-semibold shadow-sm ${
              isDownloadingAll
                ? 'border-[#cbd5e1] text-[#94a3b8] cursor-not-allowed'
                : 'border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]'
            }`}
          >
            {isDownloadingAll ? 'Generating…' : `↓ Download All Drawings (${items.length} part${items.length === 1 ? '' : 's'})`}
          </button>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full bg-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1e40af]"
            >
              Continue to Planning →
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const PartCard = ({ mode, item, onReview }) => {
  const geometry = useMemo(() => {
    if (mode === 'lifecycle') {
      const t = templateForPiece(item);
      return t ? computePreview(t.id, paramsFromPiece(t, item)).geometry : null;
    }
    return computePreview(item.templateId, item.params).geometry;
  }, [mode, item]);

  const title = mode === 'lifecycle' ? item.part : item.part;
  const subtitle = mode === 'lifecycle'
    ? [item.category, item.building && `Bldg ${item.building}`, item.floor && `Fl ${item.floor}`, item.flat && `Flat ${item.flat}`].filter(Boolean).join(' · ')
    : item.projectName || 'Standalone drawing';

  return (
    <button
      type="button"
      onClick={onReview}
      className="text-left bg-white rounded-2xl border border-[#e2e8f0] hover:border-[#93c5fd] hover:shadow-md transition-all p-4 flex flex-col gap-3"
    >
      <div className="bg-[#f8fafc] rounded-xl overflow-hidden">
        {geometry ? <DrawingPreview geometry={geometry} /> : <div className="h-24" />}
      </div>
      <div>
        <div className="font-semibold text-[#0f172a] text-sm truncate">{title || 'Untitled'}</div>
        <div className="text-xs text-[#64748b] truncate">{subtitle}</div>
      </div>
      <div className="text-xs font-semibold text-[#1d4ed8]">Review →</div>
    </button>
  );
};

export default DrawingGenerator;
