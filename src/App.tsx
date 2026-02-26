import { useState, useEffect, useCallback } from 'react';
import './App.css';
import Overlay from './components/Overlay';
import SettingsPanel from './components/SettingsPanel';
import ExportDialog from './components/ExportDialog';

export default function App() {
  const [expanded, setExpanded] = useState(false);
  /** When expanded, true = settings panel is to the right of the bar (e.g. when overlay is near left edge). */
  const [panelOnRight, setPanelOnRight] = useState(false);
  const [state, setState] = useState<{ state: string; sessionFolder: string | null; frameCount: number; lastSessionFolder: string | null; continueTarget: string | null }>({
    state: 'idle',
    sessionFolder: null,
    frameCount: 0,
    lastSessionFolder: null,
    continueTarget: null,
  });
  const [showExport, setShowExport] = useState(false);
  const [exportSessionFolder, setExportSessionFolder] = useState<string | null>(null);
  const [sessionSizeBytes, setSessionSizeBytes] = useState<number>(0);

  const refreshState = useCallback(() => {
    window.timelapser.getState().then(setState);
  }, []);

  useEffect(() => {
    refreshState();
    const t = setInterval(refreshState, 1000);
    return () => clearInterval(t);
  }, [refreshState]);

  useEffect(() => {
    if (!state.sessionFolder || (state.state !== 'recording' && state.state !== 'paused')) {
      setSessionSizeBytes(0);
      return;
    }
    const load = () => window.timelapser.getSessionSize(state.sessionFolder!).then((r) => setSessionSizeBytes(r.bytes));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [state.sessionFolder, state.state]);

  useEffect(() => {
    const unsub = window.timelapser.onCollapsePanels?.(() => {
      setExpanded(false);
      setShowExport(false);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (showExport) {
      window.timelapser?.setOverlayHeight?.(720);
    } else if (expanded) {
      window.timelapser?.setOverlayExpanded?.(true)?.then((res) => {
        if (res?.panelOnRight != null) setPanelOnRight(res.panelOnRight);
      });
    } else {
      setPanelOnRight(false);
      window.timelapser?.setOverlayExpanded?.(false);
    }
  }, [expanded, showExport]);

  const handleStart = (newSession: boolean) => {
    window.timelapser.logFromRenderer?.(`Record clicked (newSession=${newSession})`);
    window.timelapser.startRecording(newSession).then((r) => {
      if (r.ok) refreshState();
      else window.timelapser.logFromRenderer?.(`startRecording returned ok=false: ${r.message ?? 'unknown'}`);
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
      const frames = r.frameCount ?? 0;
      if (r.wasRecording && r.sessionFolder && frames >= 2) {
        setExportSessionFolder(r.sessionFolder);
        setShowExport(true);
      }
    });
  };

  const openExport = () => {
    const folder = state.state === 'idle' ? state.lastSessionFolder : state.sessionFolder;
    setExportSessionFolder(folder ?? null);
    setShowExport(true);
  };

  return (
    <div className="app">
      {expanded ? (
        <div className={`app__expanded ${panelOnRight ? 'app__expanded--panel-right' : ''}`}>
          {!panelOnRight && (
            <>
              <div className="app__panel-wrap">
                <SettingsPanel
                  sessionFolder={state.sessionFolder}
                  frameCount={state.frameCount}
                  onClose={() => setExpanded(false)}
                  onOpenFocusAssist={() => window.timelapser.openFocusAssist()}
                  inline
                />
              </div>
              <div className="app__gap" />
            </>
          )}
          <div className="app__bar-wrap">
            <Overlay
              state={state.state}
              frameCount={state.frameCount}
              sessionSizeBytes={sessionSizeBytes}
              lastSessionFolder={state.lastSessionFolder}
              continueTarget={state.continueTarget}
              expanded={expanded}
              onStartNew={startNewSession}
              onStartContinue={continueSession}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              onOpenExport={openExport}
              onOpenSettings={() => setExpanded(!expanded)}
            />
          </div>
          {panelOnRight && (
            <>
              <div className="app__gap" />
              <div className="app__panel-wrap">
                <SettingsPanel
                  sessionFolder={state.sessionFolder}
                  frameCount={state.frameCount}
                  onClose={() => setExpanded(false)}
                  onOpenFocusAssist={() => window.timelapser.openFocusAssist()}
                  inline
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <Overlay
          state={state.state}
          frameCount={state.frameCount}
          sessionSizeBytes={sessionSizeBytes}
          lastSessionFolder={state.lastSessionFolder}
          continueTarget={state.continueTarget}
          expanded={expanded}
          onStartNew={startNewSession}
          onStartContinue={continueSession}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onOpenExport={openExport}
          onOpenSettings={() => setExpanded(!expanded)}
        />
      )}
      {showExport && (
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
