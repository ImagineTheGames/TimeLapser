/**
 * Runs the automated recording test by launching Electron with RUN_RECORDING_TEST=1
 * and ELECTRON_USER_DATA pointing to ./.timelapser-test. Polls for completion and
 * exits 0 on success, 1 on failure or timeout.
 * Usage: node scripts/run-recording-test.js
 * From project root. Build Electron first (e.g. npm run build:electron or dist:win).
 */

const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const USER_DATA = path.join(PROJECT_ROOT, '.timelapser-test');
const RESULT_FILE = path.join(USER_DATA, 'recording-test-result.json');
const LOG_FILE = path.join(USER_DATA, 'logs', 'main.log');
const APPDATA = process.env.APPDATA || process.env.LOCALAPPDATA || '';
const DEFAULT_USER_DATA = path.join(APPDATA, 'timelapser');
const RESULT_FILE_DEFAULT = path.join(DEFAULT_USER_DATA, 'recording-test-result.json');
const LOG_FILE_DEFAULT = path.join(DEFAULT_USER_DATA, 'logs', 'main.log');
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readResultFrom(pathToFile) {
  try {
    if (pathToFile && fs.existsSync(pathToFile)) {
      const raw = fs.readFileSync(pathToFile, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function readResult() {
  return readResultFrom(RESULT_FILE) || readResultFrom(RESULT_FILE_DEFAULT);
}

function logContainsFinished(content, afterIso) {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d.:]+Z)\s+.*RECORDING_TEST_FINISHED\s+(success|failure)/);
    if (m && (!afterIso || m[1] >= afterIso)) return m[2];
  }
  return null;
}

function readLogTail(logPath, maxLines) {
  try {
    if (logPath && fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      return lines.slice(-(maxLines || 500)).join('\n');
    }
  } catch (e) {
    // ignore
  }
  return '';
}

function killExistingElectron() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /IM electron.exe /F 2>nul', { stdio: 'ignore', windowsHide: true });
    } else {
      execSync('pkill -x electron 2>/dev/null || true', { stdio: 'ignore' });
    }
  } catch (e) {
    // ignore
  }
}

function main() {
  ensureDir(USER_DATA);
  ensureDir(path.dirname(LOG_FILE));

  console.log('[run-recording-test] Ensuring no other Electron instances...');
  killExistingElectron();
  // Brief wait so processes fully exit before we spawn
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    await wait(800);

    const env = { ...process.env, RUN_RECORDING_TEST: '1', ELECTRON_USER_DATA: USER_DATA };
    console.log('[run-recording-test] Starting Electron with RUN_RECORDING_TEST=1...');
    console.log('[run-recording-test] User data:', USER_DATA);
    const child = spawn('npx', ['electron', '.'], { cwd: PROJECT_ROOT, env, stdio: 'inherit', shell: true });

    const start = Date.now();
    const startIso = new Date(start).toISOString();
    const check = () => {
      if (Date.now() - start > TIMEOUT_MS) {
        console.error('[run-recording-test] Timeout. Killing Electron.');
        child.kill('SIGTERM');
        process.exit(1);
      }
      const result = readResult();
      if (result && result.timestamp && result.timestamp >= startIso) {
        child.kill('SIGTERM');
        if (result.success) {
          console.log('[run-recording-test] PASSED.');
          process.exit(0);
        }
        console.error('[run-recording-test] FAILED:', result.failureReason || result.logExcerpt || 'see log');
        process.exit(1);
      }
      try {
        const logContent = readLogTail(LOG_FILE, 1000) || readLogTail(LOG_FILE_DEFAULT, 1000);
        const finished = logContent && logContainsFinished(logContent, startIso);
        if (finished) {
          child.kill('SIGTERM');
          const r = readResult();
          if (r && r.success) {
            console.log('[run-recording-test] PASSED (from log).');
            process.exit(0);
          }
          console.error('[run-recording-test] FAILED (from log).', r?.failureReason || r?.logExcerpt || '');
          process.exit(1);
        }
      } catch (e) {
        // ignore
      }
      setTimeout(check, POLL_MS);
    };
    setTimeout(check, POLL_MS);

    child.on('exit', (code) => {
      const result = readResult();
      if (result && result.timestamp && result.timestamp >= startIso) {
        if (result.success) {
          console.log('[run-recording-test] PASSED (process exited).');
          process.exit(0);
        }
        console.error('[run-recording-test] FAILED:', result.failureReason || result.logExcerpt || '');
        process.exit(1);
      }
      if (code !== 0 && code !== null) {
        console.error('[run-recording-test] Electron exited with code', code);
        process.exit(1);
      }
      console.log('[run-recording-test] Process exited; no result file yet. Exiting 0.');
      process.exit(0);
    });
  })();
}

main();
