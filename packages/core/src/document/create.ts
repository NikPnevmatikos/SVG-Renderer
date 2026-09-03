import type {
  DefsTable,
  GroupNode,
  HitTestOptions,
  PlanOptions,
  Point,
  PreserveAspectRatio,
  Rect,
  RenderPlan,
  SvgDocument,
  SvgNode,
  SvgWarning,
} from '../types';
import { nodeBBox, worldMatrix } from '../geometry/bbox';
import { nodeContainsPoint } from '../geometry/hit';
import { scaleFactor } from '../geometry/matrix';
import { expandRect, unionRects } from '../geometry/rect';
import { planDocument } from '../plan/plan';
import { selectNodes } from './select';
import { SpatialIndex } from './spatial';

export interface DocumentParts {
  viewBox: Rect | null;
  width?: number;
  height?: number;
  preserveAspectRatio: PreserveAspectRatio;
  root: GroupNode;
  defs: DefsTable;
  warnings: SvgWarning[];
  byId: Map<string, SvgNode>;
}

/** Map of id to node for a finished tree; the first node claiming an id wins. */
export function indexIds(root: GroupNode): Map<string, SvgNode> {
  const byId = new Map<string, SvgNode>();
  const visit = (node: SvgNode): void => {
    if (node.id !== undefined && !byId.has(node.id)) byId.set(node.id, node);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(root);
  return byId;
}

/**
 * Assemble a document from a finished scene graph: content bounds, id lookup, selectors,
 * lazily built spatial index for hit testing, and a cached default render plan.
 */
export function createDocument(parts: DocumentParts): SvgDocument {
  const { viewBox, width, height, root, defs, warnings, byId } = parts;

  // Leaves in paint order with their world bounds (stroke bands included), for content
  // bounds now and for the spatial index used by elementsAt later.
  const leaves: { item: SvgNode; box: Rect }[] = [];
  const bounds = { value: null as Rect | null };
  const visitLeaves = (node: SvgNode): void => {
    if (node.kind === 'group') {
      for (const child of node.children) visitLeaves(child);
      return;
    }
    const box = nodeBBox(node, 'world');
    bounds.value = unionRects(bounds.value, box);
    if (box && node.style.visibility === 'visible') {
      const halfStroke =
        node.kind === 'shape' && node.style.stroke.type !== 'none'
          ? (node.style.strokeWidth / 2) * scaleFactor(worldMatrix(node))
          : 0;
      leaves.push({ item: node, box: halfStroke > 0 ? expandRect(box, halfStroke) : box });
    }
  };
  visitLeaves(root);
  const contentBounds: Rect = bounds.value ?? viewBox ?? { x: 0, y: 0, width: width ?? 0, height: height ?? 0 };

  let spatialIndex: SpatialIndex<SvgNode> | null = null;
  const elementsAt = (point: Point, options: HitTestOptions = {}): SvgNode[] => {
    if (!spatialIndex) spatialIndex = new SpatialIndex(leaves);
    const tolerance = options.tolerance ?? 0;
    const hitOptions = { includeStroke: options.includeStroke ?? true, tolerance, mode: options.mode ?? 'painted' };
    const hits: SvgNode[] = [];
    for (const node of spatialIndex.query(point, tolerance)) {
      if (options.filter && !options.filter(node)) continue;
      if (nodeContainsPoint(node, point, hitOptions)) hits.push(node);
    }
    return hits.reverse();
  };

  let cachedPlan: RenderPlan | null = null;
  const document: SvgDocument = {
    viewBox,
    preserveAspectRatio: parts.preserveAspectRatio,
    root,
    defs,
    contentBounds,
    warnings,
    getElementById: (id: string) => byId.get(id),
    querySelectorAll: (selector: string) => selectNodes(root, selector),
    elementsAt,
    plan: (planOptions?: PlanOptions) => {
      if (planOptions === undefined) {
        if (!cachedPlan) cachedPlan = planDocument(document, {});
        return cachedPlan;
      }
      return planDocument(document, planOptions);
    },
  };
  if (width !== undefined) document.width = width;
  if (height !== undefined) document.height = height;
  return document;
}
