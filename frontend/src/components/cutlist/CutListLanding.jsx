import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../../utils/plannerUtils';
import CutListScreen from './CutListScreen';

/**
 * Landing page for standalone (no-project) cut lists — a saved-list table
 * plus a "+ New Cut List" button, the same shape as the Projects screen,
 * so each cut list is its own named, revisitable, persisted entity instead
 * of a single anonymous draft that gets overwritten.
 */
const CutListLanding = () => {
  const [lists, setLists] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const fetchLists = async () => {
    try {
      const res = await axios.get(`${API_BASE}/cutlist-projects/`);
      setLists(res.data || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchLists(); }, []);

  const createList = async () => {
    setIsCreating(true);
    try {
      const res = await axios.post(`${API_BASE}/cutlist-projects/`, { name: newName.trim() });
      setShowCreateForm(false);
      setNewName('');
      fetchLists();
      setSelectedId(res.data.id);
    } catch (e) { console.error(e); }
    finally { setIsCreating(false); }
  };

  const cancelCreate = () => { setShowCreateForm(false); setNewName(''); };

  const deleteList = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('Delete this cut list completely?')) {
      await axios.delete(`${API_BASE}/cutlist-projects/${id}`);
      fetchLists();
    }
  };

  if (selectedId) {
    return (
      <div>
        <button type="button" onClick={() => setSelectedId(null)}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 mb-4">
          ← Back to Cut Lists
        </button>
        <CutListScreen mode="manual" cutlistId={selectedId} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1e293b]">Cut Lists</h1>
        <button onClick={() => setShowCreateForm((v) => !v)} className="btn-primary">+ New Cut List</button>
      </div>

      {showCreateForm && (
        <div className="bg-white border border-[#e2e8f0] rounded-lg shadow-sm p-5 mb-6">
          <div>
            <label className="label-text">Cut List Name</label>
            <input className="input-field" value={newName} placeholder="e.g., Seasons@Gurnee 3CM"
              onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="flex items-center justify-end gap-3 mt-5">
            <button onClick={cancelCreate} className="btn-danger">Cancel</button>
            <button onClick={createList} disabled={isCreating} className={`btn-primary ${isCreating ? 'opacity-70 cursor-not-allowed' : ''}`}>
              {isCreating ? 'Saving...' : 'Save Cut List'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f1f5f9] text-[#475569] border-b border-[#e2e8f0] text-xs font-semibold">
            <tr><th className="p-4">ID</th><th className="p-4">Name</th><th className="p-4">Date</th><th className="p-4 text-center">Actions</th></tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors cursor-pointer" onClick={() => setSelectedId(l.id)}>
                <td className="p-4 text-[#64748b] font-medium">#{l.id}</td>
                <td className="p-4 font-bold text-[#1e293b]">{l.name}</td>
                <td className="p-4 text-[#475569]">{(l.created_at || '').slice(0, 10)}</td>
                <td className="p-4 text-center">
                  <button onClick={(e) => deleteList(l.id, e)} className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1 bg-[#fef2f2] hover:bg-[#fee2e2] rounded border border-[#fecaca] transition-colors">Delete</button>
                </td>
              </tr>
            ))}
            {lists.length === 0 && <tr><td colSpan="4" className="p-8 text-center text-[#64748b] italic">No cut lists found. Create one above!</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default CutListLanding;
