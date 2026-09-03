import { parseSvg } from '../parse';
import type { ShapeNode, SvgNode } from '../types';
import { flattenPath } from './flatten';
import { distanceToPolylines, findAncestor, nodeContainsPoint, pointInPolygons, shapeContainsPoint } from './hit';
import { parsePathData } from './path';

const shape = (node: SvgNode | undefined): ShapeNode => {
  if (!node || node.kind !== 'shape') throw new Error('expected shape');
  return node;
};
const painted = { includeStroke: true, tolerance: 0, mode: 'painted' as const };

describe('flattenPath', () => {
  it('flattens curves within tolerance and closes subpaths', () => {
    const polys = flattenPath(parsePathData('M0 0 C0 10 10 10 10 0 Z M20 0 L30 0').segments, 0.01);
    expect(polys).toHaveLength(2);
    const curve = polys[0]!;
    expect(curve.length).toBeGreaterThan(8);
    expect(curve[curve.length - 1]).toEqual({ x: 0, y: 0 });
    // The cubic peaks at y = 7.5.
    expect(Math.max(...curve.map((p) => p.y))).toBeCloseTo(7.5, 1);
    expect(polys[1]).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });
});

describe('pointInPolygons and distanceToPolylines', () => {
  const outer = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const inner = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 },
  ];

  it('applies nonzero and evenodd rules', () => {
    // Same orientation: nonzero fills the hole, evenodd does not.
    expect(pointInPolygons([outer, inner], { x: 5, y: 5 }, 'nonzero')).toBe(true);
    expect(pointInPolygons([outer, inner], { x: 5, y: 5 }, 'evenodd')).toBe(false);
    expect(pointInPolygons([outer, inner], { x: 1, y: 1 }, 'evenodd')).toBe(true);
    expect(pointInPolygons([outer], { x: 11, y: 5 }, 'nonzero')).toBe(false);
    // Opposite orientation: a genuine hole under nonzero too.
    const reversed = [...inner].reverse();
    expect(pointInPolygons([outer, reversed], { x: 5, y: 5 }, 'nonzero')).toBe(false);
  });

  it('measures distance to polylines', () => {
    expect(distanceToPolylines([outer], { x: 5, y: -3 })).toBe(3);
    expect(distanceToPolylines([outer], { x: 12, y: 12 })).toBeCloseTo(Math.SQRT2 * 2);
    expect(distanceToPolylines([[{ x: 1, y: 1 }]], { x: 4, y: 5 })).toBe(5);
  });
});

describe('shapeContainsPoint', () => {
  const doc = parseSvg(`
    <svg viewBox="0 0 100 100">
      <rect id="r" x="10" y="10" width="20" height="10" fill="red" stroke="#000" stroke-width="4"/>
      <rect id="outline" x="50" y="10" width="20" height="10" fill="none" stroke="#000" stroke-width="2"/>
      <circle id="c" cx="50" cy="50" r="10" fill="none" stroke="#000" stroke-width="2"/>
      <ellipse id="e" cx="80" cy="50" rx="10" ry="5" fill="blue"/>
      <path id="ring" d="M0 60 h20 v20 h-20 z M5 65 h10 v10 h-10 z" fill-rule="evenodd" fill="green"/>
      <line id="l" x1="30" y1="90" x2="60" y2="90" stroke="#000" stroke-width="6"/>
      <polyline id="pl" points="70,80 90,80 90,95" fill="orange"/>
    </svg>`);

  it('tests rect fills and stroke bands analytically', () => {
    const r = shape(doc.getElementById('r'));
    expect(shapeContainsPoint(r, { x: 15, y: 15 }, painted)).toBe(true);
    expect(shapeContainsPoint(r, { x: 8.5, y: 15 }, painted)).toBe(true); // inside the 2-unit stroke band
    expect(shapeContainsPoint(r, { x: 7, y: 15 }, painted)).toBe(false);
    expect(shapeContainsPoint(r, { x: 7, y: 15 }, { ...painted, tolerance: 2 })).toBe(true);
    expect(shapeContainsPoint(r, { x: 8.5, y: 15 }, { ...painted, includeStroke: false })).toBe(false);
  });

  it('honours painted versus geometry mode for unfilled outlines', () => {
    const outline = shape(doc.getElementById('outline'));
    expect(shapeContainsPoint(outline, { x: 60, y: 15 }, painted)).toBe(false);
    expect(shapeContainsPoint(outline, { x: 60, y: 15 }, { ...painted, mode: 'geometry' })).toBe(true);
    expect(shapeContainsPoint(outline, { x: 50, y: 15 }, painted)).toBe(true); // on the stroke
  });

  it('tests circles, ellipses, even-odd paths, lines and polylines', () => {
    expect(shapeContainsPoint(shape(doc.getElementById('c')), { x: 50, y: 50 }, painted)).toBe(false);
    expect(shapeContainsPoint(shape(doc.getElementById('c')), { x: 59.5, y: 50 }, painted)).toBe(true);
    expect(shapeContainsPoint(shape(doc.getElementById('e')), { x: 85, y: 52 }, painted)).toBe(true);
    expect(shapeContainsPoint(shape(doc.getElementById('e')), { x: 89, y: 54 }, painted)).toBe(false);
    const ring = shape(doc.getElementById('ring'));
    expect(shapeContainsPoint(ring, { x: 2, y: 70 }, painted)).toBe(true);
    expect(shapeContainsPoint(ring, { x: 10, y: 70 }, painted)).toBe(false); // the hole
    const line = shape(doc.getElementById('l'));
    expect(shapeContainsPoint(line, { x: 45, y: 92 }, painted)).toBe(true);
    expect(shapeContainsPoint(line, { x: 45, y: 94 }, painted)).toBe(false);
    // Polylines fill their implicitly closed area.
    expect(shapeContainsPoint(shape(doc.getElementById('pl')), { x: 85, y: 85 }, painted)).toBe(true);
    expect(shapeContainsPoint(shape(doc.getElementById('pl')), { x: 75, y: 90 }, painted)).toBe(false);
  });
});

describe('nodeContainsPoint and document.elementsAt', () => {
  const doc = parseSvg(`
    <svg viewBox="0 0 200 200">
      <rect id="bg" width="200" height="200" fill="#eee"/>
      <g id="zone" transform="translate(100 100) scale(2)">
        <rect id="rotated" x="-10" y="-5" width="20" height="10" fill="red" transform="rotate(90)"/>
        <rect id="thin" x="20" y="-20" width="10" height="10" fill="none" stroke="#000" stroke-width="1"/>
      </g>
      <text id="label" x="20" y="180" font-size="10">Hello</text>
      <rect id="hidden" width="200" height="200" fill="blue" visibility="hidden"/>
    </svg>`);

  it('maps world points through nested transforms', () => {
    const rotated = doc.getElementById('rotated')!;
    // After rotate(90) the rect spans x in [-5, 5], y in [-10, 10] locally, times 2 around (100, 100).
    expect(nodeContainsPoint(rotated, { x: 100, y: 118 })).toBe(true);
    expect(nodeContainsPoint(rotated, { x: 118, y: 100 })).toBe(false);
  });

  it('converts world tolerance into local units', () => {
    const thin = doc.getElementById('thin')!;
    // Stroke band is 0.5 local = 1 world unit around the outline at x = 100 + 2*20 = 140.
    expect(nodeContainsPoint(thin, { x: 138.5, y: 70 })).toBe(false);
    expect(nodeContainsPoint(thin, { x: 138.5, y: 70 }, { tolerance: 1 })).toBe(true);
  });

  it('returns hits topmost first, skips hidden nodes and honours filters', () => {
    const ids = (hits: SvgNode[]): (string | undefined)[] => hits.map((n) => n.id);
    expect(ids(doc.elementsAt({ x: 100, y: 118 }))).toEqual(['rotated', 'bg']);
    expect(ids(doc.elementsAt({ x: 5, y: 5 }))).toEqual(['bg']);
    expect(ids(doc.elementsAt({ x: 25, y: 176 }))).toEqual(['label', 'bg']);
    expect(ids(doc.elementsAt({ x: 100, y: 118 }, { filter: (n) => n.id !== 'bg' }))).toEqual(['rotated']);
    expect(doc.elementsAt({ x: -50, y: -50 })).toEqual([]);
    // Unfilled outline interior: nothing in painted mode, the outline in geometry mode.
    expect(ids(doc.elementsAt({ x: 150, y: 70 }))).toEqual(['bg']);
    expect(ids(doc.elementsAt({ x: 150, y: 70 }, { mode: 'geometry' }))).toEqual(['thin', 'bg']);
  });

  it('finds ancestors', () => {
    const rotated = doc.getElementById('rotated')!;
    expect(findAncestor(rotated, (n) => n.id === 'zone')?.id).toBe('zone');
    expect(findAncestor(rotated, (n) => n.tag === 'svg')?.tag).toBe('svg');
    expect(findAncestor(rotated, () => false)).toBeNull();
  });
});
