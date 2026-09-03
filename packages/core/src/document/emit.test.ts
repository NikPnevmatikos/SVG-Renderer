import { nodeBBox } from '../geometry/bbox';
import { parseSvg } from '../parse';
import type { ShapeNode, SvgNode } from '../types';
import { planToSvgString, toSvgString } from './emit';

const FLOOR_PLAN = `
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 800 520" width="400" height="260">
    <defs>
      <style>.room { stroke: #2b2f36; stroke-width: 1.5 } .stop-a { stop-color: #2563eb }</style>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" stop-color="#f97316" stop-opacity="0.9"/></linearGradient>
      <radialGradient id="sun" gradientUnits="userSpaceOnUse" cx="70" cy="180" r="45" fx="60" fy="170"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ca8a04"/></radialGradient>
      <clipPath id="frame"><path d="M220 130 h160 v90 h-160 z M250 160 h100 v30 h-100 z" clip-rule="evenodd"/></clipPath>
      <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#000"/></pattern>
      <symbol id="pin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></symbol>
    </defs>
    <rect width="800" height="520" fill="#f4f5f7"/>
    <g id="rooms" fill="#dbeafe">
      <rect id="a1" class="room" x="60" y="60" width="180" height="200" rx="4"/>
      <polygon id="b1" class="room" points="60,300 300,300 300,460 60,400" fill="#fef3c7"/>
      <path id="b2" class="room" d="M320 300 H450 V460 H320 Z" fill="url(#sky)" opacity="0.8"/>
      <g transform="translate(490 60) rotate(-4)"><ellipse id="stage" cx="125" cy="260" rx="110" ry="70" fill="url(#dots) red" stroke="none"/></g>
    </g>
    <g clip-path="url(#frame)"><circle cx="300" cy="175" r="60" fill="url(#sun)"/></g>
    <text x="150" y="165" font-family="Helvetica, Arial" font-size="18" text-anchor="middle">Hall <tspan font-weight="bold" fill="#b91c1c" dx="2">A1 &amp; more</tspan></text>
    <use href="#pin" x="20" y="20" width="48" height="48" color="#dc2626"/>
    <image href="https://example.com/a.png" x="700" y="400" width="80" height="80" opacity="0.5"/>
    <line x1="0" y1="500" x2="800" y2="500" stroke="#000" stroke-dasharray="4 2" stroke-linecap="round"/>
  </svg>`;

const shape = (node: SvgNode | undefined): ShapeNode => {
  if (!node || node.kind !== 'shape') throw new Error('expected shape');
  return node;
};

const leaves = (node: SvgNode, out: SvgNode[] = []): SvgNode[] => {
  if (node.kind === 'group') node.children.forEach((c) => leaves(c, out));
  else out.push(node);
  return out;
};

type Box = { x: number; y: number; width: number; height: number } | null;
/** Numbers are emitted with six decimals, so compare boxes with a little tolerance. */
const expectRectClose = (actual: Box, expected: Box): void => {
  expect(actual === null).toBe(expected === null);
  if (!actual || !expected) return;
  expect(actual.x).toBeCloseTo(expected.x, 4);
  expect(actual.y).toBeCloseTo(expected.y, 4);
  expect(actual.width).toBeCloseTo(expected.width, 4);
  expect(actual.height).toBeCloseTo(expected.height, 4);
};

describe('toSvgString', () => {
  const original = parseSvg(FLOOR_PLAN);
  const emitted = toSvgString(original);
  const reparsed = parseSvg(emitted);

  it('produces standalone SVG that re-parses without warnings', () => {
    expect(emitted.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="400" height="260"')).toBe(true);
    expect(emitted).not.toContain('<style');
    expect(emitted).not.toContain('<use');
    expect(reparsed.warnings).toEqual([]);
  });

  it('preserves geometry, ids, styles and definitions', () => {
    expect(reparsed.viewBox).toEqual(original.viewBox);
    expectRectClose(reparsed.contentBounds, original.contentBounds);
    const before = leaves(original.root);
    const after = leaves(reparsed.root);
    expect(after).toHaveLength(before.length);
    before.forEach((node, index) => {
      const twin = after[index]!;
      expect(twin.kind).toBe(node.kind);
      expect(twin.id).toBe(node.id);
      expectRectClose(nodeBBox(twin, 'world'), nodeBBox(node, 'world'));
      expect(twin.style).toEqual(node.style);
    });
    expect(shape(reparsed.getElementById('a1')).style.strokeWidth).toBe(1.5);
    expect(shape(reparsed.getElementById('b2')).style.fill).toEqual({ type: 'ref', id: 'sky' });
    expect(shape(reparsed.getElementById('stage')).style.fill).toEqual({ type: 'ref', id: 'dots', fallback: 'red' });
    expect(reparsed.defs.sky).toEqual(original.defs.sky);
    expect(reparsed.defs.sun).toEqual(original.defs.sun);
    expect(reparsed.defs.frame).toMatchObject({ kind: 'clipPath', id: 'frame' });
    expect(reparsed.defs.dots).toMatchObject({ kind: 'raw', tag: 'pattern' });
    expect(emitted).toContain('<pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#000"/></pattern>');
  });

  it('escapes text and keeps tspans', () => {
    expect(emitted).toContain('<tspan dx="2" fill="#b91c1c" font-weight="bold">A1 &amp; more</tspan>');
    const text = reparsed.root.children.find((n) => n.kind === 'text');
    expect(text && text.kind === 'text' ? text.runs.map((r) => r.text) : []).toEqual(['Hall ', 'A1 & more']);
  });

  it('can emit compact output with reduced precision', () => {
    const compact = toSvgString(parseSvg('<svg viewBox="0 0 10 10"><rect x="1.23456789" width="1" height="1"/></svg>'), { pretty: false, precision: 2 });
    expect(compact).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1.23" y="0" width="1" height="1"/></svg>');
  });
});

describe('planToSvgString', () => {
  it('emits batches as single paths and keeps everything else', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <rect width="10" height="10" fill="red"/><rect x="20" width="10" height="10" fill="red"/>
        <g opacity="0.5" transform="translate(1 1)"><circle r="5" fill="blue"/><circle cx="20" r="5" fill="blue"/></g>
        <text x="0" y="50">t</text>
      </svg>`);
    const plan = doc.plan();
    const svg = planToSvgString(plan, doc, { pretty: false });
    expect(plan.batchCount).toBe(2);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('<g opacity="0.5" transform="matrix(1 0 0 1 1 1)">');
    expect(svg).toContain('<text x="0" y="50">t</text>');
    const reparsed = parseSvg(svg);
    expect(reparsed.warnings).toEqual([]);
    expectRectClose(reparsed.contentBounds, doc.contentBounds);
  });
});
