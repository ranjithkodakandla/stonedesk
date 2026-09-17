import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { DRAWING_TEMPLATES, getTemplate, defaultParams, computePreview } from '../../utils/drawingTemplates';
import DrawingPreview from './DrawingPreview';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Review/edit surface for ONE drawing. Rendered by DrawingGenerator either
// for a brand-new part or (the common case) for a part already entered in
// Source Data / a previously-saved standalone draft — `initial` seeds every
// field so the user is looking at and adjusting real data, never re-typing
// numbers that already exist.
//
//  - lifecycle: "Save" calls the from-drawing API. If `initial.pieceIds` is
//    set (this drawing already has pieces), it updates them in place;
//    otherwise it creates them.
//  - standalone: there's no project to save to — "Save Part" just hands the
//    current form state back to the parent, which keeps it in a local
//    review list for this session (Download PDF/SVG work immediately,
//    without saving first).
const DrawingEditor = ({ mode, projectId, initial, onDone, onCancel }) => {
  const [templateId, setTemplateId] = useState(initial?.templateId || DRAWING_TEMPLATES[0].id);
  const template = useMemo(() => getTemplate(templateId), [templateId]);
  const [params, setParams] = useState(() => initial?.params || defaultParams(template));
  const [part, setPart] = useState(initial?.part ?? 'Island A');
  const [building, setBuilding] = useState(initial?.building || '');
  const [floor, setFloor] = useState(initial?.floor || '');
  const [flat, setFlat] = useState(initial?.flat || '');
  const [qty, setQty] = useState(initial?.qty || 1);
  // Mirrors Source Data's "Single / Comma-List" vs "Matrix Grid" entry: one
  // destination, or the same drawing repeated across many building/floor/
  // flat combos — the PDF renders whichever shape was actually entered.
  const [destMode, setDestMode] = useState(initial?.destinations?.length > 1 ? 'matrix' : 'single');
  const [destMatrixText, setDestMatrixText] = useState(
    (initial?.destinations || []).map((d) => `${d.building}, ${d.floor}, ${d.flat}`).join('\n')
  );
  const parsedDestinations = useMemo(() => destMatrixText
    .split('\n')
    .map((line) => line.split(',').map((s) => s.trim()))
    .filter((parts) => parts.length >= 3 && parts.some(Boolean))
    .map(([b, f, fl]) => ({ building: b || '', floor: f || '', flat: fl || '' })), [destMatrixText]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  const [material, setMaterial] = useState(initial?.material || 'Granite');
  const [stoneColor, setStoneColor] = useState(initial?.stoneColor || '');
  const [thickness, setThickness] = useState(initial?.thickness || '2CM');
  const [sinkInfo, setSinkInfo] = useState(initial?.sinkInfo || '');
  const [drawnBy, setDrawnBy] = useState(initial?.drawnBy || '');
  const [scale, setScale] = useState(initial?.scale || 'NTS');
  const [projectName, setProjectName] = useState(initial?.projectName || '');

  const [pieceIds, setPieceIds] = useState(initial?.pieceIds || {});

  const switchTemplate = (id) => {
    setTemplateId(id);
    setParams(defaultParams(getTemplate(id)));
  };

  const setParam = (id, value) => setParams((prev) => ({ ...prev, [id]: value }));

  const { geometry, errors } = useMemo(() => computePreview(templateId, params), [templateId, params]);

  const pdfPayload = () => ({
    template_id: templateId, params, part,
    material, stone_color: stoneColor, thickness,
    qty: destMode === 'matrix' ? (parsedDestinations.length || 1) : qty,
    ...(destMode === 'matrix' ? { destinations: parsedDestinations } : { building, floor, flat }),
    sink_info: sinkInfo, project: projectName,
    drawn_by: drawnBy, scale, date: new Date().toISOString().slice(0, 10),
  });

  const downloadPdf = async () => {
    setSaveMessage(null);
    try {
      const res = await axios.post(`${API_BASE}/drawing-generator/pdf`, pdfPayload(), { responseType: 'blob' });
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

  const save = async () => {
    if (errors.length) {
      setSaveMessage({ type: 'error', text: errors[0] });
      return;
    }
    if (mode === 'standalone') {
      onDone({
        id: initial?.id || `draft-${Date.now()}`,
        templateId, params, part, material, stoneColor, thickness,
        sinkInfo, drawnBy, scale, projectName,
      });
      return;
    }
    if (!projectId) return;
    if (destMode === 'matrix' && parsedDestinations.length === 0) {
      setSaveMessage({ type: 'error', text: 'Enter at least one destination (building, floor, flat) — one per line.' });
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await axios.post(`${API_BASE}/projects/${projectId}/pieces/from-drawing`, {
        template_id: templateId, params, part,
        qty: destMode === 'matrix' ? 1 : qty,
        material, stone_color: stoneColor, thickness,
        piece_ids: destMode === 'matrix' ? {} : pieceIds,
        ...(destMode === 'matrix' ? { destinations: parsedDestinations } : { building, floor, flat }),
      });
      const destCount = destMode === 'matrix' ? parsedDestinations.length : 1;
      setSaveMessage({ type: 'success', text: `Saved (${res.data.pieces.length} piece${res.data.pieces.length === 1 ? '' : 's'}${destMode === 'matrix' ? ` across ${destCount} destinations` : ''}).` });
      onDone();
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to save.' });
      setIsSaving(false);
    }
  };

  const isEditing = mode === 'lifecycle' ? Object.keys(pieceIds).length > 0 : !!initial;

  return (
    <div>
      <button type="button" onClick={onCancel} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#64748b] hover:text-[#334155]">
        ← Back to all parts
      </button>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 space-y-5">
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
            <input value={part} onChange={(e) => setPart(e.target.value)} className="input-field w-full" placeholder="e.g. Island A" />
          </div>

          {mode === 'lifecycle' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-[#64748b] uppercase tracking-wide">Destination</label>
                <div className="flex rounded-full border border-[#cbd5e1] p-0.5">
                  {['single', 'matrix'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDestMode(m)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${
                        destMode === m ? 'bg-[#1d4ed8] text-white' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      {m === 'single' ? 'Single' : 'Matrix Grid'}
                    </button>
                  ))}
                </div>
              </div>
              {destMode === 'single' ? (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Building</label>
                    <input value={building} onChange={(e) => setBuilding(e.target.value)} className="input-field w-full" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Floor</label>
                    <input value={floor} onChange={(e) => setFloor(e.target.value)} className="input-field w-full" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Flat</label>
                    <input value={flat} onChange={(e) => setFlat(e.target.value)} className="input-field w-full" />
                  </div>
                </div>
              ) : (
                <div>
                  <textarea
                    value={destMatrixText}
                    onChange={(e) => setDestMatrixText(e.target.value)}
                    rows={4}
                    className="input-field w-full font-mono text-xs"
                    placeholder={'One destination per line: Building, Floor, Flat\n13, 1, 103\n13, 1, 107\n14, 2, 203'}
                  />
                  <p className="text-xs text-[#94a3b8] mt-1">
                    {parsedDestinations.length} destination{parsedDestinations.length === 1 ? '' : 's'} parsed — this drawing repeats across all of them, and the PDF shows a Building × Floor table instead of a single destination.
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#64748b] mb-2 uppercase tracking-wide">Dimensions</label>
            <div className="grid grid-cols-2 gap-3">
              {template.parameters.filter((p) => p.type !== 'boolean').map((p) => (
                <div key={p.id}>
                  <label className="block text-xs text-[#64748b] mb-1">{p.label}{p.optional ? ' (optional)' : ''}</label>
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

          <details className="rounded-xl border border-[#e2e8f0] px-4 py-3" open={mode === 'standalone'}>
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
                <label className="block text-xs text-[#64748b] mb-1">Drawn By</label>
                <input value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Scale</label>
                <input
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                  className="input-field w-full"
                  placeholder='e.g. 1/2" = 1\'-0"'
                />
                <p className="text-xs text-[#94a3b8] mt-1">Leave as NTS (Not To Scale) unless this drawing is meant to be measured directly off the page.</p>
              </div>
            </div>
          </details>

          {mode === 'lifecycle' && destMode === 'single' && (
            <div>
              <label className="block text-xs font-semibold text-[#64748b] mb-1 uppercase tracking-wide">Qty</label>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="input-field w-24" />
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c] space-y-1">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {saveMessage && (
            <div className={`rounded-xl px-4 py-3 text-sm ${
              saveMessage.type === 'success' ? 'bg-[#ecfdf5] text-[#047857] border border-[#6ee7b7]' : 'bg-[#fef2f2] text-[#b91c1c] border border-[#fecaca]'
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
            <button
              type="button"
              onClick={save}
              disabled={isSaving || errors.length > 0}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm ${
                isSaving || errors.length > 0 ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#1d4ed8] hover:bg-[#1e40af]'
              }`}
            >
              {isSaving ? 'Saving…' : isEditing ? 'Save Changes' : mode === 'lifecycle' ? 'Add to Project' : 'Save Part'}
            </button>
          </div>
        </div>

        <div className="bg-[#f8fafc] rounded-2xl border border-[#e2e8f0] p-6 flex items-start justify-center">
          <div id="drawing-preview-svg-wrap" className="w-full">
            <DrawingPreviewWithId geometry={geometry} title={part} />
          </div>
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

export default DrawingEditor;
