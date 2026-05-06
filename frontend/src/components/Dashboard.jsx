import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Logo from './Logo';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const Dashboard = ({ onOpenProject }) => {
  const [projects, setProjects] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    customer: '',
    job_number: '',
    date: new Date().toISOString().slice(0, 10),
  });
  const [isCreating, setIsCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${API_BASE}/projects/`);
      setProjects(res.data);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchProjects(); }, []);

  const createProject = async () => {
    if (!newProject.name.trim() && !newProject.customer.trim() && !newProject.job_number.trim()) {
      alert('Please enter at least a project name, customer, or job number before saving.');
      return;
    }

    setIsCreating(true);
    try {
      const res = await axios.post(`${API_BASE}/projects/`);
      await axios.put(`${API_BASE}/projects/${res.data.id}`, {
        name: newProject.name.trim(),
        material: 'Granite',
        thickness: '3CM',
        customer: newProject.customer.trim(),
        job_number: newProject.job_number.trim(),
        date: newProject.date || new Date().toISOString().slice(0, 10),
      });
      fetchProjects();
      setShowCreateForm(false);
      setNewProject({
        name: '',
        customer: '',
        job_number: '',
        date: new Date().toISOString().slice(0, 10),
      });
      onOpenProject(res.data.id);
    } catch (e) { console.error(e); }
    finally {
      setIsCreating(false);
    }
  };

  const cancelCreate = () => {
    setShowCreateForm(false);
    setNewProject({
      name: '',
      customer: '',
      job_number: '',
      date: new Date().toISOString().slice(0, 10),
    });
  };

  const deleteProject = async (id, e) => {
    e.stopPropagation();
    if(window.confirm('Delete this project completely?')) {
      await axios.delete(`${API_BASE}/projects/${id}`);
      fetchProjects();
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans p-6 max-w-[1000px] mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-[#e2e8f0] pb-6 mt-4">
        <Logo />
        <button onClick={() => setShowCreateForm((prev) => !prev)} className="btn-primary">+ Create New Project</button>
      </div>
      <h1 className="text-2xl font-bold text-[#1e293b] mb-6">Projects</h1>
      {showCreateForm && (
        <div className="bg-white border border-[#e2e8f0] rounded-lg shadow-sm p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label-text">Project Name</label>
              <input className="input-field" value={newProject.name} onChange={(e) => setNewProject((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div>
              <label className="label-text">Customer</label>
              <input className="input-field" value={newProject.customer} onChange={(e) => setNewProject((prev) => ({ ...prev, customer: e.target.value }))} />
            </div>
            <div>
              <label className="label-text">Job #</label>
              <input className="input-field" value={newProject.job_number} onChange={(e) => setNewProject((prev) => ({ ...prev, job_number: e.target.value }))} />
            </div>
            <div>
              <label className="label-text">Date</label>
              <input type="date" className="input-field" value={newProject.date} onChange={(e) => setNewProject((prev) => ({ ...prev, date: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 mt-5">
            <button onClick={cancelCreate} className="btn-danger">Cancel</button>
            <button onClick={createProject} disabled={isCreating} className={`btn-primary ${isCreating ? 'opacity-70 cursor-not-allowed' : ''}`}>
              {isCreating ? 'Saving...' : 'Save Project'}
            </button>
          </div>
        </div>
      )}
      <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f1f5f9] text-[#475569] border-b border-[#e2e8f0] text-xs font-semibold">
            <tr><th className="p-4">ID</th><th className="p-4">Project Name</th><th className="p-4">Customer</th><th className="p-4">Date</th><th className="p-4 text-center">Actions</th></tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors cursor-pointer" onClick={() => onOpenProject(p.id)}>
                <td className="p-4 text-[#64748b] font-medium">#{p.id}</td>
                <td className="p-4 font-bold text-[#1e293b]">{p.name}</td>
                <td className="p-4 text-[#475569]">{p.customer || '-'}</td>
                <td className="p-4 text-[#475569]">{p.date}</td>
                <td className="p-4 text-center">
                  <button onClick={(e) => deleteProject(p.id, e)} className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1 bg-[#fef2f2] hover:bg-[#fee2e2] rounded border border-[#fecaca] transition-colors">Delete</button>
                </td>
              </tr>
            ))}
            {projects.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-[#64748b] italic">No projects found. Create one above!</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
export default Dashboard;
