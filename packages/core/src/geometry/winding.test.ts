import { parsePathData, pathBBox, serializePathData, shapeParamsToPath } from './path';
import type { PathSegment } from '../types';
import { normalizeWinding, orientForMerge, reverseSubpath, splitSubpaths, subpathSignedArea } from './winding';

describe('winding', () => {
  it('computes signed areas with consistent orientation', () => {
    const positive = parsePathData('M0 0 L10 0 L10 10 L0 10 Z').segments;
    const negative = parsePathData('M0 0 L0 10 L10 10 L10 0 Z').segments;
    expect(subpathSignedArea(positive)).toBeCloseTo(200);
    expect(subpathSignedArea(negative)).toBeCloseTo(-200);
    // Our generated outlines are positively oriented.
    expect(subpathSignedArea(shapeParamsToPath({ kind: 'rect', x: 0, y: 0, width: 4, height: 2, rx: 0, ry: 0 }))).toBeGreaterThan(0);
    expect(subpathSignedArea(shapeParamsToPath({ kind: 'circle', cx: 0, cy: 0, r: 5 }))).toBeGreaterThan(0);
  });

  it('splits and reverses subpaths, keeping geometry and closure', () => {
    const d = 'M0 0 L10 0 C12 2 12 8 10 10 Q5 12 0 10 A1 1 0 0 1 0 0 ZM20 20 L30 20';
    const subpaths = splitSubpaths(parsePathData(d).segments);
    expect(subpaths).toHaveLength(2);
    const reversed = reverseSubpath(subpaths[0]!);
    expect(serializePathData(reversed)).toBe('M0 0A1 1 0 0 0 0 10Q5 12 10 10C12 8 12 2 10 0L0 0Z');
    expect(subpathSignedArea(reversed)).toBeCloseTo(-subpathSignedArea(subpaths[0]!));
    expect(pathBBox(reversed)).toEqual(pathBBox(subpaths[0]!));
    expect(reverseSubpath(subpaths[1]!)).toEqual([
      { type: 'M', x: 30, y: 20 },
      { type: 'L', x: 20, y: 20 },
    ]);
  });

  it('normalizes every subpath to positive orientation', () => {
    const mixed = parsePathData('M0 0 L0 10 L10 10 L10 0 Z M20 0 L30 0 L30 10 L20 10 Z').segments;
    const normalized = normalizeWinding(mixed);
    for (const subpath of splitSubpaths(normalized)) expect(subpathSignedArea(subpath)).toBeGreaterThan(0);
    expect(pathBBox(normalized)).toEqual(pathBBox(mixed));
  });

  it('starts a new subpath after a closepath that has no moveto', () => {
    const subpaths = splitSubpaths(parsePathData('M0 0 L10 0 L10 10 Z L0 10 L0 20 Z Z M5 5 L6 6').segments);
    expect(subpaths.map((s) => serializePathData(s))).toEqual(['M0 0L10 0L10 10Z', 'M0 0L0 10L0 20ZZ', 'M5 5L6 6']);
  });
});

describe('orientForMerge', () => {
  const areas = (segments: readonly PathSegment[]): number[] =>
    splitSubpaths(segments).map((subpath) => subpathSignedArea(subpath));

  it('turns uniformly wound subpaths positive and keeps positive outlines as they are', () => {
    const negative = parsePathData('M0 0 L0 10 L10 10 L10 0 Z M20 0 L20 10 L30 10 L30 0 Z').segments;
    const oriented = orientForMerge(negative);
    expect(oriented.mixed).toBe(false);
    expect(areas(oriented.path).every((a) => a > 0)).toBe(true);
    expect(pathBBox(oriented.path)).toEqual(pathBBox(negative));

    const positive = parsePathData('M0 0 L10 0 L10 10 L0 10 Z M20 0 L30 0 L30 10 L20 10 Z').segments;
    expect(orientForMerge(positive)).toEqual({ path: positive, mixed: false });
    expect(orientForMerge(positive).path).toBe(positive);
  });

  it('leaves outlines with counters as authored and flags them, in either convention', () => {
    // An "O": outer contour positive, counter negative.
    const ring = parsePathData('M0 0 L10 0 L10 10 L0 10 Z M2 2 L2 8 L8 8 L8 2 Z').segments;
    expect(orientForMerge(ring)).toEqual({ path: ring, mixed: true });
    expect(orientForMerge(ring).path).toBe(ring);
    // The same glyph with the outer contour negative and the counter positive.
    const flipped = parsePathData('M0 0 L0 10 L10 10 L10 0 Z M2 2 L8 2 L8 8 L2 8 Z').segments;
    expect(orientForMerge(flipped)).toEqual({ path: flipped, mixed: true });
  });

  it('ignores subpaths without area', () => {
    const segments = parsePathData('M0 0 M5 5 L5 5 M10 10 L10 20 L20 20 L20 10 Z').segments;
    const oriented = orientForMerge(segments);
    expect(oriented.mixed).toBe(false);
    expect(areas(oriented.path).filter((a) => a !== 0)).toEqual([200]);
  });
});
