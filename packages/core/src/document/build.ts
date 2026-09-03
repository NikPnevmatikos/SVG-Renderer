import type {
  DefsTable,
  GroupNode,
  ImageNode,
  Matrix,
  ParseOptions,
  Rect,
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
import { parsePreserveAspectRatio, viewBoxTransform } from '../geometry/viewport';
import { parsePathData } from '../geometry/path';
import { isPercentage, parseLength, parseNumberList } from '../style/length';
import { resolveStyle, type Declarations, type StyleWarn } from '../style/resolve';
import { Stylesheet, cascadeDeclarations } from '../css/cascade';
import { xmlAdapter } from '../css/adapters';
import { extractCustomProperties, substituteVars } from '../css/vars';
import { createDocument } from './create';
import { buildDefs, DEF_LIKE_TAGS, isPaintServer, type DefsHost } from './defs';

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
const SILENT_TAGS: ReadonlySet<string> = new Set(['metadata', 'script', 'style']);
const MAX_USE_DEPTH = 32;

/** Inherited CSS custom properties in scope for an element. */
type Vars = Readonly<Record<string, string>> | null;

interface BuildContext {
  warnings: SvgWarning[];
  onWarning?: (warning: SvgWarning) => void;
  byId: Map<string, SvgNode>;
  defs: DefsTable;
  /** Raw elements addressable by id for definitions: everything inside <defs> and def-like elements anywhere. */
  defElements: Map<string, XmlElement>;
  /** Every element with an id, for `<use>` targets. */
  elementsById: Map<string, XmlElement>;
  /** Ids of `<use>` targets currently being expanded, for cycle detection. */
  useStack: string[];
  /** While > 0, built nodes are clones and must not claim ids. */
  suppressIds: number;
  reported: Set<string>;
  stylesheet: Stylesheet | null;
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

/**
 * Conditional processing for `<switch>`: the first child that can actually be rendered wins.
 * Children needing extensions or the Extensibility feature (draw.io's `foreignObject`
 * branch), foreign elements and non-English `systemLanguage` alternatives are skipped.
 */
function switchCandidate(el: XmlElement): boolean {
  if (el.name === 'foreignObject' || el.name.includes(':')) return false;
  const extensions = el.attrs.requiredExtensions;
  if (extensions !== undefined && extensions.trim().length > 0) return false;
  const features = el.attrs.requiredFeatures;
  if (features !== undefined && /Extensibility/.test(features)) return false;
  const languages = el.attrs.systemLanguage;
  if (languages !== undefined) {
    const list = languages
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0);
    if (list.length > 0 && !list.some((l) => l === 'en' || l.startsWith('en-'))) return false;
  }
  return true;
}

function registerId(ctx: BuildContext, node: SvgNode, id: string | undefined): void {
  if (id === undefined || id.length === 0 || ctx.suppressIds > 0) return;
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

/** Gather every `<style>` in document order and parse them into one stylesheet. */
function collectStylesheet(ctx: BuildContext, root: XmlElement): void {
  const chunks: string[] = [];
  const visit = (el: XmlElement): void => {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      if (child.name === 'style') {
        const type = child.attrs.type?.trim().toLowerCase() ?? '';
        if (type === '' || type === 'text/css') chunks.push(textContent(child));
        else warn(ctx, 'css-unsupported', `<style type="${child.attrs.type}"> was ignored`, 'style', child.attrs.id);
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  if (chunks.length === 0) return;
  const { stylesheet, warnings } = Stylesheet.parse(chunks.join('\n'));
  for (const message of warnings) warn(ctx, 'css-unsupported', message, 'style');
  if (!stylesheet.isEmpty()) ctx.stylesheet = stylesheet;
}

/** Cascaded declarations for an element, with `var()` references substituted. */
function declarationsFor(
  ctx: BuildContext,
  el: XmlElement,
  parentVars: Vars
): { declarations: Declarations; vars: Vars } {
  const fromStylesheet = ctx.stylesheet ? ctx.stylesheet.collect(el, xmlAdapter) : null;
  const declarations = cascadeDeclarations(el.attrs, fromStylesheet);
  const own = extractCustomProperties(declarations);
  const vars: Vars = own ? { ...(parentVars ?? {}), ...own } : parentVars;
  if (vars) {
    for (const name in declarations) {
      if (name.startsWith('--')) continue;
      const value = declarations[name];
      if (value !== undefined && value.includes('var(')) declarations[name] = substituteVars(value, vars);
    }
  }
  return { declarations, vars };
}

/** Collect every element that may be referenced by id: def-like elements anywhere and everything inside <defs>. */
function collectDefElements(ctx: BuildContext, root: XmlElement): void {
  const register = (el: XmlElement): void => {
    const id = el.attrs.id;
    if (id !== undefined && id.length > 0 && !ctx.defElements.has(id)) ctx.defElements.set(id, el);
  };
  const visit = (el: XmlElement, insideDefs: boolean): void => {
    for (const child of el.children) {
      if (child.type !== 'element' || child.name === 'style') continue;
      const id = child.attrs.id;
      if (id !== undefined && id.length > 0 && !ctx.elementsById.has(id)) ctx.elementsById.set(id, child);
      if (child.name === 'defs') {
        visit(child, true);
        continue;
      }
      if (insideDefs || DEF_LIKE_TAGS.has(child.name)) register(child);
      visit(child, insideDefs);
    }
  };
  visit(root, false);
}

/**
 * Expand `<use>`: a group carrying the use element's style and `transform × translate(x, y)`,
 * containing a fresh build of the referenced element. Symbols get their viewBox mapped onto
 * the use's width/height. Clones never claim ids; cycles and bad targets are reported.
 */
function buildUse(ctx: BuildContext, el: XmlElement, parent: GroupNode, parentVars: Vars): void {
  const id = el.attrs.id;
  const href = (el.attrs.href ?? el.attrs['xlink:href'])?.trim();
  if (href === undefined || !href.startsWith('#') || href.length < 2) {
    warn(ctx, 'unresolved-reference', '<use> without a local href was skipped', 'use', id);
    return;
  }
  const targetId = href.slice(1);
  const target = ctx.elementsById.get(targetId);
  if (!target) {
    warn(ctx, 'unresolved-reference', `<use> references "#${targetId}" which does not exist`, 'use', id);
    return;
  }
  if (DEF_LIKE_TAGS.has(target.name) && target.name !== 'symbol') {
    warn(ctx, 'unresolved-reference', `<use> references <${target.name} id="${targetId}">, which is not renderable`, 'use', id);
    return;
  }
  if (ctx.useStack.includes(targetId) || ctx.useStack.length >= MAX_USE_DEPTH) {
    warn(ctx, 'unresolved-reference', `<use> reference cycle through "#${targetId}" was skipped`, 'use', id);
    return;
  }

  const { declarations, vars } = declarationsFor(ctx, el, parentVars);
  if (declarations.display?.trim() === 'none') return;
  const style = resolveStyle(declarations, parent.style, styleWarn(ctx, 'use', id));
  let transform = parseTransformAttr(ctx, el);
  const x = attrLength(ctx, el, 'x', 'x', style, 0) ?? 0;
  const y = attrLength(ctx, el, 'y', 'y', style, 0) ?? 0;
  if (x !== 0 || y !== 0) transform = multiply(transform, translate(x, y));

  const group: GroupNode = {
    kind: 'group',
    tag: 'use',
    classes: parseClasses(el.attrs.class),
    transform,
    style,
    attrs: el.attrs,
    parent,
    children: [],
  };
  registerId(ctx, group, id);
  parent.children.push(group);

  ctx.useStack.push(targetId);
  ctx.suppressIds++;
  try {
    if (target.name === 'symbol') buildSymbolInto(ctx, target, group, el, style, vars);
    else buildElement(ctx, target, group, vars);
  } finally {
    ctx.suppressIds--;
    ctx.useStack.pop();
  }
}

function buildSymbolInto(
  ctx: BuildContext,
  symbol: XmlElement,
  group: GroupNode,
  useEl: XmlElement,
  useStyle: ResolvedStyle,
  parentVars: Vars
): void {
  const { declarations, vars } = declarationsFor(ctx, symbol, parentVars);
  const style = resolveStyle(declarations, useStyle, styleWarn(ctx, 'symbol', symbol.attrs.id));
  let transform: Matrix = IDENTITY;
  const rawViewBox = symbol.attrs.viewBox;
  if (rawViewBox !== undefined) {
    const nums = parseNumberList(rawViewBox);
    const [vx, vy, vw, vh] = nums;
    if (nums.length === 4 && vx !== undefined && vy !== undefined && vw !== undefined && vh !== undefined && vw > 0 && vh > 0) {
      const width =
        attrLength(ctx, useEl, 'width', 'x', useStyle, null) ??
        attrLength(ctx, symbol, 'width', 'x', style, null) ??
        ctx.viewportWidth ??
        vw;
      const height =
        attrLength(ctx, useEl, 'height', 'y', useStyle, null) ??
        attrLength(ctx, symbol, 'height', 'y', style, null) ??
        ctx.viewportHeight ??
        vh;
      transform = viewBoxTransform(
        { x: vx, y: vy, width: vw, height: vh },
        width,
        height,
        parsePreserveAspectRatio(symbol.attrs.preserveAspectRatio)
      );
    } else {
      warn(ctx, 'invalid-viewbox', `Invalid viewBox "${rawViewBox}" on <symbol>; ignored`, 'symbol', symbol.attrs.id);
    }
  }
  const inner: GroupNode = {
    kind: 'group',
    tag: 'symbol',
    classes: parseClasses(symbol.attrs.class),
    transform,
    style,
    attrs: symbol.attrs,
    parent: group,
    children: [],
  };
  group.children.push(inner);
  buildChildren(ctx, symbol, inner, vars);
}

/**
 * Replace references to definitions that do not exist (or are of the wrong kind) with their
 * fallbacks, so backends never receive a dangling `url(#id)`. One warning per missing id.
 */
function validateReferences(ctx: BuildContext, root: GroupNode): void {
  const missing = (id: string, what: string, tag: string, nodeId: string | undefined): void => {
    if (ctx.reported.has(`ref:${id}`)) return;
    ctx.reported.add(`ref:${id}`);
    warn(ctx, 'unresolved-reference', `${what} references "#${id}" which is not defined`, tag, nodeId);
  };
  const fixPaint = (style: ResolvedStyle, key: 'fill' | 'stroke', tag: string, nodeId: string | undefined): void => {
    const paint = style[key];
    if (paint.type !== 'ref' || isPaintServer(ctx.defs[paint.id])) return;
    missing(paint.id, `${key} paint`, tag, nodeId);
    style[key] =
      paint.fallback !== undefined && paint.fallback !== 'none'
        ? { type: 'color', value: paint.fallback }
        : { type: 'none' };
  };
  const fixStyle = (style: ResolvedStyle, tag: string, nodeId: string | undefined): void => {
    fixPaint(style, 'fill', tag, nodeId);
    fixPaint(style, 'stroke', tag, nodeId);
    if (style.clipPath !== undefined && ctx.defs[style.clipPath]?.kind !== 'clipPath') {
      missing(style.clipPath, 'clip-path', tag, nodeId);
      style.clipPath = undefined;
    }
    for (const key of ['mask', 'filter'] as const) {
      const id = style[key];
      if (id === undefined) continue;
      const def = ctx.defs[id];
      if (def && def.kind === 'raw' && def.tag === key) continue;
      missing(id, key, tag, nodeId);
      style[key] = undefined;
    }
  };
  const visit = (node: SvgNode): void => {
    fixStyle(node.style, node.tag, node.id);
    if (node.kind === 'text') {
      for (const run of node.runs) if (run.style !== node.style) fixStyle(run.style, 'tspan', node.id);
    }
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(root);
  for (const def of Object.values(ctx.defs)) {
    if (def.kind === 'clipPath') visit(def.root);
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
  transform: Matrix,
  vars: Vars
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
  const collect = (element: XmlElement, elementStyle: ResolvedStyle, elementVars: Vars): void => {
    for (const child of element.children) {
      if (child.type === 'text') {
        runs.push({ text: child.value, style: elementStyle });
        continue;
      }
      if (child.name === 'tspan' || child.name === 'a') {
        const { declarations, vars: childVars } = declarationsFor(ctx, child, elementVars);
        if (declarations.display?.trim() === 'none') continue;
        const childStyle = resolveStyle(declarations, elementStyle, styleWarn(ctx, child.name, child.attrs.id));
        const before = runs.length;
        collect(child, childStyle, childVars);
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
  collect(el, style, vars);

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

function buildElement(ctx: BuildContext, el: XmlElement, parent: GroupNode, parentVars: Vars): void {
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
  if (tag === 'use') {
    buildUse(ctx, el, parent, parentVars);
    return;
  }
  if (DEF_TAGS.has(tag)) return; // collected by the definitions pre-pass, built after the tree
  if (SILENT_TAGS.has(tag)) return; // <style> was consumed by the stylesheet pre-pass

  const { declarations, vars } = declarationsFor(ctx, el, parentVars);
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
      const chosen = el.children.find(
        (child): child is XmlElement => child.type === 'element' && switchCandidate(child)
      );
      if (chosen) buildElement(ctx, chosen, group, vars);
    } else {
      buildChildren(ctx, el, group, vars);
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
    const node = buildText(ctx, el, parent, style, transform, vars);
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

function buildChildren(ctx: BuildContext, el: XmlElement, parent: GroupNode, vars: Vars): void {
  for (const child of el.children) {
    if (child.type === 'element') buildElement(ctx, child, parent, vars);
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
    defElements: new Map(),
    elementsById: new Map(),
    useStack: [],
    suppressIds: 0,
    reported: new Set(),
    stylesheet: null,
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

  collectStylesheet(ctx, rootEl);
  collectDefElements(ctx, rootEl);

  const { declarations: rootDeclarations, vars: rootVars } = declarationsFor(ctx, rootEl, null);
  const rootStyle = resolveStyle(rootDeclarations, null, styleWarn(ctx, 'svg', rootEl.attrs.id));
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
  buildChildren(ctx, rootEl, root, rootVars);

  const host: DefsHost = {
    defElements: ctx.defElements,
    defs: ctx.defs,
    viewportWidth: ctx.viewportWidth,
    viewportHeight: ctx.viewportHeight,
    warn: (code, message, tag, id) => warn(ctx, code, message, tag, id),
    declarationsFor: (el) => declarationsFor(ctx, el, rootVars).declarations,
    buildChildrenInto: (el, holder) => buildChildren(ctx, el, holder, rootVars),
    rootStyle,
  };
  buildDefs(host);
  validateReferences(ctx, root);

  return createDocument({
    viewBox,
    width,
    height,
    preserveAspectRatio: parsePreserveAspectRatio(rootEl.attrs.preserveAspectRatio),
    root,
    defs: ctx.defs,
    warnings: ctx.warnings,
    byId: ctx.byId,
  });
}
