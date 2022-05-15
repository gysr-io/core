#!/usr/bin/env node
// prepare abis for packaging

const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');

const abis = './abis';
const artifacts = 'build/contracts';
console.log('Staging ABIs for packaging...');

const pkg = JSON.parse(fs.readFileSync('package.json'));
const included = pkg.files.filter(f => !f.startsWith('!') && !f.startsWith('abi'));
console.log(included)

if (!fs.existsSync(abis)) {
  fs.mkdirSync(abis);
}


for (const a of fs.readdirSync(artifacts)) {
  const artifact = JSON.parse(fs.readFileSync(path.join(artifacts, a)));
  const source = path.relative('.', artifact.sourcePath);

  if (micromatch.any(source, included)) {
    console.log(a);
    fs.writeFileSync(path.join(abis, a), JSON.stringify(artifact.abi, null, 2));
  }
}

