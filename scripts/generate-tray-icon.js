/**
 * Generates public/icon.png for app and tray: rounded blue square with red recording circle.
 * Run: node scripts/generate-tray-icon.js
 */
const path = require('path');
const sharp = require('sharp');

const SIZE = 64;
const OUT = path.join(__dirname, '..', 'public', 'icon.png');

async function main() {
  const radius = 14;
  const center = SIZE / 2;
  const circleRadius = SIZE * 0.22;

  const svg = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${SIZE}" height="${SIZE}" rx="${radius}" ry="${radius}" fill="#2563eb"/>
      <circle cx="${center}" cy="${center}" r="${circleRadius}" fill="#ef4444"/>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
