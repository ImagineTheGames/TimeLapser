import { useState, useEffect, useRef } from 'react';
import './SettingsPanel.css';

interface Display {
  id: number;
  index: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(i <= 1 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

interface SettingsPanelProps {
  sessionFolder: string | null;
  frameCount: number;
  onClose: () => void;
  onOpenFocusAssist: () => void;
  /** When true, panel is in flow (beside bar) and does not use fixed positioning */
  inline?: boolean;
}

const PANEL_WIDTH = 380;
const BAR_HEIGHT = 88;

export default function SettingsPanel({ sessionFolder, frameCount, onClose, onOpenFocusAssist, inline = false }: SettingsPanelProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [settings, setSettings] = useState<Partial<Record<string, unknown>>>({});
  const [sessionSizeBytes, setSessionSizeBytes] = useState<number>(0);
  const [sessionList, setSessionList] = useState<{ path: string; name: string }[]>([]);
  const [continueSessionPath, setContinueSessionPathState] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ top?: number; right?: number; bottom?: number; left?: number }>({ top: BAR_HEIGHT, right: 12 });
  const [resolutionWidthStr, setResolutionWidthStr] = useState('');
  const [resolutionHeightStr, setResolutionHeightStr] = useState('');
  const resolutionJustSetByUs = useRef<'width' | 'height' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      window.timelapser.getDisplays().then(setDisplays).catch(() => setDisplays([]));
      window.timelapser.getSettings().then(setSettings).catch(() => setSettings({}));
      window.timelapser.getSessionList().then(setSessionList).catch(() => setSessionList([]));
      window.timelapser.getContinueSessionPath().then(setContinueSessionPathState).catch(() => setContinueSessionPathState(null));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const unsub = window.timelapser.onRegionPicked((region) => {
      if (region) {
        window.timelapser.getSettings().then(setSettings);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      window.timelapser.getOverlayBoundsAndWorkArea?.()?.then(({ bounds, workArea }) => {
        const spaceBelow = workArea.y + workArea.height - (bounds.y + bounds.height);
        const spaceAbove = bounds.y - workArea.y;
        const spaceRight = workArea.x + workArea.width - (bounds.x + bounds.width);
        const spaceLeft = bounds.x - workArea.x;
        const positionBelow = spaceBelow >= spaceAbove;
        const positionRight = spaceRight >= spaceLeft;
        setPanelPosition({
          ...(positionBelow ? { top: BAR_HEIGHT } : { bottom: BAR_HEIGHT }),
          ...(positionRight ? { left: 12 } : { right: 12 }),
        });
      });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!sessionFolder) {
      setSessionSizeBytes(0);
      return;
    }
    const load = () => window.timelapser.getSessionSize(sessionFolder).then((r) => setSessionSizeBytes(r.bytes));
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [sessionFolder]);

  useEffect(() => {
    const w = settings.width;
    const h = settings.height;
    if (resolutionJustSetByUs.current === 'width') {
      resolutionJustSetByUs.current = null;
    } else if (w !== undefined && w !== null) {
      setResolutionWidthStr(String(w));
    }
    if (resolutionJustSetByUs.current === 'height') {
      resolutionJustSetByUs.current = null;
    } else if (h !== undefined && h !== null) {
      setResolutionHeightStr(String(h));
    }
  }, [settings.width, settings.height]);

  const update = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    window.timelapser.setSettings(next as Parameters<typeof window.timelapser.setSettings>[0]);
  };

  return (
    <div className={`settings-panel ${inline ? 'settings-panel--inline' : ''}`} style={inline ? undefined : panelPosition}>
      <div className="settings-panel__header">
        <h2 className="settings-panel__title">Settings</h2>
        <button type="button" className="settings-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="settings-panel__body">
        {sessionFolder && (
          <div className="settings-panel__session-size">
            <span className="settings-panel__session-size-label">Current session</span>
            <span className="settings-panel__session-size-value">
              {formatBytes(sessionSizeBytes)}
              {frameCount > 0 && ` · ${frameCount.toLocaleString()} frames`}
            </span>
          </div>
        )}

        <label className="settings-panel__row">
          <span>Continue into session</span>
          <select
            value={continueSessionPath ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              const path = v || null;
              setContinueSessionPathState(path);
              window.timelapser.setContinueSessionPath(path);
            }}
            title="Choose which session the Continue button will append to"
          >
            <option value="">Last stopped session</option>
            {sessionList.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="settings-panel__hint">When you press ▶ Continue, recording will append to the selected session.</p>

        <label className="settings-panel__row">
          <span>Capture interval (seconds)</span>
          <input
            type="number"
            min={1}
            max={3600}
            value={Number(settings.intervalSeconds) || 5}
            onChange={(e) => update('intervalSeconds', Math.max(1, parseInt(e.target.value, 10) || 5))}
          />
        </label>

        <div className="settings-panel__row">
          <span>Output folder</span>
          <div className="settings-panel__output-folder">
            <input
              type="text"
              value={String(settings.outputFolder ?? '')}
              onChange={(e) => update('outputFolder', e.target.value)}
              placeholder="C:\Pictures\TimeLapser"
            />
            <button
              type="button"
              className="settings-panel__browse"
              onClick={async () => {
                const { path: chosen } = await window.timelapser.showOutputFolderPicker();
                if (chosen) update('outputFolder', chosen);
              }}
            >
              Browse…
            </button>
          </div>
        </div>

        <label className="settings-panel__row">
          <span>Capture source</span>
          <select
            value={String(settings.source ?? 'monitor')}
            onChange={(e) => update('source', e.target.value)}
          >
            <option value="monitor">Monitor</option>
            <option value="region">Region (select area)</option>
          </select>
        </label>

        {String(settings.source) === 'monitor' && (
          <label className="settings-panel__row">
            <span>Monitor</span>
            <select
              value={settings.monitorId != null ? Number(settings.monitorId) : 0}
              onChange={(e) => update('monitorId', parseInt(e.target.value, 10))}
            >
              {displays.map((d) => (
                <option key={d.id} value={d.index}>
                  {d.name} ({d.bounds.width}×{d.bounds.height})
                </option>
              ))}
            </select>
          </label>
        )}

        {String(settings.source) === 'region' && (
          <div className="settings-panel__region">
            <span className="settings-panel__label">Capture area</span>
            <p className="settings-panel__hint">A fullscreen overlay will appear. Click and drag on your screen to draw the capture rectangle (Esc to cancel).</p>
            <button
              type="button"
              className="settings-panel__btn settings-panel__btn--primary"
              onClick={() => window.timelapser.startRegionPick()}
            >
              Select area on screen…
            </button>
            {(settings.region as { x: number; y: number; width: number; height: number } | null) && (
              <p className="settings-panel__region-value">
                Current: {(settings.region as { x: number; y: number; width: number; height: number }).x},{' '}
                {(settings.region as { x: number; y: number; width: number; height: number }).y},{' '}
                {(settings.region as { x: number; y: number; width: number; height: number }).width}×
                {(settings.region as { x: number; y: number; width: number; height: number }).height}
              </p>
            )}
          </div>
        )}

        <label className="settings-panel__row">
          <span>Output resolution (width × height)</span>
          <div className="settings-panel__res">
            <input
              type="number"
              min={0}
              placeholder="1920"
              value={resolutionWidthStr}
              onChange={(e) => {
                const raw = e.target.value;
                setResolutionWidthStr(raw);
                const n = parseInt(raw, 10);
                resolutionJustSetByUs.current = 'width';
                update('width', Number.isNaN(n) ? 0 : n);
              }}
            />
            <span>×</span>
            <input
              type="number"
              min={0}
              placeholder="1080"
              value={resolutionHeightStr}
              onChange={(e) => {
                const raw = e.target.value;
                setResolutionHeightStr(raw);
                const n = parseInt(raw, 10);
                resolutionJustSetByUs.current = 'height';
                update('height', Number.isNaN(n) ? 0 : n);
              }}
            />
          </div>
        </label>
        <p className="settings-panel__hint">Use 0×0 to keep original size.</p>

        <label className="settings-panel__row">
          <span>Image format</span>
          <select
            value={String(settings.format ?? 'jpeg')}
            onChange={(e) => update('format', e.target.value)}
          >
            <option value="png">PNG (lossless)</option>
            <option value="jpeg">JPEG (smaller)</option>
          </select>
        </label>

        {String(settings.format) === 'jpeg' && (
          <div className="settings-panel__row">
            <span>JPEG quality — {Number(settings.jpegQuality) ?? 85}</span>
            <input
              type="range"
              min={1}
              max={100}
              value={Number(settings.jpegQuality) ?? 85}
              onChange={(e) => update('jpegQuality', Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 85)))}
              className="settings-panel__slider"
            />
          </div>
        )}

        <label className="settings-panel__row settings-panel__row--check">
          <input
            type="checkbox"
            checked={Boolean(settings.optimizeFileSize)}
            onChange={(e) => update('optimizeFileSize', e.target.checked)}
          />
          <span>Optimize file size (stronger compression)</span>
        </label>

        <label className="settings-panel__row settings-panel__row--check">
          <input
            type="checkbox"
            checked={Boolean(settings.disableNotifications)}
            onChange={(e) => update('disableNotifications', e.target.checked)}
          />
          <span>Fewer interruptions during recording</span>
        </label>

        <label className="settings-panel__row settings-panel__row--check">
          <input
            type="checkbox"
            checked={Boolean(settings.extendedLogging)}
            onChange={(e) => update('extendedLogging', e.target.checked)}
          />
          <span>Extended logging</span>
        </label>
        <p className="settings-panel__hint" style={{ marginTop: -8, marginBottom: 4 }}>
          When on, the log file records recording, overlay, and export details. When off, only startup, shutdown, and errors are logged (helps with first-time run issues).
        </p>
        <button
          type="button"
          className="settings-panel__link"
          onClick={() => window.timelapser.openLogFolder()}
        >
          Open log folder
        </button>

        <div className="settings-panel__row">
          <span>Overlay transparency — {Math.round((Number(settings.overlayOpacity) ?? 1) * 100)}%</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round((Number(settings.overlayOpacity) ?? 1) * 100)}
            onChange={(e) => update('overlayOpacity', parseInt(e.target.value, 10) / 100)}
            className="settings-panel__slider"
          />
        </div>

        <button
          type="button"
          className="settings-panel__link"
          onClick={onOpenFocusAssist}
        >
          Open Windows Focus assist settings
        </button>
      </div>
    </div>
  );
}
