import { parsePathData, pathBBox, serializePathData, shapeParamsToPath } from './path';
import { normalizeWinding, reverseSubpath, splitSubpaths, subpathSignedArea } from './winding';

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
});
