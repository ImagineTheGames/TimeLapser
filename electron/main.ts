import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, Tray, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

const LOG_PREFIX = '[TimeLapser]';

function log(message: string, ...args: unknown[]) {
  const line = `${LOG_PREFIX} ${message}`;
  console.log(line, ...args);
  try {
    if (app.isReady()) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'main.log');
      const ts = new Date().toISOString();
      fs.appendFileSync(logFile, `${ts} ${line} ${args.length ? JSON.stringify(args) : ''}\n`);
    }
  } catch {
    // ignore file write errors
  }
}

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
  /** Overlay window opacity 0.1–1 (10%–100%) */
  overlayOpacity: number;
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
  overlayOpacity: 1,
};

let overlayWindow: BrowserWindow | null = null;
let regionPickerWindow: BrowserWindow | null = null;
let regionPickerOverlaySender: Electron.WebContents | null = null;
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
  log('Creating overlay window...');
  const preloadPath = path.join(__dirname, 'preload.js');
  log('Preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 88,
    x: Math.max(0, width - 440),
    y: Math.max(0, height - 80),
    show: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  const opacity = Math.max(0.1, Math.min(1, getSettings().overlayOpacity ?? 1));
  overlayWindow.setOpacity(opacity);
  overlayWindow.on('focus', () => {
    if (!overlayWindow?.isDestroyed()) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  overlayWindow.on('restore', () => {
    if (!overlayWindow?.isDestroyed()) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  overlayWindow.on('blur', () => {
    setImmediate(() => {
      if (!overlayWindow?.isDestroyed()) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    });
  });
  if (process.env.NODE_ENV !== 'production') {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    log('Loading dev URL:', devUrl);
    overlayWindow.loadURL(devUrl);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    log('Loading file:', indexPath, 'exists:', fs.existsSync(indexPath));
    overlayWindow.loadFile(indexPath);
  }
  overlayWindow.webContents.on('did-fail-load', (_e, code, errMsg, url) => {
    log('Overlay failed to load:', code, errMsg, url);
  });
  overlayWindow.webContents.on('did-finish-load', () => {
    log('Overlay finished loading');
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
  log('Overlay window created');
  return overlayWindow;
}

function showOverlayWindow() {
  ensureOverlayWindow();
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.isMinimized()) overlayWindow.restore();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow.setPosition(Math.max(0, width - 440), Math.max(0, height - 80));
  overlayWindow.show();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
  overlayWindow.focus();
  overlayWindow.setVisibleOnAllWorkspaces(true);
  log('Show overlay: shown, focused, moveTop');
}

/** Returns a 32x32 tray icon with opaque background so it displays on Windows. */
async function getTrayIcon(): Promise<Electron.NativeImage> {
  const iconPath = path.join(app.getAppPath(), 'public', 'icon.png');
  const size = 32;
  const opaqueBg = { r: 30, g: 41, b: 59, alpha: 1 };
  try {
    if (fs.existsSync(iconPath)) {
      const buf = await sharp(iconPath)
        .resize(size, size)
        .toBuffer();
      const withBg = await sharp({
        create: { width: size, height: size, channels: 4, background: opaqueBg },
      })
        .composite([{ input: buf, top: 0, left: 0 }])
        .png()
        .toBuffer();
      return nativeImage.createFromBuffer(withBg);
    }
  } catch (e) {
    log('Tray icon load failed:', (e as Error).message);
  }
  const fallback = await sharp({
    create: { width: size, height: size, channels: 4, background: opaqueBg },
  })
    .png()
    .toBuffer();
  return nativeImage.createFromBuffer(fallback);
}

async function createWindow() {
  try {
    log('createWindow: ensuring overlay...');
    ensureOverlayWindow();
    log('createWindow: creating tray...');
    const iconPath = path.join(app.getAppPath(), 'public', 'icon.png');
    log('Tray icon path:', iconPath, 'exists:', fs.existsSync(iconPath));
    tray = new Tray(await getTrayIcon());
    tray.setToolTip('TimeLapser');
    tray.on('click', () => showOverlayWindow());
    log('createWindow: building context menu...');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show TimeLapser', click: () => showOverlayWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    log('createWindow: done');
  } catch (err) {
    log('createWindow failed:', err);
    throw err;
  }
}

async function captureFrame(): Promise<Buffer> {
  const opts: { screen?: number; format?: 'png' | 'jpg' } = {};
  const listDisplays = await screenshot.listDisplays();
  const electronDisplays = screen.getAllDisplays();

  if (settings.source === 'monitor' && settings.monitorId != null) {
    const id = listDisplays[settings.monitorId]?.id ?? listDisplays[0]?.id;
    if (id != null) opts.screen = id;
  } else if (settings.source === 'region' && settings.region) {
    const r = settings.region;
    const idx = electronDisplays.findIndex(
      (d) =>
        r.x >= d.bounds.x &&
        r.x < d.bounds.x + d.bounds.width &&
        r.y >= d.bounds.y &&
        r.y < d.bounds.y + d.bounds.height
    );
    const displayIndex = idx >= 0 ? idx : 0;
    const disp = electronDisplays[displayIndex];
    const screenId = listDisplays[displayIndex]?.id ?? listDisplays[0]?.id;
    if (screenId != null) opts.screen = screenId;
    opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
    let buf = await screenshot(opts);
    const left = Math.max(0, Math.min(disp.bounds.width - 1, r.x - disp.bounds.x));
    const top = Math.max(0, Math.min(disp.bounds.height - 1, r.y - disp.bounds.y));
    const width = Math.max(1, Math.min(disp.bounds.width - left, r.width));
    const height = Math.max(1, Math.min(disp.bounds.height - top, r.height));
    try {
      buf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
    } catch (err) {
      log('Region extract failed:', (err as Error)?.message, { left, top, width, height, bounds: disp.bounds });
      throw err;
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

  opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
  let buf = await screenshot(opts);
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
    .then(async (buf) => {
      const ext = settings.format === 'jpeg' ? 'jpg' : 'png';
      const file = path.join(currentSessionFolder!, `frame_${String(++frameIndex).padStart(6, '0')}.${ext}`);
      await fs.promises.writeFile(file, buf);
    })
    .catch((err) => {
      log('Capture error:', (err as Error)?.message ?? err);
    })
    .finally(() => {
      if (captureState === 'recording') {
        captureTimer = setTimeout(runCaptureLoop, settings.intervalSeconds * 1000);
      }
    });
}

ipcMain.on('renderer-error', (_e, message: string, stack: string) => {
  log('Renderer error:', message, stack || '(no stack)');
});

ipcMain.on('renderer-log', (_e, message: string) => {
  log('[Renderer]', message);
});

ipcMain.on('close-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

/** Virtual screen bounds (union of all displays) for the region picker. */
function getVirtualScreenBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return screen.getPrimaryDisplay().bounds;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function closeRegionPicker() {
  if (regionPickerWindow && !regionPickerWindow.isDestroyed()) {
    regionPickerWindow.close();
    regionPickerWindow = null;
  }
  regionPickerOverlaySender = null;
}

ipcMain.handle('start-region-pick', async (e) => {
  if (regionPickerWindow && !regionPickerWindow.isDestroyed()) return;
  regionPickerOverlaySender = e.sender;
  const bounds = getVirtualScreenBounds();
  const preloadPickerPath = path.join(__dirname, 'preload-region-picker.js');
  log('Region picker bounds:', bounds, 'preload exists:', fs.existsSync(preloadPickerPath));
  regionPickerWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: preloadPickerPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  regionPickerWindow.setVisibleOnAllWorkspaces(true);
  regionPickerWindow.setAlwaysOnTop(true, 'screen-saver');
  const pickerHtmlPath = path.join(__dirname, 'region-picker.html');
  regionPickerWindow.loadFile(pickerHtmlPath);
  regionPickerWindow.webContents.once('did-finish-load', () => {
    if (regionPickerWindow && !regionPickerWindow.isDestroyed()) {
      regionPickerWindow.webContents.executeJavaScript(
        `window.__PICKER_BOUNDS__ = ${JSON.stringify(bounds)};`
      ).catch(() => {});
    }
  });
  regionPickerWindow.on('closed', () => {
    regionPickerWindow = null;
    regionPickerOverlaySender = null;
  });
});

ipcMain.on('region-pick-done', (_e, rect: { x: number; y: number; width: number; height: number }) => {
  const s = getSettings();
  settings = { ...s, region: rect };
  saveSettings(settings);
  log('Region picked:', rect);
  if (regionPickerOverlaySender && !regionPickerOverlaySender.isDestroyed()) {
    regionPickerOverlaySender.send('region-picked', rect);
  }
  closeRegionPicker();
});

ipcMain.on('region-pick-cancel', () => {
  if (regionPickerOverlaySender && !regionPickerOverlaySender.isDestroyed()) {
    regionPickerOverlaySender.send('region-picked', null);
  }
  closeRegionPicker();
});

ipcMain.handle('get-overlay-bounds-and-work-area', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const workArea = screen.getPrimaryDisplay().workArea;
    return { bounds: { x: workArea.width - 440, y: workArea.height - 100, width: 420, height: 88 }, workArea };
  }
  const bounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return { bounds, workArea: display.workArea };
});

const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT_COLLAPSED = 88;
const OVERLAY_HEIGHT_SETTINGS = 540;
const OVERLAY_HEIGHT_EXPORT = 720;
const MARGIN = 20;
const SETTINGS_PANEL_WIDTH = 380;
const SETTINGS_PANEL_GAP = 20;
const OVERLAY_WIDTH_WITH_PANEL = OVERLAY_WIDTH + SETTINGS_PANEL_WIDTH + SETTINGS_PANEL_GAP;

/** Set overlay size and position. When expandedWithPanel, window widens so settings panel sits to the left of the bar (bar stays in place). Expands upward when near bottom, downward when near top. If expandedWithPanel is undefined, current width is preserved (e.g. when only height changes). */
function setOverlayBoundsAndSize(newHeight: number, expandedWithPanel?: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  let x = bounds.x;
  let y = bounds.y;
  const h = Math.max(OVERLAY_HEIGHT_COLLAPSED, Math.min(900, newHeight));
  const width =
    expandedWithPanel === true
      ? OVERLAY_WIDTH_WITH_PANEL
      : expandedWithPanel === false
        ? OVERLAY_WIDTH
        : bounds.width;
  try {
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const bottomOfWorkArea = workArea.y + workArea.height;
    const wouldGoOffBottom = y + h > bottomOfWorkArea - MARGIN;
    const nearTop = y < workArea.y + 150;
    if (wouldGoOffBottom && !nearTop) {
      y = workArea.y + workArea.height - h - MARGIN;
      if (y < workArea.y) y = workArea.y;
    }
    if (y < workArea.y) y = workArea.y;
    if (y + h > bottomOfWorkArea - MARGIN) y = bottomOfWorkArea - h - MARGIN;
    if (expandedWithPanel === true) {
      const barRight = bounds.x + bounds.width;
      x = barRight - OVERLAY_WIDTH_WITH_PANEL;
      x = Math.max(workArea.x, x);
      if (x + width > workArea.x + workArea.width - MARGIN) x = workArea.x + workArea.width - width - MARGIN;
    } else if (expandedWithPanel === false) {
      if (bounds.width > OVERLAY_WIDTH) x = bounds.x + (bounds.width - OVERLAY_WIDTH);
      if (x + width > workArea.x + workArea.width - MARGIN) x = workArea.x + workArea.width - width - MARGIN;
      if (x < workArea.x) x = workArea.x;
    }
    overlayWindow.setBounds({ x, y, width, height: h }, false);
    log('Overlay bounds:', x, y, width, h);
  } catch (err) {
    log('setOverlayBoundsAndSize failed:', (err as Error).message);
    overlayWindow.setSize(width, h);
  }
}

ipcMain.on('set-overlay-expanded', (e, expanded: boolean) => {
  const hasOverlay = !!overlayWindow && !overlayWindow.isDestroyed();
  const senderIsOverlay = hasOverlay && e.sender === overlayWindow!.webContents;
  log('set-overlay-expanded received', 'expanded=', expanded, 'hasOverlay=', hasOverlay, 'senderIsOverlay=', senderIsOverlay);
  if (!senderIsOverlay) return;
  const height = expanded ? OVERLAY_HEIGHT_SETTINGS : OVERLAY_HEIGHT_COLLAPSED;
  setOverlayBoundsAndSize(height, expanded);
  log('Overlay expanded:', expanded, 'width:', expanded ? OVERLAY_WIDTH_WITH_PANEL : OVERLAY_WIDTH, 'height:', height);
});

ipcMain.on('set-overlay-height', (e, height: number) => {
  const hasOverlay = !!overlayWindow && !overlayWindow.isDestroyed();
  const senderIsOverlay = hasOverlay && e.sender === overlayWindow!.webContents;
  if (!senderIsOverlay) return;
  setOverlayBoundsAndSize(height);
  log('Overlay height set:', height);
});

ipcMain.handle('get-displays', async () => {
  try {
    const list = await screenshot.listDisplays();
    const displays = screen.getAllDisplays();
    return list.map((d, i) => ({
      id: d.id,
      index: i,
      name: d.name || `Display ${i + 1}`,
      bounds: displays[i]?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 },
    }));
  } catch (err) {
    log('get-displays failed (using Electron screen fallback):', (err as Error).message);
    const displays = screen.getAllDisplays();
    return displays.map((d, i) => ({
      id: i,
      index: i,
      name: d.label || `Display ${i + 1}`,
      bounds: d.bounds ?? d.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 },
    }));
  }
});

ipcMain.handle('get-settings', () => getSettings());
ipcMain.handle('set-settings', (_e, s: Partial<CaptureSettings>) => {
  const next = { ...getSettings(), ...s };
  saveSettings(next);
  if (overlayWindow && !overlayWindow.isDestroyed() && typeof next.overlayOpacity === 'number') {
    const opacity = Math.max(0.1, Math.min(1, next.overlayOpacity));
    overlayWindow.setOpacity(opacity);
  }
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
  const count = frameIndex;
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  captureState = 'idle';
  const folder = currentSessionFolder;
  if (folder) lastSessionFolder = folder;
  currentSessionFolder = null;
  frameIndex = 0;
  return { ok: true, sessionFolder: folder, wasRecording, frameCount: count };
});

ipcMain.handle('open-folder', (_e, folder: string) => {
  if (folder && fs.existsSync(folder)) shell.openPath(folder);
});

ipcMain.handle('get-session-frame-count', (_e, sessionFolder: string) => {
  if (!sessionFolder || !fs.existsSync(sessionFolder)) return 0;
  const files = fs.readdirSync(sessionFolder).filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f));
  return files.length;
});

function getSessionSizeBytes(dir: string): number {
  if (!dir || !fs.existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile()) total += fs.statSync(full).size;
      else if (e.isDirectory()) total += getSessionSizeBytes(full);
    }
  } catch {
    return 0;
  }
  return total;
}

ipcMain.handle('get-session-size', (_e, sessionFolder: string) => {
  return { bytes: getSessionSizeBytes(sessionFolder) };
});

ipcMain.handle('get-session-list', () => {
  try {
    const base = getSettings().outputFolder;
    if (!fs.existsSync(base)) return [];
    const names = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^session_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    return names.map((name) => ({
      path: path.join(base, name),
      name,
    }));
  } catch {
    return [];
  }
});

ipcMain.handle('get-default-export-path', (_e, sessionFolder: string) => {
  const s = getSettings();
  const name = path.basename(sessionFolder) + '.mp4';
  return path.join(s.outputFolder, name);
});

ipcMain.handle('get-first-frame-data-url', (_e, sessionFolder: string) => {
  try {
    const files = fs.readdirSync(sessionFolder)
      .filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10);
        const nb = parseInt(b.replace(/\D/g, ''), 10);
        return na - nb;
      });
    if (files.length === 0) return { dataUrl: null };
    const firstPath = path.join(sessionFolder, files[0]);
    const buf = fs.readFileSync(firstPath);
    const ext = path.extname(firstPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    return { dataUrl };
  } catch {
    return { dataUrl: null };
  }
});

ipcMain.handle('open-focus-assist', () => {
  shell.openExternal('ms-settings:quietmoments');
});

ipcMain.handle('show-output-folder-picker', async () => {
  const win = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select folder to save captures',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { path: null };
  return { path: result.filePaths[0] };
});

ipcMain.handle('show-export-save-picker', async (_e, defaultPath: string, format?: string) => {
  const win = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : BrowserWindow.getFocusedWindow();
  const formatExt = (typeof format === 'string' && format) ? format.toLowerCase() : null;
  const ext = formatExt || (typeof defaultPath === 'string' && defaultPath.includes('.')
    ? path.extname(defaultPath).slice(1).toLowerCase()
    : 'mp4');
  const filters: { name: string; extensions: string[] }[] =
    ext === 'webm' ? [{ name: 'WebM', extensions: ['webm'] }]
    : ext === 'mov' ? [{ name: 'QuickTime', extensions: ['mov'] }]
    : [{ name: 'MP4', extensions: ['mp4'] }];
  filters.push({ name: 'All files', extensions: ['*'] });
  const result = await dialog.showSaveDialog(win || undefined, {
    title: 'Save video as',
    defaultPath: defaultPath || undefined,
    filters,
  });
  if (result.canceled || !result.filePath) return { path: null };
  return { path: result.filePath };
});

ipcMain.handle('show-audio-picker', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select music file',
    filters: [
      { name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return { path: null };
  return { path: result.filePaths[0] };
});

ipcMain.handle('export-video', async (_e, args: {
  sessionFolder: string;
  outputPath: string;
  platform: string;
  format?: 'mp4' | 'webm' | 'mov';
  maxDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
  cropToFit?: boolean;
  maxFileSizeBytes?: number;
  audioPath?: string | null;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}) => {
  const {
    sessionFolder, outputPath, maxDurationSeconds, fps, width, height,
    cropToFit = false,
    maxFileSizeBytes,
    audioPath = null, fadeInSeconds = 0, fadeOutSeconds = 0,
    format = 'mp4',
  } = args;
  const ext = format === 'webm' ? 'webm' : format === 'mov' ? 'mov' : 'mp4';
  const destPath = path.extname(outputPath).toLowerCase() !== `.${ext}` ? `${outputPath.replace(/\.[^.]+$/, '')}.${ext}` : outputPath;
  const frames = fs.readdirSync(sessionFolder)
    .filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });
  if (frames.length === 0) return { ok: false, message: 'No frames in session' };
  let ffmpegPath: string;
  try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    if (process.resourcesPath && ffmpegPath.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
  } catch (e) {
    log('FFmpeg installer not found:', (e as Error).message);
    return { ok: false, message: 'FFmpeg not found. Install from https://ffmpeg.org or run: winget install FFmpeg' };
  }
  const ffmpeg = require('fluent-ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegPath);
  const firstFrame = path.join(sessionFolder, frames[0]);
  const pattern = path.join(sessionFolder, 'frame_%06d' + path.extname(firstFrame)).replace(/\\/g, '/');
  let outFps = fps;
  const totalDuration = frames.length / fps;
  if (maxDurationSeconds > 0 && totalDuration > maxDurationSeconds) {
    outFps = frames.length / maxDurationSeconds;
  }
  let videoDurationSec = frames.length / outFps;
  let frameStep = 1;
  if (maxFileSizeBytes && maxFileSizeBytes > 0) {
    const targetVideoBytes = maxFileSizeBytes * 0.9;
    let targetKbps = Math.round((targetVideoBytes * 8) / videoDurationSec / 1000);
    if (targetKbps < 400) {
      const targetDurationSec = (targetVideoBytes * 8) / (400 * 1000);
      frameStep = Math.max(1, Math.ceil(frames.length / (targetDurationSec * outFps)));
      videoDurationSec = (frames.length / frameStep) / outFps;
      targetKbps = Math.round((targetVideoBytes * 8) / videoDurationSec / 1000);
    }
    frameStep = Math.min(frameStep, Math.max(1, Math.floor(frames.length / 10)));
  }
  const effectiveDurationSec = frameStep > 1 ? (frames.length / frameStep) / outFps : videoDurationSec;
  let videoOpts: string[];
  if (maxFileSizeBytes && maxFileSizeBytes > 0) {
    const targetVideoBytes = maxFileSizeBytes * 0.9;
    const targetKbps = Math.max(300, Math.min(20000, Math.round((targetVideoBytes * 8) / effectiveDurationSec / 1000)));
    if (ext === 'webm') {
      videoOpts = [`-r ${outFps}`, '-c:v libvpx-vp9', '-pix_fmt yuv420p', `-b:v ${targetKbps}k`, '-crf 31'];
    } else {
      videoOpts = [`-r ${outFps}`, '-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart', `-b:v ${targetKbps}k`, `-maxrate ${targetKbps}k`, `-bufsize ${Math.min(2 * targetKbps, 40000)}k`];
    }
  } else {
    videoOpts = ext === 'webm'
      ? [`-r ${outFps}`, '-c:v libvpx-vp9', '-pix_fmt yuv420p', '-b:v 0', '-crf 30']
      : [`-r ${outFps}`, '-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart'];
  }

  const hasAudio = audioPath && fs.existsSync(audioPath);
  const fadeIn = Math.max(0, Math.min(fadeInSeconds, videoDurationSec / 2));
  const fadeOut = Math.max(0, Math.min(fadeOutSeconds, videoDurationSec / 2));
  const fadeOutStart = Math.max(0, videoDurationSec - fadeOut);

  return new Promise((resolve) => {
    const runVideoOnly = (dest: string, onDone: (err: Error | null) => void) => {
      const chain = ffmpeg()
        .input(pattern)
        .inputOptions([`-framerate ${fps}`])
        .outputOptions(videoOpts)
        .output(dest)
        .on('end', () => onDone(null))
        .on('error', onDone);
      const vfParts: string[] = [];
      if (frameStep > 1) {
        vfParts.push(`select='not(mod(n\\,${frameStep}))'`, `setpts=N/(${fps}*${frameStep})/TB`);
      }
      if (cropToFit) {
        vfParts.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
      } else if (vfParts.length > 0) {
        vfParts.push(`scale=${width}:${height}`);
      }
      if (vfParts.length > 0) {
        chain.outputOptions(['-vf', vfParts.join(',')]);
      } else {
        chain.size(`${width}x${height}`);
      }
      chain.run();
    };

    if (!hasAudio) {
      runVideoOnly(destPath, (err) => {
        if (err) resolve({ ok: false, message: (err as Error).message });
        else resolve({ ok: true, path: destPath });
      });
      return;
    }

    const tempVideo = path.join(path.dirname(destPath), `.timelapser_temp_${Date.now()}.mp4`);
    runVideoOnly(tempVideo, (err) => {
      if (err) {
        resolve({ ok: false, message: (err as Error).message });
        return;
      }
      const audioFilter: string[] = [];
      audioFilter.push(`atrim=0:${videoDurationSec}`);
      audioFilter.push('asetpts=PTS-STARTPTS');
      if (fadeIn > 0) audioFilter.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (fadeOut > 0) audioFilter.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      const filterStr = `[1:a]${audioFilter.join(',')}[a]`;
      const muxOpts = ext === 'webm'
        ? ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'libopus', '-shortest']
        : ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart'];
      ffmpeg()
        .input(tempVideo)
        .input(audioPath)
        .complexFilter(filterStr)
        .outputOptions(muxOpts)
        .output(destPath)
        .on('end', () => {
          try { fs.unlinkSync(tempVideo); } catch { /* ignore */ }
          resolve({ ok: true, path: destPath });
        })
        .on('error', (e: Error) => {
          try { fs.unlinkSync(tempVideo); } catch { /* ignore */ }
          resolve({ ok: false, message: e.message });
        })
        .run();
    });
  });
});

process.on('uncaughtException', (err) => {
  console.error(LOG_PREFIX, 'Uncaught exception:', err);
  try {
    if (app.isReady()) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      const logFile = path.join(logDir, 'main.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${LOG_PREFIX} Uncaught exception: ${err.stack}\n`);
    }
  } catch { /* ignore */ }
});

process.on('unhandledRejection', (reason, p) => {
  console.error(LOG_PREFIX, 'Unhandled rejection:', reason, p);
  try {
    if (app.isReady()) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      const logFile = path.join(logDir, 'main.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${LOG_PREFIX} Unhandled rejection: ${String(reason)}\n`);
    }
  } catch { /* ignore */ }
});

log('Main process starting, app.isReady:', app.isReady());

app.whenReady().then(async () => {
  log('App ready');
  try {
    log('Loading settings...');
    settings = getSettings();
    log('Settings loaded, outputFolder:', settings.outputFolder);
    await createWindow();
    log('Startup complete');
    log('Log file:', path.join(app.getPath('userData'), 'logs', 'main.log'));
  } catch (err) {
    log('Startup failed:', err);
    console.error(LOG_PREFIX, 'Startup error:', err);
    app.quit(1);
  }
});

app.on('window-all-closed', () => {
  log('window-all-closed');
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  if (tray) tray.destroy();
  app.quit();
});
