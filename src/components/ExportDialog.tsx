import { useState, useEffect } from 'react';
import './ExportDialog.css';

const ENCODING_BY_FORMAT: Record<string, string> = { mp4: 'H.264', mov: 'H.264', webm: 'VP9' };

export const SOCIAL_PRESETS = [
  {
    id: 'instagram_reels',
    name: 'Instagram Reels',
    maxDurationSeconds: 90,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
  },
  {
    id: 'instagram_stories',
    name: 'Instagram Stories',
    maxDurationSeconds: 60,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
  },
  {
    id: 'youtube_shorts',
    name: 'YouTube Shorts',
    maxDurationSeconds: 60,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
  },
  {
    id: 'youtube_standard',
    name: 'YouTube (16:9)',
    maxDurationSeconds: 0,
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    fps: 30,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    maxDurationSeconds: 180,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
  },
  {
    id: 'facebook_reels',
    name: 'Facebook Reels',
    maxDurationSeconds: 90,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
  },
  {
    id: 'facebook_stories',
    name: 'Facebook Stories',
    maxDurationSeconds: 60,
    width: 1440,
    height: 2560,
    aspectRatio: '9:16',
    fps: 30,
  },
] as const;

interface ExportDialogProps {
  sessionFolder: string | null;
  onClose: () => void;
}

export default function ExportDialog({ sessionFolder: initialSessionFolder, onClose }: ExportDialogProps) {
  const [sessions, setSessions] = useState<Array<{ path: string; name: string }>>([]);
  const [selectedSessionFolder, setSelectedSessionFolder] = useState<string>(initialSessionFolder ?? '');
  const [platformId, setPlatformId] = useState<string>(SOCIAL_PRESETS[0].id);
  const [format, setFormat] = useState<'mp4' | 'webm' | 'mov'>('mp4');
  const [speedToFit, setSpeedToFit] = useState(true);
  const [customFps, setCustomFps] = useState(30);
  const [outputPath, setOutputPath] = useState('');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [firstFrameDataUrl, setFirstFrameDataUrl] = useState<string | null>(null);
  const [cropToFit, setCropToFit] = useState(true);
  /** Max file size in MB, or null for no limit. */
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<number | null>(null);
  /** Quality 0–100 (higher = less compression, larger file). */
  const [quality, setQuality] = useState(70);

  const [targets, setTargets] = useState<Array<{ platformId: string; outputPath: string }>>([
    { platformId: SOCIAL_PRESETS[0].id, outputPath: '' },
  ]);

  useEffect(() => {
    window.timelapser.getSessionList().then((list) => {
      setSessions(list);
      setSelectedSessionFolder((prev) => {
        if (initialSessionFolder) return initialSessionFolder;
        return list.length > 0 ? list[0].path : prev;
      });
    });
  }, []);

  useEffect(() => {
    if (initialSessionFolder) setSelectedSessionFolder(initialSessionFolder);
  }, [initialSessionFolder]);

  useEffect(() => {
    if (!selectedSessionFolder) return;
    window.timelapser.getDefaultExportPath(selectedSessionFolder).then((p) => {
      setOutputPath(p);
      setTargets((t) => (t.length === 1 && !t[0].outputPath ? [{ ...t[0], outputPath: p }] : t));
    });
  }, [selectedSessionFolder]);

  const previewPreset = SOCIAL_PRESETS.find((p) => p.id === platformId) ?? SOCIAL_PRESETS[0];
  const preset = previewPreset;

  /** Preview box size so aspect ratio is correct (9:16 = tall, 16:9 = wide). Max 220px on the longer side. */
  const previewSize =
    preset.width >= preset.height
      ? { width: 220, height: Math.round((preset.height * 220) / preset.width) }
      : { width: Math.round((preset.width * 220) / preset.height), height: 220 };

  /** Returns path with (1), (2), ... before extension so it doesn't overwrite existing. */
  const getNextUniquePath = (basePath: string, existingPaths: string[]): string => {
    const ext = format === 'webm' ? '.webm' : format === 'mov' ? '.mov' : '.mp4';
    const baseNoSuffix = (basePath.replace(/\.[^.]+$/, '') || 'export').replace(/\s*\(\d+\)$/, '');
    for (let n = 1; n <= 999; n++) {
      const candidate = `${baseNoSuffix} (${n})${ext}`;
      if (!existingPaths.includes(candidate)) return candidate;
    }
    return `${baseNoSuffix} (${Date.now()})${ext}`;
  };

  const addTarget = () => {
    const last = targets[targets.length - 1];
    const existingPaths = targets.map((t) => t.outputPath).filter(Boolean) as string[];
    const newPath = getNextUniquePath(last?.outputPath || outputPath || 'export.mp4', existingPaths);
    setTargets([...targets, { platformId: last?.platformId ?? SOCIAL_PRESETS[0].id, outputPath: newPath }]);
  };
  const removeTarget = (i: number) => {
    if (targets.length <= 1) return;
    setTargets(targets.filter((_, idx) => idx !== i));
  };
  const updateTarget = (i: number, upd: Partial<{ platformId: string; outputPath: string }>) => {
    setTargets(targets.map((t, idx) => (idx === i ? { ...t, ...upd } : t)));
  };

  useEffect(() => {
    if (!selectedSessionFolder) return;
    window.timelapser.getSessionFrameCount(selectedSessionFolder).then(setFrameCount);
  }, [selectedSessionFolder]);

  useEffect(() => {
    if (!selectedSessionFolder) return;
    window.timelapser.getFirstFrameDataUrl(selectedSessionFolder).then(({ dataUrl }) => setFirstFrameDataUrl(dataUrl));
  }, [selectedSessionFolder]);

  const effectiveFps = speedToFit && preset.maxDurationSeconds > 0 && frameCount > 0
    ? Math.max(1, frameCount / preset.maxDurationSeconds)
    : (preset.fps || customFps);

  const estimatedDuration = frameCount > 0 ? (frameCount / effectiveFps).toFixed(1) : '—';

  const pickMusic = async () => {
    const { path: p } = await window.timelapser.showAudioPicker();
    if (p) setAudioPath(p);
  };

  /** Append (1) or increment (n) before extension so next export doesn't overwrite. */
  const pathWithNextSuffix = (filePath: string): string => {
    const ext = (filePath.match(/\.[^.]+$/) || ['.mp4'])[0];
    const base = filePath.slice(0, -ext.length);
    const m = base.match(/^(.+)\s+\((\d+)\)$/);
    const newBase = m ? `${m[1]} (${parseInt(m[2], 10) + 1})` : `${base} (1)`;
    return newBase + ext;
  };

  const handleExport = async () => {
    if (!selectedSessionFolder) return;
    const toExport = targets.filter((t) => t.outputPath?.trim());
    if (toExport.length === 0) return;
    setExporting(true);
    setMessage(null);
    setExportProgress({ current: 0, total: toExport.length });
    const ext = format === 'webm' ? 'webm' : format === 'mov' ? 'mov' : 'mp4';
    const okPaths: string[] = [];
    let errMsg: string | null = null;
    let done = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.outputPath?.trim()) continue;
      setExportProgress({ current: done + 1, total: toExport.length });
      const basePath = t.outputPath.replace(/\.(mp4|webm|mov)$/i, '');
      const finalPath = t.outputPath.toLowerCase().endsWith(`.${ext}`) ? t.outputPath : `${basePath}.${ext}`;
      const p = SOCIAL_PRESETS.find((x) => x.id === t.platformId) ?? SOCIAL_PRESETS[0];
      const effFps = speedToFit && p.maxDurationSeconds > 0 && frameCount > 0
        ? Math.max(1, frameCount / p.maxDurationSeconds) : (p.fps || customFps);
      const result = await window.timelapser.exportVideo({
        sessionFolder: selectedSessionFolder,
        outputPath: finalPath,
        platform: t.platformId,
        format,
        maxDurationSeconds: speedToFit ? p.maxDurationSeconds : 0,
        fps: p.fps || customFps,
        width: p.width,
        height: p.height,
        cropToFit,
        maxFileSizeBytes: maxFileSizeMb != null ? Math.round(maxFileSizeMb * 1024 * 1024) : undefined,
        quality,
        audioPath: audioPath || null,
        fadeInSeconds,
        fadeOutSeconds,
      });
      if (result.ok && result.path) okPaths.push(result.path);
      else if (!result.ok) errMsg = result.message || 'Export failed';
      done += 1;
    }
    setExporting(false);
    setExportProgress({ current: 0, total: 0 });
    if (okPaths.length > 0) {
      setMessage({ type: 'ok', text: errMsg ? `Saved ${okPaths.length} file(s). ${errMsg}` : `Saved to ${okPaths.length} file(s).` });
      if (okPaths[0]) window.timelapser.openFolder(okPaths[0].replace(/[/\\][^/\\]+$/, ''));
      setTargets((prev) =>
        prev.map((t) =>
          t.outputPath?.trim()
            ? { ...t, outputPath: pathWithNextSuffix(t.outputPath) }
            : t
        )
      );
    } else {
      setMessage({ type: 'err', text: errMsg || 'Export failed' });
    }
  };

  return (
    <div className="export-dialog__backdrop" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog__header">
          <h2>Export for social media</h2>
          <button type="button" className="export-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="export-dialog__body">
          <p className="export-dialog__hint">
            Choose a platform to get the right length and resolution. TimeLapser will speed up the timelapse to fit the max duration if needed.
          </p>

          {sessions.length > 0 && (
            <label className="export-dialog__row">
              <span>Session to export</span>
              <select
                value={selectedSessionFolder}
                onChange={(e) => setSelectedSessionFolder(e.target.value)}
              >
                {selectedSessionFolder && !sessions.some((s) => s.path === selectedSessionFolder) && (
                  <option value={selectedSessionFolder}>
                    {selectedSessionFolder.split(/[/\\]/).pop() || 'Current'}
                  </option>
                )}
                {sessions.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="export-dialog__row">
            <span>Platform (preview)</span>
            <select
              value={targets[0]?.platformId ?? platformId}
              onChange={(e) => {
                const v = e.target.value;
                setPlatformId(v);
                updateTarget(0, { platformId: v });
              }}
            >
              {SOCIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.aspectRatio}
                  {p.maxDurationSeconds > 0 ? `, max ${p.maxDurationSeconds}s` : ''} · {p.fps} FPS
                </option>
              ))}
            </select>
            <span className="export-dialog__encoding">
              Export: {Math.round(effectiveFps)} FPS · {ENCODING_BY_FORMAT[format] || 'H.264'} ({format.toUpperCase()})
            </span>
          </label>

          <div className="export-dialog__row">
            <span>Video format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm' | 'mov')}
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
              <option value="mov">MOV (H.264)</option>
            </select>
          </div>

          <div className="export-dialog__row">
            <span>Aspect ratio preview</span>
            <div
              className={`export-dialog__preview ${firstFrameDataUrl ? 'export-dialog__preview--with-image' : ''}`}
              style={
                firstFrameDataUrl
                  ? { width: previewSize.width, height: previewSize.height, minWidth: previewSize.width, minHeight: previewSize.height }
                  : { aspectRatio: preset.aspectRatio.replace(':', '/'), maxWidth: '100%', maxHeight: 120 }
              }
              title={`Crop: ${preset.width}×${preset.height} (${preset.aspectRatio})`}
            >
              {firstFrameDataUrl ? (
                <img
                  src={firstFrameDataUrl}
                  alt="First frame"
                  className={`export-dialog__preview-img ${cropToFit ? 'export-dialog__preview-img--cover' : ''}`}
                />
              ) : null}
              <span className="export-dialog__preview-label">{preset.aspectRatio}</span>
              <span className="export-dialog__preview-size">{preset.width}×{preset.height}</span>
            </div>
          </div>

          <label className="export-dialog__row export-dialog__row--check">
            <input
              type="checkbox"
              checked={cropToFit}
              onChange={(e) => setCropToFit(e.target.checked)}
            />
            <span>Crop to fit resolution (no squish) — same crop for every frame</span>
          </label>

          <label className="export-dialog__row export-dialog__row--check">
            <input
              type="checkbox"
              checked={speedToFit}
              onChange={(e) => setSpeedToFit(e.target.checked)}
            />
            <span>Speed up to fit platform max duration</span>
          </label>

          <div className="export-dialog__row">
            <span>Max file size</span>
            <select
              value={maxFileSizeMb != null ? String(maxFileSizeMb) : 'none'}
              onChange={(e) => {
                const v = e.target.value;
                setMaxFileSizeMb(v === 'none' ? null : parseFloat(v));
              }}
            >
              <option value="none">No limit</option>
              <option value="5">5 MB</option>
              <option value="9.9">9.9 MB (Discord)</option>
              <option value="25">25 MB</option>
              <option value="50">50 MB</option>
              <option value="100">100 MB</option>
            </select>
            <span className="export-dialog__hint-inline">When set, bitrate is reduced or frames skipped to fit.</span>
          </div>

          <div className="export-dialog__row">
            <span>Compression / quality</span>
            <div className="export-dialog__slider-row">
              <span className="export-dialog__slider-label">Smaller file</span>
              <input
                type="range"
                min={0}
                max={100}
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                className="export-dialog__slider"
              />
              <span className="export-dialog__slider-label">Larger file</span>
            </div>
            <span className="export-dialog__hint-inline">
              {maxFileSizeMb != null
                ? 'Quality affects VP9 CRF when capping size; H.264 uses target bitrate.'
                : 'Higher = better quality (lower CRF). Lower = more compression.'}
            </span>
          </div>

          <div className="export-dialog__row">
            <span>Output FPS (playback)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={Math.round(effectiveFps)}
              onChange={(e) => setCustomFps(parseInt(e.target.value, 10) || 30)}
              disabled={speedToFit && preset.maxDurationSeconds > 0}
            />
          </div>

          <p className="export-dialog__meta">
            Frames: {frameCount} → ~{estimatedDuration}s video · {preset.width}×{preset.height}
          </p>

          <div className="export-dialog__row">
            <span>Music</span>
            <div className="export-dialog__music-row">
              <button type="button" className="export-dialog__btn export-dialog__btn--secondary" onClick={pickMusic}>
                {audioPath ? 'Change music…' : 'Add music…'}
              </button>
              {audioPath && (
                <>
                  <span className="export-dialog__music-name" title={audioPath}>
                    {audioPath.split(/[/\\]/).pop()}
                  </span>
                  <button type="button" className="export-dialog__btn export-dialog__btn--ghost" onClick={() => setAudioPath(null)}>
                    Remove
                  </button>
                </>
              )}
            </div>
            <p className="export-dialog__hint">Music is trimmed to the video length with optional fade in/out.</p>
          </div>

          {audioPath && (
            <div className="export-dialog__fade-row">
              <label className="export-dialog__row export-dialog__row--small">
                <span>Fade in (s)</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  value={fadeInSeconds}
                  onChange={(e) => setFadeInSeconds(Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </label>
              <label className="export-dialog__row export-dialog__row--small">
                <span>Fade out (s)</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  value={fadeOutSeconds}
                  onChange={(e) => setFadeOutSeconds(Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </label>
            </div>
          )}

          <div className="export-dialog__row">
            <span>Export to</span>
            {targets.map((t, i) => {
              const p = SOCIAL_PRESETS.find((x) => x.id === t.platformId) ?? SOCIAL_PRESETS[0];
              return (
                <div key={i} className="export-dialog__target">
                  <select
                    value={t.platformId}
                    onChange={(e) => updateTarget(i, { platformId: e.target.value })}
                  >
                    {SOCIAL_PRESETS.map((pres) => (
                      <option key={pres.id} value={pres.id}>
                        {pres.name} — {pres.aspectRatio}
                      </option>
                    ))}
                  </select>
                  <div className="export-dialog__save-as">
                    <input
                      type="text"
                      value={t.outputPath}
                      onChange={(e) => updateTarget(i, { outputPath: e.target.value })}
                      title={t.outputPath}
                      className="export-dialog__save-as-input"
                      placeholder="Path"
                    />
                    <button
                      type="button"
                      className="export-dialog__btn export-dialog__btn--secondary"
                      onClick={async () => {
                        const { path: chosen } = await window.timelapser.showExportSavePicker(t.outputPath || outputPath, format);
                        if (chosen) updateTarget(i, { outputPath: chosen });
                      }}
                    >
                      Browse…
                    </button>
                  </div>
                  {targets.length > 1 && (
                    <button type="button" className="export-dialog__btn export-dialog__btn--ghost" onClick={() => removeTarget(i)} title="Remove">
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
            <button type="button" className="export-dialog__btn export-dialog__btn--secondary" onClick={addTarget}>
              Add another format…
            </button>
          </div>

          {exporting && exportProgress.total > 0 && (
            <div className="export-dialog__progress-wrap">
              <div className="export-dialog__progress-bar">
                <div
                  className="export-dialog__progress-fill"
                  style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                />
              </div>
              <span className="export-dialog__progress-label">
                Exporting {exportProgress.current} of {exportProgress.total}…
              </span>
            </div>
          )}

          {message && (
            <p className={`export-dialog__message export-dialog__message--${message.type}`}>
              {message.text}
            </p>
          )}
        </div>
        <div className="export-dialog__footer">
          <button
            type="button"
            className="export-dialog__btn export-dialog__btn--primary"
            onClick={handleExport}
            disabled={exporting || !selectedSessionFolder || frameCount === 0 || targets.every((t) => !t.outputPath?.trim())}
          >
            {exporting ? 'Exporting…' : targets.length > 1 ? 'Export all' : 'Export video'}
          </button>
          <button type="button" className="export-dialog__btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
