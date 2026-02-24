import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('timelapser', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: unknown) => ipcRenderer.invoke('set-settings', s),
  getState: () => ipcRenderer.invoke('get-state'),
  startRecording: (newSession: boolean) => ipcRenderer.invoke('start-recording', newSession),
  pauseRecording: () => ipcRenderer.invoke('pause-recording'),
  resumeRecording: () => ipcRenderer.invoke('resume-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  openFolder: (folder: string) => ipcRenderer.invoke('open-folder', folder),
  openFocusAssist: () => ipcRenderer.invoke('open-focus-assist'),
  getSessionFrameCount: (folder: string) => ipcRenderer.invoke('get-session-frame-count', folder),
  getSessionSize: (folder: string) => ipcRenderer.invoke('get-session-size', folder),
  getSessionList: () => ipcRenderer.invoke('get-session-list'),
  getContinueSessionPath: () => ipcRenderer.invoke('get-continue-session') as Promise<string | null>,
  setContinueSessionPath: (path: string | null) => ipcRenderer.invoke('set-continue-session', path),
  getDefaultExportPath: (folder: string) => ipcRenderer.invoke('get-default-export-path', folder),
  getFirstFrameDataUrl: (folder: string) => ipcRenderer.invoke('get-first-frame-data-url', folder),
  showOutputFolderPicker: () => ipcRenderer.invoke('show-output-folder-picker'),
  showExportSavePicker: (defaultPath: string, format?: string) => ipcRenderer.invoke('show-export-save-picker', defaultPath, format),
  showAudioPicker: () => ipcRenderer.invoke('show-audio-picker'),
  showWatermarkPicker: () => ipcRenderer.invoke('show-watermark-picker'),
  exportVideo: (args: unknown) => ipcRenderer.invoke('export-video', args),
  reportRendererError: (message: string, stack?: string) => ipcRenderer.send('renderer-error', message, stack || ''),
  logFromRenderer: (message: string) => ipcRenderer.send('renderer-log', message),
  setOverlayExpanded: (expanded: boolean) => ipcRenderer.invoke('set-overlay-expanded', expanded) as Promise<{ panelOnRight: boolean }>,
  setOverlayHeight: (height: number) => ipcRenderer.send('set-overlay-height', height),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  getOverlayBoundsAndWorkArea: () => ipcRenderer.invoke('get-overlay-bounds-and-work-area'),
  startRegionPick: () => ipcRenderer.invoke('start-region-pick'),
  onRegionPicked: (callback: (region: { x: number; y: number; width: number; height: number } | null) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, region: { x: number; y: number; width: number; height: number } | null) => callback(region);
    ipcRenderer.on('region-picked', fn);
    return () => ipcRenderer.removeListener('region-picked', fn);
  },
});
