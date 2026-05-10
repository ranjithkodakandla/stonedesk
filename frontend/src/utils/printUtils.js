/**
 * Print utilities — generates print-ready HTML windows for crate and container plans.
 * Users can use the browser's "Save as PDF" to get a proper PDF.
 */

import { getPieceWeight } from './plannerUtils';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgContainerTopDown(layout) {
  const L = Number(layout?.container_interior_in?.length || layout?.layout_2d?.interior_length_in || 233);
  const W = Number(layout?.container_interior_in?.width || layout?.layout_2d?.interior_width_in || 92);
  const placements = layout?.placements || [];
  const maxW = 440;
  const scale = maxW / L;
  const svgH = W * scale;
  const sw = L * scale;
  let body = `<rect x="0" y="0" width="${sw}" height="${svgH}" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>`;
  for (const p of placements) {
    const x = Number(p.x || 0) * scale;
    const y = Number(p.y || 0) * scale;
    const lw = Number(p.floor_l || 0) * scale;
    const hh = Number(p.floor_w || 0) * scale;
    const cid = escapeHtml(p.crate_id || '');
    body += `<rect x="${x}" y="${y}" width="${lw}" height="${hh}" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.2" />`;
    if (cid && lw > 28 && hh > 14) {
      body += `<text x="${x + 3}" y="${y + 12}" font-size="9" fill="#1e3a8a">${cid}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${sw} ${svgH}">${body}</svg>`;
}

function svgCrateFootprint(crate) {
  const el = Number(crate.external_length || 0) || 48;
  const ew = Number(crate.external_width || 0) || 48;
  const maxW = 300;
  const scale = maxW / el;
  const h = ew * scale;
  const w = el * scale;
  const label = escapeHtml(crate.crate_id || '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${w} ${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#ecfdf5" stroke="#047857" stroke-width="2"/><text x="6" y="16" font-size="11" fill="#065f46">${label} · top footprint</text></svg>`;
}

const printStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 24px; font-size: 11px; }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 600; margin: 18px 0 8px; border-bottom: 2px solid #1d4ed8; padding-bottom: 4px; color: #1d4ed8; }
  .subtitle { font-size: 11px; color: #64748b; margin-bottom: 12px; }
  .meta-row { display: flex; gap: 24px; margin-bottom: 12px; flex-wrap: wrap; }
  .meta-item { font-size: 10px; color: #64748b; }
  .meta-item strong { color: #1e293b; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10px; }
  th { background: #f1f5f9; font-weight: 600; text-align: left; padding: 6px 8px; border: 1px solid #e2e8f0; white-space: nowrap; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-yellow { background: #fef3c7; color: #92400e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .page-break { page-break-before: always; }
  .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; }
  .diagram-wrap { margin: 12px 0; max-width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #fff; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none; }
  }
`;

function openPrintWindow(title, html) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Popup blocked. Please allow popups for this site.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${printStyles}</style></head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

function statusBadge(status) {
  const cls = status === 'green' ? 'badge-green' : status === 'red' ? 'badge-red' : 'badge-yellow';
  return `<span class="badge ${cls}">${status}</span>`;
}

function fmt(val, decimals = 1) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toFixed(decimals);
}

export function printCratePlan(project, insights) {
  if (!insights?.crates?.length) {
    alert('No crate data to print. Generate a plan first.');
    return;
  }

  const crates = insights.crates;
  const now = new Date().toLocaleDateString();

  let html = `
    <h1>Crate Plan — ${project.name || 'Untitled Project'}</h1>
    <div class="subtitle">${project.customer || ''} • ${project.job_number || ''} • ${project.material} / ${project.thickness} • Printed ${now}</div>
    <div class="meta-row">
      <div class="meta-item"><strong>${crates.length}</strong> Crates</div>
      <div class="meta-item"><strong>${fmt(insights.summary?.shipment_weight, 0)}</strong> kg Total Weight</div>
      <div class="meta-item"><strong>${fmt(insights.efficiency_kpis?.average_fill_percent, 0)}%</strong> Avg Fill</div>
    </div>

    <h2>Crate Summary</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Type</th>
          <th>Mode</th>
          <th>Pieces</th>
          <th>Net Wt (kg)</th>
          <th>Gross Wt (kg)</th>
          <th>Fill %</th>
          <th>Int L×W×H</th>
          <th>Ext L×W×H</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const c of crates) {
    html += `<tr>
      <td><strong>${c.crate_id || ''}</strong></td>
      <td>${c.name || ''}</td>
      <td>${c.crate_type || '—'}</td>
      <td>${c.packing_mode === 'flat' ? 'Flat' : 'Category'}</td>
      <td>${c.piece_count || 0}</td>
      <td>${fmt(c.total_weight, 0)}</td>
      <td>${fmt(c.gross_weight, 0)}</td>
      <td>${fmt(c.fill_percent, 0)}%</td>
      <td>${fmt(c.internal_length, 0)}×${fmt(c.internal_width, 0)}×${fmt(c.internal_height, 0)}</td>
      <td>${fmt(c.external_length, 0)}×${fmt(c.external_width, 0)}×${fmt(c.external_height, 0)}</td>
      <td>${statusBadge(c.efficiency_status || 'yellow')}</td>
    </tr>`;
  }

  html += `</tbody></table>`;

  // Underfilled warnings
  if (insights.underfilled_crates?.length) {
    html += `<h2>Underfilled Crates</h2><table><thead><tr><th>Crate</th><th>Status</th><th>Suggestion</th></tr></thead><tbody>`;
    for (const u of insights.underfilled_crates) {
      html += `<tr><td>${u.crate_id || ''}</td><td>${u.status || ''}</td><td>${u.suggestion || ''}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  html += `<div class="footer">StoneDesk Crate Plan • Generated ${now}</div>`;

  openPrintWindow(`Crate Plan — ${project.name || 'Project'}`, html);
}

export function printContainerPlan(project, insights) {
  if (!insights?.container_loading_plan) {
    alert('No container plan to print. Generate a plan first.');
    return;
  }

  const plan = insights.container_loading_plan;
  const containers = plan.containers || [];
  const now = new Date().toLocaleDateString();

  let html = `
    <h1>Container Loading Plan — ${project.name || 'Untitled Project'}</h1>
    <div class="subtitle">${project.customer || ''} • ${project.job_number || ''} • ${project.material} / ${project.thickness} • Printed ${now}</div>

    <h2>Recommendation</h2>
    <div class="meta-row">
      <div class="meta-item"><strong>${insights.summary?.recommended_containers || 'N/A'}</strong></div>
    </div>
    <p style="margin-bottom: 12px; font-size: 11px; color: #475569;">${insights.container_plan?.reason || ''}</p>
  `;

  if (containers.length) {
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i];
      if (i > 0) html += `<div class="page-break"></div>`;
      html += `
        <h2>Container ${c.id || i + 1} — ${c.type || '40ft'}</h2>
        <div class="meta-row">
          <div class="meta-item">Total Weight: <strong>${fmt(c.total_weight, 0)} kg</strong></div>
          <div class="meta-item">Weight Util: <strong>${fmt(c.weight_utilization, 0)}%</strong></div>
          <div class="meta-item">Length Util: <strong>${fmt(c.length_utilization, 0)}%</strong></div>
          <div class="meta-item">Crates: <strong>${c.placements?.length || 0}</strong></div>
        </div>
      `;

      if (c.warnings?.length) {
        html += `<div style="margin-bottom:8px; padding:6px 10px; background:#fef3c7; border-radius:6px; font-size:10px; color:#92400e;">⚠ ${c.warnings.join(' | ')}</div>`;
      }

      html += `<table><thead><tr>
        <th>Load Order</th><th>Crate ID</th><th>Name</th><th>Destination</th>
        <th>L×W</th><th>Weight (kg)</th><th>Rotated</th><th>Unload Order</th>
      </tr></thead><tbody>`;

      const placements = [...(c.placements || [])].sort((a, b) => (a.loading_order || 0) - (b.loading_order || 0));
      for (const p of placements) {
        html += `<tr>
          <td>${p.loading_order || ''}</td>
          <td><strong>${p.crate_id || ''}</strong></td>
          <td>${p.name || ''}</td>
          <td>${p.destination_group || ''}</td>
          <td>${fmt(p.length, 0)}×${fmt(p.width, 0)}</td>
          <td>${fmt(p.weight, 0)}</td>
          <td>${p.rotated ? 'Yes' : 'No'}</td>
          <td>${p.unload_order || ''}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  // Summary table
  if (plan.summary) {
    html += `<h2>Loading Summary</h2>
    <div class="meta-row">
      <div class="meta-item">Total Containers: <strong>${plan.summary.total_containers || 0}</strong></div>
      <div class="meta-item">Total Crates Loaded: <strong>${plan.summary.total_crates_loaded || 0}</strong></div>
      <div class="meta-item">Avg Weight Util: <strong>${fmt(plan.summary.average_weight_utilization, 0)}%</strong></div>
    </div>`;
  }

  html += `<div class="footer">StoneDesk Container Loading Plan • Generated ${now}</div>`;

  openPrintWindow(`Container Plan — ${project.name || 'Project'}`, html);
}

/**
 * V3 operational pack: crate list with dimensions + 20ft placement table (Save as PDF from print dialog).
 */
export function printV3OperationalPlan({ project, crates, layout, groupedByCrateId }) {
  if (!crates?.length) {
    alert('No crates to print. Generate a plan first.');
    return;
  }

  const cap = Number(project?.delivery_payload_cap_kg) || 24000;
  const now = new Date().toLocaleString();
  const tw = layout?.total_weight_kg ?? crates.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const util = cap > 0 ? Math.min(100, Math.round((tw / cap) * 1000) / 10) : 0;

  let html = `
    <h1>Smart Crate Plan (v3) — ${project?.name || 'Project'}</h1>
    <div class="subtitle">${project?.customer || ''} • ${project?.job_number || ''} • ${project?.material || ''} / ${project?.thickness || ''} • Printed ${now}</div>
    <div class="meta-row">
      <div class="meta-item">Payload cap (planning): <strong>${fmt(cap, 0)} kg</strong></div>
      <div class="meta-item">Shipment stone est.: <strong>${fmt(tw, 0)} kg</strong></div>
      <div class="meta-item">Wt vs cap: <strong>${fmt(util, 1)}%</strong></div>
      <div class="meta-item">Crates: <strong>${crates.length}</strong></div>
    </div>
    <p style="font-size:10px;color:#64748b;margin-bottom:12px;">Use browser Print → Save as PDF for a dimensioned pack sheet. Interactive diagrams remain on screen in StoneDesk.</p>

    <h2>Crate build list</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Class</th><th>Type</th><th>Wt (kg)</th><th>Pieces</th>
          <th>External L×W×H (in)</th><th>Orientation</th><th>Dispatch group</th>
        </tr>
      </thead>
      <tbody>`;

  for (const c of crates) {
    const pcs = groupedByCrateId?.[c.id]?.length ?? '—';
    const cls = c.planner_v3_crate_class || '—';
    html += `<tr>
      <td><strong>${c.crate_id || ''}</strong></td>
      <td>${cls}</td>
      <td>${(c.crate_type || c.name || '').slice(0, 48)}</td>
      <td>${fmt(c.weight, 0)}</td>
      <td>${pcs}</td>
      <td>${fmt(c.external_length, 0)}×${fmt(c.external_width, 0)}×${fmt(c.external_height, 0)}</td>
      <td>${c.planner_v3_orientation || '—'}</td>
      <td>${c.primary_flat || '—'}</td>
    </tr>`;
  }

  html += `</tbody></table>`;

  if (layout?.placements?.length) {
    html += `<h2>20ft container — floor placement (in)</h2>
    <p style="font-size:10px;color:#475569;margin-bottom:8px;">Corner (x,y) along length × width. Single layer: B/C/D from back wall (low x); islands (A) toward door (high x).</p>
    <table><thead><tr>
      <th>Crate</th><th>x</th><th>y</th><th>Footprint L×W</th><th>Stack</th><th>Elev</th><th>Ht</th>
    </tr></thead><tbody>`;

    const byId = Object.fromEntries(crates.map((x) => [x.crate_id, x]));
    const dispatchOrder = [...crates].sort((a, b) => (a.dispatch_order || 0) - (b.dispatch_order || 0));
    for (const p of layout.placements) {
      const cid =
        p.crate_id ||
        (typeof p.crate_index === 'number' ? dispatchOrder[p.crate_index]?.crate_id : '') ||
        '';
      const wkg = byId[cid]?.weight != null ? fmt(byId[cid].weight, 0) : '—';
      html += `<tr>
        <td><strong>${cid}</strong> (${wkg} kg)</td>
        <td>${fmt(p.x, 1)}</td>
        <td>${fmt(p.y, 1)}</td>
        <td>${fmt(p.floor_l, 0)}×${fmt(p.floor_w, 0)}</td>
        <td>${p.stack_level ?? 0}</td>
        <td>${fmt(p.elevation_in, 1)}</td>
        <td>${fmt(p.height_in, 1)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  if (layout?.warnings?.length) {
    html += `<h2>Warnings</h2><ul style="font-size:10px;">`;
    for (const w of layout.warnings) html += `<li>${w}</li>`;
    html += `</ul>`;
  }

  html += `<div class="footer">StoneDesk • Smart Crate v3 operational sheet • ${now}</div>`;
  openPrintWindow(`v3 Plan — ${project?.name || 'Project'}`, html);
}

const STRATEGY_LABEL = {
  mixed_20_first: 'Mixed fleet — fill 20′ first',
  mixed_40_first: 'Mixed fleet — fill 40′ first',
  twenty_only: '20′ fleet only',
  forty_only: '40′ fleet only',
  frozen: 'Frozen (locked crates)',
};

/**
 * Full operational pack sheet: crate list, per-crate BOM + footprint SVG, all container top-down SVGs, optimizer note.
 */
export function printV3OperationalPackSheet({
  project,
  crates,
  pieces,
  layout,
  containers,
  groupedByCrateId,
  optimization,
}) {
  if (!crates?.length) {
    alert('No crates to print. Generate a plan first.');
    return;
  }

  const cap = Number(project?.delivery_payload_cap_kg) || 24000;
  const now = new Date().toLocaleString();
  const contList =
    containers?.length > 0 ? containers : layout?.placements != null ? [layout] : [];

  let html = `
    <h1>Operational pack sheet (v3) — ${escapeHtml(project?.name || 'Project')}</h1>
    <div class="subtitle">${escapeHtml(project?.customer || '')} • ${escapeHtml(project?.job_number || '')} • ${escapeHtml(project?.material || '')} / ${escapeHtml(project?.thickness || '')} • Printed ${escapeHtml(now)}</div>
    <div class="meta-row">
      <div class="meta-item">Payload cap: <strong>${fmt(cap, 0)} kg</strong></div>
      <div class="meta-item">Crates: <strong>${crates.length}</strong></div>
      <div class="meta-item">Containers in plan: <strong>${contList.length}</strong></div>
    </div>
    <p style="font-size:10px;color:#64748b;margin-bottom:12px;">Print → Save as PDF. Diagrams are simplified top-down views for field use.</p>
  `;

  if (optimization?.chosen_strategy) {
    const lab = STRATEGY_LABEL[optimization.chosen_strategy] || optimization.chosen_strategy;
    html += `<h2>Fleet optimizer</h2><p style="font-size:11px;margin-bottom:8px;"><strong>${escapeHtml(lab)}</strong></p>`;
    if (optimization.candidates?.length) {
      html += `<table><thead><tr><th>Strategy</th><th>20′</th><th>40′</th><th>Total</th><th>Unplaced</th></tr></thead><tbody>`;
      for (const c of optimization.candidates) {
        html += `<tr>
          <td>${escapeHtml(STRATEGY_LABEL[c.strategy] || c.strategy)}</td>
          <td>${c.count_20ft ?? '—'}</td>
          <td>${c.count_40ft ?? '—'}</td>
          <td>${c.container_count ?? '—'}</td>
          <td>${c.unplaced_crates ?? '—'}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  html += `<h2>Crate summary</h2>
    <table><thead><tr>
      <th>ID</th><th>Class</th><th>Wt (kg)</th><th>Pieces</th><th>External L×W×H</th>
    </tr></thead><tbody>`;
  for (const c of crates) {
    const pcs = groupedByCrateId?.[c.id]?.length ?? '—';
    html += `<tr>
      <td><strong>${escapeHtml(c.crate_id || '')}</strong></td>
      <td>${escapeHtml(c.planner_v3_crate_class || '—')}</td>
      <td>${fmt(c.weight, 0)}</td>
      <td>${pcs}</td>
      <td>${fmt(c.external_length, 0)}×${fmt(c.external_width, 0)}×${fmt(c.external_height, 0)}</td>
    </tr>`;
  }
  html += `</tbody></table>`;

  for (const c of crates) {
    html += `<div class="page-break"></div>`;
    html += `<h2>BOM — ${escapeHtml(c.crate_id || '')}</h2>
      <p class="subtitle">${escapeHtml(c.name || '')} · ${escapeHtml(c.planner_v3_orientation || '')} · ${fmt(c.weight, 0)} kg</p>
      <div class="diagram-wrap">${svgCrateFootprint(c)}</div>
      <table><thead><tr>
        <th>Part #</th><th>Description</th><th>L</th><th>W</th><th>Qty</th><th>Est. kg</th>
      </tr></thead><tbody>`;
    const plist = groupedByCrateId?.[c.id] || [];
    for (const p of plist) {
      const wkg = getPieceWeight(p, project);
      html += `<tr>
        <td>${escapeHtml(p.part_no || '')}</td>
        <td>${escapeHtml(p.description || p.notes || '')}</td>
        <td>${fmt(p.length, 0)}</td>
        <td>${fmt(p.width, 0)}</td>
        <td>${p.qty ?? 1}</td>
        <td>${fmt(wkg, 1)}</td>
      </tr>`;
    }
    if (!plist.length) {
      html += `<tr><td colspan="6">No pieces linked (refresh workspace).</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  for (let i = 0; i < contList.length; i++) {
    const cont = contList[i];
    html += `<div class="page-break"></div>`;
    const ctype = cont.type || cont.container_type || '20ft';
    const cid = cont.container_id || i + 1;
    html += `<h2>Container ${escapeHtml(String(cid))} — ${escapeHtml(ctype)}</h2>
      <div class="meta-row">
        <div class="meta-item">Weight util: <strong>${fmt(cont.weight_utilization_pct, 1)}%</strong></div>
        <div class="meta-item">Floor util (approx): <strong>${fmt(cont.floor_utilization_pct_approx, 1)}%</strong></div>
        <div class="meta-item">Stone kg: <strong>${fmt(cont.total_weight_kg ?? cont.used_weight_kg, 0)}</strong></div>
      </div>`;
    if (cont.warnings?.length) {
      html += `<div style="margin:8px 0;padding:6px 10px;background:#fef3c7;border-radius:6px;font-size:10px;">⚠ ${cont.warnings.map(escapeHtml).join(' | ')}</div>`;
    }
    html += `<div class="diagram-wrap">${svgContainerTopDown(cont)}</div>`;
    html += `<table><thead><tr>
      <th>Crate</th><th>x</th><th>y</th><th>Footprint L×W</th><th>Stack</th><th>Elev</th>
    </tr></thead><tbody>`;
    const pls = [...(cont.placements || [])].sort((a, b) => {
      const aA = String(a.crate_class || '').toUpperCase() === 'A' ? 1 : 0;
      const bA = String(b.crate_class || '').toUpperCase() === 'A' ? 1 : 0;
      if (aA !== bA) return aA - bA;
      return (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0);
    });
    for (const p of pls) {
      html += `<tr>
        <td><strong>${escapeHtml(p.crate_id || '')}</strong></td>
        <td>${fmt(p.x, 1)}</td>
        <td>${fmt(p.y, 1)}</td>
        <td>${fmt(p.floor_l, 0)}×${fmt(p.floor_w, 0)}</td>
        <td>${p.stack_level ?? 0}</td>
        <td>${fmt(p.elevation_in, 1)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  if (layout?.warnings?.length) {
    html += `<h2>Warnings</h2><ul style="font-size:10px;">`;
    for (const w of layout.warnings) html += `<li>${escapeHtml(w)}</li>`;
    html += `</ul>`;
  }

  html += `<div class="footer">StoneDesk • Operational pack sheet • ${escapeHtml(now)}</div>`;
  openPrintWindow(`Pack sheet — ${project?.name || 'Project'}`, html);
}
