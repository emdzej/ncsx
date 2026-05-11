#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseDatenFile } from '../dist/index.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: inspect.mjs <file>');
  process.exit(1);
}

const buf = readFileSync(path);
const warns = [];
const file = parseDatenFile(buf, { strictCrc: false, onWarning: (m) => warns.push(m) });

console.log('signatures:', file.signatures.map((s) => '0x' + s.type.toString(16)).join(', '));
console.log('blocks:');
for (const b of file.blocks) {
  console.log(`  0x${b.id.toString(16).padStart(4, '0')}  ${b.name}  rows=${b.rows.length}`);
  for (const f of b.fields) {
    console.log(`      ${f.name.padEnd(20)}  ${f.kind.padEnd(15)}  ${f.scalar}`);
  }
  if (b.rows.length > 0) {
    console.log('      first row:', JSON.stringify(b.rows[0], null, 2).split('\n').join('\n      '));
  }
}
if (warns.length) {
  console.log('\nwarnings:');
  for (const w of warns) console.log('  ', w);
}
