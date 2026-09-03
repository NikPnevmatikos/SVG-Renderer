import {
  chooseRenderRegion,
  clampCameraScale,
  clampCameraToBounds,
  composeCamera,
  fitCamera,
  relativeCamera,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomCamera,
} from './camera';

const close = (actual: { scale: number; tx: number; ty: number }, expected: { scale: number; tx: number; ty: number }): void => {
  expect(actual.scale).toBeCloseTo(expected.scale, 9);
  expect(actual.tx).toBeCloseTo(expected.tx, 9);
  expect(actual.ty).toBeCloseTo(expected.ty, 9);
};

describe('camera', () => {
  const bounds = { x: 100, y: 50, width: 800, height: 400 };
  const viewport = { width: 400, height: 400 };

  it('fits bounds centered with padding', () => {
    const camera = fitCamera(bounds, viewport, 20);
    // Width-limited: 360 / 800 = 0.45; content height 180 centered in 400.
    expect(camera.scale).toBeCloseTo(0.45);
    expect(worldToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 20, y: 110 });
    expect(worldToScreen(camera, { x: 900, y: 450 })).toEqual({ x: 380, y: 290 });
    expect(screenToWorld(camera, { x: 200, y: 200 })).toEqual({ x: 500, y: 250 });
  });

  it('reports the visible document rectangle', () => {
    const camera = { scale: 2, tx: -100, ty: -50 };
    expect(visibleWorldRect(camera, viewport)).toEqual({ x: 50, y: 25, width: 200, height: 200 });
  });

  it('zooms about a focal point and clamps scale about it', () => {
    const camera = { scale: 1, tx: 0, ty: 0 };
    const zoomed = zoomCamera(camera, 2, { x: 100, y: 100 });
    expect(worldToScreen(zoomed, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(zoomed.scale).toBe(2);
    const clamped = clampCameraScale(zoomed, 0.5, 1.5, { x: 100, y: 100 });
    expect(clamped.scale).toBe(1.5);
    expect(worldToScreen(clamped, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(clampCameraScale(zoomed, 1, 4, { x: 0, y: 0 })).toBe(zoomed);
  });

  it('keeps some content visible when panned away', () => {
    const camera = { scale: 1, tx: 1000, ty: -1000 };
    const clamped = clampCameraToBounds(camera, viewport, bounds, 48);
    // Content left edge is at 1100 > 400 - 48 = 352, so it is pulled back to 352.
    expect(clamped.tx + bounds.x * clamped.scale).toBeCloseTo(352);
    // Content bottom is at -550 < 48, so it is pushed down until 48 px remain visible.
    expect(clamped.ty + (bounds.y + bounds.height) * clamped.scale).toBeCloseTo(48);
    expect(clampCameraToBounds({ scale: 1, tx: 0, ty: 0 }, viewport, bounds)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('composes and inverts relative cameras', () => {
    const base = fitCamera(bounds, viewport);
    const delta = { scale: 2, tx: -30, ty: 10 };
    const total = composeCamera(base, delta);
    const point = { x: 300, y: 200 };
    const viaTotal = worldToScreen(total, point);
    const viaSteps = worldToScreen(delta, worldToScreen(base, point));
    expect(viaTotal.x).toBeCloseTo(viaSteps.x);
    expect(viaTotal.y).toBeCloseTo(viaSteps.y);
    close(relativeCamera(base, total), delta);
    close(composeCamera(base, relativeCamera(base, total)), total);
  });

  it('renders the whole content while it fits the pixel budget, else an overscanned viewport region', () => {
    const camera = fitCamera(bounds, viewport);
    const whole = chooseRenderRegion(camera, viewport, bounds, { maxPixels: 1_000_000, pixelRatio: 2 });
    expect(whole.viewBox).toEqual(bounds);
    expect(whole.width).toBeCloseTo(400);
    expect(whole.height).toBeCloseTo(200);
    expect(whole.x).toBeCloseTo(0);
    expect(whole.y).toBeCloseTo(100);

    const zoomed = zoomCamera(camera, 20, { x: 200, y: 200 });
    const region = chooseRenderRegion(zoomed, viewport, bounds, { maxPixels: 1_000_000, pixelRatio: 2, overscan: 1.5 });
    expect(region.width).toBe(600);
    expect(region.height).toBe(600);
    expect(region.x).toBe(-100);
    expect(region.y).toBe(-100);
    // The region's viewBox maps back onto the region rectangle under the camera.
    const topLeft = worldToScreen(zoomed, { x: region.viewBox.x, y: region.viewBox.y });
    expect(topLeft.x).toBeCloseTo(-100);
    expect(topLeft.y).toBeCloseTo(-100);
    expect(region.viewBox.width * zoomed.scale).toBeCloseTo(600);
  });
});
