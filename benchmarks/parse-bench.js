#!/usr/bin/env node
// Times parse + normalize and planning for every SVG in fixtures/generated (and any files
// passed as arguments). Run `npm run build` first; this loads the built core package.
//
//   node benchmarks/generate-fixtures.js
//   node benchmarks/parse-bench.js
//   node benchmarks/parse-bench.js path/to/drawing.svg

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const core = require('@nikpnevmatikos/svg-core');

const generatedDir = path.join(__dirname, '..', 'fixtures', 'generated');
const files = process.argv.slice(2);
if (files.length === 0 && fs.existsSync(generatedDir)) {
  for (const name of fs.readdirSync(generatedDir).sort()) {
    if (name.endsWith('.svg')) files.push(path.join(generatedDir, name));
  }
}
if (files.length === 0) {
  console.error('No fixtures found. Run `node benchmarks/generate-fixtures.js` first or pass SVG paths.');
  process.exit(1);
}

const RUNS = 5;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function countNodes(node) {
  let count = 1;
  if (node.kind === 'group') for (const child of node.children) count += countNodes(child);
  return count;
}

console.log(
  ['file', 'KB', 'nodes', 'parse ms', 'plan ms', 'units', 'batches', 'merged', 'warnings']
    .map((h, i) => (i === 0 ? h.padEnd(22) : h.padStart(10)))
    .join('')
);

for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  const parseTimes = [];
  const planTimes = [];
  let doc = null;
  let plan = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    doc = core.parseSvg(xml);
    const t1 = performance.now();
    plan = core.planDocument(doc);
    const t2 = performance.now();
    parseTimes.push(t1 - t0);
    planTimes.push(t2 - t1);
  }
  const row = [
    path.basename(file).padEnd(22),
    String(Math.round(xml.length / 1024)).padStart(10),
    String(countNodes(doc.root)).padStart(10),
    median(parseTimes).toFixed(1).padStart(10),
    median(planTimes).toFixed(1).padStart(10),
    String(plan.units.length).padStart(10),
    String(plan.batchCount).padStart(10),
    String(plan.mergedShapes).padStart(10),
    String(doc.warnings.length).padStart(10),
  ];
  console.log(row.join(''));
}
