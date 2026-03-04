import { useState, useEffect, useRef, useCallback } from 'react';
import './ExportDialog.css';

const ENCODING_BY_FORMAT: Record<string, string> = { mp4: 'H.264', mov: 'H.264', webm: 'VP9' };

export const CUSTOM_PRESET_ID = 'custom';
export const GIF_PRESET_ID = 'gif';
export const LINKEDIN_GIF_PRESET_ID = 'linkedin_gif';

/** LinkedIn GIF limits: 5 MB max, 500 frames max. */
export const LINKEDIN_GIF_MAX_SIZE_MB = 5;
export const LINKEDIN_GIF_MAX_FRAMES = 500;

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
  { id: 'youtube_standard', name: 'YouTube (16:9)', maxDurationSeconds: 0, width: 1920, height: 1080, aspectRatio: '16:9', fps: 30 },
  { id: 'instagram_reels', name: 'Instagram Reels', maxDurationSeconds: 90, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'instagram_stories', name: 'Instagram Stories', maxDurationSeconds: 60, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
  { id: 'youtube_shorts', name: 'YouTube Shorts', maxDurationSeconds: 60, width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
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
/** Given long-side pixels and aspect, return width x height (for any numeric resolution). */
function gifDimensionsFromLongSide(longSide: number, aspectRatio: '9:16' | '16:9'): { width: number; height: number } {
  if (aspectRatio === '16:9') {
    return { width: longSide, height: Math.max(1, Math.round(longSide * 9 / 16)) };
  }
  return { width: Math.max(1, Math.round(longSide * 9 / 16)), height: longSide };
}
function getGifDimensions(maxDim: GifMaxDimension, aspectRatio: '9:16' | '16:9'): { width: number; height: number } {
  if (maxDim === 'full') {
    const map = aspectRatio === '16:9' ? GIF_DIMENSIONS_16_9 : GIF_DIMENSIONS_9_16;
    return map.full;
  }
  if (typeof maxDim === 'number') {
    return gifDimensionsFromLongSide(maxDim, aspectRatio);
  }
  const map = aspectRatio === '16:9' ? GIF_DIMENSIONS_16_9 : GIF_DIMENSIONS_9_16;
  return map[maxDim ?? 720] ?? map[720];
}

const DEFAULT_CUSTOM_PRESET = { width: 1920, height: 1080, fps: 30, maxDurationSeconds: 0 };

export type FitMode = 'letterbox' | 'crop' | 'stretch';

const DEFAULT_TARGET_OPTIONS = {
  speedToFit: true,
  cropToFit: false,
  fitMode: 'stretch' as FitMode,
  quality: 70,
  maxFileSizeMb: null as number | null,
};

const DEFAULT_EXPORT_PLATFORM_ID = 'youtube_standard';

export type GifMaxDimension = number | 'full';

export interface ExportTarget {
  platformId: string;
  outputPath: string;
  /** Video format for this target when platformId is not GIF. */
  videoFormat?: 'mp4' | 'webm' | 'mov';
  customPreset?: { width: number; height: number; fps: number; maxDurationSeconds: number };
  /** GIF: max/long-side dimension in pixels (e.g. 240–1080) or 'full'. */
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
  /** How to fit source into output: letterbox (pad), crop (cover), stretch (fill). Default stretch. */
  fitMode?: FitMode;
  /** Custom preset only: when true, output size = recording size (no aspect change). */
  matchRecordingSize?: boolean;
  /** When fitMode is crop: position of crop window 0–1 (0=left/top, 0.5=center, 1=right/bottom). Default 0.5. */
  cropOffsetX?: number;
  cropOffsetY?: number;
  quality?: number;
  maxFileSizeMb?: number | null;
  /** Hold last frame: number of additional frames to duplicate at the end. 0 = off. */
  duplicateLastFrameCount?: number;
  /** GIF / LinkedIn: max frames (LinkedIn allows 500). 0 = no limit. */
  gifMaxFrames?: number;
  /** When true, show simple sliders for GIF/LinkedIn GIF (target size, frames, resolution, FPS). */
  gifSimpleSliders?: boolean;
}

/** Crop position preview: full image with draggable export frame (9:16 or 16:9). Used when fitMode is crop. */
function CropPositionPreview({
  firstFrameDataUrl,
  recordingDimensions,
  outWidth,
  outHeight,
  cropOffsetX = 0.5,
  cropOffsetY = 0.5,
  onOffsetChange,
}: {
  firstFrameDataUrl: string;
  recordingDimensions: { width: number; height: number };
  outWidth: number;
  outHeight: number;
  cropOffsetX?: number;
  cropOffsetY?: number;
  onOffsetChange: (cropOffsetX: number, cropOffsetY: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);

  const srcW = recordingDimensions.width;
  const srcH = recordingDimensions.height;
  const scale = Math.max(outWidth / srcW, outHeight / srcH);
  const scaleW = srcW * scale;
  const scaleH = srcH * scale;
  const cropX = (scaleW - outWidth) * cropOffsetX;
  const cropY = (scaleH - outHeight) * cropOffsetY;
  const leftPct = scaleW > 0 ? (cropX / scaleW) * 100 : 0;
  const topPct = scaleH > 0 ? (cropY / scaleH) * 100 : 0;
  const widthPct = scaleW > 0 ? (outWidth / scaleW) * 100 : 100;
  const heightPct = scaleH > 0 ? (outHeight / scaleH) * 100 : 100;

  const maxLeftPct = Math.max(0, 100 - widthPct);
  const maxTopPct = Math.max(0, 100 - heightPct);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      startRef.current = { clientX: e.clientX, clientY: e.clientY, offsetX: cropOffsetX, offsetY: cropOffsetY };
    },
    [cropOffsetX, cropOffsetY]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      const el = containerRef.current;
      if (!start || !el) return;
      const rect = el.getBoundingClientRect();
      const deltaPctX = ((e.clientX - start.clientX) / rect.width) * 100;
      const deltaPctY = ((e.clientY - start.clientY) / rect.height) * 100;
      let newLeftPct = (start.offsetX * maxLeftPct) + deltaPctX;
      let newTopPct = (start.offsetY * maxTopPct) + deltaPctY;
      newLeftPct = Math.max(0, Math.min(maxLeftPct, newLeftPct));
      newTopPct = Math.max(0, Math.min(maxTopPct, newTopPct));
      const newOffsetX = maxLeftPct > 0 ? newLeftPct / maxLeftPct : 0.5;
      const newOffsetY = maxTopPct > 0 ? newTopPct / maxTopPct : 0.5;
      onOffsetChange(newOffsetX, newOffsetY);
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, maxLeftPct, maxTopPct, onOffsetChange]);

  return (
    <div className="export-dialog__crop-position">
      <p className="export-dialog__fit-mode-label">Drag the frame to choose which part is exported.</p>
      <div
        ref={containerRef}
        className="export-dialog__crop-position-preview"
        style={{ aspectRatio: `${srcW} / ${srcH}` }}
      >
        <img
          src={firstFrameDataUrl}
          alt="Recording"
          className="export-dialog__crop-position-img"
          style={{ objectFit: 'contain' }}
        />
        <div
          role="presentation"
          className="export-dialog__crop-position-frame"
          style={{
            left: `${leftPct}%`,
            top: `${topPct}%`,
            width: `${widthPct}%`,
            height: `${heightPct}%`,
            cursor: dragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleMouseDown}
        />
      </div>
    </div>
  );
}

function getPresetForTarget(t: ExportTarget, recordingDimensions?: { width: number; height: number } | null): Preset {
  if (t.platformId === CUSTOM_PRESET_ID && t.customPreset) {
    const useRecording = t.matchRecordingSize && recordingDimensions && recordingDimensions.width > 0 && recordingDimensions.height > 0;
    const width = useRecording ? recordingDimensions.width : t.customPreset.width;
    const height = useRecording ? recordingDimensions.height : t.customPreset.height;
    const fps = t.customPreset.fps;
    const maxDurationSeconds = t.customPreset.maxDurationSeconds;
    const ratio = width / height;
    const aspectRatio = Math.abs(ratio - 21 / 9) < 0.01 ? (width >= height ? '21:9' : '9:21')
      : Math.abs(ratio - 16 / 9) < 0.01 ? (width >= height ? '16:9' : '9:16')
      : `${width}:${height}`;
    return { id: CUSTOM_PRESET_ID, name: 'Custom', maxDurationSeconds, width, height, aspectRatio, fps };
  }
  if (t.platformId === GIF_PRESET_ID) {
    const aspect = t.gifAspectRatio ?? '9:16';
    const dim = getGifDimensions(t.gifMaxDimension ?? 720, aspect);
    return { id: GIF_PRESET_ID, name: 'GIF', maxDurationSeconds: 0, width: dim.width, height: dim.height, aspectRatio: aspect, fps: 10 };
  }
  if (t.platformId === LINKEDIN_GIF_PRESET_ID) {
    const aspect = t.gifAspectRatio ?? '16:9';
    const dim = getGifDimensions(t.gifMaxDimension ?? 1080, aspect);
    return { id: LINKEDIN_GIF_PRESET_ID, name: 'LinkedIn (GIF)', maxDurationSeconds: 0, width: dim.width, height: dim.height, aspectRatio: aspect, fps: 10 };
  }
  return SOCIAL_PRESETS.find((p) => p.id === t.platformId) ?? SOCIAL_PRESETS[0];
}

function getFormatForTarget(t: ExportTarget): 'mp4' | 'webm' | 'mov' | 'gif' {
  return (t.platformId === GIF_PRESET_ID || t.platformId === LINKEDIN_GIF_PRESET_ID) ? 'gif' : (t.videoFormat ?? 'mp4');
}

function getEffectiveFpsForTarget(t: ExportTarget, frameCount: number, recordingDimensions?: { width: number; height: number } | null): number {
  if (frameCount <= 0) return 30;
  if (t.targetDurationSeconds != null && t.targetDurationSeconds > 0) {
    return Math.max(1, frameCount / t.targetDurationSeconds);
  }
  const preset = getPresetForTarget(t, recordingDimensions);
  const speedToFit = t.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit;
  if (speedToFit && preset.maxDurationSeconds > 0) {
    return Math.max(1, frameCount / preset.maxDurationSeconds);
  }
  return t.fpsOverride ?? preset.fps;
}

function getDurationSecForTarget(t: ExportTarget, frameCount: number, recordingDimensions?: { width: number; height: number } | null): number {
  if (frameCount <= 0) return 0;
  if (getFormatForTarget(t) === 'gif') {
    const out = computeGifOutput(t, frameCount, recordingDimensions);
    return out ? out.durationSec : 0;
  }
  return frameCount / getEffectiveFpsForTarget(t, frameCount, recordingDimensions);
}

function getEstimatedFileSizeMbForTarget(t: ExportTarget, frameCount: number, recordingDimensions?: { width: number; height: number } | null): number | null {
  if (frameCount <= 0) return null;
  const format = getFormatForTarget(t);
  if (format === 'gif') {
    const out = computeGifOutput(t, frameCount, recordingDimensions);
    return out ? out.estimatedSizeMb : null;
  }
  const durationSec = getDurationSecForTarget(t, frameCount, recordingDimensions);
  const preset = getPresetForTarget(t, recordingDimensions);
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

/** Mirrors backend GIF logic so we can show accurate live preview (frames, FPS, resolution, duration, size). */
export function computeGifOutput(
  t: ExportTarget,
  frameCount: number,
  recordingDimensions?: { width: number; height: number } | null
): { numFrames: number; outFps: number; outW: number; outH: number; durationSec: number; estimatedSizeBytes: number; estimatedSizeMb: number } | null {
  if (frameCount <= 0) return null;
  const preset = getPresetForTarget(t, recordingDimensions);
  let gifWidth = preset.width;
  let gifHeight = preset.height;
  const gifQuality = t.gifQuality ?? 70;
  const fps = t.fpsOverride ?? preset.fps;
  const maxFileSizeBytes = (t.maxFileSizeMb != null && t.maxFileSizeMb > 0) ? Math.round(t.maxFileSizeMb * 1024 * 1024) : null;
  const gifMaxFrames = t.gifMaxFrames ?? 0;

  const scaleFactor = Math.max(0.2, Math.min(1, 0.2 + 0.8 * (gifQuality / 100)));
  let outW = Math.max(1, Math.round(gifWidth * scaleFactor));
  let outH = Math.max(1, Math.round(gifHeight * scaleFactor));
  const bytesPerPixelPerFrame = gifMaxFrames > 0 ? 0.4 : 1.2;
  const minAnimatedFrames = 2;

  let frameStep = 1;
  if (gifMaxFrames > 0 && frameCount > gifMaxFrames) {
    frameStep = Math.max(1, Math.ceil(frameCount / gifMaxFrames));
  }
  // When gifMaxFrames is set: keep that frame count and scale resolution to fit. When 0: derive frame count from file size.
  if (maxFileSizeBytes && maxFileSizeBytes > 0 && gifMaxFrames <= 0) {
    const targetBytes = maxFileSizeBytes * 0.9;
    const currentPixels = outW * outH;
    let maxNumFramesFromSize = currentPixels > 0
      ? Math.floor(targetBytes / (currentPixels * bytesPerPixelPerFrame))
      : frameCount;
    if (frameCount >= minAnimatedFrames && maxNumFramesFromSize < minAnimatedFrames) maxNumFramesFromSize = minAnimatedFrames;
    maxNumFramesFromSize = Math.max(1, maxNumFramesFromSize);
    const neededFrameStep = Math.ceil(frameCount / maxNumFramesFromSize);
    if (neededFrameStep > frameStep) frameStep = neededFrameStep;
  }
  const numFrames = frameStep > 1 ? Math.ceil(frameCount / frameStep) : frameCount;
  if (maxFileSizeBytes && maxFileSizeBytes > 0 && numFrames > 0) {
    const targetBytes = maxFileSizeBytes * 0.9;
    const targetPixels = targetBytes / (numFrames * bytesPerPixelPerFrame);
    const currentPixels = outW * outH;
    if (currentPixels > 0 && currentPixels > targetPixels) {
      const sizeScale = Math.max(0.1, Math.min(1, Math.sqrt(targetPixels / currentPixels)));
      outW = Math.max(1, Math.round(outW * sizeScale));
      outH = Math.max(1, Math.round(outH * sizeScale));
    }
  }
  // Resolution floor: never smaller than user's chosen max dimension (matches backend)
  const maxDim = t.gifMaxDimension;
  if (maxDim && typeof maxDim === 'number') {
    const longSide = Math.max(outW, outH);
    if (longSide < maxDim) {
      const scaleUp = maxDim / longSide;
      outW = Math.max(1, Math.round(outW * scaleUp));
      outH = Math.max(1, Math.round(outH * scaleUp));
    }
  }
  const estimatedSizeBytes = numFrames * outW * outH * bytesPerPixelPerFrame;
  const estimatedSizeMb = estimatedSizeBytes / (1024 * 1024);
  const durationSec = numFrames / fps;
  return { numFrames, outFps: fps, outW, outH, durationSec, estimatedSizeBytes, estimatedSizeMb };
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
  const [watermarkPath, setWatermarkPath] = useState<string | null>(null);
  const [watermarkPosition, setWatermarkPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'>('bottom-right');
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [firstFrameDataUrl, setFirstFrameDataUrl] = useState<string | null>(null);
  const [recordingDimensions, setRecordingDimensions] = useState<{ width: number; height: number } | null>(null);
  const [targets, setTargets] = useState<ExportTarget[]>([
    {
      platformId: DEFAULT_EXPORT_PLATFORM_ID,
      outputPath: '',
      videoFormat: 'mp4',
      ...DEFAULT_TARGET_OPTIONS,
    },
  ]);

  useEffect(() => {
    window.timelapser.getSettings().then((s) => {
      const savedId = s.lastExportPlatformId ?? DEFAULT_EXPORT_PLATFORM_ID;
      const platformId = SOCIAL_PRESETS.some((p) => p.id === savedId) || savedId === CUSTOM_PRESET_ID || savedId === GIF_PRESET_ID || savedId === LINKEDIN_GIF_PRESET_ID ? savedId : DEFAULT_EXPORT_PLATFORM_ID;
      const fitMode = s.lastExportFitMode ?? (s.lastExportCropToFit === true ? 'crop' as const : s.lastExportCropToFit === false ? 'letterbox' as const : DEFAULT_TARGET_OPTIONS.fitMode);
      setTargets((prev) => {
        if (prev.length === 0) return prev;
        return [{ ...prev[0], platformId, fitMode, cropToFit: fitMode === 'crop' }, ...prev.slice(1)];
      });
    });
  }, []);

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
    const newFormat = (newPlatformId === GIF_PRESET_ID || newPlatformId === LINKEDIN_GIF_PRESET_ID) ? 'gif' : (last?.videoFormat ?? 'mp4');
    const existingPaths = targets.map((t) => t.outputPath).filter(Boolean) as string[];
    const newPath = getNextUniquePath(last?.outputPath || outputPath || 'export.mp4', existingPaths, newFormat);
    const newTarget: ExportTarget = {
      platformId: newPlatformId,
      outputPath: newPath,
      videoFormat: (newPlatformId === GIF_PRESET_ID || newPlatformId === LINKEDIN_GIF_PRESET_ID) ? undefined : (last?.videoFormat ?? 'mp4'),
      ...(newPlatformId === GIF_PRESET_ID ? { gifMaxDimension: last?.gifMaxDimension ?? 720, gifAspectRatio: last?.gifAspectRatio ?? '9:16', gifQuality: last?.gifQuality ?? 70 } : {}),
      ...(newPlatformId === LINKEDIN_GIF_PRESET_ID ? { gifMaxDimension: last?.gifMaxDimension ?? 1080, gifAspectRatio: last?.gifAspectRatio ?? '16:9', gifQuality: last?.gifQuality ?? 70, gifMaxFrames: last?.gifMaxFrames ?? LINKEDIN_GIF_MAX_FRAMES, maxFileSizeMb: last?.maxFileSizeMb ?? LINKEDIN_GIF_MAX_SIZE_MB } : {}),
      ...(newPlatformId === CUSTOM_PRESET_ID && last?.customPreset ? { customPreset: { ...last.customPreset } } : {}),
      fpsOverride: last?.fpsOverride,
      targetDurationSeconds: last?.targetDurationSeconds ?? undefined,
      speedToFit: last?.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit,
      fitMode: last?.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode,
      cropToFit: (last?.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode) === 'crop',
      matchRecordingSize: last?.matchRecordingSize ?? false,
      cropOffsetX: last?.cropOffsetX,
      cropOffsetY: last?.cropOffsetY,
      quality: last?.quality ?? DEFAULT_TARGET_OPTIONS.quality,
      maxFileSizeMb: last?.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb,
      duplicateLastFrameCount: last?.duplicateLastFrameCount ?? 0,
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
        gifMaxFrames: prev.gifMaxFrames,
        gifSimpleSliders: prev.gifSimpleSliders,
        customPreset: prev.customPreset ? { ...prev.customPreset } : undefined,
        fpsOverride: prev.fpsOverride,
        targetDurationSeconds: prev.targetDurationSeconds ?? undefined,
        speedToFit: prev.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit,
        fitMode: prev.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode,
        cropToFit: (prev.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode) === 'crop',
        matchRecordingSize: prev.matchRecordingSize ?? false,
        cropOffsetX: prev.cropOffsetX,
        cropOffsetY: prev.cropOffsetY,
        quality: prev.quality ?? DEFAULT_TARGET_OPTIONS.quality,
        maxFileSizeMb: prev.maxFileSizeMb ?? DEFAULT_TARGET_OPTIONS.maxFileSizeMb,
        duplicateLastFrameCount: prev.duplicateLastFrameCount ?? 0,
        outputPath: newPath,
      };
    }));
  };

  const removeTarget = (i: number) => {
    if (targets.length <= 1) return;
    setTargets(targets.filter((_, idx) => idx !== i));
  };
  const updateTarget = (i: number, upd: Partial<ExportTarget>) => {
    if (i === 0 && (upd.platformId != null || upd.fitMode !== undefined || upd.cropToFit !== undefined)) {
      const nextPlatform = upd.platformId ?? targets[0].platformId;
      const nextFitMode = upd.fitMode ?? (upd.cropToFit === true ? 'crop' : upd.cropToFit === false ? 'letterbox' : (targets[0].fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode));
      window.timelapser.setSettings({ lastExportPlatformId: nextPlatform, lastExportFitMode: nextFitMode, lastExportCropToFit: nextFitMode === 'crop' });
    }
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
        next.gifMaxFrames = undefined;
        next.outputPath = basePath + '.gif';
      } else if (upd.platformId === LINKEDIN_GIF_PRESET_ID) {
        next.videoFormat = undefined;
        if (next.gifMaxDimension == null) next.gifMaxDimension = 1080;
        if (next.gifAspectRatio == null) next.gifAspectRatio = '16:9';
        if (next.gifQuality == null) next.gifQuality = 70;
        if (next.gifMaxFrames == null) next.gifMaxFrames = LINKEDIN_GIF_MAX_FRAMES;
        if (next.maxFileSizeMb == null) next.maxFileSizeMb = LINKEDIN_GIF_MAX_SIZE_MB;
        next.outputPath = basePath + '.gif';
      } else if (upd.platformId != null && (t.platformId === GIF_PRESET_ID || t.platformId === LINKEDIN_GIF_PRESET_ID)) {
        next.gifMaxDimension = undefined;
        next.gifAspectRatio = undefined;
        next.gifQuality = undefined;
        next.gifMaxFrames = undefined;
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
    window.timelapser.getFirstFrameDataUrl(selectedSessionFolder).then(({ dataUrl, width, height }) => {
      setFirstFrameDataUrl(dataUrl);
      setRecordingDimensions(width != null && height != null ? { width, height } : null);
    });
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
      const p = getPresetForTarget(t, recordingDimensions);
      const effFps = getEffectiveFpsForTarget(t, frameCount, recordingDimensions);
      const speedToFit = t.speedToFit ?? DEFAULT_TARGET_OPTIONS.speedToFit;
      const fitMode = t.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode;
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
        fitMode,
        cropToFit: fitMode === 'crop',
        cropOffsetX: t.cropOffsetX ?? 0.5,
        cropOffsetY: t.cropOffsetY ?? 0.5,
        maxFileSizeBytes: maxFileSizeMb != null && maxFileSizeMb > 0 ? Math.round(maxFileSizeMb * 1024 * 1024) : undefined,
        quality: format === 'gif' ? (t.gifQuality ?? 70) : quality,
        audioPath: format === 'gif' ? null : (audioPath || null),
        fadeInSeconds: format === 'gif' ? 0 : fadeInSeconds,
        fadeOutSeconds: format === 'gif' ? 0 : fadeOutSeconds,
        gifMaxDimension: format === 'gif' ? (t.gifMaxDimension === 'full' ? 'full' : t.gifMaxDimension ?? 720) : undefined,
        gifQuality: format === 'gif' ? (t.gifQuality ?? 70) : undefined,
        gifMaxFrames: format === 'gif' ? (t.gifMaxFrames ?? 0) : undefined,
        duplicateLastFrameCount: t.duplicateLastFrameCount ?? 0,
        watermarkPath: watermarkPath || null,
        watermarkPosition,
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

          <div className="export-dialog__row">
            <span>Watermark</span>
            <div className="export-dialog__music-row">
              <button type="button" className="export-dialog__btn export-dialog__btn--secondary" onClick={async () => { const { path: p } = await window.timelapser.showWatermarkPicker(); if (p) setWatermarkPath(p); }}>
                {watermarkPath ? 'Change watermark…' : 'Select watermark image…'}
              </button>
              {watermarkPath && (
                <>
                  <span className="export-dialog__music-name" title={watermarkPath}>
                    {watermarkPath.split(/[/\\]/).pop()}
                  </span>
                  <select
                    value={watermarkPosition}
                    onChange={(e) => setWatermarkPosition(e.target.value as typeof watermarkPosition)}
                    className="export-dialog__select-inline"
                    style={{ marginLeft: 8 }}
                  >
                    <option value="top-left">Top left</option>
                    <option value="top-right">Top right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                    <option value="center">Center</option>
                  </select>
                  <button type="button" className="export-dialog__btn export-dialog__btn--ghost" onClick={() => setWatermarkPath(null)}>
                    Remove
                  </button>
                </>
              )}
            </div>
            <p className="export-dialog__hint">Optional image overlaid on the export. Choose position when image is selected.</p>
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
              const p = getPresetForTarget(t, recordingDimensions);
              const durationSec = getDurationSecForTarget(t, frameCount, recordingDimensions);
              const estimatedMb = getEstimatedFileSizeMbForTarget(t, frameCount, recordingDimensions);
              const displayFps = t.fpsOverride ?? p.fps;
              const isGif = t.platformId === GIF_PRESET_ID;
              const isLinkedInGif = t.platformId === LINKEDIN_GIF_PRESET_ID;
              const isGifOrLinkedInGif = isGif || isLinkedInGif;
              const fitMode = t.fitMode ?? DEFAULT_TARGET_OPTIONS.fitMode;
              const previewObjectFit = fitMode === 'crop' ? 'cover' : fitMode === 'stretch' ? 'fill' : 'contain';
              const previewTitle = fitMode === 'crop' ? 'Crop to fit' : fitMode === 'stretch' ? 'Stretch' : 'Letterbox';
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
                      <option value={LINKEDIN_GIF_PRESET_ID}>LinkedIn (GIF) — max 5 MB, 500 frames</option>
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
                  <div
                    className={`export-dialog__preview export-dialog__target-preview ${firstFrameDataUrl ? 'export-dialog__preview--with-image' : ''}`}
                    style={{ aspectRatio: p.aspectRatio.replace(':', '/'), maxWidth: '100%', maxHeight: 140, minHeight: 80 }}
                    title={`Preview: ${previewTitle} · ${p.aspectRatio}`}
                  >
                    {firstFrameDataUrl ? (
                      <img
                        src={firstFrameDataUrl}
                        alt="Export preview"
                        className="export-dialog__preview-img"
                        style={{ objectFit: previewObjectFit }}
                      />
                    ) : null}
                    <span className="export-dialog__preview-label">{p.aspectRatio}</span>
                    <span className="export-dialog__preview-size">{p.width}×{p.height}</span>
                  </div>
                  <div className="export-dialog__fit-mode export-dialog__row">
                    <span className="export-dialog__fit-mode-label">Fit image</span>
                    <div className="export-dialog__fit-mode-options" role="group" aria-label="Fit image">
                      {(['letterbox', 'crop', 'stretch'] as const).map((mode) => (
                        <label key={mode} className="export-dialog__fit-mode-option">
                          <input
                            type="radio"
                            name={`fit-${i}`}
                            checked={fitMode === mode}
                            onChange={() => updateTarget(i, { fitMode: mode, cropToFit: mode === 'crop' })}
                          />
                          <span>{mode === 'letterbox' ? 'Letterbox' : mode === 'crop' ? 'Crop to fit' : 'Stretch'}</span>
                        </label>
                      ))}
                    </div>
                    <p className="export-dialog__hint export-dialog__hint-inline">Letterbox = pad to fit. Crop = fill and trim. Stretch = fill exact size (may distort).</p>
                  </div>
                  {fitMode === 'crop' && (p.aspectRatio === '9:16' || p.aspectRatio === '16:9') && firstFrameDataUrl && recordingDimensions && recordingDimensions.width > 0 && recordingDimensions.height > 0 && (
                    <CropPositionPreview
                      firstFrameDataUrl={firstFrameDataUrl}
                      recordingDimensions={recordingDimensions}
                      outWidth={p.width}
                      outHeight={p.height}
                      cropOffsetX={t.cropOffsetX ?? 0.5}
                      cropOffsetY={t.cropOffsetY ?? 0.5}
                      onOffsetChange={(cropOffsetX, cropOffsetY) => updateTarget(i, { cropOffsetX, cropOffsetY })}
                    />
                  )}
                  {!isGifOrLinkedInGif && (
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
                  {isGifOrLinkedInGif && (() => {
                    const gifOut = computeGifOutput(t, frameCount, recordingDimensions);
                    const simpleSliders = t.gifSimpleSliders ?? false;
                    const maxSizeSliderMax = isLinkedInGif ? 5 : 25;
                    const maxFramesSliderMax = isLinkedInGif ? 500 : 1000;
                    const resSliderMin = 240;
                    const resSliderMax = 1080;
                    const resSliderStep = 30;
                    const resNum = typeof t.gifMaxDimension === 'number' ? Math.min(resSliderMax, Math.max(resSliderMin, t.gifMaxDimension)) : resSliderMax;
                    return (
                    <>
                      {isLinkedInGif && !simpleSliders && (
                        <p className="export-dialog__hint" style={{ marginBottom: 6 }}>LinkedIn: max 5 MB, 500 frames. Settings below are limited accordingly.</p>
                      )}
                      <label className="export-dialog__row export-dialog__row--check">
                        <input
                          type="checkbox"
                          checked={simpleSliders}
                          onChange={(e) => updateTarget(i, { gifSimpleSliders: e.target.checked })}
                        />
                        <span>Use simple sliders (target size, frames, resolution, FPS)</span>
                      </label>
                      {simpleSliders ? (
                        <div className="export-dialog__gif-simple">
                          <label className="export-dialog__row">
                            <span>Aspect ratio</span>
                            <select
                              value={t.gifAspectRatio ?? (isLinkedInGif ? '16:9' : '9:16')}
                              onChange={(e) => updateTarget(i, { gifAspectRatio: e.target.value as '16:9' | '9:16' })}
                            >
                              <option value="9:16">9:16 (portrait)</option>
                              <option value="16:9">16:9 (landscape)</option>
                            </select>
                          </label>
                          <div className="export-dialog__row">
                            <span>Target file size (MB)</span>
                            <div className="export-dialog__slider-row">
                              <input
                                type="range"
                                min={0.5}
                                max={maxSizeSliderMax}
                                step={0.5}
                                value={t.maxFileSizeMb != null && t.maxFileSizeMb > 0 ? Math.min(maxSizeSliderMax, t.maxFileSizeMb) : maxSizeSliderMax}
                                onChange={(e) => updateTarget(i, { maxFileSizeMb: parseFloat(e.target.value) })}
                                className="export-dialog__slider"
                              />
                              <span className="export-dialog__slider-value">
                                {t.maxFileSizeMb != null && t.maxFileSizeMb > 0 ? `${t.maxFileSizeMb} MB` : 'No limit'}
                              </span>
                            </div>
                            {!isLinkedInGif && (
                              <label className="export-dialog__row--check" style={{ marginTop: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={t.maxFileSizeMb == null || t.maxFileSizeMb <= 0}
                                  onChange={(e) => updateTarget(i, { maxFileSizeMb: e.target.checked ? null : 5 })}
                                />
                                <span>No limit</span>
                              </label>
                            )}
                          </div>
                          <div className="export-dialog__row">
                            <span>Number of frames</span>
                            <div className="export-dialog__slider-row">
                              <input
                                type="range"
                                min={10}
                                max={maxFramesSliderMax}
                                step={10}
                                value={Math.min(maxFramesSliderMax, (t.gifMaxFrames ?? 0) || 300)}
                                onChange={(e) => updateTarget(i, { gifMaxFrames: parseInt(e.target.value, 10) })}
                                className="export-dialog__slider"
                              />
                              <span className="export-dialog__slider-value">{(t.gifMaxFrames ?? 0) === 0 ? 'No limit' : (t.gifMaxFrames ?? 300)}</span>
                            </div>
                            {!isLinkedInGif && (
                              <label className="export-dialog__row--check" style={{ marginTop: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={(t.gifMaxFrames ?? 0) === 0}
                                  onChange={(e) => updateTarget(i, { gifMaxFrames: e.target.checked ? 0 : 300 })}
                                />
                                <span>No limit</span>
                              </label>
                            )}
                          </div>
                          <div className="export-dialog__row">
                            <span>Resolution (min. long side)</span>
                            <div className="export-dialog__slider-row">
                              <input
                                type="range"
                                min={resSliderMin}
                                max={resSliderMax}
                                step={resSliderStep}
                                value={resNum}
                                disabled={t.gifMaxDimension === 'full'}
                                onChange={(e) => updateTarget(i, { gifMaxDimension: parseInt(e.target.value, 10) })}
                                className="export-dialog__slider"
                              />
                              <span className="export-dialog__slider-value">
                                {t.gifMaxDimension === 'full' ? 'Full' : `${resNum}px`}
                              </span>
                            </div>
                            <label className="export-dialog__row--check" style={{ marginTop: 4 }}>
                              <input
                                type="checkbox"
                                checked={t.gifMaxDimension === 'full'}
                                onChange={(e) => updateTarget(i, { gifMaxDimension: e.target.checked ? 'full' : resNum })}
                              />
                              <span>Full resolution (no cap)</span>
                            </label>
                          </div>
                          <div className="export-dialog__row">
                            <span>FPS</span>
                            <div className="export-dialog__slider-row">
                              <input
                                type="range"
                                min={5}
                                max={15}
                                step={1}
                                value={displayFps}
                                onChange={(e) => updateTarget(i, { fpsOverride: parseInt(e.target.value, 10) })}
                                className="export-dialog__slider"
                              />
                              <span className="export-dialog__slider-value">{displayFps}</span>
                            </div>
                          </div>
                          <div className="export-dialog__row">
                            <span>Quality</span>
                            <div className="export-dialog__slider-row">
                              <span className="export-dialog__slider-label">Smaller</span>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={t.gifQuality ?? 70}
                                onChange={(e) => updateTarget(i, { gifQuality: parseInt(e.target.value, 10) })}
                                className="export-dialog__slider"
                              />
                              <span className="export-dialog__slider-label">Larger</span>
                            </div>
                          </div>
                        </div>
                      ) : (
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
                              value={t.gifMaxDimension === 'full' ? 'full' : (typeof t.gifMaxDimension === 'number' && [480, 720, 1080].includes(t.gifMaxDimension) ? t.gifMaxDimension : (isLinkedInGif ? 1080 : 720))}
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
                              value={(t.maxFileSizeMb ?? (isLinkedInGif ? LINKEDIN_GIF_MAX_SIZE_MB : DEFAULT_TARGET_OPTIONS.maxFileSizeMb)) != null ? String(t.maxFileSizeMb ?? (isLinkedInGif ? LINKEDIN_GIF_MAX_SIZE_MB : DEFAULT_TARGET_OPTIONS.maxFileSizeMb)) : 'none'}
                              onChange={(e) => {
                                const v = e.target.value;
                                updateTarget(i, { maxFileSizeMb: v === 'none' ? null : parseFloat(v) });
                              }}
                            >
                              <option value="none">No limit</option>
                              <option value="5">5 MB (LinkedIn max)</option>
                              <option value="9.9">9.9 MB (Discord)</option>
                              <option value="25">25 MB</option>
                              <option value="50">50 MB</option>
                              <option value="100">100 MB</option>
                            </select>
                          </div>
                          {isLinkedInGif && (
                            <label className="export-dialog__row">
                              <span>Max frames</span>
                              <input
                                type="number"
                                min={1}
                                max={500}
                                value={t.gifMaxFrames ?? LINKEDIN_GIF_MAX_FRAMES}
                                onChange={(e) => updateTarget(i, { gifMaxFrames: Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 500)) })}
                              />
                              <span className="export-dialog__hint-inline">LinkedIn allows up to 500 frames.</span>
                            </label>
                          )}
                        </>
                      )}
                      {gifOut && (
                        <div className="export-dialog__gif-result">
                          <p className="export-dialog__gif-result-title">Result preview</p>
                          <ul className="export-dialog__gif-result-list">
                            <li>Output frames: <strong>{gifOut.numFrames.toLocaleString()}</strong></li>
                            <li>Output FPS: <strong>{gifOut.outFps}</strong></li>
                            <li>Resolution: <strong>{gifOut.outW}×{gifOut.outH}</strong></li>
                            <li>Duration: <strong>~{gifOut.durationSec.toFixed(1)}s</strong></li>
                            <li>Est. file size: <strong>~{gifOut.estimatedSizeMb < 1 ? gifOut.estimatedSizeMb.toFixed(2) : gifOut.estimatedSizeMb.toFixed(1)} MB</strong></li>
                          </ul>
                          {isLinkedInGif && gifOut.estimatedSizeMb > LINKEDIN_GIF_MAX_SIZE_MB && (
                            <p className="export-dialog__hint export-dialog__gif-result-warn">Over 5 MB – reduce resolution or frames to stay under LinkedIn limit.</p>
                          )}
                        </div>
                      )}
                      <p className="export-dialog__hint">Lower resolution → smaller file or more frames. Fewer frames → smaller file, shorter clip. Higher FPS → longer duration, often larger file.</p>
                    </>
                    );
                  })()}
                  {t.platformId === CUSTOM_PRESET_ID && t.customPreset && (
                    <div className="export-dialog__custom-preset">
                      <label className="export-dialog__row export-dialog__row--check">
                        <input
                          type="checkbox"
                          checked={t.matchRecordingSize ?? false}
                          onChange={(e) => updateTarget(i, { matchRecordingSize: e.target.checked })}
                        />
                        <span>Match recording size (output same resolution as recording)</span>
                      </label>
                      {recordingDimensions && (t.matchRecordingSize ?? false) ? (
                        <p className="export-dialog__hint">Output: {recordingDimensions.width}×{recordingDimensions.height} (same as recording)</p>
                      ) : null}
                      {!(t.matchRecordingSize ?? false) && (
                        <>
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
                        </>
                      )}
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
                  {!isGifOrLinkedInGif && (t.platformId !== CUSTOM_PRESET_ID) && (
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
                  {!isGifOrLinkedInGif && (
                    <>
                      <label className="export-dialog__row">
                        <span>Target video length (s)</span>
                        <span className="export-dialog__hint">How long your timelapse will be.</span>
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
                  <label className="export-dialog__row">
                    <span>Hold last frame (extra frames)</span>
                    <input
                      type="number"
                      min={0}
                      max={3000}
                      value={t.duplicateLastFrameCount ?? 0}
                      onChange={(e) => updateTarget(i, { duplicateLastFrameCount: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    />
                    <span className="export-dialog__hint-inline">0 = off. Adds this many copies of the last frame at the end.</span>
                  </label>
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
