/**
 * Generates public/icon.png for app and tray (timelapse-themed, works at 16–32px).
 * Run: node scripts/generate-tray-icon.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SIZE = 64;
const OUT = path.join(__dirname, '..', 'public', 'icon.png');

const bg = { r: 30, g: 41, b: 59, alpha: 1 };
const fg = { r: 226, g: 232, b: 240, alpha: 1 };

async function main() {
  const padding = 10;
  const cell = (SIZE - 2 * padding) / 3;
  const gap = 2;

  const frames = [
    { x: padding, y: padding },
    { x: padding + cell + gap, y: padding },
    { x: padding + 2 * (cell + gap), y: padding },
  ];

  const bgSvg = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${SIZE}" height="${SIZE}" rx="12" fill="rgb(30,41,59)"/>
    </svg>
  `;

  let frameSvg = '';
  frames.forEach(({ x, y }, i) => {
    const w = cell;
    const h = cell;
    frameSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="rgb(226,232,240)"/>`;
    if (i === 1) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const t = 5;
      frameSvg += `<path d="M${cx-t} ${cy-t} L${cx-t} ${cy+t} L${cx+t} ${cy} Z" fill="rgb(30,41,59)"/>`;
    }
  });

  const fullSvg = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${SIZE}" height="${SIZE}" rx="12" fill="rgb(30,41,59)"/>
      ${frameSvg}
    </svg>
  `;

  const buf = Buffer.from(fullSvg);
  await sharp(buf)
    .resize(SIZE, SIZE)
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
