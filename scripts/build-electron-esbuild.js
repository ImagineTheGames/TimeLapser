const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distElectron = path.join(root, 'dist-electron');

if (!fs.existsSync(distElectron)) {
  fs.mkdirSync(distElectron, { recursive: true });
}

const esbuild = (input, output) => {
  execSync(
    `npx esbuild "${input}" --outfile="${output}" --platform=node --format=cjs --packages=external`,
    { cwd: root, stdio: 'inherit' }
  );
};

esbuild(path.join(root, 'electron', 'main.ts'), path.join(distElectron, 'main.js'));
esbuild(path.join(root, 'electron', 'preload.ts'), path.join(distElectron, 'preload.js'));
esbuild(path.join(root, 'electron', 'preload-region-picker.ts'), path.join(distElectron, 'preload-region-picker.js'));
fs.copyFileSync(
  path.join(root, 'electron', 'region-picker.html'),
  path.join(distElectron, 'region-picker.html')
);
console.log('Electron build (esbuild) done.');
