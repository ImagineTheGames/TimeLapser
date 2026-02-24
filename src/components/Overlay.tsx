import './Overlay.css';

type State = 'idle' | 'recording' | 'paused';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(i <= 1 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

interface OverlayProps {
  state: string;
  frameCount: number;
  sessionSizeBytes?: number;
  lastSessionFolder: string | null;
  /** Session path to continue into (from settings or last stopped). When set, Continue button is shown. */
  continueTarget: string | null;
  expanded: boolean;
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
  sessionSizeBytes = 0,
  expanded,
  onStartNew,
  onStartContinue,
  onPause,
  onResume,
  onStop,
  onOpenExport,
  onOpenSettings,
  lastSessionFolder,
  continueTarget,
}: OverlayProps) {
  const s = state as State;

  return (
    <div className={`overlay ${expanded ? 'overlay--expanded' : ''}`}>
      <div className="overlay__bar">
        <div className="overlay__titlebar">
          <span className="overlay__title">TimeLapser</span>
          <button
            type="button"
            className="overlay__close"
            onClick={() => window.timelapser?.closeOverlay?.()}
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="overlay__controls">
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
            {continueTarget && (
              <button
                type="button"
                className="overlay__btn overlay__btn--secondary"
                onClick={onStartContinue}
                title="Continue into selected session"
              >
                ▶ Continue
              </button>
            )}
            <button
              type="button"
              className="overlay__btn overlay__btn--secondary"
              onClick={() => {
                window.timelapser?.logFromRenderer?.(expanded ? 'Click: Options (close settings)' : 'Click: Options (open settings)');
                onOpenSettings();
              }}
              title={expanded ? 'Close settings' : 'Settings'}
              aria-label={expanded ? 'Close settings' : 'Settings'}
            >
              ⚙
            </button>
            <button
              type="button"
              className="overlay__btn overlay__btn--secondary"
              onClick={onOpenExport}
              title="Export to video (choose any session)"
            >
              Export
            </button>
          </>
        )}

        {s === 'recording' && (
          <>
            <span className="overlay__status overlay__status--rec">● REC</span>
            <span className="overlay__rec-stats">
              <span className="overlay__frames">{frameCount} frames</span>
              {sessionSizeBytes > 0 && <span className="overlay__size">{formatBytes(sessionSizeBytes)}</span>}
            </span>
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
            <span className="overlay__sep" aria-hidden="true" />
          </>
        )}

        {s === 'paused' && (
          <>
            <span className="overlay__status overlay__status--paused">⏸ Paused</span>
            <span className="overlay__rec-stats">
              <span className="overlay__frames">{frameCount} frames</span>
              {sessionSizeBytes > 0 && <span className="overlay__size">{formatBytes(sessionSizeBytes)}</span>}
            </span>
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
            <span className="overlay__sep" aria-hidden="true" />
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
    </div>
  );
}
