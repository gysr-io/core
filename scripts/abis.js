#!/usr/bin/env node
// prepare abis for packaging

const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');

const abis = './abis';
const artifacts = 'artifacts/contracts';
console.log('Staging ABIs for packaging...');

const pkg = JSON.parse(fs.readFileSync('package.json'));
const included = pkg.files.filter(f => !f.startsWith('!') && !f.startsWith('abi'));

if (!fs.existsSync(abis)) {
  fs.mkdirSync(abis);
  fs.mkdirSync(path.join(abis, 'interfaces'));
  fs.mkdirSync(path.join(abis, 'info'));
}

function getFiles(dir, files) {
  files = files || [];
  fs.readdirSync(dir).forEach(file => {
    const abs = path.join(dir, file);
    if (fs.statSync(abs).isDirectory()) {
      files = getFiles(abs, files);
    }
    else if (!abs.includes('.dbg')) {
      files.push(abs);
    }
  });
  return files;
}
const files = getFiles(artifacts);

for (const f of files) {
  const artifact = JSON.parse(fs.readFileSync(f));
  const source = path.relative('.', artifact.sourceName);

  if (micromatch.any(source, included)) {
    const subpath = path.dirname(path.relative('./contracts', source));
    const name = path.basename(f);
    console.log(subpath, name);
    fs.writeFileSync(path.join(abis, subpath, name), JSON.stringify(artifact.abi, null, 2));
  }
}
