import { clampCameraToBounds } from 'svg-core';
import { panRange } from './cameraLimits';

describe('panRange', () => {
  const viewport = { width: 400, height: 300 };
  const bounds = { x: 10, y: 20, width: 200, height: 100 };

  it('agrees with clampCameraToBounds at both ends of each axis', () => {
    const scale = 1.5;
    const range = panRange(scale, viewport.width, viewport.height, bounds.x, bounds.y, bounds.width, bounds.height, 48);
    const atMin = clampCameraToBounds({ scale, tx: range.minTx, ty: range.minTy }, viewport, bounds, 48);
    const atMax = clampCameraToBounds({ scale, tx: range.maxTx, ty: range.maxTy }, viewport, bounds, 48);
    expect(atMin.tx).toBeCloseTo(range.minTx);
    expect(atMin.ty).toBeCloseTo(range.minTy);
    expect(atMax.tx).toBeCloseTo(range.maxTx);
    expect(atMax.ty).toBeCloseTo(range.maxTy);
    // One pixel beyond either end is pulled back.
    expect(clampCameraToBounds({ scale, tx: range.minTx - 1, ty: 0 }, viewport, bounds, 48).tx).toBeCloseTo(range.minTx);
    expect(clampCameraToBounds({ scale, tx: range.maxTx + 1, ty: 0 }, viewport, bounds, 48).tx).toBeCloseTo(range.maxTx);
  });

  it('never demands more visibility than the content has', () => {
    const range = panRange(0.1, viewport.width, viewport.height, 0, 0, 100, 100, 48);
    // Content is 10 px wide: it may sit anywhere from fully at the left edge to fully at the right edge.
    expect(range.minTx).toBeCloseTo(0);
    expect(range.maxTx).toBeCloseTo(viewport.width - 10);
  });
});
