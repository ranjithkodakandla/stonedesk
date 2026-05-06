/**
 * Print utilities — generates print-ready HTML windows for crate and container plans.
 * Users can use the browser's "Save as PDF" to get a proper PDF.
 */

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
