import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import ProjectWorkspace from './components/ProjectWorkspace';

function App() {
   const [currentProjectId, setCurrentProjectId] = useState(null);

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