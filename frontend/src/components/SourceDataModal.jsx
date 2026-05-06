import React from 'react';
import EntryForm from './EntryForm';
import PiecesTable from './PiecesTable';

const SourceDataModal = ({
  isOpen,
  onClose,
  project,
  setProject,
  pieces,
  onDeletePiece,
  onDataChange,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex h-[92vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-[#dbe4f0] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Source Data</div>
            <div className="mt-1 text-xl font-semibold text-[#0f172a]">Manage project inputs and parts</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#f8fafc]"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <EntryForm project={project} setProject={setProject} onDataChange={onDataChange} />
          <PiecesTable
            pieces={pieces}
            project={project}
            onDelete={onDeletePiece}
            onDataChange={onDataChange}
          />
        </div>
      </div>
    </div>
  );
};

export default SourceDataModal;
