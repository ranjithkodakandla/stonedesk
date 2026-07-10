import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const MATERIALS = ['Granite', 'Marble', 'Quartz'];

// ── One editable table used for both Stone Colors and Crate Wood Types ──
const EditableTable = ({ rows, nameLabel, valueLabel, valueSuffix, onAdd, onSave, onDelete }) => {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditValue(row.value);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError('');
  };

  const saveEdit = async (id) => {
    if (!editName.trim() || !editValue || Number(editValue) <= 0) {
      setError('Enter a name and a value greater than zero.');
      return;
    }
    try {
      await onSave(id, editName.trim(), Number(editValue));
      setEditingId(null);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not save changes.');
    }
  };

  const submitAdd = async () => {
    if (!newName.trim() || !newValue || Number(newValue) <= 0) {
      setError('Enter a name and a value greater than zero.');
      return;
    }
    try {
      await onAdd(newName.trim(), Number(newValue));
      setAdding(false);
      setNewName('');
      setNewValue('');
      setError('');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not add row.');
    }
  };

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#f1f5f9] text-[#475569] border-b border-[#e2e8f0] text-xs font-semibold">
          <tr>
            <th className="p-3">{nameLabel}</th>
            <th className="p-3 w-48">{valueLabel}</th>
            <th className="p-3 w-56 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[#f1f5f9]">
              {editingId === row.id ? (
                <>
                  <td className="p-2">
                    <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                  </td>
                  <td className="p-2">
                    <input type="number" step="any" className="input-field" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => saveEdit(row.id)} className="btn-primary text-xs px-3 py-1.5">Save</button>
                      <button onClick={cancelEdit} className="text-xs text-[#64748b] px-3 py-1.5">Cancel</button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="p-3 font-semibold text-[#1e293b]">{row.name}</td>
                  <td className="p-3 text-[#475569]">{row.value}{valueSuffix}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => startEdit(row)} className="text-[#2563eb] hover:text-[#1d4ed8] font-medium text-xs px-3 py-1.5 bg-[#eff6ff] hover:bg-[#dbeafe] rounded-md border border-[#bfdbfe] transition-colors">Edit</button>
                      <button onClick={() => onDelete(row.id)} className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1.5 bg-[#fef2f2] hover:bg-[#fee2e2] rounded-md border border-[#fecaca] transition-colors">Delete</button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && !adding && (
            <tr><td colSpan="3" className="p-6 text-center text-[#94a3b8] italic">Nothing added yet.</td></tr>
          )}
          {adding && (
            <tr className="bg-[#f8fafc]">
              <td className="p-2">
                <input className="input-field" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </td>
              <td className="p-2">
                <input type="number" step="any" className="input-field" placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
              </td>
              <td className="p-2 text-right">
                <div className="flex justify-end gap-2">
                  <button onClick={submitAdd} className="btn-primary text-xs px-3 py-1.5">Save</button>
                  <button onClick={() => { setAdding(false); setError(''); }} className="text-xs text-[#64748b] px-3 py-1.5">Cancel</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <div className="px-4 py-2 text-sm text-[#dc2626] bg-[#fef2f2] border-t border-[#fecaca]">{error}</div>}
      {!adding && (
        <div className="p-3 border-t border-[#e2e8f0]">
          <button onClick={() => { setAdding(true); setError(''); }} className="btn-primary text-sm">+ Add New</button>
        </div>
      )}
    </div>
  );
};

const ConfigurationScreen = () => {
  const [material, setMaterial] = useState('Granite');
  const [colorsByMaterial, setColorsByMaterial] = useState({});
  const [woodTypes, setWoodTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [colorsRes, woodRes] = await Promise.all([
        axios.get(`${API_BASE}/stone-colors`),
        axios.get(`${API_BASE}/crate-wood-types`),
      ]);
      setColorsByMaterial(colorsRes.data || {});
      setWoodTypes(woodRes.data || []);
    } catch (err) {
      console.error('Failed to load configuration', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const colorRows = (colorsByMaterial[material] || []).map((c) => ({ id: c.id, name: c.name, value: c.density_kg_m3 }));
  const woodRows = woodTypes.map((w) => ({ id: w.id, name: w.name, value: w.density_factor }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1e293b]">Configuration</h1>
        <p className="text-sm text-[#64748b] mt-1">Manage the stone colors and crate wood types used when entering project data.</p>
      </div>

      {loading ? (
        <div className="text-center text-[#64748b] py-12">Loading…</div>
      ) : (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-[#1e293b]">Stone Colors</h2>
                <p className="text-xs text-[#64748b]">Density (kg/m³) is used to calculate the weight of each stone piece.</p>
              </div>
              <div className="flex gap-2">
                {MATERIALS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMaterial(m)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                      material === m ? 'bg-[#1d4ed8] text-white' : 'bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <EditableTable
              rows={colorRows}
              nameLabel="Color Name"
              valueLabel="Density (kg/m³)"
              valueSuffix=""
              onAdd={async (name, value) => {
                await axios.post(`${API_BASE}/stone-colors`, { material, name, density_kg_m3: value });
                await loadAll();
              }}
              onSave={async (id, name, value) => {
                await axios.put(`${API_BASE}/stone-colors/${id}`, { name, density_kg_m3: value });
                await loadAll();
              }}
              onDelete={async (id) => {
                if (!window.confirm('Delete this color? Projects already using it will fall back to a default weight estimate.')) return;
                await axios.delete(`${API_BASE}/stone-colors/${id}`);
                await loadAll();
              }}
            />
          </div>

          <div>
            <div className="mb-3">
              <h2 className="text-lg font-bold text-[#1e293b]">Crate Wood Types</h2>
              <p className="text-xs text-[#64748b]">Density factor is used to calculate the weight of the crate itself.</p>
            </div>
            <EditableTable
              rows={woodRows}
              nameLabel="Wood Type"
              valueLabel="Density Factor"
              valueSuffix=""
              onAdd={async (name, value) => {
                await axios.post(`${API_BASE}/crate-wood-types`, { name, density_factor: value });
                await loadAll();
              }}
              onSave={async (id, name, value) => {
                await axios.put(`${API_BASE}/crate-wood-types/${id}`, { name, density_factor: value });
                await loadAll();
              }}
              onDelete={async (id) => {
                if (!window.confirm('Delete this wood type? Projects already using it will fall back to a default weight estimate.')) return;
                await axios.delete(`${API_BASE}/crate-wood-types/${id}`);
                await loadAll();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigurationScreen;
