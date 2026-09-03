import type {
  DefEntry,
  GroupNode,
  ImageNode,
  LinearGradientDef,
  Matrix,
  PreserveAspectRatio,
  RadialGradientDef,
  Rect,
  ResolvedStyle,
  ShapeKind,
  ShapeNode,
  ShapeParams,
  SvgDocument,
  SvgNode,
  SvgWarning,
  TextNode,
  TextRun,
} from '../types';
import { parseXml } from '../xml/tokenize';
import { serializeXml } from '../xml/serialize';
import { createDocument, indexIds } from './create';

export const IR_FORMAT = 'svg-core-ir';
export const IR_VERSION = 1;

interface SerializedNodeBase {
  id?: string;
  classes: string[];
  tag: string;
  transform: Matrix;
  style: ResolvedStyle;
  attrs: Record<string, string>;
  title?: string;
  desc?: string;
}

export interface SerializedRun {
  text: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  /** Omitted when the run uses the text node's own style. */
  style?: ResolvedStyle;
}

export type SerializedNode =
  | (SerializedNodeBase & { kind: 'group'; children: SerializedNode[] })
  | (SerializedNodeBase & { kind: 'shape'; shape: ShapeKind; params: ShapeParams })
  | (SerializedNodeBase & { kind: 'text'; x: number; y: number; runs: SerializedRun[] })
  | (SerializedNodeBase & { kind: 'image'; href: string; rect: Rect; preserveAspectRatio: string });

export type SerializedDef =
  | LinearGradientDef
  | RadialGradientDef
  | { kind: 'clipPath'; id: string; units: 'objectBoundingBox' | 'userSpaceOnUse'; transform: Matrix; root: SerializedNode }
  | { kind: 'raw'; id: string; tag: string; xml: string };

/** JSON-safe form of a document: the scene graph without parent links, definitions and warnings. */
export interface SerializedDocument {
  format: typeof IR_FORMAT;
  version: typeof IR_VERSION;
  viewBox: Rect | null;
  width?: number;
  height?: number;
  preserveAspectRatio: PreserveAspectRatio;
  root: SerializedNode;
  defs: Record<string, SerializedDef>;
  warnings: SvgWarning[];
}

function serializeBase(node: SvgNode): SerializedNodeBase {
  const base: SerializedNodeBase = {
    classes: [...node.classes],
    tag: node.tag,
    transform: node.transform,
    style: node.style,
    attrs: { ...node.attrs },
  };
  if (node.id !== undefined) base.id = node.id;
  if (node.title !== undefined) base.title = node.title;
  if (node.desc !== undefined) base.desc = node.desc;
  return base;
}

function serializeNode(node: SvgNode): SerializedNode {
  const base = serializeBase(node);
  switch (node.kind) {
    case 'group':
      return { ...base, kind: 'group', children: node.children.map(serializeNode) };
    case 'shape':
      return { ...base, kind: 'shape', shape: node.shape, params: node.params };
    case 'text':
      return {
        ...base,
        kind: 'text',
        x: node.x,
        y: node.y,
        runs: node.runs.map((run) => {
          const out: SerializedRun = { text: run.text };
          if (run.x !== undefined) out.x = run.x;
          if (run.y !== undefined) out.y = run.y;
          if (run.dx !== undefined) out.dx = run.dx;
          if (run.dy !== undefined) out.dy = run.dy;
          if (run.style !== node.style) out.style = run.style;
          return out;
        }),
      };
    case 'image':
      return { ...base, kind: 'image', href: node.href, rect: node.rect, preserveAspectRatio: node.preserveAspectRatio };
  }
}

function serializeDef(def: DefEntry): SerializedDef {
  switch (def.kind) {
    case 'linearGradient':
    case 'radialGradient':
      return def;
    case 'clipPath':
      return { kind: 'clipPath', id: def.id, units: def.units, transform: def.transform, root: serializeNode(def.root) };
    case 'raw':
      return { kind: 'raw', id: def.id, tag: def.tag, xml: serializeXml(def.element) };
  }
}

/**
 * Serialize a document to a JSON-safe object. Application data attached to nodes (`data`) is
 * not included. Feed the result to `JSON.stringify` for storage or transport.
 */
export function serializeDocument(document: SvgDocument): SerializedDocument {
  const defs: Record<string, SerializedDef> = {};
  for (const [id, def] of Object.entries(document.defs)) defs[id] = serializeDef(def);
  const out: SerializedDocument = {
    format: IR_FORMAT,
    version: IR_VERSION,
    viewBox: document.viewBox,
    preserveAspectRatio: document.preserveAspectRatio,
    root: serializeNode(document.root),
    defs,
    warnings: document.warnings,
  };
  if (document.width !== undefined) out.width = document.width;
  if (document.height !== undefined) out.height = document.height;
  return out;
}

function deserializeNode(s: SerializedNode, parent: GroupNode | null): SvgNode {
  const base = {
    classes: [...s.classes],
    tag: s.tag,
    transform: s.transform,
    style: s.style,
    attrs: s.attrs,
    parent,
  };
  const optional = (node: SvgNode): void => {
    if (s.id !== undefined) node.id = s.id;
    if (s.title !== undefined) node.title = s.title;
    if (s.desc !== undefined) node.desc = s.desc;
  };
  switch (s.kind) {
    case 'group': {
      const group: GroupNode = { ...base, kind: 'group', children: [] };
      optional(group);
      for (const child of s.children) group.children.push(deserializeNode(child, group));
      return group;
    }
    case 'shape': {
      const shape: ShapeNode = { ...base, kind: 'shape', shape: s.shape, params: s.params };
      optional(shape);
      return shape;
    }
    case 'text': {
      const text: TextNode = { ...base, kind: 'text', x: s.x, y: s.y, runs: [] };
      optional(text);
      for (const run of s.runs) {
        const out: TextRun = { text: run.text, style: run.style ?? text.style };
        if (run.x !== undefined) out.x = run.x;
        if (run.y !== undefined) out.y = run.y;
        if (run.dx !== undefined) out.dx = run.dx;
        if (run.dy !== undefined) out.dy = run.dy;
        text.runs.push(out);
      }
      return text;
    }
    case 'image': {
      const image: ImageNode = { ...base, kind: 'image', href: s.href, rect: s.rect, preserveAspectRatio: s.preserveAspectRatio };
      optional(image);
      return image;
    }
  }
}

function deserializeDef(s: SerializedDef): DefEntry {
  switch (s.kind) {
    case 'linearGradient':
    case 'radialGradient':
      return s;
    case 'clipPath': {
      const root = deserializeNode(s.root, null);
      if (root.kind !== 'group') throw new Error(`Clip path "${s.id}" root must be a group`);
      return { kind: 'clipPath', id: s.id, units: s.units, transform: s.transform, root };
    }
    case 'raw':
      return { kind: 'raw', id: s.id, tag: s.tag, element: parseXml(s.xml) };
  }
}

/** Rebuild a live document (parent links, id lookup, hit testing, planning) from serialized form. */
export function deserializeDocument(input: SerializedDocument | string): SvgDocument {
  const s: SerializedDocument = typeof input === 'string' ? (JSON.parse(input) as SerializedDocument) : input;
  if (s.format !== IR_FORMAT) throw new Error(`Not a ${IR_FORMAT} document`);
  if (s.version !== IR_VERSION) throw new Error(`Unsupported ${IR_FORMAT} version ${String(s.version)}`);
  const rootNode = deserializeNode(s.root, null);
  if (rootNode.kind !== 'group') throw new Error('Document root must be a group');
  const defs: Record<string, DefEntry> = {};
  for (const [id, def] of Object.entries(s.defs)) defs[id] = deserializeDef(def);
  const parts = {
    viewBox: s.viewBox,
    preserveAspectRatio: s.preserveAspectRatio,
    root: rootNode,
    defs,
    warnings: s.warnings,
    byId: indexIds(rootNode),
  };
  return createDocument(s.width === undefined && s.height === undefined ? parts : { ...parts, width: s.width, height: s.height });
}
