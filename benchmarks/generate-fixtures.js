#!/usr/bin/env node
// Generates large synthetic SVG grids into fixtures/generated/ for benchmarks.
// Many elements, few paint styles: the shape of real floor plans and technical drawings.
//
//   node benchmarks/generate-fixtures.js            # 1k, 10k and 50k element grids
//   node benchmarks/generate-fixtures.js 2000 8000  # custom element counts

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'fixtures', 'generated');
const FILLS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fde2e4', '#ede9fe', '#e0f2fe'];

function generateGrid(targetElements) {
  const cols = Math.ceil(Math.sqrt(targetElements * 1.4));
  const rows = Math.ceil(targetElements / cols);
  const cell = 24;
  const gap = 6;
  const width = cols * (cell + gap) + gap;
  const height = rows * (cell + gap) + gap;
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="#f8fafc"/>`,
    '  <g id="aisles" fill="none" stroke="#cbd5e1" stroke-width="0.25">',
  ];
  for (let r = 0; r <= rows; r++) {
    const y = gap / 2 + r * (cell + gap);
    parts.push(`    <line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
  }
  parts.push('  </g>', '  <g id="booths" stroke="#334155" stroke-width="0.5">');
  let count = 0;
  for (let r = 0; r < rows && count < targetElements; r++) {
    for (let c = 0; c < cols && count < targetElements; c++) {
      const x = gap + c * (cell + gap);
      const y = gap + r * (cell + gap);
      const fill = FILLS[(r * 7 + c) % FILLS.length];
      const id = count % 20 === 0 ? ` id="booth-${count}"` : '';
      parts.push(`    <rect${id} x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`);
      count++;
    }
  }
  parts.push('  </g>', '</svg>', '');
  return { xml: parts.join('\n'), elements: count + rows + 2 };
}

const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const targets = sizes.length > 0 ? sizes : [1000, 10000, 50000];

fs.mkdirSync(outDir, { recursive: true });
for (const target of targets) {
  const { xml, elements } = generateGrid(target);
  const file = path.join(outDir, `grid-${target}.svg`);
  fs.writeFileSync(file, xml, 'utf8');
  console.log(`${path.relative(process.cwd(), file)}  ${elements} elements  ${(xml.length / 1024).toFixed(0)} KB`);
}
