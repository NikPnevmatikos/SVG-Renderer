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

/**
 * Split a segment list into subpaths, each starting with its `M`. A drawing command that
 * follows a closepath without a moveto starts a new subpath at the closed one's start point,
 * as it does when rendered, so a synthetic `M` is inserted there.
 */
export function splitSubpaths(segments: readonly PathSegment[]): PathSegment[][] {
  const subpaths: PathSegment[][] = [];
  let current: PathSegment[] = [];
  let startX = 0;
  let startY = 0;
  let closed = false;
  for (const seg of segments) {
    if (seg.type === 'M') {
      if (current.length > 0) subpaths.push(current);
      current = [seg];
      startX = seg.x;
      startY = seg.y;
      closed = false;
      continue;
    }
    if (closed && seg.type !== 'Z') {
      subpaths.push(current);
      current = [{ type: 'M', x: startX, y: startY }];
      closed = false;
    }
    current.push(seg);
    if (seg.type === 'Z') closed = true;
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
 * Make every subpath run in the positive direction. Right for outlines whose subpaths all run
 * the same way: under the nonzero rule their union then paints exactly what the separate
 * shapes did. Wrong for outlines with holes, whose counters run opposite to the outer contour
 * on purpose; use `orientForMerge`, which leaves those alone.
 */
export function normalizeWinding(segments: readonly PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (const subpath of splitSubpaths(segments)) {
    if (subpathSignedArea(subpath) < 0) out.push(...reverseSubpath(subpath));
    else out.push(...subpath);
  }
  return out;
}

export interface MergeOrientation {
  /** The outline to merge: every subpath positive when that is safe, otherwise as authored. */
  path: readonly PathSegment[];
  /**
   * True when subpaths with area run in both directions. The nonzero rule then relies on their
   * relative direction for the holes (glyph counters, rings): nothing was reversed, and other
   * members of a merged path must not overlap this outline or the windings would cancel.
   */
  mixed: boolean;
}

/**
 * Prepare one filled outline for merging into a nonzero-filled path. When all of its subpaths
 * run the same way they are turned positive, so overlapping members of the merged path union
 * exactly as the separate shapes did. When they run both ways, reversing any of them would
 * fill the holes, so the outline is returned as authored and flagged `mixed`.
 */
export function orientForMerge(segments: readonly PathSegment[]): MergeOrientation {
  const subpaths = splitSubpaths(segments);
  let positive = false;
  let negative = false;
  const areas: number[] = [];
  for (const subpath of subpaths) {
    const area = subpathSignedArea(subpath);
    areas.push(area);
    if (area > 0) positive = true;
    else if (area < 0) negative = true;
  }
  if (positive && negative) return { path: segments, mixed: true };
  if (!negative) return { path: segments, mixed: false };
  const path: PathSegment[] = [];
  for (let i = 0; i < subpaths.length; i++) {
    const subpath = subpaths[i]!;
    if (areas[i]! < 0) for (const seg of reverseSubpath(subpath)) path.push(seg);
    else for (const seg of subpath) path.push(seg);
  }
  return { path, mixed: false };
}
