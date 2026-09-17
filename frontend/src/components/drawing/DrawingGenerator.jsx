import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { DRAWING_TEMPLATES, getTemplate, defaultParams, computePreview, templateForPiece, paramsFromPiece } from '../../utils/drawingTemplates';
import DrawingPreview from './DrawingPreview';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Two modes:
//  - "lifecycle": rendered inside a project workspace. Building/floor/flat
//    context is known, and this step doubles as a VIEW onto the project's
//    existing pieces: pick one from `pieces` (already loaded by
//    ProjectWorkspace) to see/edit its dimensions instead of re-entering
//    them, and saving updates those pieces in place (via piece_ids) rather
//    than creating duplicates.
//  - "standalone": rendered from the Dashboard with no project. Only
//    PDF/SVG download is offered — no project setup required. Standalone
//    jobs still capture the metadata a real fab drawing needs (material,
//    sink info, work ticket #, drawn by, scale) so the PDF looks like the
//    documents fabricators actually work from.
const DrawingGenerator = ({ mode = 'standalone', projectId = null, pieces = [], onAdded = () => {} }) => {
  const [templateId, setTemplateId] = useState(DRAWING_TEMPLATES[0].id);
  const template = useMemo(() => getTemplate(templateId), [templateId]);
  const [params, setParams] = useState(() => defaultParams(template));
  const [part, setPart] = useState('Island A');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [flat, setFlat] = useState('');
  const [qty, setQty] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  // Job metadata — shown on the generated PDF's title block, matching real
  // fab drawings (material color/thickness, sink model, work ticket #, ...).
  const [material, setMaterial] = useState('Granite');
  const [stoneColor, setStoneColor] = useState('');
  const [thickness, setThickness] = useState('2CM');
  const [sinkInfo, setSinkInfo] = useState('');
  const [workTicket, setWorkTicket] = useState('');
  const [drawnBy, setDrawnBy] = useState('');
  const [scale, setScale] = useState('NTS');
  const [projectName, setProjectName] = useState('');

  // Which existing project pieces this drawing is currently bound to, by
  // assembly role — set when loading an existing piece, or after a
  // successful save. Saving again with these set updates in place.
  const [pieceIds, setPieceIds] = useState({});
  const [selectedPieceId, setSelectedPieceId] = useState('');

  const drawablePieces = useMemo(
    () => (pieces || []).filter((p) => templateForPiece(p)),
    [pieces]
  );

  const switchTemplate = (id) => {
    setTemplateId(id);
    setParams(defaultParams(getTemplate(id)));
    setPieceIds({});
    setSelectedPieceId('');
  };

  const setParam = (id, value) => setParams((prev) => ({ ...prev, [id]: value }));

  const { geometry, errors } = useMemo(() => computePreview(templateId, params), [templateId, params]);

  const loadPiece = (pieceId) => {
    setSelectedPieceId(pieceId);
    if (!pieceId) {
      setPieceIds({});
      return;
    }
    const piece = pieces.find((p) => String(p.id) === String(pieceId));
    if (!piece) return;
    const matched = templateForPiece(piece);
    if (!matched) return;
    setTemplateId(matched.id);
    setParams(paramsFromPiece(matched, piece));
    setPart(piece.part || '');
    setBuilding(piece.building || '');
    setFloor(piece.floor || '');
    setFlat(piece.flat || '');
    setQty(piece.qty || 1);
    setMaterial(piece.material || 'Granite');
    setStoneColor(piece.stone_color || '');
    setThickness(piece.thickness || '2CM');
    // Group sibling assembly pieces (same drawing/part grouping) by role so
    // "Save" updates all of them instead of creating duplicates.
    const drawingKey = piece.drawing || piece.part;
    const siblings = pieces.filter((p) => (p.drawing || p.part) === drawingKey && p.drawing_template_id === piece.drawing_template_id);
    const ids = {};
    siblings.forEach((p) => {
      if (p.assembly_role) ids[p.assembly_role] = p.id;
    });
    if (!ids.top) ids.top = piece.id;
    setPieceIds(ids);
  };

  const startNew = () => {
    setSelectedPieceId('');
    setPieceIds({});
    setPart('');
    setParams(defaultParams(template));
  };

  const downloadPdf = async () => {
    setSaveMessage(null);
    try {
      const res = await axios.post(`${API_BASE}/drawing-generator/pdf`, {
        template_id: templateId, params, part,
        material, stone_color: stoneColor, thickness, qty,
        sink_info: sinkInfo, project: projectName, work_ticket: workTicket,
        drawn_by: drawnBy, scale, date: new Date().toISOString().slice(0, 10),
      }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${part || template.name}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to generate PDF.' });
    }
  };

  const downloadSvg = () => {
    const svgEl = document.getElementById('drawing-preview-svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${part || template.name}.svg`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const saveToProject = async () => {
    if (!projectId) return;
    if (errors.length) {
      setSaveMessage({ type: 'error', text: errors[0] });
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await axios.post(`${API_BASE}/projects/${projectId}/pieces/from-drawing`, {
        template_id: templateId,
        params,
        part,
        qty,
        building,
        floor,
        flat,
        material,
        stone_color: stoneColor,
        thickness,
        piece_ids: pieceIds,
      });
      setPieceIds(res.data.piece_ids || {});
      setSaveMessage({ type: 'success', text: `${part || 'Countertop'} ${Object.keys(pieceIds).length ? 'updated' : 'added to project'} (${res.data.pieces.length} piece${res.data.pieces.length === 1 ? '' : 's'}).` });
      onAdded();
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to save.' });
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = Object.keys(pieceIds).length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 space-y-5">
        {mode === 'lifecycle' && drawablePieces.length > 0 && (
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-3">
            <label className="block text-xs font-semibold text-[#1d4ed8] mb-2 uppercase tracking-wide">
              View / Edit an Existing Piece
            </label>
            <div className="flex gap-2">
              <select
                value={selectedPieceId}
                onChange={(e) => loadPiece(e.target.value)}
                className="input-field flex-1"
              >
                <option value="">— New drawing —</option>
                {drawablePieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.part || `Piece #${p.id}`} ({p.category}, {p.length}"×{p.width}")
                  </option>
                ))}
              </select>
              {selectedPieceId && (
                <button type="button" onClick={startNew} className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-[#f8fafc]">
                  New
                </button>
              )}
            </div>
            <p className="text-xs text-[#1d4ed8]/70 mt-2">
              Already entered in Source Data — select it to view or adjust its drawing instead of re-entering dimensions.
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#64748b] mb-2 uppercase tracking-wide">Template</label>
          <div className="flex flex-wrap gap-2">
            {DRAWING_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTemplate(t.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium border transition-all ${
                  templateId === t.id
                    ? 'bg-[#1d4ed8] text-white border-[#1d4ed8]'
                    : 'bg-white text-[#334155] border-[#cbd5e1] hover:bg-[#f8fafc]'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Part Name</label>
          <input
            value={part}
            onChange={(e) => setPart(e.target.value)}
            className="input-field w-full"
            placeholder="e.g. Island A"
          />
        </div>

        {mode === 'lifecycle' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Building</label>
              <input value={building} onChange={(e) => setBuilding(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Floor</label>
              <input value={floor} onChange={(e) => setFloor(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Flat</label>
              <input value={flat} onChange={(e) => setFlat(e.target.value)} className="input-field w-full" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#64748b] mb-2 uppercase tracking-wide">Dimensions</label>
          <div className="grid grid-cols-2 gap-3">
            {template.parameters.filter((p) => p.type !== 'boolean').map((p) => (
              <div key={p.id}>
                <label className="block text-xs text-[#64748b] mb-1">
                  {p.label}{p.optional ? ' (optional)' : ''}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={params[p.id] ?? ''}
                    placeholder={p.optional ? 'auto-center' : ''}
                    onChange={(e) => setParam(p.id, e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-field w-full pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94a3b8]">{p.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {template.parameters.some((p) => p.type === 'boolean') && (
          <div>
            <label className="block text-xs font-semibold text-[#64748b] mb-2 uppercase tracking-wide">Bundled Pieces</label>
            <div className="flex flex-wrap gap-4">
              {template.parameters.filter((p) => p.type === 'boolean').map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-[#334155]">
                  <input
                    type="checkbox"
                    checked={params[p.id] ?? p.default}
                    onChange={(e) => setParam(p.id, e.target.checked)}
                    className="h-4 w-4 rounded border-[#cbd5e1]"
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-[#94a3b8] mt-1">Cut from the same job as the top — uncheck if not needed (e.g. against an existing wall).</p>
          </div>
        )}

        <details className="rounded-xl border border-[#e2e8f0] px-4 py-3">
          <summary className="text-xs font-semibold text-[#64748b] uppercase tracking-wide cursor-pointer">Job Details (for drawing title block)</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {mode === 'standalone' && (
              <div className="col-span-2">
                <label className="block text-xs text-[#64748b] mb-1">Project</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="input-field w-full" placeholder="Project name, city" />
              </div>
            )}
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Material</label>
              <input value={material} onChange={(e) => setMaterial(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Color</label>
              <input value={stoneColor} onChange={(e) => setStoneColor(e.target.value)} className="input-field w-full" placeholder="e.g. Black Pearl" />
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Thickness</label>
              <select value={thickness} onChange={(e) => setThickness(e.target.value)} className="input-field w-full">
                <option value="2CM">2CM</option>
                <option value="3CM">3CM</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Sink Info</label>
              <input value={sinkInfo} onChange={(e) => setSinkInfo(e.target.value)} className="input-field w-full" placeholder="Undermount, Model #..." />
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Work Ticket #</label>
              <input value={workTicket} onChange={(e) => setWorkTicket(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Drawn By</label>
              <input value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs text-[#64748b] mb-1">Scale</label>
              <input value={scale} onChange={(e) => setScale(e.target.value)} className="input-field w-full" />
            </div>
          </div>
        </details>

        {mode === 'lifecycle' && (
          <div>
            <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Qty</label>
            <input
              type="number" min="1" value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="input-field w-24"
            />
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c] space-y-1">
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {saveMessage && (
          <div className={`rounded-xl px-4 py-3 text-sm ${
            saveMessage.type === 'success'
              ? 'bg-[#ecfdf5] text-[#047857] border border-[#6ee7b7]'
              : 'bg-[#fef2f2] text-[#b91c1c] border border-[#fecaca]'
          }`}>
            {saveMessage.text}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={downloadSvg} className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">
            ↓ Download SVG
          </button>
          <button type="button" onClick={downloadPdf} className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">
            ↓ Download PDF
          </button>
          {mode === 'lifecycle' && (
            <button
              type="button"
              onClick={saveToProject}
              disabled={isSaving || errors.length > 0}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm ${
                isSaving || errors.length > 0 ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#1d4ed8] hover:bg-[#1e40af]'
              }`}
            >
              {isSaving ? 'Saving…' : isEditing ? 'Update Piece(s)' : 'Add to Project'}
            </button>
          )}
        </div>
      </div>

      {/* Live preview */}
      <div className="bg-[#f8fafc] rounded-2xl border border-[#e2e8f0] p-6 flex items-start justify-center">
        <div id="drawing-preview-svg-wrap" className="w-full">
          <DrawingPreviewWithId geometry={geometry} title={part} />
        </div>
      </div>
    </div>
  );
};

// Wraps DrawingPreview to tag the underlying <svg> with an id, so the
// "Download SVG" button can serialize exactly what's on screen.
const DrawingPreviewWithId = ({ geometry, title }) => {
  const ref = React.useRef(null);
  useEffect(() => {
    if (ref.current) {
      const svg = ref.current.querySelector('svg');
      if (svg) svg.id = 'drawing-preview-svg';
    }
  });
  return (
    <div ref={ref}>
      <DrawingPreview geometry={geometry} title={title} />
    </div>
  );
};

export default DrawingGenerator;
