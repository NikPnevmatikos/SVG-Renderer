import { findAncestor, nodeBBox, type Rect, type SvgDocument, type SvgNode } from 'svg-core';
import type { StyleOverride } from '../mapping';
import type { Decorator, InteractiveSpec, SelectionMode } from './types';

/** Selection after tapping `id`: single mode toggles the one element, multiple mode toggles membership. */
export function nextSelection(mode: SelectionMode, current: readonly string[], id: string): string[] {
  const selected = current.includes(id);
  if (mode === 'none') return [...current];
  if (mode === 'single') return selected ? [] : [id];
  return selected ? current.filter((other) => other !== id) : [...current, id];
}

export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export interface ResolvedInteractive {
  isInteractive: (node: SvgNode) => boolean;
  dataFor: (node: SvgNode) => unknown;
  /** Interactive nodes in document order (for decorators and lookups). */
  nodes: SvgNode[];
}

/** Turn the `interactive` prop into a predicate plus data lookup. Records attach their values as `node.data`. */
export function resolveInteractive(document: SvgDocument, spec: InteractiveSpec | undefined): ResolvedInteractive {
  if (spec === undefined) return { isInteractive: () => false, dataFor: () => undefined, nodes: [] };
  if (typeof spec === 'function') {
    const nodes = collect(document, spec);
    const set = new Set(nodes);
    return { isInteractive: (node) => set.has(node), dataFor: (node) => node.data, nodes };
  }
  if (typeof spec === 'string') {
    const nodes = document.querySelectorAll(spec);
    const set = new Set(nodes);
    return { isInteractive: (node) => set.has(node), dataFor: (node) => node.data, nodes };
  }
  const nodes: SvgNode[] = [];
  const data = new Map<SvgNode, unknown>();
  for (const [id, value] of Object.entries(spec)) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.data = value;
    data.set(node, value);
    nodes.push(node);
  }
  return { isInteractive: (node) => data.has(node), dataFor: (node) => data.get(node), nodes };
}

function collect(document: SvgDocument, predicate: (node: SvgNode) => boolean): SvgNode[] {
  const out: SvgNode[] = [];
  const visit = (node: SvgNode): void => {
    if (predicate(node)) out.push(node);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(document.root);
  return out;
}

/** Nodes matching a selector or an id (ids win when both would parse). */
export function nodesFor(document: SvgDocument, idOrSelector: string): SvgNode[] {
  const byId = document.getElementById(idOrSelector);
  if (byId) return [byId];
  try {
    return document.querySelectorAll(idOrSelector);
  } catch {
    return [];
  }
}

/** `elementStyles` prop to a per-node override map, later keys overriding earlier ones. */
export function buildOverrides(
  document: SvgDocument,
  elementStyles: Readonly<Record<string, StyleOverride>> | undefined
): Map<SvgNode, StyleOverride> {
  const overrides = new Map<SvgNode, StyleOverride>();
  if (!elementStyles) return overrides;
  for (const [key, override] of Object.entries(elementStyles)) {
    for (const node of nodesFor(document, key)) {
      const existing = overrides.get(node);
      overrides.set(node, existing ? { ...existing, ...override } : override);
    }
  }
  return overrides;
}

export interface DecoratorTarget {
  decorator: Decorator;
  decoratorIndex: number;
  node: SvgNode;
  bbox: Rect;
  /** Anchor point in document coordinates. */
  anchor: { x: number; y: number };
}

/** Every (decorator, node) pair with its anchor point. */
export function resolveDecorators(document: SvgDocument, decorators: readonly Decorator[] | undefined): DecoratorTarget[] {
  const targets: DecoratorTarget[] = [];
  if (!decorators) return targets;
  decorators.forEach((decorator, decoratorIndex) => {
    const nodes = typeof decorator.match === 'string' ? document.querySelectorAll(decorator.match) : collect(document, decorator.match);
    for (const node of nodes) {
      const bbox = nodeBBox(node, 'world');
      if (!bbox) continue;
      targets.push({ decorator, decoratorIndex, node, bbox, anchor: anchorPoint(bbox, decorator.anchor ?? 'center') });
    }
  });
  return targets;
}

function anchorPoint(bbox: Rect, anchor: NonNullable<Decorator['anchor']>): { x: number; y: number } {
  switch (anchor) {
    case 'topLeft':
      return { x: bbox.x, y: bbox.y };
    case 'topRight':
      return { x: bbox.x + bbox.width, y: bbox.y };
    case 'bottomLeft':
      return { x: bbox.x, y: bbox.y + bbox.height };
    case 'bottomRight':
      return { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
    default:
      return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }
}

/** The interactive node a tap on `target` should report: the leaf itself or its nearest interactive ancestor. */
export function interactiveFor(target: SvgNode, isInteractive: (node: SvgNode) => boolean): SvgNode | null {
  return findAncestor(target, isInteractive);
}
