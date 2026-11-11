/**
 * DEV ONLY — open http://localhost:5173/?projectId=1#crate-3d-demo
 * Renders Crate3DPreview (single-crate box, no container) for every crate
 * in a real project, against a real running backend.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Crate3DPreview from '../components/planner3d/Crate3DPreview';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const classFromName = (name) => {
  const m = /^\[(\w)\]/.exec(name || '');
  return m ? m[1] : undefined;
};

export default function Crate3DDevPage() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const [crates, setCrates] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    axios.get(`${API_BASE}/projects/${projectId}/crates/`)
      .then((res) => setCrates(res.data || []))
      .catch((err) => setError(err?.response?.data?.detail || 'Failed to load crates.'));
  }, [projectId]);

  if (!projectId) return <div className="p-8 text-sm text-slate-600">Add ?projectId= to the URL.</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-lg font-bold text-slate-900 mb-4">Crate 3D preview — dev</h1>
      <div className="grid grid-cols-2 gap-6">
        {crates.map((c) => (
          <div key={c.id}>
            <div className="text-xs font-mono text-slate-500 mb-1">
              {c.crate_id} — {c.name} — {c.external_length}" x {c.external_width}" x {c.external_height}"
            </div>
            <Crate3DPreview
              externalLength={c.external_length}
              externalWidth={c.external_width}
              externalHeight={c.external_height}
              crateClass={classFromName(c.name)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
