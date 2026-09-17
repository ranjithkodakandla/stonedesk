import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Logo from './Logo';
import ConfigurationScreen from './ConfigurationScreen';
import CutListLanding from './cutlist/CutListLanding';
import DrawingGenerator from './drawing/DrawingGenerator';
import SidebarNav from './SidebarNav';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const AVATAR_COLORS = ['#1d4ed8', '#0f766e', '#b45309', '#6d28d9', '#be123c', '#0369a1'];
const avatarColor = (seed) => AVATAR_COLORS[Math.abs(String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length];

const formatDate = (d) => {
  if (!d) return '-';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const daysAgo = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86400000);
};

const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-[#e2e8f0] rounded-xl p-4 flex items-center gap-4 shadow-sm">
    <div className="h-10 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
    <div>
      <div className="text-2xl font-bold text-[#1e293b] leading-none">{value}</div>
      <div className="text-xs font-medium text-[#64748b] mt-1 uppercase tracking-wide">{label}</div>
    </div>
  </div>
);

const Dashboard = ({ onOpenProject }) => {
  const [view, setView] = useState('projects');
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
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
        crate_wood_type: 'Pine',
        crate_wood_thickness: 1.25,
        preferred_container_mode: 'recommended',
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
    if (window.confirm('Delete this project completely?')) {
      await axios.delete(`${API_BASE}/projects/${id}`);
      fetchProjects();
    }
  };

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      String(p.id).includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.customer || '').toLowerCase().includes(q)
    );
  }, [projects, search]);

  const stats = useMemo(() => {
    const customers = new Set(projects.map((p) => (p.customer || '').trim()).filter(Boolean));
    const recent = projects.filter((p) => {
      const da = daysAgo(p.date);
      return da != null && da <= 7 && da >= 0;
    }).length;
    return { total: projects.length, recent, customers: customers.size };
  }, [projects]);

  const ProjectsView = () => (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Projects" value={stats.total} accent="#1d4ed8" />
        <StatCard label="Added This Week" value={stats.recent} accent="#0f766e" />
        <StatCard label="Customers" value={stats.customers} accent="#b45309" />
      </div>

      {showCreateForm && (
        <div className="bg-white border border-[#e2e8f0] rounded-xl shadow-sm p-5 mb-6">
          <div className="text-sm font-semibold text-[#1e293b] mb-4">New Project</div>
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

      <div className="flex items-center justify-between mb-3">
        <div className="relative w-full max-w-xs">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="input-field pl-9"
            placeholder="Search by ID, name, or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="text-xs text-[#94a3b8] font-medium ml-4 whitespace-nowrap">
          {filteredProjects.length} of {projects.length} {projects.length === 1 ? 'project' : 'projects'}
        </div>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f1f5f9] text-[#475569] border-b border-[#e2e8f0] text-[11px] font-bold uppercase tracking-wide">
                <th className="p-4 bg-[#f1f5f9]">ID</th>
                <th className="p-4 bg-[#f1f5f9]">Project</th>
                <th className="p-4 bg-[#f1f5f9]">Customer</th>
                <th className="p-4 bg-[#f1f5f9]">Date</th>
                <th className="p-4 bg-[#f1f5f9] text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const da = daysAgo(p.date);
                return (
                  <tr key={p.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors cursor-pointer" onClick={() => onOpenProject(p.id)}>
                    <td className="p-4">
                      <span className="inline-flex items-center justify-center font-mono text-xs font-bold text-[#64748b] bg-[#f1f5f9] rounded px-2 py-1">#{p.id}</span>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-[#1e293b]">{p.name || <span className="italic text-[#94a3b8] font-normal">Untitled</span>}</div>
                      {da != null && da <= 7 && da >= 0 && (
                        <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide text-[#0f766e] bg-[#ecfdf5] border border-[#a7f3d0] rounded-full px-2 py-0.5">New</span>
                      )}
                    </td>
                    <td className="p-4">
                      {p.customer ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                            style={{ backgroundColor: avatarColor(p.customer) }}
                          >
                            {initials(p.customer)}
                          </span>
                          <span className="text-[#334155]">{p.customer}</span>
                        </div>
                      ) : (
                        <span className="text-[#94a3b8]">-</span>
                      )}
                    </td>
                    <td className="p-4 text-[#475569] whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenProject(p.id); }}
                          className="text-[#1d4ed8] hover:text-[#1e40af] font-medium text-xs px-3 py-1.5 bg-[#eff6ff] hover:bg-[#dbeafe] rounded-md border border-[#bfdbfe] transition-colors"
                        >
                          Open
                        </button>
                        <button
                          onClick={(e) => deleteProject(p.id, e)}
                          className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1.5 bg-[#fef2f2] hover:bg-[#fee2e2] rounded-md border border-[#fecaca] transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProjects.length === 0 && projects.length > 0 && (
                <tr><td colSpan="5" className="p-8 text-center text-[#64748b] italic">No projects match "{search}".</td></tr>
              )}
              {projects.length === 0 && (
                <tr><td colSpan="5" className="p-10 text-center text-[#64748b]">
                  <div className="text-sm italic mb-3">No projects yet.</div>
                  <button onClick={() => setShowCreateForm(true)} className="btn-primary">+ Create New Project</button>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  // ── Dashboard modules ──────────────────────────────────────────────────
  // Each top-level module is one entry here: {key, label, render, headerAction?}.
  // To add a future module (Slab Inventory, Suppliers, Production Tracking,
  // Container Booking, ...), add one entry — the tab bar and content switch
  // below are both driven off this array, no other JSX changes needed.
  const MODULES = [
    {
      key: 'projects',
      label: 'Projects',
      hint: 'Your jobs',
      render: ProjectsView,
      headerAction: (
        <button onClick={() => setShowCreateForm((prev) => !prev)} className="btn-primary flex items-center gap-1.5">
          <span className="text-base leading-none">+</span> Create New Project
        </button>
      ),
    },
    { key: 'cutlist', label: 'Cut List', hint: 'Nest parts onto slabs', render: CutListLanding },
    { key: 'drawing-generator', label: 'Drawing Generator', hint: 'Create a countertop drawing', render: () => <DrawingGenerator mode="standalone" /> },
    { key: 'config', label: 'Configuration', hint: 'Materials & settings', render: ConfigurationScreen },
  ];

  const activeModule = MODULES.find((m) => m.key === view) || MODULES[0];
  const ActiveView = activeModule.render;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans">
      <div className="sticky top-0 z-20 bg-[#111827] border-b border-black/20 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex justify-between items-center gap-4">
          <Logo dark />
          {activeModule.headerAction}
        </div>
      </div>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <SidebarNav items={MODULES} activeKey={view} onSelect={setView} />
          <div className="flex-1 min-w-0 w-full">
            <ActiveView />
          </div>
        </div>
      </div>
    </div>
  );
};
export default Dashboard;
