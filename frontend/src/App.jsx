import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import ProjectWorkspace from './components/ProjectWorkspace';

function App() {
   const [currentProjectId, setCurrentProjectId] = useState(null);

   if (import.meta.env.DEV && window.location.hash === '#crate-viewer-demo') {
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