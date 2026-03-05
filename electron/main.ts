import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, Tray, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import Store from 'electron-store';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

const LOG_PREFIX = '[TimeLapser]';

function getLogFilePath(): string | null {
  try {
    if (!app.isReady()) return null;
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    return path.join(logDir, 'main.log');
  } catch {
    return null;
  }
}

function getExtendedLogging(): boolean {
  const s = store.get('captureSettings') as Partial<CaptureSettings> | undefined;
  return !!s?.extendedLogging;
}

function writeToLogFile(line: string, args: unknown[]) {
  const logFile = getLogFilePath();
  if (!logFile) return;
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `${ts} ${line} ${args.length ? JSON.stringify(args) : ''}\n`);
  } catch {
    // ignore
  }
}

/** Extended logging: only written to file when user enables "Extended logging" in settings. */
function log(message: string, ...args: unknown[]) {
  const line = `${LOG_PREFIX} ${message}`;
  try {
    console.log(line, ...args);
  } catch {
    // stdout may be a broken pipe (EPIPE) if the terminal that launched the app closed
  }
  if (getExtendedLogging()) writeToLogFile(line, args);
}

/** Minimal logging: always written to file (startup, shutdown). Use for first-time run diagnosis. */
function logMinimal(message: string, ...args: unknown[]) {
  const line = `${LOG_PREFIX} ${message}`;
  try {
    console.log(line, ...args);
  } catch {
    // ignore EPIPE
  }
  writeToLogFile(line, args);
}

/** Error logging: always written to file. */
function logError(message: string, ...args: unknown[]) {
  const line = `${LOG_PREFIX} ${message}`;
  try {
    console.log(line, ...args);
  } catch {
    // ignore EPIPE
  }
  writeToLogFile(line, args);
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
  /** When true, full logging (recording, overlay, etc.) is written to main.log. Default false = minimal only (startup/shutdown). */
  extendedLogging: boolean;
  /** Last selected export format preset (e.g. youtube_standard). Default 16:9. */
  lastExportPlatformId?: string;
  /** Last export "crop to fit" option. Default false. Kept for backward compat. */
  lastExportCropToFit?: boolean;
  /** Last export fit mode: letterbox, crop, or stretch. Default stretch. */
  lastExportFitMode?: 'letterbox' | 'crop' | 'stretch';
  /** Last export crop zoom when fit mode is crop: 1 = fill frame, 0.5–1 = show more content (letterbox). Default 1. */
  lastExportCropZoom?: number;
  /** Screenshot resolution scale: 1 = 100%, 0.75 = 75%, 0.5 = 50%, 0.25 = 25%. Reduces disk usage. Default 0.5. */
  captureResolutionScale?: number;
}

const defaultSettings: CaptureSettings = {
  intervalSeconds: 5,
  outputFolder: path.join(app.getPath('pictures'), 'TimeLapser'),
  source: 'monitor',
  monitorId: 0,
  region: null,
  width: 0,
  height: 0,
  captureResolutionScale: 0.5,
  format: 'jpeg',
  jpegQuality: 85,
  optimizeFileSize: true,
  disableNotifications: false,
  overlayOpacity: 1,
  extendedLogging: false,
};

let overlayWindow: BrowserWindow | null = null;
let regionPickerWindow: BrowserWindow | null = null;
let regionPickerOverlaySender: Electron.WebContents | null = null;
let tray: Tray | null = null;
let isQuitting = false;
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

/** Default false for new users: do not start with Windows until the user enables it. */
function getOpenAtLogin(): boolean {
  return (store.get('openAtLogin') as boolean | undefined) ?? false;
}

/** True if we should show the overlay on startup. We always show so that when the user launches the app (e.g. installer "Run", Start menu) the window is visible. "Start with Windows" only controls whether the app runs at login; we don't start minimized. */
function shouldShowWindowOnStartup(): boolean {
  return true;
}

function markStartupWindowShown(): void {
  store.set('lastSeenVersion', app.getVersion());
}

function getContinueSessionPath(): string | null {
  const p = store.get('continueSessionPath');
  return typeof p === 'string' && p ? p : null;
}

function setContinueSessionPath(path: string | null) {
  if (path) store.set('continueSessionPath', path);
  else store.delete('continueSessionPath');
}

function setOpenAtLogin(value: boolean) {
  store.set('openAtLogin', value);
  try {
    app.setLoginItemSettings({ openAtLogin: value });
  } catch (err) {
    logError('setLoginItemSettings failed:', (err as Error)?.message);
  }
}

/** Overlay width/height for positioning (must match BrowserWindow size). */
const OVERLAY_W = 420;
const OVERLAY_H_COLLAPSED = 120;

/** Get overlay position on the display that contains the cursor (or primary), clamped to work area. */
function getOverlayPosition(): { x: number; y: number; workArea: Electron.Rectangle } {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const workArea = display.workArea;
  const x = Math.max(workArea.x, workArea.x + workArea.width - OVERLAY_W - 20);
  const y = Math.max(workArea.y, workArea.y + workArea.height - OVERLAY_H_COLLAPSED - 20);
  return { x, y, workArea };
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  logMinimal('Creating overlay window...');
  const preloadPath = path.join(__dirname, 'preload.js');
  log('Preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));
  const { x, y } = getOverlayPosition();
  const iconPath = getAppIconPath();
  const appVersion = app.getVersion();
  overlayWindow = new BrowserWindow({
    width: 420,
    height: OVERLAY_HEIGHT_COLLAPSED,
    x,
    y,
    show: false,
    frame: false,
    title: `TimeLapser ${appVersion}`,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
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
  // Do not re-apply always-on-top on every focus/blur so switching to another window does not pull the overlay back on top.
  overlayWindow.on('restore', () => {
    if (!overlayWindow?.isDestroyed()) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    logMinimal('Loading dev URL:', devUrl);
    overlayWindow.loadURL(devUrl);
  } else {
    const pathFromDir = path.join(__dirname, '../dist/index.html');
    const pathFromApp = path.join(app.getAppPath(), 'dist', 'index.html');
    const indexPath = fs.existsSync(pathFromDir) ? pathFromDir : pathFromApp;
    logMinimal('Loading file:', indexPath, 'exists:', fs.existsSync(indexPath));
    overlayWindow.loadFile(indexPath);
  }
  let productionLoadTriedAlt = false;
  let overlayLoadFailed = false;
  overlayWindow.webContents.on('did-fail-load', (_e, code, errMsg, url) => {
    logError('Overlay failed to load:', code, errMsg, url);
    overlayLoadFailed = true;
    if (app.isPackaged && overlayWindow && !overlayWindow.isDestroyed() && !productionLoadTriedAlt) {
      productionLoadTriedAlt = true;
      const pathFromDir = path.join(__dirname, '../dist/index.html');
      const pathFromApp = path.join(app.getAppPath(), 'dist', 'index.html');
      const altPath = fs.existsSync(pathFromDir) ? pathFromApp : pathFromDir;
      log('Retrying load from:', altPath);
      overlayWindow.loadFile(altPath).catch((err) => logError('Retry load failed:', (err as Error).message));
    }
  });
  overlayWindow.webContents.on('did-finish-load', () => {
    if (overlayLoadFailed && !productionLoadTriedAlt) return;
    overlayLoadFailed = false;
    logMinimal('Overlay finished loading');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (process.argv.includes('--test-export-zoom')) {
        runExportZoomTest(overlayWindow)
          .then((result) => {
            const userData = app.getPath('userData');
            const resultPath = path.join(userData, 'export-test-result.json');
            try {
              fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
            } catch (e) {
              logError('export-test write result', (e as Error)?.message);
            }
            logMinimal('export-test done', result.success ? 'SUCCESS' : 'FAIL', resultPath);
            app.quit(result.success ? 0 : 1);
          })
          .catch((err) => {
            logError('export-test error', (err as Error)?.message);
            try {
              fs.writeFileSync(
                path.join(app.getPath('userData'), 'export-test-result.json'),
                JSON.stringify({ success: false, error: String(err) }, null, 2),
                'utf8'
              );
            } catch {}
            app.quit(1);
          });
        return;
      }
      if (shouldShowWindowOnStartup()) {
        markStartupWindowShown();
        if (overlayWindow.isMinimized()) overlayWindow.restore();
        overlayWindow.show();
        overlayWindow.focus();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        // Force overlay to the front (e.g. after install when launched from installer "Run")
        setImmediate(() => bringOverlayToFront());
        if (process.platform === 'win32') {
          setTimeout(() => bringOverlayToFront(), 300);
          setTimeout(() => bringOverlayToFront(), 1500);
          setTimeout(() => bringOverlayToFront(), 3500);
        }
      }
    }
  });
  overlayWindow.once('ready-to-show', () => {
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isVisible()) {
      if (shouldShowWindowOnStartup()) {
        markStartupWindowShown();
        if (overlayWindow.isMinimized()) overlayWindow.restore();
        overlayWindow.show();
        overlayWindow.focus();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        setImmediate(() => bringOverlayToFront());
      }
    }
  });
  // Keep app in tray: close button and Alt+F4 hide the overlay instead of destroying it (unless quitting)
  overlayWindow.on('close', (e) => {
    if (isQuitting) {
      // Let the window close so app.quit() can complete
      return;
    }
    if (!overlayWindow?.isDestroyed()) {
      e.preventDefault();
      overlayWindow.hide();
      log('Overlay hidden (minimized to tray)');
    }
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
  logMinimal('Overlay window created');
  return overlayWindow;
}

function bringOverlayToFront() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.show();
  overlayWindow.setAlwaysOnTop(true);
  overlayWindow.focus();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
  overlayWindow.setVisibleOnAllWorkspaces(true);
}

function showOverlayWindow() {
  ensureOverlayWindow();
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.isMinimized()) overlayWindow.restore();
  const { x, y } = getOverlayPosition();
  overlayWindow.setPosition(x, y);
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.show();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
  overlayWindow.focus();
  // Collapse settings/export so they are closed when reshowing from tray
  if (!overlayWindow.webContents.isDestroyed()) {
    overlayWindow.webContents.send('collapse-overlay-panels');
  }
  if (process.platform === 'win32') {
    overlayWindow.setAlwaysOnTop(true);
    setImmediate(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(false);
        overlayWindow.focus();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    });
    setTimeout(() => bringOverlayToFront(), 150);
  }
  log('Show overlay: shown, focused, moveTop');
}

/** Path to app icon (used for window icon; same locations as tray). Returns null if none found. */
function getAppIconPath(): string | null {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(appPath, 'public', 'icon.png'),
    appPath.replace(/\.asar$/, '.asar.unpacked') + path.sep + path.join('public', 'icon.png'),
  ];
  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) return iconPath;
  }
  return null;
}

/** Returns a 32x32 tray icon with opaque background so it displays on Windows. */
async function getTrayIcon(): Promise<Electron.NativeImage> {
  const size = 32;
  const opaqueBg = { r: 30, g: 41, b: 59, alpha: 1 };
  const appPath = app.getAppPath();
  const candidates = [
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(appPath, 'public', 'icon.png'),
    appPath.replace(/\.asar$/, '.asar.unpacked') + path.sep + path.join('public', 'icon.png'),
  ];
  for (const iconPath of candidates) {
    try {
      if (!fs.existsSync(iconPath)) continue;
      const raw = fs.readFileSync(iconPath);
      const buf = await sharp(raw).resize(size, size).toBuffer();
      const withBg = await sharp({
        create: { width: size, height: size, channels: 4, background: opaqueBg },
      })
        .composite([{ input: buf, top: 0, left: 0 }])
        .png()
        .toBuffer();
      return nativeImage.createFromBuffer(withBg);
    } catch (e) {
      logError('Tray icon load failed for', iconPath, (e as Error).message);
    }
  }
  const fallback = await sharp({
    create: { width: size, height: size, channels: 4, background: opaqueBg },
  })
    .png()
    .toBuffer();
  return nativeImage.createFromBuffer(fallback);
}

/** Used by --test-export-zoom: find last session, export with cropZoom 0.7, return result. */
async function runExportZoomTest(win: BrowserWindow): Promise<{ success: boolean; path?: string; error?: string }> {
  const base = getSettings().outputFolder;
  if (!base || !fs.existsSync(base)) {
    return { success: false, error: 'No output folder' };
  }
  const dirs = fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^session_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  if (dirs.length === 0) {
    return { success: false, error: 'No session folder found' };
  }
  const sessionFolder = path.join(base, dirs[0]);
  const outputPath = path.join(base, dirs[0] + '_zoom_test.mp4');
  const args = {
    sessionFolder,
    outputPath,
    platform: 'instagram_reels',
    format: 'mp4' as const,
    maxDurationSeconds: 0,
    fps: 30,
    width: 1080,
    height: 1920,
    fitMode: 'crop' as const,
    cropToFit: true,
    cropOffsetX: 0.5,
    cropOffsetY: 0.5,
    cropZoom: 0.7,
    quality: 70,
    audioPath: null as string | null,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    watermarkPath: null as string | null,
    watermarkPosition: 'bottom-right' as const,
  };
  logMinimal('export-test: session', sessionFolder, 'cropZoom', 0.7);
  const argsJson = JSON.stringify(args).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  try {
    const result = await win.webContents.executeJavaScript(
      `(async () => { return await window.timelapser.exportVideo(JSON.parse('${argsJson}')); })()`
    );
    return {
      success: !!result?.ok,
      path: result?.path,
      error: result?.ok ? undefined : (result?.message || 'Export failed'),
    };
  } catch (e) {
    return { success: false, error: (e as Error)?.message };
  }
}

async function createWindow() {
  try {
    logMinimal('createWindow: ensuring overlay...');
    ensureOverlayWindow();
    logMinimal('createWindow: creating tray...');
    const iconPath = path.join(app.getAppPath(), 'public', 'icon.png');
    log('Tray icon path:', iconPath, 'exists:', fs.existsSync(iconPath));
    tray = new Tray(await getTrayIcon());
    tray.setToolTip('TimeLapser');
    tray.on('click', () => showOverlayWindow());
    tray.on('double-click', () => showOverlayWindow());
    logMinimal('createWindow: building context menu...');
    const refreshTrayMenu = () => {
      if (!tray || tray.isDestroyed()) return;
      const openAtLogin = getOpenAtLogin();
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Show TimeLapser', click: () => showOverlayWindow() },
        { type: 'separator' },
        {
          label: 'Start up with Windows',
          type: 'checkbox',
          checked: openAtLogin,
          click: (menuItem) => {
            const next = menuItem.checked;
            setOpenAtLogin(next);
            refreshTrayMenu();
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
      ]);
      tray.setContextMenu(contextMenu);
    };
    refreshTrayMenu();
    logMinimal('createWindow: done');
  } catch (err) {
    logError('createWindow failed:', err);
    throw err;
  }
}

/** Region (DIP) to extract params. Uses capture dimensions to decide DIP vs physical (screenshot-desktop may return either). */
function regionToExtract(
  r: { x: number; y: number; width: number; height: number },
  disp: Electron.Display,
  captureWidth: number,
  captureHeight: number
): { left: number; top: number; width: number; height: number } {
  const dip = disp.bounds;
  const scale = disp.scaleFactor ?? 1;
  const capW = captureWidth;
  const capH = captureHeight;
  const isDipCapture = capW === dip.width && capH === dip.height;
  const mult = isDipCapture ? 1 : scale;
  const left = Math.max(0, Math.min(capW - 1, Math.round((r.x - dip.x) * mult)));
  const top = Math.max(0, Math.min(capH - 1, Math.round((r.y - dip.y) * mult)));
  const width = Math.max(1, Math.min(capW - left, Math.round(r.width * mult)));
  const height = Math.max(1, Math.min(capH - top, Math.round(r.height * mult)));
  return { left, top, width, height };
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
    const rRight = r.x + r.width;
    const rBottom = r.y + r.height;
    const displaysIntersecting = electronDisplays.filter((d) => {
      const dx = d.bounds.x;
      const dy = d.bounds.y;
      const dw = d.bounds.width;
      const dh = d.bounds.height;
      return r.x < dx + dw && rRight > dx && r.y < dy + dh && rBottom > dy;
    });
    let buf: Buffer;
    if (displaysIntersecting.length <= 1) {
      const disp = displaysIntersecting[0] ?? electronDisplays[0];
      const displayIndex = electronDisplays.indexOf(disp);
      const screenId = listDisplays[displayIndex]?.id ?? listDisplays[0]?.id;
      if (screenId != null) opts.screen = screenId;
      opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
      buf = await screenshot(opts);
      const meta = await sharp(buf).metadata();
      const capW = meta.width ?? disp.bounds.width;
      const capH = meta.height ?? disp.bounds.height;
      const { left, top, width, height } = regionToExtract(r, disp, capW, capH);
      try {
        buf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
      } catch (err) {
        logError('Region extract failed:', (err as Error)?.message, { left, top, width, height, bounds: disp.bounds });
        throw err;
      }
    } else {
      const virtual = getVirtualScreenBounds();
      const screenshotDisplays = listDisplays as { id: string; left: number; top: number; width: number; height: number }[];
      // Capture each display individually (don't use screenshot.all() – it can fail if any display fails).
      // Match each Electron display to a screenshot display by position, then capture by that id.
      const inputs: { input: Buffer; left: number; top: number }[] = [];
      for (const eDisplay of electronDisplays) {
        const b = eDisplay.bounds;
        let bestJ = -1;
        let bestDist = Infinity;
        for (let j = 0; j < screenshotDisplays.length; j++) {
          const d = screenshotDisplays[j];
          const dx = (d.left - b.x);
          const dy = (d.top - b.y);
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestJ = j;
          }
        }
        if (bestJ < 0) continue;
        const screenId = screenshotDisplays[bestJ].id;
        let displayBuf: Buffer;
        try {
          displayBuf = await screenshot({
            screen: screenId,
            format: settings.format === 'jpeg' ? 'jpg' : 'png',
          } as { screen?: number; format?: string });
        } catch (e) {
          logError('Multi-monitor: capture failed for display at', b.x, b.y, (e as Error)?.message);
          continue;
        }
        const rawLeft = Math.round(b.x - virtual.x);
        const rawTop = Math.round(b.y - virtual.y);
        const left = Math.max(0, Math.min(rawLeft, virtual.width - 1));
        const top = Math.max(0, Math.min(rawTop, virtual.height - 1));
        // Slot size: must not exceed base (Sharp requires overlay not to extend past base)
        const slotW = Math.max(1, Math.floor(virtual.width - left));
        const slotH = Math.max(1, Math.floor(virtual.height - top));
        const placeW = Math.min(b.width, slotW);
        const placeH = Math.min(b.height, slotH);
        let overlayBuf = await sharp(displayBuf)
          .resize(placeW, placeH, { fit: 'fill' })
          .ensureAlpha()
          .png()
          .toBuffer();
        const meta = await sharp(overlayBuf).metadata();
        const ow = meta.width ?? placeW;
        const oh = meta.height ?? placeH;
        const fitW = Math.min(placeW, ow, slotW);
        const fitH = Math.min(placeH, oh, slotH);
        if (fitW < ow || fitH < oh) {
          overlayBuf = await sharp(overlayBuf)
            .extract({ left: 0, top: 0, width: fitW, height: fitH })
            .png()
            .toBuffer();
        }
        inputs.push({ input: overlayBuf, left, top });
      }
      if (inputs.length === 0) {
        const disp = displaysIntersecting[0] ?? electronDisplays[0];
        const displayIndex = electronDisplays.indexOf(disp);
        const screenId = listDisplays[displayIndex]?.id ?? listDisplays[0]?.id;
        opts.screen = screenId ?? undefined;
        opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
        buf = await screenshot(opts);
        const meta0 = await sharp(buf).metadata();
        const cw = meta0.width ?? disp.bounds.width;
        const ch = meta0.height ?? disp.bounds.height;
        const { left, top, width, height } = regionToExtract(r, disp, cw, ch);
        buf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
      } else {
      // Composite one overlay at a time to avoid "same dimensions or smaller" with multiple inputs
      let baseBuf = await sharp({
        create: { width: virtual.width, height: virtual.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer();
      for (const { input, left, top } of inputs) {
        const meta = await sharp(input).metadata();
        const iw = meta.width ?? 0;
        const ih = meta.height ?? 0;
        const maxW = Math.floor(virtual.width - left);
        const maxH = Math.floor(virtual.height - top);
        const useW = Math.max(0, Math.min(iw, maxW));
        const useH = Math.max(0, Math.min(ih, maxH));
        if (useW < 1 || useH < 1) continue;
        const overlay = (useW < iw || useH < ih)
          ? await sharp(input).extract({ left: 0, top: 0, width: useW, height: useH }).png().toBuffer()
          : input;
        baseBuf = await sharp(baseBuf).composite([{ input: overlay, left, top }]).png().toBuffer();
      }
      let composed = sharp(baseBuf);
      try {
        const extractLeft = r.x - virtual.x;
        const extractTop = r.y - virtual.y;
        buf = await composed.extract({
          left: Math.max(0, extractLeft),
          top: Math.max(0, extractTop),
          width: Math.min(virtual.width - Math.max(0, extractLeft), r.width),
          height: Math.min(virtual.height - Math.max(0, extractTop), r.height),
        }).toBuffer();
      } catch (err) {
        logError('Region extract (multi-monitor) failed:', (err as Error)?.message);
        log('Region multi-monitor fallback: capturing first intersecting display only');
        const disp = displaysIntersecting[0] ?? electronDisplays[0];
        const displayIndex = electronDisplays.indexOf(disp);
        const screenId = listDisplays[displayIndex]?.id ?? listDisplays[0]?.id;
        opts.screen = screenId ?? undefined;
        opts.format = settings.format === 'jpeg' ? 'jpg' : 'png';
        buf = await screenshot(opts);
        const metaF = await sharp(buf).metadata();
        const cwF = metaF.width ?? disp.bounds.width;
        const chF = metaF.height ?? disp.bounds.height;
        const { left, top, width, height } = regionToExtract(r, disp, cwF, chF);
        buf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
      }
      }
    }
    let pipeline = sharp(buf);
    const scale = settings.captureResolutionScale ?? 0.5;
    if (scale < 1) {
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 1920;
      const h = meta.height ?? 1080;
      pipeline = pipeline.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), { fit: 'inside' });
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
  const scale = settings.captureResolutionScale ?? 0.5;
  if (scale < 1) {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 1920;
    const h = meta.height ?? 1080;
    pipeline = pipeline.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), { fit: 'inside' });
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

/** Local time as session_YYYY-MM-DDTHH-mm-ss (filesystem-safe, matches user's system time). */
function localSessionTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function startNewSession(): string {
  const base = settings.outputFolder;
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const name = `session_${localSessionTimestamp()}`;
  const sessionPath = path.join(base, name);
  fs.mkdirSync(sessionPath, { recursive: true });
  const meta = {
    startedAt: new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }),
    intervalSeconds: settings.intervalSeconds,
    source: settings.source,
    width: settings.width,
    height: settings.height,
    resolutionScale: settings.captureResolutionScale ?? 0.5,
    format: settings.format,
  };
  fs.writeFileSync(path.join(sessionPath, 'metadata.json'), JSON.stringify(meta, null, 2));
  return sessionPath;
}

function runCaptureLoop() {
  if (captureState !== 'recording' || !currentSessionFolder) return;
  const isFirstFrame = frameIndex === 0;
  const intervalSec = Math.max(0.1, settings.intervalSeconds ?? 1);
  if (isFirstFrame) {
    log('Capture loop: first frame scheduled', { intervalSeconds: intervalSec });
  }
  captureFrame()
    .then(async (buf) => {
      if (!buf || buf.length === 0) {
        throw new Error('Capture returned empty buffer (0 bytes)');
      }
      const sessionFolder = currentSessionFolder;
      if (!sessionFolder) {
        return; // Stop was pressed while capture was in flight; skip writing
      }
      const ext = settings.format === 'jpeg' ? 'jpg' : 'png';
      const nextIndex = frameIndex + 1;
      const file = path.join(sessionFolder, `frame_${String(nextIndex).padStart(6, '0')}.${ext}`);
      await fs.promises.writeFile(file, buf);
      const stat = await fs.promises.stat(file);
      if (nextIndex === 1) {
        log('Capture loop: first frame saved', file, 'size:', stat.size, 'bytes');
        if (stat.size === 0) {
          logError('Capture warning: first frame file is 0 bytes – export may fail');
        }
      }
      frameIndex = nextIndex;
    })
    .catch((err) => {
      const file = currentSessionFolder ? path.join(currentSessionFolder, `frame_${String(frameIndex + 1).padStart(6, '0')}.${settings.format === 'jpeg' ? 'jpg' : 'png'}`) : '(no session)';
      logError('Capture error:', (err as Error)?.message ?? err, 'path:', file);
    })
    .finally(() => {
      if (captureState === 'recording') {
        const intervalSec = Math.max(0.1, settings.intervalSeconds ?? 1);
        captureTimer = setTimeout(runCaptureLoop, intervalSec * 1000);
      }
    });
}

ipcMain.on('renderer-error', (_e, message: string, stack: string) => {
  logError('Renderer error:', message, stack || '(no stack)');
});

ipcMain.on('renderer-log', (_e, message: string) => {
  log('[Renderer]', message);
});

ipcMain.on('close-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
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
  const pickerIconPath = getAppIconPath();
  regionPickerWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    ...(pickerIconPath ? { icon: nativeImage.createFromPath(pickerIconPath) } : {}),
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
    if (!regionPickerWindow || regionPickerWindow.isDestroyed()) return;
    regionPickerWindow.setBounds(bounds);
    setImmediate(() => {
      if (!regionPickerWindow || regionPickerWindow.isDestroyed()) return;
      const actual = regionPickerWindow.getBounds();
      // Use actual window bounds so client coords map to real screen position.
      // (OS may move the window, e.g. clamp negative coords; virtual bounds would then be wrong.)
      const effectiveBounds = { x: actual.x, y: actual.y, width: actual.width, height: actual.height };
      regionPickerWindow!.webContents.executeJavaScript(
        `window.__PICKER_BOUNDS__ = ${JSON.stringify(effectiveBounds)};`
      ).catch(() => {});
      regionPickerWindow!.show();
    });
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
    return { bounds: { x: workArea.width - 440, y: workArea.height - 100, width: 420, height: 120 }, workArea, panelOnRight: false };
  }
  const bounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return { bounds, workArea: display.workArea, panelOnRight: overlayPanelOnRight };
});

const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT_COLLAPSED = 120;
const OVERLAY_HEIGHT_SETTINGS = 540;
const OVERLAY_HEIGHT_EXPORT = 720;
const MARGIN = 20;
const SETTINGS_PANEL_WIDTH = 380;
const SETTINGS_PANEL_GAP = 10;
const OVERLAY_WIDTH_WITH_PANEL = OVERLAY_WIDTH + SETTINGS_PANEL_WIDTH + SETTINGS_PANEL_GAP;

/** When expanded, true = panel is to the right of the bar (window grew right); false = panel to the left (window grew left). */
let overlayPanelOnRight = false;

/** Set overlay size and position. When expandedWithPanel, window widens and grows in place (keeps top-left, like Export). Panel is always to the right of the bar. */
function setOverlayBoundsAndSize(newHeight: number, expandedWithPanel?: boolean): void {
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
    const waLeft = workArea.x;
    const waTop = workArea.y;
    const waRight = workArea.x + workArea.width;
    const waBottom = workArea.y + workArea.height;

    if (expandedWithPanel === true) {
      overlayPanelOnRight = true;
    } else if (expandedWithPanel === false) {
      x = bounds.x;
      overlayPanelOnRight = false;
    }

    // Clamp: keep fully inside work area with margin on all sides
    if (x + width > waRight - MARGIN) x = waRight - width - MARGIN;
    if (x < waLeft + MARGIN) x = waLeft + MARGIN;
    if (y + h > waBottom - MARGIN) y = waBottom - h - MARGIN;
    if (y < waTop + MARGIN) y = waTop + MARGIN;

    overlayWindow.setBounds({ x, y, width, height: h }, false);
    log('Overlay bounds:', x, y, width, h, 'panelOnRight:', overlayPanelOnRight);
  } catch (err) {
    logError('setOverlayBoundsAndSize failed:', (err as Error).message);
    overlayWindow.setSize(width, h);
  }
}

ipcMain.handle('set-overlay-expanded', (_e, expanded: boolean): { panelOnRight: boolean } => {
  const hasOverlay = !!overlayWindow && !overlayWindow.isDestroyed();
  if (!hasOverlay) return { panelOnRight: false };
  log('set-overlay-expanded', 'expanded=', expanded);
  const height = expanded ? OVERLAY_HEIGHT_SETTINGS : OVERLAY_HEIGHT_COLLAPSED;
  setOverlayBoundsAndSize(height, expanded);
  log('Overlay expanded:', expanded, 'width:', expanded ? OVERLAY_WIDTH_WITH_PANEL : OVERLAY_WIDTH, 'height:', height, 'panelOnRight:', overlayPanelOnRight);
  return { panelOnRight: overlayPanelOnRight };
});

ipcMain.on('set-overlay-height', (e, height: number) => {
  const hasOverlay = !!overlayWindow && !overlayWindow.isDestroyed();
  const senderIsOverlay = hasOverlay && e.sender === overlayWindow!.webContents;
  if (!senderIsOverlay) return;
  setOverlayBoundsAndSize(height);
  log('Overlay height set:', height);
});

const GET_DISPLAYS_TIMEOUT_MS = 5000;

/** Common display widths/heights so we can snap off-by-one rounding errors (e.g. 3441 → 3440). */
const COMMON_DISPLAY_DIMENSIONS = [5120, 3840, 3440, 2560, 1920, 1680, 1600, 1440, 1366, 1280, 1080, 900, 864, 800, 768, 720, 600, 480];

function snapToCommonDimension(n: number): number {
  const rounded = Math.round(n);
  for (const std of COMMON_DISPLAY_DIMENSIONS) {
    if (Math.abs(rounded - std) <= 1) return std;
  }
  return rounded;
}

function displayPhysicalSize(bounds: { width: number; height: number }, scaleFactor: number | undefined): { width: number; height: number } {
  const s = scaleFactor ?? 1;
  const w = Math.floor(bounds.width);
  const h = Math.floor(bounds.height);
  const width = Math.round(w * s);
  const height = Math.round(h * s);
  return { width: snapToCommonDimension(width), height: snapToCommonDimension(height) };
}

/** On Windows packaged app, Electron sometimes reports scaleFactor 1 for all displays; use primary's scaleFactor so physical size is correct. */
function effectiveScaleFactor(d: Electron.Display, primary: Electron.Display): number {
  const s = d.scaleFactor ?? 1;
  if (process.platform === 'win32' && app.isPackaged && (s === 1 || d.scaleFactor == null)) {
    const primaryScale = primary.scaleFactor ?? 1;
    if (primaryScale > 1) return primaryScale;
  }
  return s;
}

ipcMain.handle('get-displays', async () => {
  const electronDisplayList = () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return displays.map((d, i) => {
      const bounds = d.bounds ?? d.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
      const scale = effectiveScaleFactor(d, primary);
      return {
        id: i,
        index: i,
        name: d.label || `Display ${i + 1}`,
        bounds,
        physicalSize: displayPhysicalSize(bounds, scale),
      };
    });
  };
  // Packaged app: use only Electron so each display's name, bounds and physicalSize come from the same display (avoids wrong monitor size when screenshot list order differs).
  if (app.isPackaged) return electronDisplayList();
  try {
    const list = await Promise.race([
      screenshot.listDisplays(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('listDisplays timeout')), GET_DISPLAYS_TIMEOUT_MS)
      ),
    ]);
    const displays = screen.getAllDisplays();
    return list.map((d, i) => {
      const disp = displays[i];
      const bounds = disp?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 };
      return {
        id: d.id,
        index: i,
        name: d.name || `Display ${i + 1}`,
        bounds,
        physicalSize: displayPhysicalSize(bounds, disp?.scaleFactor),
      };
    });
  } catch (err) {
    logError('get-displays failed (using Electron screen fallback):', (err as Error).message);
    return electronDisplayList();
  }
});

ipcMain.handle('get-settings', () => getSettings());
ipcMain.handle('get-continue-session', () => getContinueSessionPath());
ipcMain.handle('set-continue-session', (_e, path: string | null) => {
  setContinueSessionPath(path || null);
});
ipcMain.handle('set-settings', (_e, s: Partial<CaptureSettings>) => {
  const next = { ...getSettings(), ...s };
  if (typeof next.intervalSeconds === 'number' && next.intervalSeconds < 0.1) next.intervalSeconds = 0.1;
  saveSettings(next);
  if (overlayWindow && !overlayWindow.isDestroyed() && typeof next.overlayOpacity === 'number') {
    const opacity = Math.max(0.1, Math.min(1, next.overlayOpacity));
    overlayWindow.setOpacity(opacity);
  }
  return getSettings();
});

ipcMain.handle('get-state', () => {
  const preferred = getContinueSessionPath();
  const continueTarget = (preferred && fs.existsSync(preferred))
    ? preferred
    : (lastSessionFolder && fs.existsSync(lastSessionFolder) ? lastSessionFolder : null);
  return {
    state: captureState,
    sessionFolder: currentSessionFolder,
    frameCount: frameIndex,
    lastSessionFolder,
    continueTarget,
  };
});

const MAIN_LOG_TAIL_LINES = 1500;

ipcMain.handle('get-main-log-contents', (_e, maxLines?: number) => {
  const logPath = getLogFilePath();
  if (!logPath || !fs.existsSync(logPath)) return '';
  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const n = Math.max(0, Math.min(maxLines ?? MAIN_LOG_TAIL_LINES, lines.length));
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
});

ipcMain.handle('get-startup-flags', () => {
  const userData = app.getPath('userData');
  const isTestUserData = userData.includes('.timelapser-test');
  const runRecordingTest = process.env.RUN_RECORDING_TEST === '1' && isTestUserData;
  const showTestUI = process.argv.includes('--test') || process.argv.includes('-test');
  return { runRecordingTest, showTestUI };
});

ipcMain.handle('recording-test-complete', (_e, payload: { success: boolean; failureReason?: string; logExcerpt?: string }) => {
  const userData = app.getPath('userData');
  const resultPath = path.join(userData, 'recording-test-result.json');
  const result = {
    success: payload.success,
    failureReason: payload.failureReason ?? null,
    logExcerpt: payload.logExcerpt ?? null,
    timestamp: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    logError('recording-test-complete: failed to write result file', (err as Error)?.message);
  }
  const line = payload.success ? 'RECORDING_TEST_FINISHED success' : 'RECORDING_TEST_FINISHED failure';
  log(line);
  writeToLogFile(line, []);
});

ipcMain.handle('start-recording', async (_e, newSession: unknown) => {
  if (captureState === 'recording') {
    logError('start-recording: rejected (already recording)');
    return { ok: false, message: 'Already recording' };
  }
  settings = getSettings();
  const wantNewSession = newSession === true;
  if (wantNewSession || !currentSessionFolder) {
    let continuePath: string | null = null;
    if (!wantNewSession) {
      const preferred = getContinueSessionPath();
      if (preferred && fs.existsSync(preferred)) continuePath = preferred;
      else if (lastSessionFolder && fs.existsSync(lastSessionFolder)) continuePath = lastSessionFolder;
    }
    if (continuePath) {
      currentSessionFolder = continuePath;
      const files = fs.readdirSync(currentSessionFolder).filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f));
      frameIndex = files.length;
    } else {
      currentSessionFolder = startNewSession();
      frameIndex = 0;
    }
  }
  captureState = 'recording';
  log('start-recording: ok', {
    sessionFolder: currentSessionFolder,
    intervalSeconds: settings.intervalSeconds,
    source: settings.source,
    monitorId: settings.monitorId,
    hasRegion: !!settings.region,
    outputFolder: settings.outputFolder,
  });
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
  log('stop-recording', { wasRecording, frameCount: count, sessionFolder: currentSessionFolder ?? undefined });
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

ipcMain.handle('open-log-folder', () => {
  const logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  shell.openPath(logDir);
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

ipcMain.handle('get-first-frame-data-url', async (_e, sessionFolder: string) => {
  try {
    const files = fs.readdirSync(sessionFolder)
      .filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10);
        const nb = parseInt(b.replace(/\D/g, ''), 10);
        return na - nb;
      });
    if (files.length === 0) return { dataUrl: null, width: undefined, height: undefined };
    const firstPath = path.join(sessionFolder, files[0]);
    const buf = fs.readFileSync(firstPath);
    const ext = path.extname(firstPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(buf).metadata();
      if (typeof meta.width === 'number' && typeof meta.height === 'number') {
        width = meta.width;
        height = meta.height;
      }
    } catch {
      // ignore
    }
    return { dataUrl, width, height };
  } catch {
    return { dataUrl: null, width: undefined, height: undefined };
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
    : ext === 'gif' ? [{ name: 'GIF', extensions: ['gif'] }]
    : [{ name: 'MP4', extensions: ['mp4'] }];
  filters.push({ name: 'All files', extensions: ['*'] });
  const result = await dialog.showSaveDialog(win || undefined, {
    title: ext === 'gif' ? 'Save GIF as' : 'Save video as',
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

ipcMain.handle('show-watermark-picker', async () => {
  const win = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select watermark image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
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
  format?: 'mp4' | 'webm' | 'mov' | 'gif';
  maxDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
  cropToFit?: boolean;
  /** How to fit source into output: letterbox (pad), crop (cover), stretch (fill). Takes precedence over cropToFit when set. */
  fitMode?: 'letterbox' | 'crop' | 'stretch';
  /** Crop position when fitMode is crop: 0 = left/top, 0.5 = center, 1 = right/bottom. Default 0.5. */
  cropOffsetX?: number;
  cropOffsetY?: number;
  /** When fitMode is crop: 1 = fill frame (crop overflow); 0.5–1 = zoom out to show more content (letterbox). Default 1. */
  cropZoom?: number;
  maxFileSizeBytes?: number;
  audioPath?: string | null;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  gifMaxDimension?: number | 'full';
  gifQuality?: number;
  gifMaxFrames?: number;
  duplicateLastFrameCount?: number;
  watermarkPath?: string | null;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}) => {
  const a = args as Record<string, unknown>;
  const cropZoomRaw = a.cropZoom;
  const cropZoom = typeof cropZoomRaw === 'number' && Number.isFinite(cropZoomRaw)
    ? Math.max(0.5, Math.min(1, cropZoomRaw))
    : typeof cropZoomRaw === 'string'
      ? Math.max(0.5, Math.min(1, parseFloat(cropZoomRaw) || 1))
      : 1;
  const {
    sessionFolder, outputPath, maxDurationSeconds, fps, width, height,
    cropToFit = false,
    fitMode,
    cropOffsetX = 0.5,
    cropOffsetY = 0.5,
    maxFileSizeBytes,
    quality = 70,
    audioPath = null, fadeInSeconds = 0, fadeOutSeconds = 0,
    format = 'mp4',
    gifMaxDimension,
    gifQuality = 70,
    gifMaxFrames = 0,
    duplicateLastFrameCount = 0,
    watermarkPath = null,
    watermarkPosition = 'bottom-right',
  } = args;
  logMinimal('export-video: cropZoom', cropZoom, 'fitMode', fitMode);
  const hasWatermark = !!(watermarkPath && fs.existsSync(watermarkPath));
  const isGif = format === 'gif';
  /** Map quality 0–100 to CRF (100 = best quality/low CRF, 0 = high compression/high CRF). */
  const crfFromQuality = (q: number, forWebm: boolean) => {
    const clamped = Math.max(0, Math.min(100, q));
    if (forWebm) return Math.round(40 - (clamped / 100) * 22); // 40..18
    return Math.round(35 - (clamped / 100) * 17); // 35..18 for H.264
  };
  const ext = isGif ? 'gif' : format === 'webm' ? 'webm' : format === 'mov' ? 'mov' : 'mp4';
  const destPath = path.extname(outputPath).toLowerCase() !== `.${ext}` ? `${outputPath.replace(/\.[^.]+$/, '')}.${ext}` : outputPath;
  const frames = fs.readdirSync(sessionFolder)
    .filter((f) => /^frame_\d+\.(png|jpg|jpeg)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });
  if (frames.length === 0) return { ok: false, message: 'No frames in session' };
  const firstFramePath = path.join(sessionFolder, frames[0]);
  let firstFrameSize = 0;
  try {
    firstFrameSize = fs.statSync(firstFramePath).size;
  } catch {
    // ignore
  }
  log('export-video: sessionFolder:', sessionFolder, 'frames:', frames.length, 'firstFrame:', frames[0], 'size:', firstFrameSize);
  if (firstFrameSize === 0) {
    logError('export-video: first frame is 0 bytes, refusing to export');
    return { ok: false, message: 'First frame file is empty (0 bytes). The recording did not capture correctly – try a different capture source or reinstall the app.' };
  }
  let srcW = 0;
  let srcH = 0;
  try {
    const buf = fs.readFileSync(firstFramePath);
    const meta = await sharp(buf).metadata();
    if (typeof meta.width === 'number' && typeof meta.height === 'number') {
      srcW = meta.width;
      srcH = meta.height;
    }
  } catch {
    // ignore; crop will use center when srcW/srcH are 0
  }
  logMinimal('export-video: first frame size', srcW, 'x', srcH);
  let ffmpegPath: string | null = null;
  try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    if (process.resourcesPath && ffmpegPath.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    if (!fs.existsSync(ffmpegPath)) ffmpegPath = null;
  } catch {
    ffmpegPath = null;
  }
  if (!ffmpegPath) {
    try {
      const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const first = out.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) ffmpegPath = first;
    } catch {
      // ignore
    }
  }
  if (!ffmpegPath) {
    logError('FFmpeg not found: bundled installer missing and not on PATH');
    return { ok: false, message: 'FFmpeg not found. Install from https://ffmpeg.org or run: winget install FFmpeg' };
  }
  // Get first-frame dimensions the same way FFmpeg will decode them (avoids "Error reinitializing filters" from dimension mismatch)
  const ffprobePath = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (fs.existsSync(ffprobePath)) {
    try {
      const result = spawnSync(ffprobePath, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
        firstFramePath,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0 && result.stdout) {
        const m = result.stdout.trim().match(/^(\d+),(\d+)$/);
        if (m) {
          const w = parseInt(m[1], 10);
          const h = parseInt(m[2], 10);
          if (w > 0 && h > 0) {
            srcW = w;
            srcH = h;
            logMinimal('export-video: ffprobe first frame', srcW, 'x', srcH);
          }
        }
      }
    } catch {
      // keep Sharp dimensions
    }
  }
  /** Normalized even dimensions; force all frames to this size so filter chain never sees dimension changes. */
  const normW = srcW > 0 && srcH > 0 ? Math.max(2, srcW - (srcW % 2)) : 0;
  const normH = srcW > 0 && srcH > 0 ? Math.max(2, srcH - (srcH % 2)) : 0;
  const ffmpeg = require('fluent-ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegPath);
  const firstFrame = firstFramePath;
  const pattern = path.join(sessionFolder, 'frame_%06d' + path.extname(firstFrame)).replace(/\\/g, '/');
  const startNumber = 1; // frames are frame_000001, frame_000002, ...
  let outFps = fps;
  const totalDuration = frames.length / fps;
  if (maxDurationSeconds > 0 && totalDuration > maxDurationSeconds) {
    outFps = frames.length / maxDurationSeconds;
  }
  let videoDurationSec = frames.length / outFps;
  const holdLastSec = duplicateLastFrameCount > 0 ? duplicateLastFrameCount / outFps : 0;
  let frameStep = 1;
  if (isGif && gifMaxFrames > 0 && frames.length > gifMaxFrames) {
    frameStep = Math.max(1, Math.ceil(frames.length / gifMaxFrames));
  }
  if (!isGif && maxFileSizeBytes && maxFileSizeBytes > 0) {
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
  if (isGif) {
    return new Promise((resolve) => {
      // Use concat demuxer so we explicitly pass every frame file (avoids image2 pattern reading only the start)
      const concatListPath = path.join(sessionFolder, `.timelapser_concat_${Date.now()}.txt`);
      const listContent = frames.map((f) => {
        const fullPath = path.join(sessionFolder, f).replace(/\\/g, '/');
        const escaped = fullPath.replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      }).join('\n');
      try {
        fs.writeFileSync(concatListPath, listContent, 'utf8');
      } catch (e) {
        return void resolve({ ok: false, message: (e as Error).message });
      }
      const cleanup = () => { try { fs.unlinkSync(concatListPath); } catch { /* ignore */ } };
      let gifWidth = width;
      let gifHeight = height;
      if (typeof gifMaxDimension === 'number') {
        const maxSide = Math.max(gifWidth, gifHeight);
        if (maxSide > gifMaxDimension) {
          const scale = gifMaxDimension / maxSide;
          gifWidth = Math.max(1, Math.round(gifWidth * scale));
          gifHeight = Math.max(1, Math.round(gifHeight * scale));
        }
      }
      const scaleFactor = Math.max(0.2, Math.min(1, 0.2 + 0.8 * (gifQuality / 100)));
      let outW = Math.max(1, Math.round(gifWidth * scaleFactor));
      let outH = Math.max(1, Math.round(gifHeight * scaleFactor));
      // When gifMaxFrames is set: respect user's frame count and scale resolution to fit file size.
      // When gifMaxFrames is 0: derive frame count from file size, then scale resolution if still over.
      const bytesPerPixelPerFrame = gifMaxFrames > 0 ? 0.4 : 1.2;
      const minAnimatedFrames = 2; // avoid single-frame static GIF only
      if (maxFileSizeBytes && maxFileSizeBytes > 0 && gifMaxFrames <= 0) {
        const targetBytes = maxFileSizeBytes * 0.9;
        const currentPixels = outW * outH;
        let maxNumFramesFromSize = currentPixels > 0
          ? Math.floor(targetBytes / (currentPixels * bytesPerPixelPerFrame))
          : frames.length;
        if (frames.length >= minAnimatedFrames && maxNumFramesFromSize < minAnimatedFrames) maxNumFramesFromSize = minAnimatedFrames;
        maxNumFramesFromSize = Math.max(1, maxNumFramesFromSize);
        const neededFrameStep = Math.ceil(frames.length / maxNumFramesFromSize);
        if (neededFrameStep > frameStep) frameStep = neededFrameStep;
      }
      const numFrames = frameStep > 1 ? Math.ceil(frames.length / frameStep) : frames.length;
      // Scale down resolution when over target size (keeps user's frame count when gifMaxFrames was set)
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
      // Resolution floor: never output smaller than user's chosen max dimension (easy-mode slider)
      if (typeof gifMaxDimension === 'number') {
        const longSide = Math.max(outW, outH);
        if (longSide < gifMaxDimension) {
          const scaleUp = gifMaxDimension / longSide;
          outW = Math.max(1, Math.round(outW * scaleUp));
          outH = Math.max(1, Math.round(outH * scaleUp));
        }
      }
      const vfParts: string[] = [];
      if (frameStep > 1) {
        // Sample evenly across the whole timeline: every frameStep-th frame (0, frameStep, 2*frameStep, ...)
        vfParts.push(`select='not(mod(n\\,${frameStep}))'`, `setpts=N/(${outFps})/TB`);
      }
      // Only apply fps when not skipping (when skipping, setpts already defines timing; fps would risk dropping frames)
      if (frameStep <= 1) vfParts.push(`fps=${outFps}`);
      // Normalize all frames to same (even) size so filter chain never sees dimension changes (avoids "Error reinitializing filters")
      if (normW > 0 && normH > 0) vfParts.push(`scale=${normW}:${normH}:flags=lanczos`);
      const gifFitMode = fitMode ?? (cropToFit ? 'crop' : 'letterbox');
      if (gifFitMode === 'stretch') {
        vfParts.push(`scale=${outW}:${outH}:flags=lanczos`);
      } else if (gifFitMode === 'crop') {
        const zoom = Math.max(0.5, Math.min(1, cropZoom));
        if (normW > 0 && normH > 0) {
          const scaleCover = Math.max(outW / normW, outH / normH);
          const scaleContain = Math.min(outW / normW, outH / normH);
          const t = (zoom - 0.5) / 0.5;
          const effectiveScale = scaleContain + (scaleCover - scaleContain) * t;
          let contentW = Math.max(2, Math.round(normW * effectiveScale));
          let contentH = Math.max(2, Math.round(normH * effectiveScale));
          contentW -= contentW % 2;
          contentH -= contentH % 2;
          if (contentW < 2) contentW = 2;
          if (contentH < 2) contentH = 2;
          if (contentW >= outW && contentH >= outH) {
            let cropX = Math.round((contentW - outW) * cropOffsetX);
            let cropY = Math.round((contentH - outH) * cropOffsetY);
            cropX = Math.max(0, Math.min(contentW - outW, cropX));
            cropY = Math.max(0, Math.min(contentH - outH, cropY));
            vfParts.push(`scale=${contentW}:${contentH}:flags=lanczos`, `crop=${outW}:${outH}:${cropX}:${cropY}`);
          } else if (contentW <= outW && contentH <= outH) {
            const padX = Math.max(0, Math.round((outW - contentW) / 2));
            const padY = Math.max(0, Math.round((outH - contentH) / 2));
            vfParts.push(`scale=${contentW}:${contentH}:flags=lanczos`, `pad=${outW}:${outH}:${padX}:${padY}:black`);
          } else {
            vfParts.push(`scale=${outW}:${outH}:force_original_aspect_ratio=increase`, `crop=${outW}:${outH}`);
          }
        } else {
          vfParts.push(`scale=${outW}:${outH}:force_original_aspect_ratio=increase`, `crop=${outW}:${outH}`);
        }
      } else {
        vfParts.push(`scale=${outW}:${outH}:force_original_aspect_ratio=decrease`, `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`);
      }
      if (holdLastSec > 0) {
        vfParts.push(`tpad=stop_mode=clone:stop_duration=${holdLastSec}`);
      }
      vfParts.push('split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer');
      const overlayPos = (): string => {
        const m = (x: string, y: string) => `overlay=x=${x}:y=${y}`;
        switch (watermarkPosition) {
          case 'top-left': return m('10', '10');
          case 'top-right': return m("'main_w-overlay_w-10'", '10');
          case 'bottom-left': return m('10', "'main_h-overlay_h-10'");
          case 'bottom-right': return m("'main_w-overlay_w-10'", "'main_h-overlay_h-10'");
          case 'center': return m("'(main_w-overlay_w)/2'", "'(main_h-overlay_h)/2'");
          default: return m("'main_w-overlay_w-10'", "'main_h-overlay_h-10'");
        }
      };
      if (hasWatermark) {
        const baseChain = vfParts.join(',');
        const filterComplex = `[0:v]${baseChain}[v];[1:v]scale=200:-1[wm];[v][wm]${overlayPos()}[out]`;
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .input(watermarkPath!)
          .complexFilter(filterComplex, 'out')
          .outputOptions(['-r', String(outFps), '-loop', '0'])
          .output(destPath)
          .on('end', () => { cleanup(); resolve({ ok: true, path: destPath }); })
          .on('error', (e: Error) => { cleanup(); resolve({ ok: false, message: e.message }); })
          .run();
      } else {
        const vfStr = vfParts.join(',');
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-r', String(outFps), '-vf', vfStr, '-loop', '0'])
          .output(destPath)
          .on('end', () => { cleanup(); resolve({ ok: true, path: destPath }); })
          .on('error', (e: Error) => { cleanup(); resolve({ ok: false, message: e.message }); })
          .run();
      }
    });
  }
  const effectiveDurationSec = frameStep > 1 ? (frames.length / frameStep) / outFps : videoDurationSec;
  const crfVp9 = crfFromQuality(quality, true);
  const crfH264 = crfFromQuality(quality, false);
  let videoOpts: string[];
  if (maxFileSizeBytes && maxFileSizeBytes > 0) {
    const targetVideoBytes = maxFileSizeBytes * 0.9;
    const targetKbps = Math.max(300, Math.min(20000, Math.round((targetVideoBytes * 8) / effectiveDurationSec / 1000)));
    if (ext === 'webm') {
      videoOpts = [`-r ${outFps}`, '-c:v libvpx-vp9', '-pix_fmt yuv420p', `-b:v ${targetKbps}k`, `-crf ${Math.min(crfVp9, 35)}`];
    } else {
      videoOpts = [`-r ${outFps}`, '-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart', `-b:v ${targetKbps}k`, `-maxrate ${targetKbps}k`, `-bufsize ${Math.min(2 * targetKbps, 40000)}k`];
    }
  } else {
    videoOpts = ext === 'webm'
      ? [`-r ${outFps}`, '-c:v libvpx-vp9', '-pix_fmt yuv420p', '-b:v 0', `-crf ${crfVp9}`]
      : [`-r ${outFps}`, '-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart', `-crf ${crfH264}`];
  }

  const hasAudio = audioPath && fs.existsSync(audioPath);
  const totalVideoSec = videoDurationSec + holdLastSec;
  const fadeIn = Math.max(0, Math.min(fadeInSeconds, totalVideoSec / 2));
  const fadeOut = Math.max(0, Math.min(fadeOutSeconds, totalVideoSec / 2));
  const fadeOutStart = Math.max(0, totalVideoSec - fadeOut);

  const overlayPosExpr = (): string => {
    const m = (x: string, y: string) => `overlay=x=${x}:y=${y}`;
    switch (watermarkPosition) {
      case 'top-left': return m('10', '10');
      case 'top-right': return m("'main_w-overlay_w-10'", '10');
      case 'bottom-left': return m('10', "'main_h-overlay_h-10'");
      case 'bottom-right': return m("'main_w-overlay_w-10'", "'main_h-overlay_h-10'");
      case 'center': return m("'(main_w-overlay_w)/2'", "'(main_h-overlay_h)/2'");
      default: return m("'main_w-overlay_w-10'", "'main_h-overlay_h-10'");
    }
  };

  return new Promise((resolve) => {
    // Concat list for video: same as GIF, so FFmpeg gets one explicit file per frame (avoids image2 pattern dimension quirks)
    const videoConcatPath = path.join(sessionFolder, `.timelapser_video_concat_${Date.now()}.txt`);
    let videoConcatCreated = false;
    try {
      const listContent = frames.map((f) => {
        const fullPath = path.join(sessionFolder, f).replace(/\\/g, '/');
        const escaped = fullPath.replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      }).join('\n');
      fs.writeFileSync(videoConcatPath, listContent, 'utf8');
      videoConcatCreated = true;
    } catch (e) {
      return void resolve({ ok: false, message: (e as Error).message });
    }
    const cleanupVideoConcat = () => { try { if (videoConcatCreated) fs.unlinkSync(videoConcatPath); } catch { /* ignore */ } };

    const runVideoOnly = (dest: string, onDone: (err: Error | null) => void) => {
      const vfParts: string[] = [];
      // Normalize first so every filter downstream sees the same dimensions (avoids "Error reinitializing filters")
      if (normW > 0 && normH > 0) vfParts.push(`scale=${normW}:${normH}`);
      vfParts.push(`fps=${fps}`);
      if (frameStep > 1) {
        vfParts.push(`select='not(mod(n\\,${frameStep}))'`, `setpts=N/(${fps}*${frameStep})/TB`);
      }
      const mode = fitMode ?? (cropToFit ? 'crop' : 'letterbox');
      if (mode === 'stretch') {
        vfParts.push(`scale=${width}:${height}`);
      } else if (mode === 'crop') {
        const zoom = Math.max(0.5, Math.min(1, cropZoom));
        logMinimal('export-video: crop branch zoom=', zoom, 'norm=', normW, 'x', normH);
        if (normW > 0 && normH > 0) {
          const scaleCover = Math.max(width / normW, height / normH);
          const scaleContain = Math.min(width / normW, height / normH);
          const t = (zoom - 0.5) / 0.5;
          const effectiveScale = scaleContain + (scaleCover - scaleContain) * t;
          let contentW = Math.max(2, Math.round(normW * effectiveScale));
          let contentH = Math.max(2, Math.round(normH * effectiveScale));
          contentW -= contentW % 2;
          contentH -= contentH % 2;
          if (contentW < 2) contentW = 2;
          if (contentH < 2) contentH = 2;
          logMinimal('export-video: zoom scale cover=', scaleCover, 'contain=', scaleContain, 't=', t, 'effective=', effectiveScale, 'content=', contentW, 'x', contentH);
          if (contentW >= width && contentH >= height) {
            let cropX = Math.round((contentW - width) * cropOffsetX);
            let cropY = Math.round((contentH - height) * cropOffsetY);
            cropX = Math.max(0, Math.min(contentW - width, cropX));
            cropY = Math.max(0, Math.min(contentH - height, cropY));
            vfParts.push(`scale=${contentW}:${contentH}`, `crop=${width}:${height}:${cropX}:${cropY}`);
            logMinimal('export-video: zoom filter scale', contentW, contentH, 'crop', width, height, cropX, cropY);
          } else if (contentW <= width && contentH <= height) {
            const padX = Math.max(0, Math.round((width - contentW) / 2));
            const padY = Math.max(0, Math.round((height - contentH) / 2));
            vfParts.push(`scale=${contentW}:${contentH}`, `pad=${width}:${height}:${padX}:${padY}:black`);
            logMinimal('export-video: zoom filter scale', contentW, contentH, 'pad', width, height, padX, padY);
          } else {
            // Mixed: one dimension > output, one < output -> scale to cover and crop
            vfParts.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
            logMinimal('export-video: zoom filter mixed -> cover+crop');
          }
        } else {
          vfParts.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
        }
      } else {
        vfParts.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
      }
      if (holdLastSec > 0) {
        vfParts.push(`tpad=stop_mode=clone:stop_duration=${holdLastSec}`);
      }
      if (hasWatermark) {
        const baseChain = vfParts.join(',');
        const filterComplex = `[0:v]${baseChain}[v];[1:v]scale=200:-1[wm];[v][wm]${overlayPosExpr()}[out]`;
        const chain = ffmpeg()
          .input(videoConcatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .input(watermarkPath!)
          .complexFilter(filterComplex, 'out')
          .outputOptions(videoOpts)
          .output(dest)
          .on('end', () => { cleanupVideoConcat(); onDone(null); })
          .on('error', (e: Error) => { cleanupVideoConcat(); onDone(e); });
        chain.run();
      } else {
        const chain = ffmpeg()
          .input(videoConcatPath)
          .inputOptions(['-f', 'concat', '-safe', '0']);
        chain.outputOptions(videoOpts).output(dest)
          .on('end', () => { cleanupVideoConcat(); onDone(null); })
          .on('error', (e: Error) => { cleanupVideoConcat(); onDone(e); });
        if (vfParts.length > 0) {
          chain.outputOptions(['-vf', vfParts.join(',')]);
        } else {
          chain.size(`${width}x${height}`);
        }
        chain.run();
      }
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
      audioFilter.push(`atrim=0:${totalVideoSec}`);
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
  try {
    if (app.isReady()) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      const logFile = path.join(logDir, 'main.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${LOG_PREFIX} Uncaught exception: ${err?.stack ?? err}\n`);
    }
  } catch { /* ignore */ }
  // Do not use console here: stdout/stderr may be a broken pipe (EPIPE) if the terminal closed
});

process.on('unhandledRejection', (reason, p) => {
  try {
    if (app.isReady()) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      const logFile = path.join(logDir, 'main.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${LOG_PREFIX} Unhandled rejection: ${String(reason)}\n`);
    }
  } catch { /* ignore */ }
  // Do not use console here: stdout/stderr may be a broken pipe (EPIPE) if the terminal closed
});

logMinimal('Main process starting, app.isReady:', app.isReady());

app.whenReady().then(async () => {
  logMinimal('App ready');
  try {
    logMinimal('Loading settings...');
    settings = getSettings();
    logMinimal('Settings loaded, outputFolder:', settings.outputFolder);
    try {
      app.setLoginItemSettings({ openAtLogin: getOpenAtLogin() });
    } catch (err) {
      logError('setLoginItemSettings on startup:', (err as Error)?.message);
    }
    await createWindow();
    logMinimal('Startup complete');
    logMinimal('Log file:', path.join(app.getPath('userData'), 'logs', 'main.log'));
  } catch (err) {
    logError('Startup failed:', err);
    try {
      console.error(LOG_PREFIX, 'Startup error:', err);
    } catch {
      // Ignore EPIPE if terminal/pipe is closed
    }
    app.quit(1);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  logMinimal('window-all-closed');
  if (isQuitting) {
    // User chose Quit from tray; destroy tray and exit.
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = null;
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
    app.quit();
    return;
  }
  // Keep app running in tray; don't quit. User can show overlay again from tray.
  if (tray && !tray.isDestroyed()) {
    return;
  }
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  if (tray) tray.destroy();
  app.quit();
});
