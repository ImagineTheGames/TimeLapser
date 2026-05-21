/**
 * Verify export duration matches targetDurationSeconds.
 * Creates a synthetic 600-frame session, exports targeting 20s, then probes the result.
 * Pass = output duration within 0.5s of 20s.
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_DIR = path.join(PROJECT_ROOT, 'test-export-session', 'session_verify');
const OUT_PATH = path.join(PROJECT_ROOT, 'test-export-session', 'verify.mp4');
const W = 640;
const H = 360;
const NUM_FRAMES = 600;
const TARGET_SEC = 20;

async function mkFrames() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  for (let i = 1; i <= NUM_FRAMES; i++) {
    const c = (i * 4) % 255;
    const buf = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: c, g: 60, b: 80 } }
    }).jpeg({ quality: 70 }).toBuffer();
    fs.writeFileSync(path.join(SESSION_DIR, `frame_${String(i).padStart(6, '0')}.jpg`), buf);
  }
}

async function main() {
  await mkFrames();

  // Mirror the IPC path: load main.ts exports? Too heavy. Call ffmpeg the same way main.ts does.
  const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

  const effFps = NUM_FRAMES / TARGET_SEC; // 30
  const concatList = path.join(SESSION_DIR, '.concat.txt');
  const frames = fs.readdirSync(SESSION_DIR).filter((f) => /^frame_\d+\.jpg$/.test(f)).sort();
  fs.writeFileSync(
    concatList,
    frames.map((f) => `file '${path.join(SESSION_DIR, f).replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );

  function runFfmpeg(extraInputArgs, label) {
    const dest = OUT_PATH.replace(/\.mp4$/, `_${label}.mp4`);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    const args = [
      '-y', '-f', 'concat', '-safe', '0',
      ...extraInputArgs,
      '-i', concatList,
      '-vf', `scale=${W}:${H},fps=${effFps}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
      dest,
    ];
    const r = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`ffmpeg ${label} failed`, r.stderr.slice(-500));
      return null;
    }
    // Parse Duration from ffmpeg -i stderr (HH:MM:SS.ss)
    const probe = spawnSync(ffmpegPath, ['-i', dest], { encoding: 'utf8' });
    const m = (probe.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!m) { console.error('could not parse duration for', dest); return NaN; }
    return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }

  const beforeDur = runFfmpeg([], 'BEFORE'); // old buggy path (no -r)
  const afterDur = runFfmpeg(['-r', String(effFps)], 'AFTER'); // fixed path (-r outFps)

  console.log('--- result ---');
  console.log('target seconds:', TARGET_SEC);
  console.log('frames:', NUM_FRAMES, 'effFps:', effFps);
  console.log('BEFORE (no -r):', beforeDur, 's');
  console.log('AFTER  (-r effFps):', afterDur, 's');
  const pass = Math.abs(afterDur - TARGET_SEC) < 0.5;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
