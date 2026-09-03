import { decoratorOpacity } from './visibility';

describe('decoratorOpacity', () => {
  it('is fully visible without any limits', () => {
    expect(decoratorOpacity(0.5, 1, 10, undefined, undefined, undefined)).toBe(1);
  });

  it('hides below minZoom and above maxZoom, relative to the initial fit', () => {
    expect(decoratorOpacity(1.5, 1, 100, undefined, 2, undefined)).toBe(0);
    expect(decoratorOpacity(2, 1, 100, undefined, 2, undefined)).toBe(1);
    expect(decoratorOpacity(9, 1, 100, undefined, undefined, 8)).toBe(0);
    expect(decoratorOpacity(4, 0.5, 100, undefined, undefined, 8)).toBe(1);
  });

  it('hides while the element is drawn smaller than minTargetSize and fades in over the last 20%', () => {
    // 20 world units at scale 1 = 20 px; threshold 40 px -> hidden.
    expect(decoratorOpacity(1, 1, 20, 40, undefined, undefined)).toBe(0);
    // 32 px is the start of the fade (80% of 40).
    expect(decoratorOpacity(1.6, 1, 20, 40, undefined, undefined)).toBe(0);
    // 36 px is halfway through the fade.
    expect(decoratorOpacity(1.8, 1, 20, 40, undefined, undefined)).toBeCloseTo(0.5);
    // 40 px and beyond: fully visible.
    expect(decoratorOpacity(2, 1, 20, 40, undefined, undefined)).toBe(1);
    expect(decoratorOpacity(5, 1, 20, 40, undefined, undefined)).toBe(1);
  });

  it('ignores a non-positive minTargetSize and a zero fit scale', () => {
    expect(decoratorOpacity(1, 1, 1, 0, undefined, undefined)).toBe(1);
    expect(decoratorOpacity(1, 0, 1, undefined, 0.5, undefined)).toBe(1);
  });
});
