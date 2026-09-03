import type { Matrix, Point } from '../types';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const EPSILON = 1e-9;

/** Returns `m1 × m2`: the transform that applies `m2` first, then `m1`. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translate(tx: number, ty = 0): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(degrees: number, cx = 0, cy = 0): Matrix {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const m: Matrix = [cos, sin, -sin, cos, 0, 0];
  if (cx === 0 && cy === 0) return m;
  return multiply(multiply(translate(cx, cy), m), translate(-cx, -cy));
}

export function skewX(degrees: number): Matrix {
  return [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0];
}

export function skewY(degrees: number): Matrix {
  return [1, Math.tan((degrees * Math.PI) / 180), 0, 1, 0, 0];
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function isIdentity(m: Matrix): boolean {
  return (
    Math.abs(m[0] - 1) < EPSILON &&
    Math.abs(m[1]) < EPSILON &&
    Math.abs(m[2]) < EPSILON &&
    Math.abs(m[3] - 1) < EPSILON &&
    Math.abs(m[4]) < EPSILON &&
    Math.abs(m[5]) < EPSILON
  );
}

export function invert(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

/** Geometric mean scale factor: how much lengths grow under `m` (exact for uniform scale). */
export function scaleFactor(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** True when `m` is a rotation, uniform scale, translation, reflection or a combination — no skew. */
export function isConformal(m: Matrix, epsilon = EPSILON): boolean {
  const [a, b, c, d] = m;
  return (
    (Math.abs(a - d) < epsilon && Math.abs(b + c) < epsilon) ||
    (Math.abs(a + d) < epsilon && Math.abs(b - c) < epsilon)
  );
}

const TRANSFORM_RE = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

/**
 * Parse an SVG `transform` attribute into a single matrix. Returns `null` when the list is
 * malformed (unknown function, wrong argument count, non-numeric argument, stray text).
 */
export function parseTransform(input: string): Matrix | null {
  if (input.trim().length === 0) return IDENTITY;
  let result: Matrix = IDENTITY;
  let lastIndex = 0;
  TRANSFORM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSFORM_RE.exec(input))) {
    const between = input.slice(lastIndex, match.index);
    if (between.replace(/[\s,]/g, '').length > 0) return null;
    lastIndex = TRANSFORM_RE.lastIndex;
    const name = match[1] ?? '';
    const args = (match[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map(Number);
    if (args.some((value) => !Number.isFinite(value))) return null;
    const [a0, a1, a2, a3, a4, a5] = args;
    let t: Matrix;
    switch (name) {
      case 'matrix':
        if (
          args.length !== 6 ||
          a0 === undefined ||
          a1 === undefined ||
          a2 === undefined ||
          a3 === undefined ||
          a4 === undefined ||
          a5 === undefined
        ) {
          return null;
        }
        t = [a0, a1, a2, a3, a4, a5];
        break;
      case 'translate':
        if (a0 === undefined || args.length > 2) return null;
        t = translate(a0, a1 ?? 0);
        break;
      case 'scale':
        if (a0 === undefined || args.length > 2) return null;
        t = scale(a0, a1 ?? a0);
        break;
      case 'rotate':
        if (a0 === undefined || (args.length !== 1 && args.length !== 3)) return null;
        t = rotate(a0, a1 ?? 0, a2 ?? 0);
        break;
      case 'skewX':
        if (a0 === undefined || args.length !== 1) return null;
        t = skewX(a0);
        break;
      case 'skewY':
        if (a0 === undefined || args.length !== 1) return null;
        t = skewY(a0);
        break;
      default:
        return null;
    }
    result = multiply(result, t);
  }
  if (input.slice(lastIndex).trim().length > 0) return null;
  return result;
}

/** `matrix(a b c d e f)`. Exact (shortest round-trip) unless `precision` decimals are requested. */
export function formatMatrix(m: Matrix, precision?: number): string {
  const fmt = (v: number): string => {
    const value = precision === undefined ? v : Number(v.toFixed(precision));
    return String(value === 0 ? 0 : value);
  };
  return `matrix(${m.map(fmt).join(' ')})`;
}
