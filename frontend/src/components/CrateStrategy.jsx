import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const CrateStrategy = ({ pieces, project, onDataChange, showToast }) => {
  const [strategy, setStrategy] = useState({ group_by: 'type', max_pieces: '', max_weight: '' });
  const [loading, setLoading] = useState(false);

  const handleAutoGenerate = async () => {
    if (pieces.length === 0) { 
      showToast('No pieces to crate', 'error'); 
      return; 
    }
    
    setLoading(true);
    
    // Prepare data - convert empty strings to null
    const payload = {
      group_by: strategy.group_by,
      max_pieces: strategy.max_pieces ? parseInt(strategy.max_pieces) : null,
      max_weight: strategy.max_weight ? parseFloat(strategy.max_weight) : null
    };
    
    console.log('Sending payload:', payload); // Check what's being sent
    
    try {
      const response = await axios.post(`${API_BASE}/crates/auto-generate`, payload);
      console.log('Response:', response.data);
      onDataChange();
      showToast('Crates generated successfully!', 'success');
    } catch (error) { 
      console.error('Error details:', error.response?.data);
      showToast('Error generating crates: ' + (error.response?.data?.detail || error.message), 'error'); 
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-stone-mid border border-stone-light border-t-2 border-orange p-5 mb-6">
      <h3 className="font-mono text-sm text-orange uppercase tracking-wider mb-4">Crate Generation Strategy</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div>
          <label className="font-mono text-[10px] text-quartz-dim uppercase block mb-2">Group by</label>
          <select 
            className="w-full bg-stone border border-stone-light text-quartz font-mono text-sm p-2 outline-none focus:border-orange transition-all"
            value={strategy.group_by} 
            onChange={e => setStrategy({ ...strategy, group_by: e.target.value })}
          >
            <option value="type">📦 Type (Vanity/Kitchen together)</option>
            <option value="flat">🏢 Flat/Building (same unit together)</option>
          </select>
        </div>
        <div>
          <label className="font-mono text-[10px] text-quartz-dim uppercase block mb-2">Max pieces per crate (optional)</label>
          <input 
            type="number" 
            className="w-full bg-stone border border-stone-light text-quartz font-mono text-sm p-2 outline-none focus:border-orange transition-all" 
            placeholder="e.g., 10" 
            value={strategy.max_pieces} 
            onChange={e => setStrategy({ ...strategy, max_pieces: e.target.value })} 
          />
        </div>
        <div>
          <label className="font-mono text-[10px] text-quartz-dim uppercase block mb-2">Max weight per crate (kg, optional)</label>
          <input 
            type="number" 
            className="w-full bg-stone border border-stone-light text-quartz font-mono text-sm p-2 outline-none focus:border-orange transition-all" 
            placeholder="e.g., 350" 
            value={strategy.max_weight} 
            onChange={e => setStrategy({ ...strategy, max_weight: e.target.value })} 
          />
        </div>
      </div>
      <button 
        className="mt-5 bg-orange text-white px-6 py-2 text-sm font-bold uppercase tracking-wider hover:bg-orange/80 transition-all disabled:opacity-50"
        onClick={handleAutoGenerate}
        disabled={loading}
      >
        {loading ? 'Generating...' : '⚡ Auto-Generate Crates'}
      </button>
    </div>
  );
};

export default CrateStrategy;