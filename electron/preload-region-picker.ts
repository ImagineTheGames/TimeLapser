import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('regionPicker', {
  sendRegion: (x: number, y: number, width: number, height: number) =>
    ipcRenderer.send('region-pick-done', { x, y, width, height }),
  cancel: () => ipcRenderer.send('region-pick-cancel'),
});
