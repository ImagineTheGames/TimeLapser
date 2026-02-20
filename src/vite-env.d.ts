/// <reference types="vite/client" />

interface TimeLapserAPI {
  getDisplays: () => Promise<{ id: number; index: number; name: string; bounds: { x: number; y: number; width: number; height: number } }[]>;
  getSettings: () => Promise<CaptureSettings>;
  setSettings: (s: Partial<CaptureSettings>) => Promise<CaptureSettings>;
  getState: () => Promise<{ state: string; sessionFolder: string | null; frameCount: number; lastSessionFolder: string | null }>;
  startRecording: (newSession: boolean) => Promise<{ ok: boolean; message?: string; sessionFolder?: string }>;
  pauseRecording: () => Promise<{ ok: boolean }>;
  resumeRecording: () => Promise<{ ok: boolean }>;
  stopRecording: () => Promise<{ ok: boolean; sessionFolder?: string | null; wasRecording?: boolean }>;
  openFolder: (folder: string) => Promise<void>;
  openFocusAssist: () => Promise<void>;
  getSessionFrameCount: (folder: string) => Promise<number>;
  getDefaultExportPath: (folder: string) => Promise<string>;
  exportVideo: (args: ExportVideoArgs) => Promise<{ ok: boolean; path?: string; message?: string }>;
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
}

interface ExportVideoArgs {
  sessionFolder: string;
  outputPath: string;
  platform: string;
  maxDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    timelapser: TimeLapserAPI;
  }
}

export {};
