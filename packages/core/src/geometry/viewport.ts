import type { Matrix, PreserveAspectRatio, Rect } from '../types';
import { IDENTITY } from './matrix';

const ASPECT_ALIGN_RE = /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))$/;

/** Parse a `preserveAspectRatio` attribute. Unknown values fall back to `xMidYMid meet`. */
export function parsePreserveAspectRatio(value: string | undefined): PreserveAspectRatio {
  const result: PreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' };
  if (value === undefined) return result;
  const tokens = value.trim().split(/\s+/);
  if (tokens[0] === 'defer') tokens.shift();
  const align = tokens[0];
  if (align !== undefined && ASPECT_ALIGN_RE.test(align)) result.align = align;
  if (tokens[1] === 'slice') result.meetOrSlice = 'slice';
  return result;
}

/**
 * The transform that maps `viewBox` onto a `width` × `height` viewport according to
 * `preserveAspectRatio` (SVG 1.1 §7.8). Identity when either box is degenerate.
 */
export function viewBoxTransform(
  viewBox: Rect,
  width: number,
  height: number,
  par: PreserveAspectRatio
): Matrix {
  if (viewBox.width <= 0 || viewBox.height <= 0 || width <= 0 || height <= 0) return IDENTITY;
  let sx = width / viewBox.width;
  let sy = height / viewBox.height;
  if (par.align !== 'none') {
    const s = par.meetOrSlice === 'meet' ? Math.min(sx, sy) : Math.max(sx, sy);
    sx = s;
    sy = s;
  }
  let tx = -viewBox.x * sx;
  let ty = -viewBox.y * sy;
  if (par.align !== 'none') {
    const ax = par.align.startsWith('xMid') ? 0.5 : par.align.startsWith('xMax') ? 1 : 0;
    const ay = par.align.endsWith('YMid') ? 0.5 : par.align.endsWith('YMax') ? 1 : 0;
    tx += (width - viewBox.width * sx) * ax;
    ty += (height - viewBox.height * sy) * ay;
  }
  return [sx, 0, 0, sy, tx, ty];
}
