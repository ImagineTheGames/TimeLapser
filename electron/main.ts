import { app, BrowserWindow, ipcMain, screen, shell, Tray, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

const store = new Store<Record<string, unknown>>();

type CaptureSource = 'monitor' | 'window' | 'region';
type CaptureState = 'idle' | 'recording' | 'paused';

interface CaptureSettings {
  intervalSeconds: number;
  outputFolder: string;
  source: CaptureSource;
  monitorId: number | null;
  region: { x: number; y: number; width: number; height: number } | null;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  jpegQuality: number;
  optimizeFileSize: boolean;
  disableNotifications: boolean;
}

const defaultSettings: CaptureSettings = {
  intervalSeconds: 5,
  outputFolder: path.join(app.getPath('pictures'), 'TimeLapser'),
  source: 'monitor',
  monitorId: 0,
  region: null,
  width: 1920,
  height: 1080,
  format: 'jpeg',
  jpegQuality: 85,
  optimizeFileSize: true,
  disableNotifications: false,
};

let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let captureTimer: ReturnType<typeof setInterval> | null = null;
let captureState: CaptureState = 'idle';
let currentSessionFolder: string | null = null;
let lastSessionFolder: string | null = null;
let frameIndex = 0;
let settings: CaptureSettings = { ...defaultSettings };

function getSettings(): CaptureSettings {
  const saved = store.get('captureSettings') as Partial<CaptureSettings> | undefined;
  return { ...defaultSettings, ...saved };
}

function saveSettings(s: CaptureSettings) {
  settings = s;
  store.set('captureSettings', s);
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 56,
    x: Math.max(0, width - 440),
    y: Math.max(0, height - 80),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setVisibleOnAllWorkspaces(true);
  if (process.env.NODE_ENV !== 'production') {
    overlayWindow.loadURL('http://localhost:5173');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function createWindow() {
  ensureOverlayWindow();
  tray = new Tray(nativeImage.createEmpty());
  const iconPath = path.join(__dirname, '../public/icon.png');
  try {
    tray.setImage(iconPath);
  } catch {
    tray.setImage(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhklEQVQ4T2NkYGD4z0ABYBzVMKoBBg0Y1QCjBhhVAAODgP8MRHrBf1QDDEMNMAz9gGE4GoZh6AeGoR8Yhn5gGPqBYegHhqEfGIZ+YBj6gWHoB4ahHxiGfmAY+oFh6AeGoR8Yhn5gGPqBYegHhqEfGIZ+YBj6gWHoB4ahHxiGfmAY+gEANpkL/O0w0s0AAAAASUVORK5CYII='));
  }
  tray.setToolTip('TimeLapser');
  tray.on('click', () => {
    overlayWindow?.show();
    overlayWindow?.focus();
  });
}

async function captureFrame(): Promise<Buffer> {
  const opts: { screen?: number; format?: 'png' | 'jpg' } = {};
  if (settings.source === 'monitor' && settings.monitorId != null) {
    const displays = await screenshot.listDisplays();
    const id = displays[settings.monitorId]?.id ?? displays[0]?.id;
    if (id != null) opts.screen = id;
  }
  opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
  let buf = await screenshot(opts);
  if (settings.source === 'region' && settings.region) {
    const r = settings.region;
    buf = await sharp(buf).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).toBuffer();
  }
  let pipeline = sharp(buf);
  if (settings.width > 0 && settings.height > 0) {
    pipeline = pipeline.resize(settings.width, settings.height, { fit: 'inside' });
  }
  if (settings.format === 'jpeg') {
    pipeline = pipeline.jpeg({
      quality: settings.optimizeFileSize ? Math.max(30, settings.jpegQuality - 15) : settings.jpegQuality,
      mozjpeg: settings.optimizeFileSize,
    });
  } else {
    if (settings.optimizeFileSize) {
      pipeline = pipeline.png({ compressionLevel: 8 });
    }
  }
  return pipeline.toBuffer();
}

function startNewSession(): string {
  const base = settings.outputFolder;
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const name = `session_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const sessionPath = path.join(base, name);
  fs.mkdirSync(sessionPath, { recursive: true });
  const meta = {
    startedAt: new Date().toISOString(),
    intervalSeconds: settings.intervalSeconds,
    source: settings.source,
    width: settings.width,
    height: settings.height,
    format: settings.format,
  };
  fs.writeFileSync(path.join(sessionPath, 'metadata.json'), JSON.stringify(meta, null, 2));
  return sessionPath;
}

function runCaptureLoop() {
  if (captureState !== 'recording' || !currentSessionFolder) return;
  captureFrame()
    .then((buf) => {
      const ext = settings.format === 'jpeg' ? 'jpg' : 'png';
      const file = path.join(currentSessionFolder!, `frame_${String(++frameIndex).padStart(6, '0')}.${ext}`);
      fs.writeFileSync(file, buf);
    })
    .catch((err) => console.error('Capture error:', err))
    .finally(() => {
      if (captureState === 'recording' && captureTimer)
        captureTimer = setTimeout(runCaptureLoop, settings.intervalSeconds * 1000);
    });
}

ipcMain.handle('get-displays', async () => {
  const list = await screenshot.listDisplays();
  const displays = screen.getAllDisplays();
  return list.map((d, i) => ({
    id: d.id,
    index: i,
    name: d.name || `Display ${i + 1}`,
    bounds: displays[i]?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 },
  }));
});

ipcMain.handle('get-settings', () => getSettings());
ipcMain.handle('set-settings', (_e, s: Partial<CaptureSettings>) => {
  saveSettings({ ...getSettings(), ...s });
  return getSettings();
});

ipcMain.handle('get-state', () => ({
  state: captureState,
  sessionFolder: currentSessionFolder,
  frameCount: frameIndex,
  lastSessionFolder,
}));

ipcMain.handle('start-recording', async (_e, newSession: boolean) => {
  if (captureState === 'recording') return { ok: false, message: 'Already recording' };
  settings = getSettings();
  if (newSession || !currentSessionFolder) {
    const continueFolder = !newSession && lastSessionFolder && fs.existsSync(lastSessionFolder);
    if (continueFolder) {
      currentSessionFolder = lastSessionFolder;
      const files = fs.readdirSync(currentSessionFolder).filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f));
      frameIndex = files.length;
    } else {
      currentSessionFolder = startNewSession();
      frameIndex = 0;
    }
  }
  captureState = 'recording';
  runCaptureLoop();
  return { ok: true, sessionFolder: currentSessionFolder };
});

ipcMain.handle('pause-recording', () => {
  if (captureState !== 'recording') return { ok: false };
  captureState = 'paused';
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  return { ok: true };
});

ipcMain.handle('resume-recording', () => {
  if (captureState !== 'paused' || !currentSessionFolder) return { ok: false };
  captureState = 'recording';
  runCaptureLoop();
  return { ok: true };
});

ipcMain.handle('stop-recording', () => {
  const wasRecording = captureState === 'recording' || captureState === 'paused';
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  captureState = 'idle';
  const folder = currentSessionFolder;
  if (folder) lastSessionFolder = folder;
  currentSessionFolder = null;
  frameIndex = 0;
  return { ok: true, sessionFolder: folder, wasRecording };
});

ipcMain.handle('open-folder', (_e, folder: string) => {
  if (folder && fs.existsSync(folder)) shell.openPath(folder);
});

ipcMain.handle('get-session-frame-count', (_e, sessionFolder: string) => {
  if (!sessionFolder || !fs.existsSync(sessionFolder)) return 0;
  const files = fs.readdirSync(sessionFolder).filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f));
  return files.length;
});

ipcMain.handle('get-default-export-path', (_e, sessionFolder: string) => {
  const s = getSettings();
  const name = path.basename(sessionFolder) + '.mp4';
  return path.join(s.outputFolder, name);
});

ipcMain.handle('open-focus-assist', () => {
  shell.openExternal('ms-settings:quietmoments');
});

ipcMain.handle('export-video', async (_e, args: {
  sessionFolder: string;
  outputPath: string;
  platform: string;
  maxDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
}) => {
  const { sessionFolder, outputPath, maxDurationSeconds, fps, width, height } = args;
  const frames = fs.readdirSync(sessionFolder)
    .filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });
  if (frames.length === 0) return { ok: false, message: 'No frames in session' };
  const ffmpeg = require('fluent-ffmpeg');
  const firstFrame = path.join(sessionFolder, frames[0]);
  const pattern = path.join(sessionFolder, 'frame_%06d' + path.extname(firstFrame)).replace(/\\/g, '/');
  return new Promise((resolve) => {
    let outFps = fps;
    const totalDuration = frames.length / fps;
    if (maxDurationSeconds > 0 && totalDuration > maxDurationSeconds) {
      outFps = frames.length / maxDurationSeconds;
    }
    ffmpeg()
      .input(pattern)
      .inputOptions([`-framerate ${fps}`])
      .outputOptions([`-r ${outFps}`, '-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart'])
      .size(`${width}x${height}`)
      .output(outputPath)
      .on('end', () => resolve({ ok: true, path: outputPath }))
      .on('error', (err: Error) => resolve({ ok: false, message: err.message }))
      .run();
  });
});

app.whenReady().then(() => {
  settings = getSettings();
  createWindow();
});

app.on('window-all-closed', () => {
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  if (tray) tray.destroy();
  app.quit();
});
