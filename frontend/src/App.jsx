import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import ProjectWorkspace from './components/ProjectWorkspace';

function App() {
   const [currentProjectId, setCurrentProjectId] = useState(null);

   const crateDemo =
      window.location.hash === '#crate-viewer-demo'
      && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('crateDemo'));
   if (crateDemo) {
      const CrateViewerDevPage = React.lazy(() => import('./dev/CrateViewerDevPage'));
      return (
         <React.Suspense fallback={<div className="p-8 text-sm text-slate-600">Loading crate viewer demo…</div>}>
            <CrateViewerDevPage />
         </React.Suspense>
      );
   }

   return (
      <>
         {currentProjectId ? (
            <ProjectWorkspace projectId={currentProjectId} goBack={() => setCurrentProjectId(null)} />
         ) : (
            <Dashboard onOpenProject={setCurrentProjectId} />
         )}
      </>
   );
}
export default App;