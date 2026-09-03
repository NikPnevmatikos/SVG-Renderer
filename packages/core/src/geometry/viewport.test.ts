import { applyToPoint } from './matrix';
import { parsePreserveAspectRatio, viewBoxTransform } from './viewport';

describe('parsePreserveAspectRatio', () => {
  it('parses alignment and meet/slice with defaults', () => {
    expect(parsePreserveAspectRatio(undefined)).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    expect(parsePreserveAspectRatio('none')).toEqual({ align: 'none', meetOrSlice: 'meet' });
    expect(parsePreserveAspectRatio('defer xMinYMax slice')).toEqual({ align: 'xMinYMax', meetOrSlice: 'slice' });
    expect(parsePreserveAspectRatio('bogus')).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
  });
});

describe('viewBoxTransform', () => {
  const vb = { x: 10, y: 20, width: 100, height: 50 };

  it('scales uniformly and centers for meet', () => {
    const m = viewBoxTransform(vb, 400, 400, { align: 'xMidYMid', meetOrSlice: 'meet' });
    // Scale 4 (limited by width); content height 200 centered in 400 -> offset 100.
    expect(applyToPoint(m, { x: 10, y: 20 })).toEqual({ x: 0, y: 100 });
    expect(applyToPoint(m, { x: 110, y: 70 })).toEqual({ x: 400, y: 300 });
  });

  it('scales uniformly and overflows for slice', () => {
    const m = viewBoxTransform(vb, 400, 400, { align: 'xMinYMin', meetOrSlice: 'slice' });
    // Scale 8 (limited by height); content width 800 anchored at the left.
    expect(applyToPoint(m, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
    expect(applyToPoint(m, { x: 110, y: 70 })).toEqual({ x: 800, y: 400 });
  });

  it('stretches for none and aligns to the max corner', () => {
    const none = viewBoxTransform(vb, 200, 200, { align: 'none', meetOrSlice: 'meet' });
    expect(applyToPoint(none, { x: 110, y: 70 })).toEqual({ x: 200, y: 200 });
    const max = viewBoxTransform(vb, 400, 400, { align: 'xMaxYMax', meetOrSlice: 'meet' });
    expect(applyToPoint(max, { x: 110, y: 70 })).toEqual({ x: 400, y: 400 });
  });

  it('returns identity for degenerate boxes', () => {
    expect(viewBoxTransform({ x: 0, y: 0, width: 0, height: 10 }, 10, 10, { align: 'none', meetOrSlice: 'meet' })).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });
});
