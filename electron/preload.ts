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
  getDefaultExportPath: (folder: string) => ipcRenderer.invoke('get-default-export-path', folder),
  exportVideo: (args: unknown) => ipcRenderer.invoke('export-video', args),
});
