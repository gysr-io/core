#!/usr/bin/env node
// prepare abis for packaging

const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');

const stage = './stage'
const artifacts = './artifacts/contracts';
console.log('Staging ABIs and contracts for packaging...');

const pkg = JSON.parse(fs.readFileSync('package.json'));
const included = pkg.files.filter(f => !f.startsWith('!') && !f.startsWith('abi'));

// setup package staging directory
if (!fs.existsSync(stage)) {
  fs.mkdirSync(stage);
  fs.mkdirSync(path.join(stage, 'abis'));
  fs.mkdirSync(path.join(stage, 'abis', 'interfaces'));
  fs.mkdirSync(path.join(stage, 'abis', 'info'));
  fs.mkdirSync(path.join(stage, 'contracts'));
  fs.mkdirSync(path.join(stage, 'contracts', 'interfaces'));
  fs.mkdirSync(path.join(stage, 'contracts', 'info'));
}
fs.copyFileSync('package.json', path.join(stage, 'package.json'));
fs.copyFileSync('README.md', path.join(stage, 'README.md'));
fs.copyFileSync('LICENSE', path.join(stage, 'LICENSE'));

// list files recursively
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
    // abi
    const subpath = path.dirname(path.relative('./contracts', source));
    const name = path.basename(f);
    console.log(source, subpath, name);
    fs.writeFileSync(path.join(stage, 'abis', subpath, name), JSON.stringify(artifact.abi, null, 2));

    // contract
    const src = fs.readFileSync(source, 'utf8');
    const replaced = src.replace(/0.8.18;/, '^0.8.18;')
    fs.writeFileSync(path.join(stage, source), replaced, 'utf8')
  }
}
