import './Overlay.css';

type State = 'idle' | 'recording' | 'paused';

interface OverlayProps {
  state: string;
  frameCount: number;
  lastSessionFolder: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onStartNew: () => void;
  onStartContinue: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
}

export default function Overlay({
  state,
  frameCount,
  expanded,
  onToggleExpand,
  onStartNew,
  onStartContinue,
  onPause,
  onResume,
  onStop,
  onOpenExport,
  onOpenSettings,
  lastSessionFolder,
}: OverlayProps) {
  const s = state as State;

  return (
    <div className={`overlay ${expanded ? 'overlay--expanded' : ''}`}>
      <div className="overlay__bar">
        <button
          type="button"
          className="overlay__expand"
          onClick={onToggleExpand}
          title={expanded ? 'Collapse' : 'Expand options'}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '◀' : '▶'}
        </button>

        {s === 'idle' && (
          <>
            <button
              type="button"
              className="overlay__btn overlay__btn--record"
              onClick={onStartNew}
              title="Start new session"
            >
              ● Record
            </button>
            {lastSessionFolder && (
              <button
                type="button"
                className="overlay__btn overlay__btn--secondary"
                onClick={onStartContinue}
                title="Continue last session"
              >
                ▶ Continue
              </button>
            )}
            <button
              type="button"
              className="overlay__btn overlay__btn--secondary"
              onClick={onOpenSettings}
              title="Settings"
            >
              ⚙
            </button>
          </>
        )}

        {s === 'recording' && (
          <>
            <span className="overlay__status overlay__status--rec">● REC</span>
            <span className="overlay__frames">{frameCount} frames</span>
            <button
              type="button"
              className="overlay__btn overlay__btn--pause"
              onClick={onPause}
              title="Pause"
            >
              ⏸ Pause
            </button>
            <button
              type="button"
              className="overlay__btn overlay__btn--stop"
              onClick={onStop}
              title="Stop (new session next time)"
            >
              ■ Stop
            </button>
          </>
        )}

        {s === 'paused' && (
          <>
            <span className="overlay__status overlay__status--paused">⏸ Paused</span>
            <span className="overlay__frames">{frameCount} frames</span>
            <button
              type="button"
              className="overlay__btn overlay__btn--record"
              onClick={onResume}
              title="Resume"
            >
              ▶ Resume
            </button>
            <button
              type="button"
              className="overlay__btn overlay__btn--stop"
              onClick={onStop}
              title="Stop (new session next time)"
            >
              ■ Stop
            </button>
          </>
        )}

        {s !== 'idle' && (
          <button
            type="button"
            className="overlay__btn overlay__btn--secondary"
            onClick={onOpenExport}
            title="Export to video"
          >
            Export
          </button>
        )}
      </div>
    </div>
  );
}
