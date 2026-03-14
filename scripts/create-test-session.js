/**
 * Creates a minimal session folder with frame images for export testing.
 * Usage: node scripts/create-test-session.js
 * Creates: test-export-session/session_YYYY-MM-DDTHH-MM-SS/ with frame_000001.jpg ... frame_000015.jpg
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_ROOT = path.join(PROJECT_ROOT, 'test-export-session');
const NOW = new Date();
const SESSION_NAME = `session_${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}T${String(NOW.getHours()).padStart(2, '0')}-${String(NOW.getMinutes()).padStart(2, '0')}-${String(NOW.getSeconds()).padStart(2, '0')}`;
const SESSION_DIR = path.join(SESSION_ROOT, SESSION_NAME);
const W = 1720;
const H = 720;
const NUM_FRAMES = 15;

async function main() {
  if (!fs.existsSync(SESSION_ROOT)) fs.mkdirSync(SESSION_ROOT, { recursive: true });
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const buf = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 40, g: 60, b: 80 } }
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  for (let i = 1; i <= NUM_FRAMES; i++) {
    const name = `frame_${String(i).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(SESSION_DIR, name), buf);
  }

  console.log('Created', SESSION_DIR, 'with', NUM_FRAMES, 'frames', W + 'x' + H);
  console.log('SESSION_ROOT=', SESSION_ROOT);
}

main().catch((e) => { console.error(e); process.exit(1); });
