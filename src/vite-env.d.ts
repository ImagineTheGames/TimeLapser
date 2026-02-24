/// <reference types="vite/client" />

interface TimeLapserAPI {
  getDisplays: () => Promise<{ id: number; index: number; name: string; bounds: { x: number; y: number; width: number; height: number } }[]>;
  getSettings: () => Promise<CaptureSettings>;
  setSettings: (s: Partial<CaptureSettings>) => Promise<CaptureSettings>;
  getState: () => Promise<{ state: string; sessionFolder: string | null; frameCount: number; lastSessionFolder: string | null }>;
  startRecording: (newSession: boolean) => Promise<{ ok: boolean; message?: string; sessionFolder?: string }>;
  pauseRecording: () => Promise<{ ok: boolean }>;
  resumeRecording: () => Promise<{ ok: boolean }>;
  stopRecording: () => Promise<{ ok: boolean; sessionFolder?: string | null; wasRecording?: boolean; frameCount?: number }>;
  openFolder: (folder: string) => Promise<void>;
  openFocusAssist: () => Promise<void>;
  getSessionFrameCount: (folder: string) => Promise<number>;
  getSessionSize: (folder: string) => Promise<{ bytes: number }>;
  getSessionList: () => Promise<{ path: string; name: string }[]>;
  getDefaultExportPath: (folder: string) => Promise<string>;
  getFirstFrameDataUrl: (folder: string) => Promise<{ dataUrl: string | null }>;
  showOutputFolderPicker: () => Promise<{ path: string | null }>;
  showExportSavePicker: (defaultPath: string, format?: string) => Promise<{ path: string | null }>;
  showAudioPicker: () => Promise<{ path: string | null }>;
  exportVideo: (args: ExportVideoArgs) => Promise<{ ok: boolean; path?: string; message?: string }>;
  reportRendererError: (message: string, stack?: string) => void;
  logFromRenderer: (message: string) => void;
  setOverlayExpanded: (expanded: boolean) => Promise<{ panelOnRight: boolean }>;
  setOverlayHeight: (height: number) => void;
  closeOverlay: () => void;
  getOverlayBoundsAndWorkArea: () => Promise<{ bounds: { x: number; y: number; width: number; height: number }; workArea: { x: number; y: number; width: number; height: number }; panelOnRight?: boolean }>;
  startRegionPick: () => Promise<void>;
  onRegionPicked: (callback: (region: { x: number; y: number; width: number; height: number } | null) => void) => () => void;
}

interface CaptureSettings {
  intervalSeconds: number;
  outputFolder: string;
  source: 'monitor' | 'window' | 'region';
  monitorId: number | null;
  region: { x: number; y: number; width: number; height: number } | null;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  jpegQuality: number;
  optimizeFileSize: boolean;
  disableNotifications: boolean;
  /** Overlay window opacity 0.1–1 (10%–100%) */
  overlayOpacity: number;
}

interface ExportVideoArgs {
  sessionFolder: string;
  outputPath: string;
  platform: string;
  format?: 'mp4' | 'webm' | 'mov';
  maxDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
  cropToFit?: boolean;
  /** Cap output file size (e.g. 9.9*1024*1024 for Discord). May skip frames if needed. */
  maxFileSizeBytes?: number;
  /** Quality 0–100 (higher = less compression, larger file). Used when no size cap; affects CRF. */
  quality?: number;
  audioPath?: string | null;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}

declare global {
  interface Window {
    timelapser: TimeLapserAPI;
  }
}

export {};
