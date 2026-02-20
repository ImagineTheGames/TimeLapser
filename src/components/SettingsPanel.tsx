import { useState, useEffect } from 'react';
import './SettingsPanel.css';

interface Display {
  id: number;
  index: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface SettingsPanelProps {
  onClose: () => void;
  onOpenFocusAssist: () => void;
}

export default function SettingsPanel({ onClose, onOpenFocusAssist }: SettingsPanelProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [settings, setSettings] = useState<Partial<Record<string, unknown>>>({});

  useEffect(() => {
    window.timelapser.getDisplays().then(setDisplays);
    window.timelapser.getSettings().then(setSettings);
  }, []);

  const update = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    window.timelapser.setSettings(next as Parameters<typeof window.timelapser.setSettings>[0]);
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <h2 className="settings-panel__title">Settings</h2>
        <button type="button" className="settings-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="settings-panel__body">
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

        <label className="settings-panel__row">
          <span>Output folder</span>
          <input
            type="text"
            value={String(settings.outputFolder ?? '')}
            onChange={(e) => update('outputFolder', e.target.value)}
            placeholder="C:\Pictures\TimeLapser"
          />
        </label>

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
            <span className="settings-panel__label">Region (x, y, width, height)</span>
            <div className="settings-panel__row settings-panel__row--inline">
              {(['x', 'y', 'width', 'height'] as const).map((key) => {
                const r = (settings.region as { x: number; y: number; width: number; height: number }) || { x: 0, y: 0, width: 800, height: 600 };
                return (
                  <input
                    key={key}
                    type="number"
                    placeholder={key}
                    value={r[key] ?? ''}
                    onChange={(e) => update('region', { ...r, [key]: parseInt(e.target.value, 10) || 0 })}
                  />
                );
              })}
            </div>
            <p className="settings-panel__hint">Capture from primary screen; crop to this rectangle.</p>
          </div>
        )}

        <label className="settings-panel__row">
          <span>Output resolution (width × height)</span>
          <div className="settings-panel__res">
            <input
              type="number"
              min={0}
              placeholder="1920"
              value={Number(settings.width) || ''}
              onChange={(e) => update('width', parseInt(e.target.value, 10) || 0)}
            />
            <span>×</span>
            <input
              type="number"
              min={0}
              placeholder="1080"
              value={Number(settings.height) || ''}
              onChange={(e) => update('height', parseInt(e.target.value, 10) || 0)}
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
          <label className="settings-panel__row">
            <span>JPEG quality (1–100)</span>
            <input
              type="number"
              min={1}
              max={100}
              value={Number(settings.jpegQuality) ?? 85}
              onChange={(e) => update('jpegQuality', Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 85)))}
            />
          </label>
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
