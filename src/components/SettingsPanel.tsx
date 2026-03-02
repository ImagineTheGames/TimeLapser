import { useState, useEffect, useRef } from 'react';
import './SettingsPanel.css';

interface Display {
  id: number;
  index: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  physicalSize?: { width: number; height: number };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(i <= 1 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

const RECORDING_TEST_LOG_PREFIX = '[RecordingTest]';
const RECORDING_TEST_FRAME_TARGET = 10;
const RECORDING_TEST_POLL_MS = 600;
const RECORDING_TEST_FRAME_TIMEOUT_MS = 60000;
const LOG_FAILURE_PATTERNS = [
  /Capture error/i,
  /Region extract failed/i,
  /refusing to export/i,
  /first frame is 0 bytes/i,
  /Image to composite must have same dimensions/i,
  /Renderer error:/i,
  /export-video:.*failed/i,
  /failed:/i,
];

function centeredBox16_9(bounds: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = bounds;
  if (width / height >= 16 / 9) {
    const w = width;
    const h = Math.round(width * (9 / 16));
    return { x, y: y + Math.round((height - h) / 2), width: w, height: h };
  }
  const h = height;
  const w = Math.round(height * (16 / 9));
  return { x: x + Math.round((width - w) / 2), y, width: w, height: h };
}

function centeredBox9_16(bounds: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = bounds;
  if (width / height <= 9 / 16) {
    const w = width;
    const h = Math.round(width * (16 / 9));
    return { x, y: y + Math.round((height - h) / 2), width: w, height: h };
  }
  const h = height;
  const w = Math.round(height * (9 / 16));
  return { x: x + Math.round((width - w) / 2), y, width: w, height: h };
}

function virtualBounds(displays: Display[]) {
  if (displays.length === 0) return { x: 0, y: 0, width: 1920, height: 1080 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** ISO timestamp at start of line, e.g. 2026-02-28T00:50:46.645Z */
const LOG_LINE_TS = /^(\d{4}-\d{2}-\d{2}T[\d.:]+Z)\s/;

function detectFailuresInLog(
  logContent: string,
  startMarker: string,
  onlyAfterIso?: string
): { failed: boolean; excerpt: string } {
  const lines = logContent.split(/\r?\n/);
  // Use last occurrence of startMarker so we only consider the current test run (log may contain prior runs)
  let fromIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(startMarker)) fromIdx = i;
  }
  const relevant = lines.slice(fromIdx);
  const matches: string[] = [];
  for (const line of relevant) {
    if (line.includes('[Renderer]')) continue; // ignore renderer-forwarded lines (they may quote old excerpts)
    const m = line.match(LOG_LINE_TS);
    if (onlyAfterIso && m && m[1] < onlyAfterIso) continue;
    for (const pat of LOG_FAILURE_PATTERNS) {
      if (pat.test(line)) {
        matches.push(line.trim());
        break;
      }
    }
  }
  return { failed: matches.length > 0, excerpt: matches.slice(0, 5).join('\n') };
}

interface SettingsPanelProps {
  sessionFolder: string | null;
  frameCount: number;
  onClose: () => void;
  onOpenFocusAssist: () => void;
  /** When true, panel is in flow (beside bar) and does not use fixed positioning */
  inline?: boolean;
  /** When true, auto-start the recording test when panel mounts (e.g. from Cursor script) */
  autoRunRecordingTest?: boolean;
}

const PANEL_WIDTH = 380;
const BAR_HEIGHT = 88;

export default function SettingsPanel({ sessionFolder, frameCount, onClose, onOpenFocusAssist, inline = false, autoRunRecordingTest = false }: SettingsPanelProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [settings, setSettings] = useState<Partial<Record<string, unknown>>>({});
  const [sessionSizeBytes, setSessionSizeBytes] = useState<number>(0);
  const [sessionList, setSessionList] = useState<{ path: string; name: string }[]>([]);
  const [continueSessionPath, setContinueSessionPathState] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ top?: number; right?: number; bottom?: number; left?: number }>({ top: BAR_HEIGHT, right: 12 });
  const [resolutionWidthStr, setResolutionWidthStr] = useState('');
  const [resolutionHeightStr, setResolutionHeightStr] = useState('');
  const resolutionJustSetByUs = useRef<'width' | 'height' | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testLogLines, setTestLogLines] = useState<string[]>([]);
  const autoRunDone = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      window.timelapser.getDisplays().then(setDisplays).catch(() => setDisplays([]));
      window.timelapser.getSettings().then(setSettings).catch(() => setSettings({}));
      window.timelapser.getSessionList().then(setSessionList).catch(() => setSessionList([]));
      window.timelapser.getContinueSessionPath().then(setContinueSessionPathState).catch(() => setContinueSessionPathState(null));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const settingsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = window.timelapser.onRegionPicked((region) => {
      if (region) {
        // Region pick must only update settings (no auto-start recording). Pre-fill output resolution from region size.
        window.timelapser.getSettings().then((s) => {
          const next = { ...s, region, width: region.width, height: region.height };
          setSettings(next);
          window.timelapser.setSettings(next as Parameters<typeof window.timelapser.setSettings>[0]);
          setResolutionWidthStr(String(region.width));
          setResolutionHeightStr(String(region.height));
          resolutionJustSetByUs.current = 'width';
          resolutionJustSetByUs.current = 'height';
        });
        settingsPanelRef.current?.focus();
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

  const appendTestLog = (line: string) => {
    window.timelapser.logFromRenderer?.(`${RECORDING_TEST_LOG_PREFIX} ${line}`);
    setTestLogLines((prev) => [...prev, line]);
  };

  const runRecordingTest = async (displayList?: Display[]) => {
    if (testRunning) return;
    const list = displayList ?? displays;
    setTestRunning(true);
    setTestLogLines([]);
    if (list.length === 0) {
      appendTestLog('No displays detected.');
      await window.timelapser.sendRecordingTestComplete({ success: false, failureReason: 'No displays detected', logExcerpt: 'No displays' });
      setTestRunning(false);
      return;
    }
    const currentSettings = await window.timelapser.getSettings();
    const outputFolder = String((currentSettings?.outputFolder ?? settings.outputFolder) ?? '').trim();
    if (!outputFolder) {
      appendTestLog('Output folder not set. Set it above and run again.');
      await window.timelapser.sendRecordingTestComplete({ success: false, failureReason: 'Output folder not set', logExcerpt: 'Output folder not set' });
      setTestRunning(false);
      return;
    }
    const prevInterval = Number(settings.intervalSeconds) || 5;
    let overallSuccess = true;
    let failureReason: string | null = null;
    const testStartIso = new Date().toISOString();
    try {
      appendTestLog('Starting.');
      await window.timelapser.setSettings({ ...settings, intervalSeconds: 1 } as Parameters<typeof window.timelapser.setSettings>[0]);
      const join = (dir: string, name: string) => dir.replace(/\/?$/, '') + '/' + name;

      const waitForFrames = async (): Promise<{ sessionFolder: string | null; ok: boolean }> => {
        const start = Date.now();
        while (Date.now() - start < RECORDING_TEST_FRAME_TIMEOUT_MS) {
          const state = await window.timelapser.getState();
          if (state.frameCount >= RECORDING_TEST_FRAME_TARGET) {
            const stop = await window.timelapser.stopRecording();
            return { sessionFolder: stop.sessionFolder ?? state.sessionFolder ?? null, ok: true };
          }
          await new Promise((r) => setTimeout(r, RECORDING_TEST_POLL_MS));
        }
        await window.timelapser.stopRecording();
        return { sessionFolder: null, ok: false };
      };

      const exportPair = async (sessionFolder: string, nameBase: string) => {
        // Use 2 fps so 10 frames = 5 seconds
        const base = { sessionFolder, platform: 'custom', format: 'mp4' as const, maxDurationSeconds: 0, fps: 2, cropToFit: false, quality: 70 };
        const r169 = await window.timelapser.exportVideo({ ...base, outputPath: join(outputFolder, `${nameBase}_16_9.mp4`), width: 1920, height: 1080 });
        const r916 = await window.timelapser.exportVideo({ ...base, outputPath: join(outputFolder, `${nameBase}_9_16.mp4`), width: 1080, height: 1920 });
        return r169.ok && r916.ok;
      };

      for (let i = 0; i < list.length; i++) {
        const n = i + 1;
        appendTestLog(`Monitor Screen ${n}: setting source...`);
        await window.timelapser.setSettings({ ...settings, source: 'monitor', monitorId: i, region: null, intervalSeconds: 1 } as Parameters<typeof window.timelapser.setSettings>[0]);
        const startRes = await window.timelapser.startRecording(true);
        if (!startRes.ok) {
          appendTestLog(`Monitor Screen ${n}: start failed: ${startRes.message ?? 'unknown'}`);
          overallSuccess = false;
          continue;
        }
        appendTestLog(`Monitor Screen ${n}: recording...`);
        const { sessionFolder: folder, ok } = await waitForFrames();
        if (!ok || !folder) {
          appendTestLog(`Monitor Screen ${n}: timeout or no session.`);
          overallSuccess = false;
          continue;
        }
        appendTestLog(`Monitor Screen ${n}: exporting 16:9 and 9:16...`);
        const exportOk = await exportPair(folder, `_TEST_Screen${n}`);
        if (!exportOk) overallSuccess = false;
        appendTestLog(`Monitor Screen ${n}: done.`);
      }

      for (let i = 0; i < list.length; i++) {
        const n = i + 1;
        const region = centeredBox16_9(list[i].bounds);
        appendTestLog(`Region 16:9 Screen ${n}: setting region...`);
        await window.timelapser.setSettings({ ...settings, source: 'region', region, monitorId: null, intervalSeconds: 1 } as Parameters<typeof window.timelapser.setSettings>[0]);
        const startRes = await window.timelapser.startRecording(true);
        if (!startRes.ok) {
          appendTestLog(`Region 16:9 Screen ${n}: start failed.`);
          overallSuccess = false;
          continue;
        }
        const { sessionFolder: folder, ok } = await waitForFrames();
        if (!ok || !folder) {
          overallSuccess = false;
          continue;
        }
        const exportOk = await exportPair(folder, `_TEST_Region_Screen${n}`);
        if (!exportOk) overallSuccess = false;
        appendTestLog(`Region 16:9 Screen ${n}: done.`);
      }

      for (let i = 0; i < list.length; i++) {
        const n = i + 1;
        const region = centeredBox9_16(list[i].bounds);
        appendTestLog(`Region 9:16 Screen ${n}: setting region...`);
        await window.timelapser.setSettings({ ...settings, source: 'region', region, monitorId: null, intervalSeconds: 1 } as Parameters<typeof window.timelapser.setSettings>[0]);
        const startRes = await window.timelapser.startRecording(true);
        if (!startRes.ok) {
          overallSuccess = false;
          continue;
        }
        const { sessionFolder: folder, ok } = await waitForFrames();
        if (!ok || !folder) {
          overallSuccess = false;
          continue;
        }
        const exportOk = await exportPair(folder, `_TEST_RegionPortrait_Screen${n}`);
        if (!exportOk) overallSuccess = false;
        appendTestLog(`Region 9:16 Screen ${n}: done.`);
      }

      const virtual = virtualBounds(list);
      appendTestLog('AllScreens: setting full virtual region...');
      await window.timelapser.setSettings({ ...settings, source: 'region', region: virtual, monitorId: null, intervalSeconds: 1 } as Parameters<typeof window.timelapser.setSettings>[0]);
      const startRes = await window.timelapser.startRecording(true);
      if (!startRes.ok) {
        appendTestLog('AllScreens: start failed.');
        overallSuccess = false;
      } else {
        const { sessionFolder: folder, ok } = await waitForFrames();
        if (ok && folder) {
          const exportOk = await exportPair(folder, '_TEST_AllScreens');
          if (!exportOk) overallSuccess = false;
        } else overallSuccess = false;
        appendTestLog('AllScreens: done.');
      }

      const logContent = await window.timelapser.getMainLogContents(1500);
      const { failed: logFailed, excerpt } = detectFailuresInLog(logContent, RECORDING_TEST_LOG_PREFIX, testStartIso);
      if (logFailed) {
        overallSuccess = false;
        failureReason = `Log errors: ${excerpt || 'see main.log'}`;
      }
    } catch (e) {
      overallSuccess = false;
      failureReason = (e as Error)?.message ?? String(e);
      appendTestLog(`Error: ${failureReason}`);
    } finally {
      await window.timelapser.setSettings({ ...settings, intervalSeconds: prevInterval } as Parameters<typeof window.timelapser.setSettings>[0]);
      appendTestLog(overallSuccess ? 'Finished (success).' : `Finished (failure). ${failureReason ?? ''}`);
      await window.timelapser.sendRecordingTestComplete({
        success: overallSuccess,
        failureReason: failureReason ?? undefined,
        logExcerpt: failureReason ?? undefined,
      });
      setTestRunning(false);
    }
  };

  useEffect(() => {
    if (!autoRunRecordingTest || autoRunDone.current || testRunning) return;
    autoRunDone.current = true;
    const maxWait = 20000;
    const intervalMs = 800;
    const started = Date.now();

    const tryStart = async () => {
      if (Date.now() - started >= maxWait) {
        window.timelapser.sendRecordingTestComplete({
          success: false,
          failureReason: 'No displays detected after 20s',
          logExcerpt: 'No displays',
        });
        return true;
      }
      const fetched = displays.length > 0 ? displays : await window.timelapser.getDisplays().catch(() => []);
      if (fetched && fetched.length > 0) {
        if (fetched !== displays) setDisplays(fetched);
        runRecordingTest(fetched);
        return true;
      }
      return false;
    };

    const id = setInterval(async () => {
      if (await tryStart()) clearInterval(id);
    }, intervalMs);
    tryStart().then((done) => {
      if (done) clearInterval(id);
    });
    return () => clearInterval(id);
  }, [autoRunRecordingTest, testRunning]);

  return (
    <div ref={settingsPanelRef} tabIndex={-1} className={`settings-panel ${inline ? 'settings-panel--inline' : ''}`} style={inline ? undefined : panelPosition}>
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
            min={0.1}
            max={3600}
            step={0.1}
            value={Number(settings.intervalSeconds) || 5}
            onChange={(e) => update('intervalSeconds', Math.max(0.1, Math.min(3600, parseFloat(e.target.value) || 1)))}
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
                  {d.name} ({d.physicalSize ? `${d.physicalSize.width}×${d.physicalSize.height}` : `${Math.round(d.bounds.width)}×${Math.round(d.bounds.height)}`})
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

        <div className="settings-panel__test-section">
          <span className="settings-panel__label">Automated recording test</span>
          <p className="settings-panel__hint">
            Records 10 frames per display (monitor, 16:9 region, 9:16 region, then all screens), exports each as 16:9 and 9:16. Writes to main log and detects failures from the log.
          </p>
          <button
            type="button"
            className="settings-panel__btn settings-panel__btn--primary"
            disabled={testRunning || displays.length === 0}
            onClick={() => runRecordingTest()}
          >
            {testRunning ? 'Running test…' : 'Run recording test'}
          </button>
          {testLogLines.length > 0 && (
            <pre className="settings-panel__test-log" aria-live="polite">
              {testLogLines.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
