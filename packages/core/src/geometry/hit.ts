import type { FillRule, HitTestMode, Point, ShapeNode, SvgNode } from '../types';
import { textApproxLocalBBox, worldMatrix } from './bbox';
import { flattenPath } from './flatten';
import { applyToPoint, invert, scaleFactor } from './matrix';
import { pathBBox, shapeToPath } from './path';
import { expandRect, rectContainsPoint } from './rect';

export interface ShapeHitOptions {
  /** Count the stroke band (half the stroke width on each side of the outline). Default true. */
  includeStroke: boolean;
  /** Extra distance around fills and strokes that still counts, in the shape's local units. */
  tolerance: number;
  /**
   * `painted` follows SVG pointer semantics: fills count only when painted, strokes only when
   * stroked. `geometry` treats every outline as filled and stroked, which suits regions drawn
   * as unfilled outlines (rooms, zones) that should still respond to taps inside them.
   */
  mode: HitTestMode;
}

/** Point-in-compound-polygon test with the given fill rule. Open polylines are closed implicitly. */
export function pointInPolygons(polygons: readonly (readonly Point[])[], p: Point, rule: FillRule): boolean {
  let winding = 0;
  let crossings = 0;
  for (const poly of polygons) {
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[j]!;
      const b = poly[i]!;
      if (a.y <= p.y !== b.y <= p.y) {
        const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (x > p.x) {
          crossings++;
          winding += b.y > a.y ? 1 : -1;
        }
      }
    }
  }
  return rule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Smallest distance from `p` to any polyline segment. */
export function distanceToPolylines(polylines: readonly (readonly Point[])[], p: Point): number {
  let best = Infinity;
  for (const poly of polylines) {
    if (poly.length === 1) {
      best = Math.min(best, Math.hypot(p.x - poly[0]!.x, p.y - poly[0]!.y));
      continue;
    }
    for (let i = 1; i < poly.length; i++) {
      const d = pointSegmentDistance(p, poly[i - 1]!, poly[i]!);
      if (d < best) best = d;
    }
  }
  return best;
}

function flattenTolerance(shape: ShapeNode): number {
  const box = pathBBox(shapeToPath(shape));
  if (!box) return 0.01;
  return Math.max(1e-4, Math.hypot(box.width, box.height) * 1e-3);
}

/** Hit test in the shape's own coordinate system. */
export function shapeContainsPoint(shape: ShapeNode, p: Point, options: ShapeHitOptions): boolean {
  const style = shape.style;
  const params = shape.params;
  const geometry = options.mode === 'geometry';
  const testFill = params.kind !== 'line' && (geometry || style.fill.type !== 'none');
  const testStroke = options.includeStroke && (geometry || style.stroke.type !== 'none');
  const band = (testStroke ? style.strokeWidth / 2 : 0) + options.tolerance;

  if (params.kind === 'rect' && params.rx === 0 && params.ry === 0) {
    const { x, y, width, height } = params;
    const inside = p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height;
    if (testFill && inside) return true;
    if (band <= 0) return false;
    if (inside) {
      const toEdge = Math.min(p.x - x, x + width - p.x, p.y - y, y + height - p.y);
      return toEdge <= band;
    }
    const dx = Math.max(x - p.x, 0, p.x - (x + width));
    const dy = Math.max(y - p.y, 0, p.y - (y + height));
    return Math.hypot(dx, dy) <= band;
  }
  if (params.kind === 'circle') {
    const d = Math.hypot(p.x - params.cx, p.y - params.cy);
    if (testFill && d <= params.r) return true;
    return band > 0 && Math.abs(d - params.r) <= band;
  }

  const polylines = flattenPath(shapeToPath(shape), flattenTolerance(shape));
  if (testFill && pointInPolygons(polylines, p, style.fillRule)) return true;
  if (band > 0 && distanceToPolylines(polylines, p) <= band) return true;
  return false;
}

export interface NodeHitOptions {
  includeStroke?: boolean;
  /** Extra distance in document (world) units, e.g. touch slop converted to SVG units. */
  tolerance?: number;
  mode?: HitTestMode;
}

/** Hit test any leaf node against a point in document coordinates. Groups never hit directly. */
export function nodeContainsPoint(node: SvgNode, worldPoint: Point, options: NodeHitOptions = {}): boolean {
  if (node.kind === 'group') return false;
  const wm = worldMatrix(node);
  const inverse = invert(wm);
  if (!inverse) return false;
  const local = applyToPoint(inverse, worldPoint);
  const scale = scaleFactor(wm) || 1;
  const tolerance = (options.tolerance ?? 0) / scale;
  switch (node.kind) {
    case 'shape':
      return shapeContainsPoint(node, local, {
        includeStroke: options.includeStroke ?? true,
        tolerance,
        mode: options.mode ?? 'painted',
      });
    case 'text': {
      const box = textApproxLocalBBox(node);
      return box !== null && rectContainsPoint(tolerance > 0 ? expandRect(box, tolerance) : box, local);
    }
    case 'image':
      return rectContainsPoint(tolerance > 0 ? expandRect(node.rect, tolerance) : node.rect, local);
  }
}

/** Nearest node (starting with `node` itself) for which `predicate` holds, or `null`. */
export function findAncestor(node: SvgNode, predicate: (candidate: SvgNode) => boolean): SvgNode | null {
  let current: SvgNode | null = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}
