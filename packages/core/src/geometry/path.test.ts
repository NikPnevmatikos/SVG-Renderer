import type { PathSegment } from '../types';
import { rotate, scale, translate } from './matrix';
import {
  arcToCubics,
  parsePathData,
  pathBBox,
  serializePathData,
  shapeParamsToPath,
  transformPathSegments,
} from './path';

const expectRect = (
  rect: { x: number; y: number; width: number; height: number } | null,
  expected: [number, number, number, number],
  digits = 6
): void => {
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeCloseTo(expected[0], digits);
  expect(rect!.y).toBeCloseTo(expected[1], digits);
  expect(rect!.width).toBeCloseTo(expected[2], digits);
  expect(rect!.height).toBeCloseTo(expected[3], digits);
};

describe('parsePathData', () => {
  it('parses absolute commands', () => {
    const { segments, error } = parsePathData('M10 10 L20 20 H30 V40 C1 2 3 4 5 6 Q7 8 9 10 Z');
    expect(error).toBeUndefined();
    expect(segments).toEqual<PathSegment[]>([
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 20, y: 20 },
      { type: 'L', x: 30, y: 20 },
      { type: 'L', x: 30, y: 40 },
      { type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { type: 'Q', x1: 7, y1: 8, x: 9, y: 10 },
      { type: 'Z' },
    ]);
  });

  it('converts relative commands, implicit linetos and compact numbers', () => {
    const { segments } = parsePathData('m10,10l5-5.5.5.5h10v-2z');
    expect(segments).toEqual<PathSegment[]>([
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 15, y: 4.5 },
      { type: 'L', x: 15.5, y: 5 },
      { type: 'L', x: 25.5, y: 5 },
      { type: 'L', x: 25.5, y: 3 },
      { type: 'Z' },
    ]);
    // Implicit lineto after M / m, plus a relative m after z is relative to the subpath start.
    const implicit = parsePathData('M1 1 2 2 3 3 z m1 1');
    expect(implicit.segments.map((s) => s.type)).toEqual(['M', 'L', 'L', 'Z', 'M']);
    expect(implicit.segments[4]).toEqual({ type: 'M', x: 2, y: 2 });
  });

  it('reflects control points for S and T', () => {
    const { segments } = parsePathData('M0 0 C10 10 20 10 30 0 S50 -10 60 0 Q70 10 80 0 T100 0');
    expect(segments[2]).toEqual({ type: 'C', x1: 40, y1: -10, x2: 50, y2: -10, x: 60, y: 0 });
    expect(segments[4]).toEqual({ type: 'Q', x1: 90, y1: -10, x: 100, y: 0 });
    // S without a preceding curve uses the current point as first control point.
    const lone = parsePathData('M0 0 S10 10 20 0');
    expect(lone.segments[1]).toEqual({ type: 'C', x1: 0, y1: 0, x2: 10, y2: 10, x: 20, y: 0 });
  });

  it('parses arcs with compact flags', () => {
    const { segments, error } = parsePathData('M0 0 a1 1 0 00 1 1 A 5 5 30 1 0 10 10');
    expect(error).toBeUndefined();
    expect(segments[1]).toEqual({
      type: 'A',
      rx: 1,
      ry: 1,
      rotation: 0,
      largeArc: false,
      sweep: false,
      x: 1,
      y: 1,
    });
    expect(segments[2]).toEqual({
      type: 'A',
      rx: 5,
      ry: 5,
      rotation: 30,
      largeArc: true,
      sweep: false,
      x: 10,
      y: 10,
    });
  });

  it('handles exponents and leading dots', () => {
    const { segments } = parsePathData('M1e2 -.5 L1E-1 +2');
    expect(segments).toEqual([
      { type: 'M', x: 100, y: -0.5 },
      { type: 'L', x: 0.1, y: 2 },
    ]);
  });

  it('keeps the parsed prefix on malformed data', () => {
    const result = parsePathData('M0 0 L10 10 L20');
    expect(result.error).toMatch(/Expected number/);
    expect(result.segments).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 10 },
    ]);
    expect(parsePathData('10 10 L20 20').error).toMatch(/must start with a command/);
    expect(parsePathData('M0 0 X1').error).toMatch(/Unknown path command/);
    expect(parsePathData('M0 0 Z 5').error).toMatch(/after closepath/);
  });

  it('round-trips through serializePathData', () => {
    const d = 'M10 10L20 20C1 2 3 4 5 6Q7 8 9 10A5 5 30 1 0 10 10Z';
    expect(serializePathData(parsePathData(d).segments)).toBe(d);
    expect(serializePathData([{ type: 'M', x: 1.23456, y: 2 }], 2)).toBe('M1.23 2');
  });
});

describe('pathBBox', () => {
  it('bounds lines', () => {
    expectRect(pathBBox(parsePathData('M10 20 L30 5 L-2 8 Z').segments), [-2, 5, 32, 15]);
    expect(pathBBox([])).toBeNull();
  });

  it('bounds cubic and quadratic curves exactly, not by control points', () => {
    // Symmetric cubic bulging up to y = -7.5 at t = 0.5.
    expectRect(pathBBox(parsePathData('M0 0 C0 -10 10 -10 10 0').segments), [0, -7.5, 10, 7.5]);
    // Quadratic peaks at y = -5.
    expectRect(pathBBox(parsePathData('M0 0 Q5 -10 10 0').segments), [0, -5, 10, 5]);
  });

  it('bounds arcs through their extrema', () => {
    // Half circle of radius 10 from (0,0) to (20,0) bulging downward (sweep flag set).
    expectRect(pathBBox(parsePathData('M0 0 A10 10 0 0 1 20 0').segments), [0, -10, 20, 10], 4);
    // Full circle via shapeParamsToPath.
    const circle = shapeParamsToPath({ kind: 'circle', cx: 50, cy: 50, r: 10 });
    expectRect(pathBBox(circle), [40, 40, 20, 20], 4);
    const ellipse = shapeParamsToPath({ kind: 'ellipse', cx: 0, cy: 0, rx: 30, ry: 10 });
    expectRect(pathBBox(ellipse), [-30, -10, 60, 20], 4);
  });

  it('scales up too-small radii like browsers do', () => {
    // Radii of 1 cannot span a chord of 20: they are scaled to 10, giving a half circle.
    expectRect(pathBBox(parsePathData('M0 0 A1 1 0 0 1 20 0').segments), [0, -10, 20, 10], 4);
  });
});

describe('arcToCubics', () => {
  it('splits into at most 90 degree pieces that end exactly at the target', () => {
    const cubics = arcToCubics(0, 0, {
      type: 'A',
      rx: 10,
      ry: 10,
      rotation: 0,
      largeArc: true,
      sweep: true,
      x: 10,
      y: 10,
    });
    expect(cubics.length).toBe(3);
    const last = cubics[cubics.length - 1]!;
    expect(last.x).toBe(10);
    expect(last.y).toBe(10);
  });

  it('returns nothing for a zero-length arc and a line for zero radii', () => {
    const zero = arcToCubics(5, 5, { type: 'A', rx: 1, ry: 1, rotation: 0, largeArc: false, sweep: false, x: 5, y: 5 });
    expect(zero).toEqual([]);
    const line = arcToCubics(0, 0, { type: 'A', rx: 0, ry: 3, rotation: 0, largeArc: false, sweep: false, x: 4, y: 4 });
    expect(line).toEqual([{ type: 'C', x1: 0, y1: 0, x2: 4, y2: 4, x: 4, y: 4 }]);
  });
});

describe('shapeParamsToPath', () => {
  it('outlines rects, rounded rects and polygons', () => {
    expect(serializePathData(shapeParamsToPath({ kind: 'rect', x: 1, y: 2, width: 3, height: 4, rx: 0, ry: 0 }))).toBe(
      'M1 2L4 2L4 6L1 6Z'
    );
    const rounded = shapeParamsToPath({ kind: 'rect', x: 0, y: 0, width: 10, height: 10, rx: 20, ry: 2 });
    // rx is clamped to half the width.
    expect(rounded[0]).toEqual({ type: 'M', x: 5, y: 0 });
    expectRect(pathBBox(rounded), [0, 0, 10, 10], 4);
    expect(serializePathData(shapeParamsToPath({ kind: 'polygon', points: [0, 0, 4, 0, 4, 3] }))).toBe('M0 0L4 0L4 3Z');
    expect(serializePathData(shapeParamsToPath({ kind: 'polyline', points: [0, 0, 4, 0, 4, 3] }))).toBe('M0 0L4 0L4 3');
    expect(serializePathData(shapeParamsToPath({ kind: 'line', x1: 1, y1: 1, x2: 2, y2: 3 }))).toBe('M1 1L2 3');
  });
});

describe('transformPathSegments', () => {
  it('maps points and converts arcs so rotation is exact', () => {
    const translated = transformPathSegments(parsePathData('M0 0 L10 0').segments, translate(5, 5));
    expect(translated).toEqual([
      { type: 'M', x: 5, y: 5 },
      { type: 'L', x: 15, y: 5 },
    ]);
    const circle = shapeParamsToPath({ kind: 'circle', cx: 0, cy: 0, r: 10 });
    const stretched = transformPathSegments(circle, scale(2, 1));
    expectRect(pathBBox(stretched), [-20, -10, 40, 20], 3);
    const rotatedSquare = transformPathSegments(
      shapeParamsToPath({ kind: 'rect', x: -5, y: -5, width: 10, height: 10, rx: 0, ry: 0 }),
      rotate(45)
    );
    const half = Math.sqrt(50);
    expectRect(pathBBox(rotatedSquare), [-half, -half, 2 * half, 2 * half], 6);
  });
});
