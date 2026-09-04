import { decayStep, distance, easeOutCubic, estimateVelocity, midpoint, wheelZoomFactor } from './camera';

describe('web camera helpers', () => {
  it('eases out from 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('estimates velocity from the samples inside the window', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 500, x: 500, y: 0 }, // too old, ignored
      { t: 900, x: 600, y: 10 },
      { t: 1000, x: 700, y: 20 },
    ];
    const v = estimateVelocity(samples, 1000, 100);
    expect(v.vx).toBeCloseTo(1000);
    expect(v.vy).toBeCloseTo(100);
    expect(estimateVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
    expect(estimateVelocity([{ t: 5, x: 1, y: 1 }], 5)).toEqual({ vx: 0, vy: 0 });
  });

  it('decays velocity and advances the position', () => {
    const step = decayStep(0, 1000, 100, 0.997);
    expect(step.position).toBeCloseTo(100);
    expect(step.velocity).toBeCloseTo(1000 * Math.pow(0.997, 100));
    expect(step.velocity).toBeLessThan(1000);
  });

  it('turns wheel deltas into zoom factors', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
    // Line mode counts 16 px per line.
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0));
  });

  it('computes distance and midpoint', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual({ x: 2, y: 1 });
  });
});
