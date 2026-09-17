import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { DRAWING_TEMPLATES, getTemplate, defaultParams, computePreview } from '../../utils/drawingTemplates';
import DrawingPreview from './DrawingPreview';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Two modes:
//  - "lifecycle": rendered inside a project workspace. Building/floor/flat
//    context is known and "Add to Project" turns the generated drawing into
//    a normal piece (POST .../pieces/from-drawing) that crate planning, cut
//    list and labels consume with zero special-casing.
//  - "standalone": rendered from the Dashboard with no project. Only
//    PDF/SVG download is offered — no project setup required.
const DrawingGenerator = ({ mode = 'standalone', projectId = null, onAdded = () => {} }) => {
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

  const switchTemplate = (id) => {
    setTemplateId(id);
    setParams(defaultParams(getTemplate(id)));
  };

  const setParam = (id, value) => setParams((prev) => ({ ...prev, [id]: value }));

  const { geometry, errors } = useMemo(() => computePreview(templateId, params), [templateId, params]);

  const downloadPdf = async () => {
    setSaveMessage(null);
    try {
      const res = await axios.post(`${API_BASE}/drawing-generator/pdf`, { template_id: templateId, params, part }, { responseType: 'blob' });
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
    // Rendered client-side from the same geometry shown in the preview.
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

  const addToProject = async () => {
    if (!projectId) return;
    if (errors.length) {
      setSaveMessage({ type: 'error', text: errors[0] });
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await axios.post(`${API_BASE}/projects/${projectId}/pieces/from-drawing`, {
        template_id: templateId,
        params,
        part,
        qty,
        building,
        floor,
        flat,
      });
      setSaveMessage({ type: 'success', text: `${part || 'Countertop'} added to project.` });
      onAdded();
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to add piece.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
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
            {template.parameters.map((p) => (
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
              onClick={addToProject}
              disabled={isSaving || errors.length > 0}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm ${
                isSaving || errors.length > 0 ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#1d4ed8] hover:bg-[#1e40af]'
              }`}
            >
              {isSaving ? 'Adding…' : 'Add to Project'}
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
  React.useEffect(() => {
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
