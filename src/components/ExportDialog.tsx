import { useState, useEffect } from 'react';
import './ExportDialog.css';

const ENCODING_BY_FORMAT: Record<string, string> = { mp4: 'H.264', mov: 'H.264', webm: 'VP9' };

export const CUSTOM_PRESET_ID = 'custom';
export const GIF_PRESET_ID = 'gif';

export type Preset = {
  id: string;
  name: string;
  maxDurationSeconds: number;
  width: number;
  height: number;
  aspectRatio: string;
  fps: number;
};

export const SOCIAL_PRESETS: Preset[] = [
  { id: 'instagram_reels', name: 'Instagram Reels', maxDurationSeconds: 90, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'instagram_stories', name: 'Instagram Stories', maxDurationSeconds: 60, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'youtube_shorts', name: 'YouTube Shorts', maxDurationSeconds: 60, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'youtube_standard', name: 'YouTube (16:9)', maxDurationSeconds: 0, width: 1920, height: 1080, aspectRatio: '16:9', fps: 30 },
  { id: 'tiktok', name: 'TikTok', maxDurationSeconds: 180, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'facebook_reels', name: 'Facebook Reels', maxDurationSeconds: 90, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'facebook_stories', name: 'Facebook Stories', maxDurationSeconds: 60, width: 1440, height: 2560, aspectRatio: '9:16', fps: 30 },
];

/** Dimensions for GIF by max dimension and aspect ratio. */
const GIF_DIMENSIONS_9_16: Record<number | 'full', { width: number; height: number }> = {
  480: { width: 480, height: 854 },
  720: { width: 720, height: 1280 },
  1080: { width: 1080, height: 1920 },
  full: { width: 1080, height: 1920 },
};
const GIF_DIMENSIONS_16_9: Record<number | 'full', { width: number; height: number }> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  full: { width: 1920, height: 1080 },
};
function getGifDimensions(maxDim: GifMaxDimension, aspectRatio: '9:16' | '16:9'): { width: number; height: number } {
  const map = aspectRatio === '16:9' ? GIF_DIMENSIONS_16_9 : GIF_DIMENSIONS_9_16;
  return map[maxDim ?? 720] ?? map[720];
}

const DEFAULT_CUSTOM_PRESET = { width: 1920, height: 1080, fps: 30, maxDurationSeconds: 0 };

const DEFAULT_TARGET_OPTIONS = {
  speedToFit: true,
  cropToFit: true,
  quality: 70,
  maxFileSizeMb: null as number | null,
};

export type GifMaxDimension = 480 | 720 | 1080 | 'full';

export interface ExportTarget {
  platformId: string;
  outputPath: string;
  /** Video format for this target when platformId is not GIF. */
  videoFormat?: 'mp4' | 'webm' | 'mov';
  customPreset?: { width: number; height: number; fps: number; maxDurationSeconds: number };
  /** GIF: max dimension (480, 720, 1080, full). */
  gifMaxDimension?: GifMaxDimension;
  /** GIF: aspect ratio 16:9 or 9:16. */
  gifAspectRatio?: '16:9' | '9:16';
  /** GIF: quality 0–100 (affects scale/size). */
  gifQuality?: number;
  /** Override FPS for any platform; when undefined, use preset FPS. */
  fpsOverride?: number;
  /** When set (e.g. 60), video length is fixed to this many seconds; FPS is derived. Overrides speed-to-fit and FPS. */
  targetDurationSeconds?: number | null;
  speedToFit?: boolean;
  cropToFit?: boolean;
  quality?: number;
  maxFileSizeMb?: number | null;
}

function getPresetForTarget(t: ExportTarget): Preset {
  if (t.platformId === CUSTOM_PRESET_ID && t.customPreset) {
    const { width, height, fps, maxDurationSeconds } = t.customPreset;
    const aspectRatio = width >= height ? '16:9' : '9:16';
    return { id: CUSTOM_PRESET_ID, name: 'Custom', maxDurationSeconds, width, height, aspectRatio, fps };
  }
  if (t.platformId === GIF_PRESET_ID) {
    const aspect = t.gifAspectRatio ?? '9:16';
    const dim = getGifDimensions(t.gifMaxDimension ?? 720, aspect);
    return { id: GIF_PRESET_ID, name: 'GIF', maxDurationSeconds: 0, width: dim.width, height: dim.height, aspectRatio: aspect, fps: 10 };
  }
  return SOCIAL_PRESETS.find((p) => p.id === t.platformId) ?? SOCIAL_PRESETS[0];
}

function getFormatForTarget(t: ExportTarget): 'mp4' | 'webm' | 'mov' | 'gif' {
  return t.platformId === GIF_PRESET_ID ? 'gif' : (t.videoFormat ?? 'mp4');
}

function getEffectiveFpsForTarget(t: ExportTarget, frameCount: number): number {
  if (frameCount <= 0) return 30;
  if (t.targetDurationSeconds != null && t.targetDurationSeconds > 0) {
    return Math.max(1, frameCount / t.targetDurationSeconds);
  }
  const preset = getPresetForTarget(t);
  const speedToFit = t.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit;
  if (speedToFit && preset.maxDurationSeconds > 0) {
    return Math.max(1, frameCount / preset.maxDurationSeconds);
  }
  return t.fpsOverride ?? preset.fps;
}

function getDurationSecForTarget(t: ExportTarget, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return frameCount / getEffectiveFpsForTarget(t, frameCount);
}

function getEstimatedFileSizeMbForTarget(t: ExportTarget, frameCount: number): number | null {
  if (frameCount <= 0) return null;
  const format = getFormatForTarget(t);
  if (format === 'gif') {
    const durationSec = getDurationSecForTarget(t, frameCount);
    const preset = getPresetForTarget(t);
    const pixels = preset.width * preset.height;
    const refPixels = 1920 * 1080;
    const qualityFactor = (t.gifQuality ?? 70) / 100;
    return (durationSec * 0.5 * (pixels / refPixels) * (0.3 + 0.7 * qualityFactor)); // rough estimate for GIF
  }
  const durationSec = getDurationSecForTarget(t, frameCount);
  const preset = getPresetForTarget(t);
  const quality = t.quality ?? DEFAULT_TARGET_OPTIONS.quality;
  const maxFileSizeMb = t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb;
  const pixels = preset.width * preset.height;
  const refPixels = 1920 * 1080;
  const baseMbps = format === 'webm'
    ? (2 + (quality / 100) * 5) * 0.75
    : 2 + (quality / 100) * 6;
  let estimatedMb = (durationSec * baseMbps * 1e6 / 8) * (pixels / refPixels) / (1024 * 1024);
  if (maxFileSizeMb != null && maxFileSizeMb > 0) estimatedMb = Math.min(estimatedMb, maxFileSizeMb);
  return estimatedMb;
}

interface ExportDialogProps {
  sessionFolder: string | null;
  onClose: () => void;
}

export default function ExportDialog({ sessionFolder: initialSessionFolder, onClose }: ExportDialogProps) {
  const [sessions, setSessions] = useState<Array<{ path: string; name: string }>>([]);
  const [selectedSessionFolder, setSelectedSessionFolder] = useState<string>(initialSessionFolder ?? '');
  const [outputPath, setOutputPath] = useState('');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [firstFrameDataUrl, setFirstFrameDataUrl] = useState<string | null>(null);
  /** Aspect ratio for preview only: 16:9 or 9:16. */
  const [previewAspectRatio, setPreviewAspectRatio] = useState<'16:9' | '9:16'>('9:16');

  const [targets, setTargets] = useState<ExportTarget[]>([
    {
      platformId: SOCIAL_PRESETS[0].id,
      outputPath: '',
      videoFormat: 'mp4',
      ...DEFAULT_TARGET_OPTIONS,
    },
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
      setTargets((t) => {
        if (t.length !== 1 || t[0].outputPath) return t;
        const fmt = getFormatForTarget(t[0]);
        const pathWithExt = fmt === 'gif' ? p.replace(/\.(mp4|webm|mov)$/i, '.gif') : p;
        return [{ ...t[0], outputPath: pathWithExt }];
      });
    });
  }, [selectedSessionFolder]);

  /** Preview dimensions from aspect ratio only (16:9 or 9:16). */
  const previewWidth = previewAspectRatio === '16:9' ? 1920 : 1080;
  const previewHeight = previewAspectRatio === '16:9' ? 1080 : 1920;
  const previewSize =
    previewWidth >= previewHeight
      ? { width: 220, height: Math.round((previewHeight * 220) / previewWidth) }
      : { width: Math.round((previewWidth * 220) / previewHeight), height: 220 };

  /** Returns path with (1), (2), ... before extension so it doesn't overwrite existing. */
  const getNextUniquePath = (basePath: string, existingPaths: string[], ext: string): string => {
    const baseNoSuffix = (basePath.replace(/\.[^.]+$/, '') || 'export').replace(/\s*\(\d+\)$/, '');
    const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
    for (let n = 1; n <= 999; n++) {
      const candidate = `${baseNoSuffix} (${n})${dotExt}`;
      if (!existingPaths.includes(candidate)) return candidate;
    }
    return `${baseNoSuffix} (${Date.now()})${dotExt}`;
  };

  const addTarget = () => {
    const last = targets[targets.length - 1];
    const newPlatformId = last?.platformId ?? SOCIAL_PRESETS[0].id;
    const newFormat = newPlatformId === GIF_PRESET_ID ? 'gif' : (last?.videoFormat ?? 'mp4');
    const existingPaths = targets.map((t) => t.outputPath).filter(Boolean) as string[];
    const newPath = getNextUniquePath(last?.outputPath || outputPath || 'export.mp4', existingPaths, newFormat);
    const newTarget: ExportTarget = {
      platformId: newPlatformId,
      outputPath: newPath,
      videoFormat: newPlatformId === GIF_PRESET_ID ? undefined : (last?.videoFormat ?? 'mp4'),
      ...(newPlatformId === GIF_PRESET_ID ? { gifMaxDimension: last?.gifMaxDimension ?? 720, gifAspectRatio: last?.gifAspectRatio ?? '9:16', gifQuality: last?.gifQuality ?? 70 } : {}),
      ...(newPlatformId === CUSTOM_PRESET_ID && last?.customPreset ? { customPreset: { ...last.customPreset } } : {}),
      fpsOverride: last?.fpsOverride,
      targetDurationSeconds: last?.targetDurationSeconds ?? undefined,
      speedToFit: last?.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit,
      cropToFit: last?.cropToFit ?? DEFAULT_TARGET_OPTIONS.cropToFit,
      quality: last?.quality ?? DEFAULT_TARGET_OPTIONS.quality,
      maxFileSizeMb: last?.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb,
    };
    setTargets([...targets, newTarget]);
  };

  const copyFromPrevious = (i: number) => {
    if (i <= 0) return;
    const prev = targets[i - 1];
    const ext = getFormatForTarget(prev);
    const existingPaths = targets.map((t) => t.outputPath).filter(Boolean) as string[];
    const newPath = getNextUniquePath(prev.outputPath || outputPath || 'export.mp4', existingPaths, ext);
    setTargets(targets.map((t, idx) => {
      if (idx !== i) return t;
      return {
        ...t,
        platformId: prev.platformId,
        videoFormat: prev.videoFormat,
        gifMaxDimension: prev.gifMaxDimension,
        gifAspectRatio: prev.gifAspectRatio,
        gifQuality: prev.gifQuality,
        customPreset: prev.customPreset ? { ...prev.customPreset } : undefined,
        fpsOverride: prev.fpsOverride,
        targetDurationSeconds: prev.targetDurationSeconds ?? undefined,
        speedToFit: prev.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit,
        cropToFit: prev.cropToFit ?? DEFAULT_TARGET_OPTIONS.cropToFit,
        quality: prev.quality ?? DEFAULT_TARGET_OPTIONS.quality,
        maxFileSizeMb: prev.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb,
        outputPath: newPath,
      };
    }));
  };

  const removeTarget = (i: number) => {
    if (targets.length <= 1) return;
    setTargets(targets.filter((_, idx) => idx !== i));
  };
  const updateTarget = (i: number, upd: Partial<ExportTarget>) => {
    setTargets(targets.map((t, idx) => {
      if (idx !== i) return t;
      const next = { ...t, ...upd };
      if (upd.platformId === CUSTOM_PRESET_ID && !next.customPreset) next.customPreset = { ...DEFAULT_CUSTOM_PRESET };
      if (upd.platformId != null && upd.platformId !== CUSTOM_PRESET_ID) next.customPreset = undefined;
      if (upd.platformId != null) next.fpsOverride = undefined;
      const basePath = (next.outputPath || outputPath || 'export.mp4').replace(/\.(mp4|webm|mov|gif)$/i, '') || 'export';
      if (upd.platformId === GIF_PRESET_ID) {
        next.videoFormat = undefined;
        if (next.gifMaxDimension == null) next.gifMaxDimension = 720;
        if (next.gifAspectRatio == null) next.gifAspectRatio = '9:16';
        if (next.gifQuality == null) next.gifQuality = 70;
        next.outputPath = basePath + '.gif';
      } else if (upd.platformId != null && t.platformId === GIF_PRESET_ID) {
        next.gifMaxDimension = undefined;
        next.gifAspectRatio = undefined;
        next.gifQuality = undefined;
        next.videoFormat = next.videoFormat ?? 'mp4';
        next.outputPath = basePath + '.' + (next.videoFormat ?? 'mp4');
      }
      if (upd.videoFormat != null && next.platformId !== GIF_PRESET_ID) {
        next.outputPath = basePath + '.' + upd.videoFormat;
      }
      return next;
    }));
  };

  useEffect(() => {
    if (!selectedSessionFolder) return;
    window.timelapser.getSessionFrameCount(selectedSessionFolder).then(setFrameCount);
  }, [selectedSessionFolder]);

  useEffect(() => {
    if (!selectedSessionFolder) return;
    window.timelapser.getFirstFrameDataUrl(selectedSessionFolder).then(({ dataUrl }) => setFirstFrameDataUrl(dataUrl));
  }, [selectedSessionFolder]);

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
    const okPaths: string[] = [];
    let errMsg: string | null = null;
    let done = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.outputPath?.trim()) continue;
      const format = getFormatForTarget(t);
      const ext = format;
      const basePath = t.outputPath.replace(/\.(mp4|webm|mov|gif)$/i, '');
      const finalPath = t.outputPath.toLowerCase().endsWith(`.${ext}`) ? t.outputPath : `${basePath}.${ext}`;
      const p = getPresetForTarget(t);
      const effFps = getEffectiveFpsForTarget(t, frameCount);
      const speedToFit = t.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit;
      const cropToFit = t.cropToFit ?? DEFAULT_TARGET_OPTIONS.cropToFit;
      const quality = t.quality ?? DEFAULT_TARGET_OPTIONS.quality;
      const maxFileSizeMb = t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb;
      const result = await window.timelapser.exportVideo({
        sessionFolder: selectedSessionFolder,
        outputPath: finalPath,
        platform: t.platformId,
        format,
        maxDurationSeconds: speedToFit ? p.maxDurationSeconds : 0,
        fps: effFps,
        width: p.width,
        height: p.height,
        cropToFit,
        maxFileSizeBytes: maxFileSizeMb != null && maxFileSizeMb > 0 ? Math.round(maxFileSizeMb * 1024 * 1024) : undefined,
        quality: format === 'gif' ? (t.gifQuality ?? 70) : quality,
        audioPath: format === 'gif' ? null : (audioPath || null),
        fadeInSeconds: format === 'gif' ? 0 : fadeInSeconds,
        fadeOutSeconds: format === 'gif' ? 0 : fadeOutSeconds,
        gifMaxDimension: format === 'gif' ? (t.gifMaxDimension === 'full' ? 'full' : t.gifMaxDimension ?? 720) : undefined,
        gifQuality: format === 'gif' ? (t.gifQuality ?? 70) : undefined,
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
            Add export targets below. Each card has its own resolution, FPS, and quality. Use Copy from previous to duplicate settings.
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

          <div className="export-dialog__row">
            <span>Aspect ratio preview</span>
            <select
              value={previewAspectRatio}
              onChange={(e) => setPreviewAspectRatio(e.target.value as '16:9' | '9:16')}
              style={{ marginBottom: 8 }}
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
            <div
              className={`export-dialog__preview ${firstFrameDataUrl ? 'export-dialog__preview--with-image' : ''}`}
              style={
                firstFrameDataUrl
                  ? { width: previewSize.width, height: previewSize.height, minWidth: previewSize.width, minHeight: previewSize.height }
                  : { aspectRatio: previewAspectRatio.replace(':', '/'), maxWidth: '100%', maxHeight: 120 }
              }
              title={`Preview: ${previewWidth}×${previewHeight} (${previewAspectRatio})`}
            >
              {firstFrameDataUrl ? (
                <img
                  src={firstFrameDataUrl}
                  alt="First frame"
                  className="export-dialog__preview-img export-dialog__preview-img--cover"
                />
              ) : null}
              <span className="export-dialog__preview-label">{previewAspectRatio}</span>
              <span className="export-dialog__preview-size">{previewWidth}×{previewHeight}</span>
            </div>
          </div>

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
              const p = getPresetForTarget(t);
              const durationSec = getDurationSecForTarget(t, frameCount);
              const estimatedMb = getEstimatedFileSizeMbForTarget(t, frameCount);
              const displayFps = t.fpsOverride ?? p.fps;
              const isGif = t.platformId === GIF_PRESET_ID;
              return (
                <div key={i} className="export-dialog__target-card">
                  <div className="export-dialog__target-card-header">
                    <select
                      value={t.platformId}
                      onChange={(e) => updateTarget(i, { platformId: e.target.value })}
                    >
                      {SOCIAL_PRESETS.map((pres) => (
                        <option key={pres.id} value={pres.id}>
                          {pres.name} — {pres.aspectRatio}, {pres.fps} FPS
                          {pres.maxDurationSeconds > 0 ? `, max ${pres.maxDurationSeconds}s` : ''}
                        </option>
                      ))}
                      <option value={GIF_PRESET_ID}>GIF</option>
                      <option value={CUSTOM_PRESET_ID}>Custom…</option>
                    </select>
                    {i > 0 && (
                      <button type="button" className="export-dialog__btn export-dialog__btn--ghost" onClick={() => copyFromPrevious(i)} title="Copy from previous">
                        Copy from previous
                      </button>
                    )}
                    {targets.length > 1 && (
                      <button type="button" className="export-dialog__btn export-dialog__btn--ghost" onClick={() => removeTarget(i)} title="Remove">
                        Remove
                      </button>
                    )}
                  </div>
                  {!isGif && (
                    <label className="export-dialog__row">
                      <span>Video format</span>
                      <select
                        value={t.videoFormat ?? 'mp4'}
                        onChange={(e) => updateTarget(i, { videoFormat: e.target.value as 'mp4' | 'webm' | 'mov' })}
                      >
                        <option value="mp4">MP4 (H.264)</option>
                        <option value="webm">WebM (VP9)</option>
                        <option value="mov">MOV (H.264)</option>
                      </select>
                    </label>
                  )}
                  {isGif && (
                    <>
                      <label className="export-dialog__row">
                        <span>Aspect ratio</span>
                        <select
                          value={t.gifAspectRatio ?? '9:16'}
                          onChange={(e) => updateTarget(i, { gifAspectRatio: e.target.value as '16:9' | '9:16' })}
                        >
                          <option value="9:16">9:16 (portrait)</option>
                          <option value="16:9">16:9 (landscape)</option>
                        </select>
                      </label>
                      <label className="export-dialog__row">
                        <span>Max dimension</span>
                        <select
                          value={t.gifMaxDimension ?? 720}
                          onChange={(e) => updateTarget(i, { gifMaxDimension: (e.target.value === 'full' ? 'full' : parseInt(e.target.value, 10)) as GifMaxDimension })}
                        >
                          <option value={480}>480px</option>
                          <option value={720}>720px</option>
                          <option value={1080}>1080px</option>
                          <option value="full">Full</option>
                        </select>
                      </label>
                      <div className="export-dialog__row">
                        <span>Quality</span>
                        <div className="export-dialog__slider-row">
                          <span className="export-dialog__slider-label">Smaller file</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={t.gifQuality ?? 70}
                            onChange={(e) => updateTarget(i, { gifQuality: parseInt(e.target.value, 10) })}
                            className="export-dialog__slider"
                          />
                          <span className="export-dialog__slider-label">Larger file</span>
                        </div>
                      </div>
                      <label className="export-dialog__row">
                        <span>FPS</span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={displayFps}
                          onChange={(e) => updateTarget(i, { fpsOverride: parseInt(e.target.value, 10) || undefined })}
                        />
                      </label>
                      <div className="export-dialog__row">
                        <span>Max file size</span>
                        <select
                          value={(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb) != null ? String(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb) : 'none'}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateTarget(i, { maxFileSizeMb: v === 'none' ? null : parseFloat(v) });
                          }}
                        >
                          <option value="none">No limit</option>
                          <option value="5">5 MB</option>
                          <option value="9.9">9.9 MB (Discord)</option>
                          <option value="25">25 MB</option>
                          <option value="50">50 MB</option>
                          <option value="100">100 MB</option>
                        </select>
                      </div>
                    </>
                  )}
                  {t.platformId === CUSTOM_PRESET_ID && t.customPreset && (
                    <div className="export-dialog__custom-preset">
                      <label className="export-dialog__row export-dialog__row--small">
                        <span>Width</span>
                        <input
                          type="number"
                          min={1}
                          max={4096}
                          value={t.customPreset.width}
                          onChange={(e) => updateTarget(i, { customPreset: { ...t.customPreset!, width: parseInt(e.target.value, 10) || 1920 } })}
                        />
                      </label>
                      <label className="export-dialog__row export-dialog__row--small">
                        <span>Height</span>
                        <input
                          type="number"
                          min={1}
                          max={4096}
                          value={t.customPreset.height}
                          onChange={(e) => updateTarget(i, { customPreset: { ...t.customPreset!, height: parseInt(e.target.value, 10) || 1080 } })}
                        />
                      </label>
                      <label className="export-dialog__row export-dialog__row--small">
                        <span>FPS</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={t.customPreset.fps}
                          onChange={(e) => updateTarget(i, { customPreset: { ...t.customPreset!, fps: parseInt(e.target.value, 10) || 30 } })}
                        />
                      </label>
                      <label className="export-dialog__row export-dialog__row--small">
                        <span>Max duration (s)</span>
                        <input
                          type="number"
                          min={0}
                          value={t.customPreset.maxDurationSeconds}
                          onChange={(e) => updateTarget(i, { customPreset: { ...t.customPreset!, maxDurationSeconds: Math.max(0, parseInt(e.target.value, 10) || 0) } })}
                        />
                      </label>
                    </div>
                  )}
                  {!isGif && (t.platformId !== CUSTOM_PRESET_ID) && (
                    <label className="export-dialog__row">
                      <span>Output FPS</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={displayFps}
                        onChange={(e) => updateTarget(i, { fpsOverride: parseInt(e.target.value, 10) || undefined })}
                      />
                    </label>
                  )}
                  {!isGif && (
                    <>
                      <label className="export-dialog__row">
                        <span>Target video length (s)</span>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          placeholder="Auto (use FPS or speed to fit)"
                          value={t.targetDurationSeconds != null && t.targetDurationSeconds > 0 ? t.targetDurationSeconds : ''}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            updateTarget(i, { targetDurationSeconds: v === '' ? undefined : Math.max(0, parseFloat(v) || 0) });
                          }}
                        />
                        <span className="export-dialog__hint-inline">0 or empty = use FPS or speed to fit.</span>
                      </label>
                      <label className="export-dialog__row export-dialog__row--check">
                        <input
                          type="checkbox"
                          checked={t.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit}
                          onChange={(e) => updateTarget(i, { speedToFit: e.target.checked })}
                        />
                        <span>Speed up to fit platform max duration</span>
                      </label>
                      <label className="export-dialog__row export-dialog__row--check">
                        <input
                          type="checkbox"
                          checked={t.cropToFit ?? DEFAULT_TARGET_OPTIONS.cropToFit}
                          onChange={(e) => updateTarget(i, { cropToFit: e.target.checked })}
                        />
                        <span>Crop to fit resolution (no squish)</span>
                      </label>
                      <div className="export-dialog__row">
                        <span>Quality</span>
                        <div className="export-dialog__slider-row">
                          <span className="export-dialog__slider-label">Smaller</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={t.quality ?? DEFAULT_TARGET_OPTIONS.quality}
                            onChange={(e) => updateTarget(i, { quality: parseInt(e.target.value, 10) })}
                            className="export-dialog__slider"
                          />
                          <span className="export-dialog__slider-label">Larger</span>
                        </div>
                      </div>
                      <div className="export-dialog__row">
                        <span>Max file size</span>
                        <select
                          value={(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb) != null ? String(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb) : 'none'}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateTarget(i, { maxFileSizeMb: v === 'none' ? null : parseFloat(v) });
                          }}
                        >
                          <option value="none">No limit</option>
                          <option value="5">5 MB</option>
                          <option value="9.9">9.9 MB (Discord)</option>
                          <option value="25">25 MB</option>
                          <option value="50">50 MB</option>
                          <option value="100">100 MB</option>
                        </select>
                      </div>
                    </>
                  )}
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
                        const targetFormat = getFormatForTarget(t);
                        const { path: chosen } = await window.timelapser.showExportSavePicker(t.outputPath || outputPath, targetFormat);
                        if (chosen) updateTarget(i, { outputPath: chosen });
                      }}
                    >
                      Browse…
                    </button>
                  </div>
                  <p className="export-dialog__target-summary">
                    <span title="Preview: length and estimated size depend on FPS, target length, and speed to fit.">
                      Length: ~{frameCount > 0 ? durationSec.toFixed(1) : '—'}s
                      {estimatedMb != null && ` · Est. size: ~${estimatedMb < 1 ? estimatedMb.toFixed(1) : Math.round(estimatedMb)} MB`}
                      {(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb) != null && (t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb)! > 0 && ` (max ${(t.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb)} MB)`}
                    </span>
                  </p>
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
