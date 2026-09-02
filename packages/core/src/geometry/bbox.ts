import type { Matrix, Rect, ShapeNode, SvgNode, TextNode } from '../types';
import { invert, isIdentity, multiply } from './matrix';
import { pathBBox, shapeToPath, transformPathSegments } from './path';
import { rectFromPoints, transformRect, unionRects } from './rect';

/** Composed transform from the node's local space to document user space. */
export function worldMatrix(node: SvgNode): Matrix {
  let m = node.transform;
  let parent = node.parent;
  while (parent) {
    m = multiply(parent.transform, m);
    parent = parent.parent;
  }
  return m;
}

/** Geometric bounds of a shape in its own coordinate system (own transform excluded). */
export function shapeLocalBBox(shape: ShapeNode): Rect | null {
  const p = shape.params;
  switch (p.kind) {
    case 'rect':
      return { x: p.x, y: p.y, width: p.width, height: p.height };
    case 'circle':
      return { x: p.cx - p.r, y: p.cy - p.r, width: 2 * p.r, height: 2 * p.r };
    case 'ellipse':
      return { x: p.cx - p.rx, y: p.cy - p.ry, width: 2 * p.rx, height: 2 * p.ry };
    case 'line':
      return rectFromPoints([
        { x: p.x1, y: p.y1 },
        { x: p.x2, y: p.y2 },
      ]);
    case 'polyline':
    case 'polygon': {
      const points = [];
      for (let i = 0; i + 1 < p.points.length; i += 2) {
        points.push({ x: p.points[i] ?? 0, y: p.points[i + 1] ?? 0 });
      }
      return rectFromPoints(points);
    }
    case 'path':
      return pathBBox(p.segments);
  }
}

/**
 * Rough text bounds from font size and run lengths (average advance 0.55em, ascent 0.8em).
 * Good enough for fit-to-element and culling; exact metrics need a font engine.
 */
export function textApproxLocalBBox(text: TextNode): Rect | null {
  let width = 0;
  let size = text.style.font.size;
  for (const run of text.runs) {
    const advance = run.style.font.size * 0.55 + (run.style.font.letterSpacing ?? 0);
    width += run.text.length * advance;
    if (run.style.font.size > size) size = run.style.font.size;
  }
  if (width <= 0) return null;
  const anchor = text.style.font.textAnchor;
  const x = anchor === 'middle' ? text.x - width / 2 : anchor === 'end' ? text.x - width : text.x;
  return { x, y: text.y - size * 0.8, width, height: size };
}

/**
 * Bounding box of a node. `world` applies every ancestor transform and the node's own;
 * `local` is the node's own coordinate system (its own transform excluded), like `getBBox()`.
 */
export function nodeBBox(node: SvgNode, space: 'local' | 'world' = 'world'): Rect | null {
  switch (node.kind) {
    case 'shape': {
      if (space === 'local') return shapeLocalBBox(node);
      const m = worldMatrix(node);
      if (isIdentity(m)) return shapeLocalBBox(node);
      return pathBBox(transformPathSegments(shapeToPath(node), m));
    }
    case 'text': {
      const local = textApproxLocalBBox(node);
      if (!local || space === 'local') return local;
      const m = worldMatrix(node);
      return isIdentity(m) ? local : transformRect(local, m);
    }
    case 'image': {
      if (space === 'local') return { ...node.rect };
      const m = worldMatrix(node);
      return isIdentity(m) ? { ...node.rect } : transformRect(node.rect, m);
    }
    case 'group': {
      let bounds: Rect | null = null;
      for (const child of node.children) bounds = unionRects(bounds, nodeBBox(child, 'world'));
      if (!bounds || space === 'world') return bounds;
      const inverse = invert(worldMatrix(node));
      return inverse ? transformRect(bounds, inverse) : bounds;
    }
  }
}
