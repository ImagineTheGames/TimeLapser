const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'node_modules', 'source-map', 'lib', 'base64.js');
const source = path.join(__dirname, 'source-map-base64.js');
if (fs.existsSync(path.dirname(target)) && fs.existsSync(source)) {
  try {
    fs.copyFileSync(source, target);
    console.log('Patched source-map lib/base64.js');
  } catch (e) {
    console.warn('Could not patch source-map:', e.message);
  }
}
