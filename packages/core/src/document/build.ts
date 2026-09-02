import type {
  DefsTable,
  GroupNode,
  ImageNode,
  Matrix,
  ParseOptions,
  PlanOptions,
  PreserveAspectRatio,
  Rect,
  RenderPlan,
  ResolvedStyle,
  ShapeNode,
  ShapeParams,
  SvgDocument,
  SvgNode,
  SvgWarning,
  TextNode,
  TextRun,
  WarningCode,
} from '../types';
import { SvgParseError, type XmlElement } from '../xml/tokenize';
import { IDENTITY, multiply, parseTransform, translate } from '../geometry/matrix';
import { nodeBBox } from '../geometry/bbox';
import { unionRects } from '../geometry/rect';
import { parsePathData } from '../geometry/path';
import { isPercentage, parseLength, parseNumberList } from '../style/length';
import { collectDeclarations, resolveStyle, type Declarations, type StyleWarn } from '../style/resolve';
import { planDocument } from '../plan/plan';
import { selectNodes } from './select';

const SHAPE_TAGS: ReadonlySet<string> = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
]);
const CONTAINER_TAGS: ReadonlySet<string> = new Set(['g', 'a', 'switch']);
const DEF_TAGS: ReadonlySet<string> = new Set([
  'defs',
  'linearGradient',
  'radialGradient',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'symbol',
  'font',
  'font-face',
]);
const SILENT_TAGS: ReadonlySet<string> = new Set(['metadata', 'script']);
const ASPECT_ALIGN_RE = /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))$/;

interface BuildContext {
  warnings: SvgWarning[];
  onWarning?: (warning: SvgWarning) => void;
  byId: Map<string, SvgNode>;
  defs: DefsTable;
  reported: Set<string>;
  viewportWidth?: number;
  viewportHeight?: number;
}

type Axis = 'x' | 'y';

function warn(ctx: BuildContext, code: WarningCode, message: string, tag?: string, nodeId?: string): void {
  const warning: SvgWarning = { code, message };
  if (tag !== undefined) warning.tag = tag;
  if (nodeId !== undefined) warning.nodeId = nodeId;
  ctx.warnings.push(warning);
  ctx.onWarning?.(warning);
}

function styleWarn(ctx: BuildContext, tag: string, id: string | undefined): StyleWarn {
  return (code, message) => warn(ctx, code, message, tag, id);
}

function parseClasses(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.trim().split(/\s+/).filter((c) => c.length > 0);
}

function textContent(el: XmlElement): string {
  let out = '';
  for (const child of el.children) {
    out += child.type === 'text' ? child.value : textContent(child);
  }
  return out;
}

function parsePreserveAspectRatio(value: string | undefined): PreserveAspectRatio {
  const result: PreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' };
  if (value === undefined) return result;
  const tokens = value.trim().split(/\s+/);
  if (tokens[0] === 'defer') tokens.shift();
  const align = tokens[0];
  if (align !== undefined && ASPECT_ALIGN_RE.test(align)) result.align = align;
  if (tokens[1] === 'slice') result.meetOrSlice = 'slice';
  return result;
}

function registerId(ctx: BuildContext, node: SvgNode, id: string | undefined): void {
  if (id === undefined || id.length === 0) return;
  node.id = id;
  if (ctx.byId.has(id)) {
    if (!ctx.reported.has(`id:${id}`)) {
      ctx.reported.add(`id:${id}`);
      warn(ctx, 'duplicate-id', `Duplicate id "${id}"; only the first element is addressable`, node.tag, id);
    }
    return;
  }
  ctx.byId.set(id, node);
}

function parseTransformAttr(ctx: BuildContext, el: XmlElement): Matrix {
  const value = el.attrs.transform;
  if (value === undefined) return IDENTITY;
  const m = parseTransform(value);
  if (m === null) {
    warn(ctx, 'invalid-transform', `Invalid transform "${value}"; ignored`, el.name, el.attrs.id);
    return IDENTITY;
  }
  return m;
}

/**
 * Read a length attribute in user units. Percentages resolve against the viewport axis.
 * Returns `fallback` when the attribute is missing, and warns (then falls back) when invalid.
 */
function attrLength(
  ctx: BuildContext,
  el: XmlElement,
  name: string,
  axis: Axis,
  style: ResolvedStyle,
  fallback: number | null
): number | null {
  const raw = el.attrs[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const percentBase = axis === 'x' ? ctx.viewportWidth : ctx.viewportHeight;
  const value = parseLength(raw, { fontSize: style.font.size, percentBase });
  if (value === null) {
    if (isPercentage(raw) && percentBase === undefined) {
      warn(
        ctx,
        'percent-length-unsupported',
        `Percentage ${name}="${raw}" cannot be resolved without a viewBox or absolute size`,
        el.name,
        el.attrs.id
      );
    } else {
      warn(ctx, 'invalid-attribute', `Invalid ${name}="${raw}"`, el.name, el.attrs.id);
    }
    return fallback;
  }
  return value;
}

function warnStylesheet(ctx: BuildContext, el: XmlElement): void {
  warn(
    ctx,
    'stylesheet-unsupported',
    '<style> stylesheets are not applied yet; elements styled through classes render with inherited or default paint',
    'style',
    el.attrs.id
  );
}

function registerDefs(ctx: BuildContext, el: XmlElement): void {
  if (el.name === 'defs') {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      // Design tools commonly place the stylesheet inside <defs>.
      if (child.name === 'style') warnStylesheet(ctx, child);
      else registerDefs(ctx, child);
    }
    return;
  }
  const id = el.attrs.id;
  if (id !== undefined && id.length > 0 && ctx.defs[id] === undefined) {
    ctx.defs[id] = { id, tag: el.name };
  }
}

function buildShapeParams(
  ctx: BuildContext,
  el: XmlElement,
  style: ResolvedStyle
): ShapeParams | null {
  const id = el.attrs.id;
  const len = (name: string, axis: Axis, fallback: number | null = 0): number | null =>
    attrLength(ctx, el, name, axis, style, fallback);

  switch (el.name) {
    case 'rect': {
      const width = len('width', 'x', null);
      const height = len('height', 'y', null);
      if (width === null || height === null || width <= 0 || height <= 0) return null;
      const rawRx = el.attrs.rx;
      const rawRy = el.attrs.ry;
      let rx = rawRx === undefined || rawRx === 'auto' ? null : len('rx', 'x', null);
      let ry = rawRy === undefined || rawRy === 'auto' ? null : len('ry', 'y', null);
      if (rx !== null && rx < 0) rx = null;
      if (ry !== null && ry < 0) ry = null;
      if (rx === null && ry === null) {
        rx = 0;
        ry = 0;
      } else if (rx === null) rx = ry as number;
      else if (ry === null) ry = rx;
      return {
        kind: 'rect',
        x: len('x', 'x') ?? 0,
        y: len('y', 'y') ?? 0,
        width,
        height,
        rx: Math.min(rx, width / 2),
        ry: Math.min(ry as number, height / 2),
      };
    }
    case 'circle': {
      const r = len('r', 'x', null);
      if (r === null || r <= 0) return null;
      return { kind: 'circle', cx: len('cx', 'x') ?? 0, cy: len('cy', 'y') ?? 0, r };
    }
    case 'ellipse': {
      const rawRx = el.attrs.rx;
      const rawRy = el.attrs.ry;
      let rx = rawRx === undefined || rawRx === 'auto' ? null : len('rx', 'x', null);
      let ry = rawRy === undefined || rawRy === 'auto' ? null : len('ry', 'y', null);
      if (rx === null && ry === null) return null;
      if (rx === null) rx = ry as number;
      if (ry === null) ry = rx;
      if (rx <= 0 || ry <= 0) return null;
      return { kind: 'ellipse', cx: len('cx', 'x') ?? 0, cy: len('cy', 'y') ?? 0, rx, ry };
    }
    case 'line':
      return {
        kind: 'line',
        x1: len('x1', 'x') ?? 0,
        y1: len('y1', 'y') ?? 0,
        x2: len('x2', 'x') ?? 0,
        y2: len('y2', 'y') ?? 0,
      };
    case 'polyline':
    case 'polygon': {
      const points = parseNumberList(el.attrs.points);
      if (points.length % 2 === 1) {
        warn(ctx, 'invalid-attribute', 'Odd number of coordinates in points; last one dropped', el.name, id);
        points.pop();
      }
      if (points.length < 2) return null;
      return { kind: el.name, points };
    }
    case 'path': {
      const d = el.attrs.d;
      if (d === undefined || d.trim().length === 0) return null;
      const result = parsePathData(d);
      if (result.error !== undefined) {
        warn(ctx, 'invalid-path', `Malformed path data: ${result.error}`, 'path', id);
      }
      if (result.segments.length === 0) return null;
      const params: ShapeParams = { kind: 'path', d, segments: result.segments };
      if (result.error !== undefined) params.error = result.error;
      return params;
    }
    default:
      return null;
  }
}

function normalizeRuns(runs: TextRun[]): TextRun[] {
  const collapsed = runs.map((run) => ({ ...run, text: run.text.replace(/\s+/g, ' ') }));
  const first = collapsed[0];
  if (first) first.text = first.text.replace(/^\s+/, '');
  const last = collapsed[collapsed.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, '');
  return collapsed.filter((run) => run.text.length > 0);
}

function buildText(
  ctx: BuildContext,
  el: XmlElement,
  parent: GroupNode,
  style: ResolvedStyle,
  transform: Matrix
): TextNode | null {
  const firstLength = (element: XmlElement, name: string, axis: Axis, elementStyle: ResolvedStyle): number | undefined => {
    const raw = element.attrs[name];
    if (raw === undefined) return undefined;
    const token = raw.trim().split(/[\s,]+/)[0];
    if (token === undefined || token.length === 0) return undefined;
    const value = parseLength(token, {
      fontSize: elementStyle.font.size,
      percentBase: axis === 'x' ? ctx.viewportWidth : ctx.viewportHeight,
    });
    if (value === null) {
      warn(ctx, 'invalid-attribute', `Invalid ${name}="${raw}"`, element.name, element.attrs.id);
      return undefined;
    }
    return value;
  };

  const runs: TextRun[] = [];
  const collect = (element: XmlElement, elementStyle: ResolvedStyle): void => {
    for (const child of element.children) {
      if (child.type === 'text') {
        runs.push({ text: child.value, style: elementStyle });
        continue;
      }
      if (child.name === 'tspan' || child.name === 'a') {
        const declarations = collectDeclarations(child.attrs);
        if (declarations.display?.trim() === 'none') continue;
        const childStyle = resolveStyle(declarations, elementStyle, styleWarn(ctx, child.name, child.attrs.id));
        const before = runs.length;
        collect(child, childStyle);
        const firstRun = runs[before];
        if (firstRun) {
          const x = firstLength(child, 'x', 'x', childStyle);
          const y = firstLength(child, 'y', 'y', childStyle);
          const dx = firstLength(child, 'dx', 'x', childStyle);
          const dy = firstLength(child, 'dy', 'y', childStyle);
          if (x !== undefined) firstRun.x = x;
          if (y !== undefined) firstRun.y = y;
          if (dx !== undefined) firstRun.dx = dx;
          if (dy !== undefined) firstRun.dy = dy;
        }
        continue;
      }
      if (child.name === 'title' || child.name === 'desc' || child.name.includes(':')) continue;
      if (!ctx.reported.has(`tag:${child.name}`)) {
        ctx.reported.add(`tag:${child.name}`);
        warn(ctx, 'unsupported-element', `<${child.name}> inside <text> is not supported and was skipped`, child.name, child.attrs.id);
      }
    }
  };
  collect(el, style);

  const normalized = normalizeRuns(runs);
  if (normalized.length === 0) return null;

  const node: TextNode = {
    kind: 'text',
    tag: 'text',
    classes: parseClasses(el.attrs.class),
    transform,
    style,
    attrs: el.attrs,
    parent,
    x: firstLength(el, 'x', 'x', style) ?? 0,
    y: firstLength(el, 'y', 'y', style) ?? 0,
    runs: normalized,
  };
  return node;
}

function buildImage(
  ctx: BuildContext,
  el: XmlElement,
  parent: GroupNode,
  style: ResolvedStyle,
  transform: Matrix
): ImageNode | null {
  const href = el.attrs.href ?? el.attrs['xlink:href'];
  if (href === undefined || href.trim().length === 0) {
    warn(ctx, 'invalid-attribute', '<image> without href was skipped', 'image', el.attrs.id);
    return null;
  }
  const width = attrLength(ctx, el, 'width', 'x', style, null);
  const height = attrLength(ctx, el, 'height', 'y', style, null);
  if (width === null || height === null || width <= 0 || height <= 0) {
    warn(ctx, 'invalid-attribute', '<image> needs explicit positive width and height', 'image', el.attrs.id);
    return null;
  }
  const rect: Rect = {
    x: attrLength(ctx, el, 'x', 'x', style, 0) ?? 0,
    y: attrLength(ctx, el, 'y', 'y', style, 0) ?? 0,
    width,
    height,
  };
  return {
    kind: 'image',
    tag: 'image',
    classes: parseClasses(el.attrs.class),
    transform,
    style,
    attrs: el.attrs,
    parent,
    href: href.trim(),
    rect,
    preserveAspectRatio: el.attrs.preserveAspectRatio?.trim() || 'xMidYMid meet',
  };
}

function buildElement(ctx: BuildContext, el: XmlElement, parent: GroupNode): void {
  const tag = el.name;
  const id = el.attrs.id;

  if (tag === 'title' || tag === 'desc') {
    const content = textContent(el).trim();
    if (content.length > 0) {
      if (tag === 'title') parent.title = content;
      else parent.desc = content;
    }
    return;
  }
  if (tag.includes(':')) return; // editor namespaces: inkscape:, sodipodi:, ...
  if (tag === 'style') {
    warnStylesheet(ctx, el);
    return;
  }
  if (tag === 'use') {
    warn(ctx, 'use-unsupported', '<use> is not supported yet; the referenced content is not rendered', 'use', id);
    return;
  }
  if (DEF_TAGS.has(tag)) {
    registerDefs(ctx, el);
    return;
  }
  if (SILENT_TAGS.has(tag)) return;

  const declarations: Declarations = collectDeclarations(el.attrs);
  if (declarations.display?.trim() === 'none') return;
  const style = resolveStyle(declarations, parent.style, styleWarn(ctx, tag, id));
  let transform = parseTransformAttr(ctx, el);

  if (CONTAINER_TAGS.has(tag) || tag === 'svg') {
    if (tag === 'svg') {
      warn(ctx, 'nested-svg', 'Nested <svg> is treated as a group; its viewBox and size are ignored', 'svg', id);
      const x = attrLength(ctx, el, 'x', 'x', style, 0) ?? 0;
      const y = attrLength(ctx, el, 'y', 'y', style, 0) ?? 0;
      if (x !== 0 || y !== 0) transform = multiply(translate(x, y), transform);
    }
    const group: GroupNode = {
      kind: 'group',
      tag,
      classes: parseClasses(el.attrs.class),
      transform,
      style,
      attrs: el.attrs,
      parent,
      children: [],
    };
    registerId(ctx, group, id);
    parent.children.push(group);
    if (tag === 'switch') {
      const first = el.children.find((child) => child.type === 'element');
      if (first && first.type === 'element') buildElement(ctx, first, group);
    } else {
      buildChildren(ctx, el, group);
    }
    return;
  }

  if (SHAPE_TAGS.has(tag)) {
    const params = buildShapeParams(ctx, el, style);
    if (!params) return;
    const node: ShapeNode = {
      kind: 'shape',
      tag,
      classes: parseClasses(el.attrs.class),
      transform,
      style,
      attrs: el.attrs,
      parent,
      shape: params.kind,
      params,
    };
    registerId(ctx, node, id);
    parent.children.push(node);
    return;
  }

  if (tag === 'text') {
    const node = buildText(ctx, el, parent, style, transform);
    if (!node) return;
    registerId(ctx, node, id);
    parent.children.push(node);
    return;
  }

  if (tag === 'image') {
    const node = buildImage(ctx, el, parent, style, transform);
    if (!node) return;
    registerId(ctx, node, id);
    parent.children.push(node);
    return;
  }

  if (!ctx.reported.has(`tag:${tag}`)) {
    ctx.reported.add(`tag:${tag}`);
    warn(ctx, 'unsupported-element', `<${tag}> is not supported and was skipped`, tag, id);
  }
}

function buildChildren(ctx: BuildContext, el: XmlElement, parent: GroupNode): void {
  for (const child of el.children) {
    if (child.type === 'element') buildElement(ctx, child, parent);
  }
}

/** Build a scene graph document from a parsed `<svg>` element. */
export function buildDocument(rootEl: XmlElement, options: ParseOptions = {}): SvgDocument {
  if (rootEl.name !== 'svg') {
    throw new SvgParseError(`Root element must be <svg>, got <${rootEl.name}>`, 0);
  }
  const ctx: BuildContext = {
    warnings: [],
    byId: new Map(),
    defs: {},
    reported: new Set(),
  };
  if (options.onWarning) ctx.onWarning = options.onWarning;

  let viewBox: Rect | null = null;
  const rawViewBox = rootEl.attrs.viewBox;
  if (rawViewBox !== undefined) {
    const nums = parseNumberList(rawViewBox);
    const [x, y, w, h] = nums;
    if (nums.length === 4 && x !== undefined && y !== undefined && w !== undefined && h !== undefined && w > 0 && h > 0) {
      viewBox = { x, y, width: w, height: h };
    } else {
      warn(ctx, 'invalid-viewbox', `Invalid viewBox "${rawViewBox}"; ignored`, 'svg');
    }
  }
  const width = parseLength(rootEl.attrs.width) ?? undefined;
  const height = parseLength(rootEl.attrs.height) ?? undefined;
  if (!viewBox && width !== undefined && height !== undefined && width > 0 && height > 0) {
    viewBox = { x: 0, y: 0, width, height };
  }
  ctx.viewportWidth = viewBox?.width ?? width;
  ctx.viewportHeight = viewBox?.height ?? height;

  const rootStyle = resolveStyle(collectDeclarations(rootEl.attrs), null, styleWarn(ctx, 'svg', rootEl.attrs.id));
  const root: GroupNode = {
    kind: 'group',
    tag: 'svg',
    classes: parseClasses(rootEl.attrs.class),
    transform: IDENTITY,
    style: rootStyle,
    attrs: rootEl.attrs,
    parent: null,
    children: [],
  };
  registerId(ctx, root, rootEl.attrs.id);
  buildChildren(ctx, rootEl, root);

  const bounds = { value: null as Rect | null };
  const visitBounds = (node: SvgNode): void => {
    if (node.kind === 'group') {
      for (const child of node.children) visitBounds(child);
    } else {
      bounds.value = unionRects(bounds.value, nodeBBox(node, 'world'));
    }
  };
  visitBounds(root);
  const contentBounds: Rect = bounds.value ?? viewBox ?? { x: 0, y: 0, width: width ?? 0, height: height ?? 0 };

  let cachedPlan: RenderPlan | null = null;
  const document: SvgDocument = {
    viewBox,
    preserveAspectRatio: parsePreserveAspectRatio(rootEl.attrs.preserveAspectRatio),
    root,
    defs: ctx.defs,
    contentBounds,
    warnings: ctx.warnings,
    getElementById: (id: string) => ctx.byId.get(id),
    querySelectorAll: (selector: string) => selectNodes(root, selector),
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
