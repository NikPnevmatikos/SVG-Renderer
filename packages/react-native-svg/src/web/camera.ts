/** Pure helpers for the DOM viewer's camera animations and pointer math. */

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export interface VelocitySample {
  /** Timestamp in ms. */
  t: number;
  x: number;
  y: number;
}

/**
 * Velocity (px/s) from the samples of the last `window` ms before `now`. Uses the oldest sample
 * inside the window against the newest, which smooths jitter without lagging behind the finger.
 */
export function estimateVelocity(samples: readonly VelocitySample[], now: number, window = 100): { vx: number; vy: number } {
  const newest = samples[samples.length - 1];
  if (!newest) return { vx: 0, vy: 0 };
  let oldest = newest;
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i];
    if (!sample || now - sample.t > window) break;
    oldest = sample;
  }
  const dt = newest.t - oldest.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: ((newest.x - oldest.x) / dt) * 1000, vy: ((newest.y - oldest.y) / dt) * 1000 };
}

/**
 * One step of an exponential decay: the position advances by the current velocity and the
 * velocity shrinks by `deceleration` per millisecond (0.997 feels like a phone's scroll).
 */
export function decayStep(
  position: number,
  velocity: number,
  dt: number,
  deceleration: number
): { position: number; velocity: number } {
  return { position: position + (velocity * dt) / 1000, velocity: velocity * Math.pow(deceleration, dt) };
}

/**
 * Zoom factor for a wheel event. Trackpad pinches and mouse wheels both report `deltaY`;
 * line and page delta modes are scaled to pixels first. Negative deltas (scroll up) zoom in.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, sensitivity = 0.0015): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  return Math.exp(-pixels * sensitivity);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
