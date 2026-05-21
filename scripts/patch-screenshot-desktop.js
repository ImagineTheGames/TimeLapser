/**
 * Patch screenshot-desktop's screenCapture_1.3.2.bat so it invokes its compiled
 * .exe via an absolute path (%~dp0%~n0.exe) instead of the bare name (%~n0.exe).
 *
 * Modern Windows ships with NoDefaultCurrentDirectoryInExePath enabled by
 * default, which prevents cmd.exe from finding the exe in the current
 * directory when invoked without a path prefix. On affected machines the
 * capture loop fails every tick with:
 *   'screenCapture_1.3.2.exe' is not recognized as an internal or external
 *   command, operable program or batch file.
 *
 * This script is idempotent and safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'screenshot-desktop',
  'lib',
  'win32',
  'screenCapture_1.3.2.bat'
);

if (!fs.existsSync(target)) {
  // Package not installed (e.g. non-Windows dev) -- nothing to do.
  process.exit(0);
}

let src;
try {
  src = fs.readFileSync(target, 'utf8');
} catch (e) {
  console.warn('Could not read screenshot-desktop bat:', e.message);
  process.exit(0);
}

if (src.includes('"%~dp0%~n0.exe"')) {
  // Already patched.
  process.exit(0);
}

let patched = src;
// 1) exe existence check
patched = patched.replace(
  /if not exist "%~n0\.exe" \(/,
  'if not exist "%~dp0%~n0.exe" ('
);
// 2) /win32manifest path: resolve relative to bat dir
patched = patched.replace(
  /\/win32manifest:"app\.manifest"/,
  '/win32manifest:"%~dp0app.manifest"'
);
// 3) /out path: emit exe next to bat
patched = patched.replace(
  /\/out:"%~n0\.exe"/,
  '/out:"%~dp0%~n0.exe"'
);
// 4) invocation: call the exe via absolute path
patched = patched.replace(
  /^%~n0\.exe %\*$/m,
  '"%~dp0%~n0.exe" %*'
);

if (patched === src) {
  console.warn('patch-screenshot-desktop: no patterns matched -- bat format may have changed');
  process.exit(0);
}

try {
  fs.writeFileSync(target, patched, 'utf8');
  console.log('Patched screenshot-desktop screenCapture_1.3.2.bat (absolute exe path)');
} catch (e) {
  console.warn('Could not write patched screenshot-desktop bat:', e.message);
}
