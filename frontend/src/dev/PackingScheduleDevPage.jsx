/**
 * DEV ONLY — open http://localhost:5173/#packing-schedule-demo?projectId=1&crateId=1&crateLabel=A-1&material=Granite&stoneColor=Kashmir+White
 * for QA/screenshots of CratePackingSchedule against a real running backend
 * (not mocked data — projectId/crateId must exist there).
 */
import React from 'react';
import CratePackingSchedule from '../components/CratePackingSchedule';

export default function PackingScheduleDevPage() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const crateId = params.get('crateId');
  const crateLabel = params.get('crateLabel') || undefined;
  const material = params.get('material') || 'Granite';
  const stoneColor = params.get('stoneColor') || undefined;

  if (!projectId || !crateId) {
    return (
      <div className="p-8 text-sm text-slate-600">
        Add ?projectId=&amp;crateId= (and optionally &amp;crateLabel=&amp;material=&amp;stoneColor=) to the URL.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-lg font-bold text-slate-900 mb-4">Packing schedule — dev preview</h1>
      <CratePackingSchedule
        projectId={Number(projectId)} crateId={Number(crateId)} crateLabel={crateLabel}
        material={material} stoneColor={stoneColor}
      />
    </div>
  );
}
