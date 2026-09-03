import type { PathSegment, Point } from '../types';
import { arcToCubics } from './path';

const MAX_DEPTH = 16;

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number, out: Point[], depth: number): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const chord2 = dx * dx + dy * dy;
  const tol2 = tolerance * tolerance;
  let flat: boolean;
  if (chord2 < 1e-12) {
    flat = dist2(p1, p0) <= tol2 && dist2(p2, p0) <= tol2;
  } else {
    const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
    const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
    flat = (d1 + d2) * (d1 + d2) <= tol2 * chord2;
  }
  if (flat || depth >= MAX_DEPTH) {
    out.push(p3);
    return;
  }
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth + 1);
  flattenCubic(p0123, p123, p23, p3, tolerance, out, depth + 1);
}

/**
 * Flatten path segments into polylines, one per subpath. Curves are subdivided until they
 * deviate from their chord by less than `tolerance` (user units). A closed subpath ends with
 * a copy of its start point.
 */
export function flattenPath(segments: readonly PathSegment[], tolerance = 0.05): Point[][] {
  const polylines: Point[][] = [];
  let current: Point[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const ensure = (): Point[] => {
    if (!current) current = [{ x: cx, y: cy }];
    return current;
  };
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        if (current && current.length > 0) polylines.push(current);
        current = [{ x: seg.x, y: seg.y }];
        cx = sx = seg.x;
        cy = sy = seg.y;
        break;
      case 'L':
        ensure().push({ x: seg.x, y: seg.y });
        cx = seg.x;
        cy = seg.y;
        break;
      case 'C':
        flattenCubic({ x: cx, y: cy }, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, { x: seg.x, y: seg.y }, tolerance, ensure(), 0);
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Q': {
        const p0 = { x: cx, y: cy };
        const c1 = { x: cx + (2 / 3) * (seg.x1 - cx), y: cy + (2 / 3) * (seg.y1 - cy) };
        const c2 = { x: seg.x + (2 / 3) * (seg.x1 - seg.x), y: seg.y + (2 / 3) * (seg.y1 - seg.y) };
        flattenCubic(p0, c1, c2, { x: seg.x, y: seg.y }, tolerance, ensure(), 0);
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'A': {
        const out = ensure();
        let px = cx;
        let py = cy;
        for (const cubic of arcToCubics(cx, cy, seg)) {
          flattenCubic({ x: px, y: py }, { x: cubic.x1, y: cubic.y1 }, { x: cubic.x2, y: cubic.y2 }, { x: cubic.x, y: cubic.y }, tolerance, out, 0);
          px = cubic.x;
          py = cubic.y;
        }
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'Z':
        if (current) {
          current.push({ x: sx, y: sy });
          polylines.push(current);
          current = null;
        }
        cx = sx;
        cy = sy;
        break;
    }
  }
  if (current && current.length > 0) polylines.push(current);
  return polylines;
}
