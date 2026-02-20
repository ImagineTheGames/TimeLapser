import { useState, useEffect } from 'react';
import './ExportDialog.css';

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
  sessionFolder: string;
  onClose: () => void;
}

export default function ExportDialog({ sessionFolder, onClose }: ExportDialogProps) {
  const [platformId, setPlatformId] = useState<string>(SOCIAL_PRESETS[0].id);
  const [speedToFit, setSpeedToFit] = useState(true);
  const [customFps, setCustomFps] = useState(30);
  const [outputPath, setOutputPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  const preset = SOCIAL_PRESETS.find((p) => p.id === platformId) ?? SOCIAL_PRESETS[0];

  useEffect(() => {
    window.timelapser.getDefaultExportPath(sessionFolder).then(setOutputPath);
  }, [sessionFolder]);

  useEffect(() => {
    window.timelapser.getSessionFrameCount(sessionFolder).then(setFrameCount);
  }, [sessionFolder]);

  const effectiveFps = speedToFit && preset.maxDurationSeconds > 0 && frameCount > 0
    ? Math.max(1, frameCount / preset.maxDurationSeconds)
    : (preset.fps || customFps);

  const estimatedDuration = frameCount > 0 ? (frameCount / effectiveFps).toFixed(1) : '—';

  const handleExport = async () => {
    setExporting(true);
    setMessage(null);
    const result = await window.timelapser.exportVideo({
      sessionFolder,
      outputPath,
      platform: platformId,
      maxDurationSeconds: speedToFit ? preset.maxDurationSeconds : 0,
      fps: preset.fps || customFps,
      width: preset.width,
      height: preset.height,
    });
    setExporting(false);
    if (result.ok) {
      setMessage({ type: 'ok', text: `Saved to ${result.path}` });
      window.timelapser.openFolder(sessionFolder);
    } else {
      setMessage({ type: 'err', text: result.message || 'Export failed' });
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

          <label className="export-dialog__row">
            <span>Platform</span>
            <select
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              {SOCIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.aspectRatio}
                  {p.maxDurationSeconds > 0 ? `, max ${p.maxDurationSeconds}s` : ''}
                </option>
              ))}
            </select>
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

          <label className="export-dialog__row">
            <span>Save as</span>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
            />
          </label>

          {message && (
            <p className={`export-dialog__message export-dialog__message--${message.type}`}>
              {message.text}
            </p>
          )}

          <div className="export-dialog__actions">
            <button
              type="button"
              className="export-dialog__btn export-dialog__btn--primary"
              onClick={handleExport}
              disabled={exporting || frameCount === 0}
            >
              {exporting ? 'Exporting…' : 'Export video'}
            </button>
            <button type="button" className="export-dialog__btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
