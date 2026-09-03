import type { PathSegment, Point } from '../types';

/**
 * Twice the signed area of a subpath, from its anchor points plus curve midpoints.
 * Positive means the same orientation as a rectangle drawn `M0 0 L1 0 L1 1 L0 1 Z`.
 */
export function subpathSignedArea(segments: readonly PathSegment[]): number {
  const points: Point[] = [];
  let cx = 0;
  let cy = 0;
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
      case 'L':
        points.push({ x: seg.x, y: seg.y });
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Q':
        points.push({ x: 0.25 * cx + 0.5 * seg.x1 + 0.25 * seg.x, y: 0.25 * cy + 0.5 * seg.y1 + 0.25 * seg.y });
        points.push({ x: seg.x, y: seg.y });
        cx = seg.x;
        cy = seg.y;
        break;
      case 'C':
        points.push({
          x: 0.125 * cx + 0.375 * seg.x1 + 0.375 * seg.x2 + 0.125 * seg.x,
          y: 0.125 * cy + 0.375 * seg.y1 + 0.375 * seg.y2 + 0.125 * seg.y,
        });
        points.push({ x: seg.x, y: seg.y });
        cx = seg.x;
        cy = seg.y;
        break;
      case 'A':
        // Arcs are only ever produced by our own shape outlines, which are consistently
        // oriented; the chord endpoints are enough to determine the overall direction.
        points.push({ x: seg.x, y: seg.y });
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Z':
        break;
    }
  }
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

/** Split a segment list into subpaths, each starting with its `M`. */
export function splitSubpaths(segments: readonly PathSegment[]): PathSegment[][] {
  const subpaths: PathSegment[][] = [];
  let current: PathSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'M' && current.length > 0) {
      subpaths.push(current);
      current = [];
    }
    current.push(seg);
  }
  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

/** Reverse the direction of one subpath (must start with `M`). Closed subpaths stay closed. */
export function reverseSubpath(subpath: readonly PathSegment[]): PathSegment[] {
  const first = subpath[0];
  if (!first || first.type !== 'M') return [...subpath];
  const closed = subpath[subpath.length - 1]?.type === 'Z';
  const body = closed ? subpath.slice(1, -1) : subpath.slice(1);

  // Anchor points: start plus the end point of every drawing segment.
  const anchors: Point[] = [{ x: first.x, y: first.y }];
  for (const seg of body) {
    if (seg.type !== 'Z') anchors.push({ x: seg.x, y: seg.y });
  }
  const last = anchors[anchors.length - 1] ?? anchors[0]!;
  const out: PathSegment[] = [{ type: 'M', x: last.x, y: last.y }];
  for (let i = body.length - 1; i >= 0; i--) {
    const seg = body[i]!;
    const target = anchors[i]!; // the point this segment started from
    switch (seg.type) {
      case 'L':
        out.push({ type: 'L', x: target.x, y: target.y });
        break;
      case 'Q':
        out.push({ type: 'Q', x1: seg.x1, y1: seg.y1, x: target.x, y: target.y });
        break;
      case 'C':
        out.push({ type: 'C', x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1, x: target.x, y: target.y });
        break;
      case 'A':
        out.push({
          type: 'A',
          rx: seg.rx,
          ry: seg.ry,
          rotation: seg.rotation,
          largeArc: seg.largeArc,
          sweep: !seg.sweep,
          x: target.x,
          y: target.y,
        });
        break;
      case 'M':
      case 'Z':
        break;
    }
  }
  if (closed) out.push({ type: 'Z' });
  return out;
}

/**
 * Make every subpath run in the positive direction so that, under the nonzero rule, the
 * union of several shapes merged into one path paints exactly what the separate shapes did.
 */
export function normalizeWinding(segments: readonly PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (const subpath of splitSubpaths(segments)) {
    if (subpathSignedArea(subpath) < 0) out.push(...reverseSubpath(subpath));
    else out.push(...subpath);
  }
  return out;
}
