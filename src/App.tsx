import { useState, useEffect, useCallback } from 'react';
import Overlay from './components/Overlay';
import SettingsPanel from './components/SettingsPanel';
import ExportDialog from './components/ExportDialog';

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<{ state: string; sessionFolder: string | null; frameCount: number; lastSessionFolder: string | null }>({
    state: 'idle',
    sessionFolder: null,
    frameCount: 0,
    lastSessionFolder: null,
  });
  const [showExport, setShowExport] = useState(false);
  const [exportSessionFolder, setExportSessionFolder] = useState<string | null>(null);

  const refreshState = useCallback(() => {
    window.timelapser.getState().then(setState);
  }, []);

  useEffect(() => {
    refreshState();
    const t = setInterval(refreshState, 1000);
    return () => clearInterval(t);
  }, [refreshState]);

  const handleStart = (newSession: boolean) => {
    window.timelapser.startRecording(newSession).then((r) => {
      if (r.ok) refreshState();
    });
  };

  const startNewSession = () => handleStart(true);
  const continueSession = () => handleStart(false);

  const handlePause = () => {
    window.timelapser.pauseRecording().then(() => refreshState());
  };

  const handleResume = () => {
    window.timelapser.resumeRecording().then(() => refreshState());
  };

  const handleStop = () => {
    window.timelapser.stopRecording().then((r) => {
      refreshState();
      if (r.wasRecording && r.sessionFolder) {
        setExportSessionFolder(r.sessionFolder);
        setShowExport(true);
      }
    });
  };

  const openExport = () => {
    setExportSessionFolder(state.sessionFolder);
    setShowExport(true);
  };

  return (
    <div className="app">
      <Overlay
        state={state.state}
        frameCount={state.frameCount}
        lastSessionFolder={state.lastSessionFolder}
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
        onStartNew={startNewSession}
        onStartContinue={continueSession}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onOpenExport={openExport}
        onOpenSettings={() => setExpanded(true)}
      />
      {expanded && (
        <SettingsPanel
          onClose={() => setExpanded(false)}
          onOpenFocusAssist={() => window.timelapser.openFocusAssist()}
        />
      )}
      {showExport && exportSessionFolder && (
        <ExportDialog
          sessionFolder={exportSessionFolder}
          onClose={() => {
            setShowExport(false);
            setExportSessionFolder(null);
          }}
        />
      )}
    </div>
  );
}
