/**
 * Generates build/icon.png (256x256) and build/icon.ico from public/icon.png.
 * Windows exe needs 256x256 PNG; NSIS installer/uninstaller need ICO.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public', 'icon.png');
const buildDir = path.join(root, 'build');
const outPng = path.join(buildDir, 'icon.png');
const outIco = path.join(buildDir, 'icon.ico');

if (!fs.existsSync(src)) {
  console.error('build-win-icon: public/icon.png not found');
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

async function main() {
  try {
    await sharp(src)
      .resize(256, 256)
      .png()
      .toFile(outPng);
    console.log('build-win-icon: build/icon.png (256x256) created');

    const pngToIco = (await import('png-to-ico')).default;
    const icoBuffer = await pngToIco(outPng);
    fs.writeFileSync(outIco, icoBuffer);
    console.log('build-win-icon: build/icon.ico created');
  } catch (err) {
    console.error('build-win-icon:', err);
    process.exit(1);
  }
}

main();
