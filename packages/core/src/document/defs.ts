import type {
  ClipPathDef,
  DefEntry,
  GradientStop,
  GradientUnits,
  GroupNode,
  LinearGradientDef,
  Matrix,
  RadialGradientDef,
  ResolvedStyle,
  SpreadMethod,
} from '../types';
import type { XmlElement } from '../xml/tokenize';
import { IDENTITY, parseTransform } from '../geometry/matrix';
import { parseLength } from '../style/length';
import { parseOpacity, type Declarations } from '../style/resolve';

/** What the defs builder needs from the document builder. Keeps this module free of build internals. */
export interface DefsHost {
  /** Raw elements that may be referenced by id: everything inside `<defs>` plus def-like elements anywhere. */
  defElements: Map<string, XmlElement>;
  defs: Record<string, DefEntry>;
  viewportWidth?: number;
  viewportHeight?: number;
  warn(code: 'invalid-attribute' | 'unresolved-reference' | 'invalid-transform', message: string, tag: string, id?: string): void;
  /** Cascaded declarations for an element (stylesheet + attributes + inline). */
  declarationsFor(el: XmlElement): Declarations;
  /** Build the children of `el` as scene nodes under `holder`. */
  buildChildrenInto(el: XmlElement, holder: GroupNode): void;
  rootStyle: ResolvedStyle;
}

export const DEF_LIKE_TAGS: ReadonlySet<string> = new Set([
  'linearGradient',
  'radialGradient',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'symbol',
]);

type GradientDef = LinearGradientDef | RadialGradientDef;

function parseUnits(value: string | undefined, fallback: GradientUnits): GradientUnits {
  if (value === undefined) return fallback;
  const v = value.trim();
  return v === 'userSpaceOnUse' ? 'userSpaceOnUse' : v === 'objectBoundingBox' ? 'objectBoundingBox' : fallback;
}

function parseSpread(value: string | undefined, fallback: SpreadMethod): SpreadMethod {
  if (value === undefined) return fallback;
  const v = value.trim();
  return v === 'reflect' || v === 'repeat' || v === 'pad' ? v : fallback;
}

function buildStops(host: DefsHost, el: XmlElement): GradientStop[] {
  const stops: GradientStop[] = [];
  let last = 0;
  for (const child of el.children) {
    if (child.type !== 'element' || child.name !== 'stop') continue;
    const declarations = host.declarationsFor(child);
    const rawOffset = (child.attrs.offset ?? '0').trim();
    let offset = rawOffset.endsWith('%') ? parseFloat(rawOffset) / 100 : Number(rawOffset);
    if (!Number.isFinite(offset)) {
      host.warn('invalid-attribute', `Invalid stop offset "${rawOffset}"`, 'stop', child.attrs.id);
      offset = 0;
    }
    offset = Math.min(1, Math.max(0, offset));
    if (offset < last) offset = last;
    last = offset;
    let color = declarations['stop-color']?.trim() || 'black';
    if (color === 'currentColor') color = declarations.color?.trim() || 'black';
    const rawOpacity = declarations['stop-opacity']?.trim();
    const opacity = rawOpacity === undefined ? 1 : (parseOpacity(rawOpacity) ?? 1);
    stops.push({ offset, color, opacity });
  }
  return stops;
}

/**
 * Parse a gradient coordinate. With `objectBoundingBox` units the value is a fraction
 * (percentages divided by 100); with `userSpaceOnUse` it is a user-unit length.
 */
function gradientCoordinate(
  host: DefsHost,
  el: XmlElement,
  name: string,
  units: GradientUnits,
  axis: 'x' | 'y',
  fallback: number
): number {
  const raw = el.attrs[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (units === 'objectBoundingBox') {
    const n = trimmed.endsWith('%') ? parseFloat(trimmed) / 100 : Number(trimmed);
    if (Number.isFinite(n)) return n;
  } else {
    const n = parseLength(trimmed, { percentBase: axis === 'x' ? host.viewportWidth : host.viewportHeight });
    if (n !== null) return n;
  }
  host.warn('invalid-attribute', `Invalid ${name}="${raw}"`, el.name, el.attrs.id);
  return fallback;
}

function gradientTransform(host: DefsHost, el: XmlElement, fallback: Matrix): Matrix {
  const raw = el.attrs.gradientTransform;
  if (raw === undefined) return fallback;
  const m = parseTransform(raw);
  if (m === null) {
    host.warn('invalid-transform', `Invalid gradientTransform "${raw}"; ignored`, el.name, el.attrs.id);
    return fallback;
  }
  return m;
}

function resolveTemplate(host: DefsHost, el: XmlElement, chain: ReadonlySet<string>): GradientDef | null {
  const href = el.attrs.href ?? el.attrs['xlink:href'];
  if (href === undefined) return null;
  const target = href.trim();
  if (!target.startsWith('#')) return null;
  const id = target.slice(1);
  if (chain.has(id)) {
    host.warn('unresolved-reference', `Gradient "${el.attrs.id ?? ''}" references itself through href`, el.name, el.attrs.id);
    return null;
  }
  const refEl = host.defElements.get(id);
  if (!refEl || (refEl.name !== 'linearGradient' && refEl.name !== 'radialGradient')) {
    host.warn('unresolved-reference', `Gradient href "${target}" does not point to a gradient`, el.name, el.attrs.id);
    return null;
  }
  return getGradient(host, refEl, chain);
}

/** Build (or return the cached) gradient for a `<linearGradient>` / `<radialGradient>` element. */
export function getGradient(host: DefsHost, el: XmlElement, chain: ReadonlySet<string> = new Set()): GradientDef | null {
  const id = el.attrs.id ?? '';
  const cached = host.defs[id];
  if (cached && (cached.kind === 'linearGradient' || cached.kind === 'radialGradient')) return cached;

  const nextChain = new Set(chain);
  nextChain.add(id);
  const template = resolveTemplate(host, el, nextChain);

  const units = parseUnits(el.attrs.gradientUnits, template?.units ?? 'objectBoundingBox');
  const spreadMethod = parseSpread(el.attrs.spreadMethod, template?.spreadMethod ?? 'pad');
  const transform = gradientTransform(host, el, template?.transform ?? IDENTITY);
  const ownStops = buildStops(host, el);
  const stops = ownStops.length > 0 ? ownStops : template?.stops ?? [];
  const full = (axis: 'x' | 'y'): number =>
    units === 'objectBoundingBox' ? 1 : axis === 'x' ? host.viewportWidth ?? 0 : host.viewportHeight ?? 0;
  const half = (axis: 'x' | 'y'): number => full(axis) / 2;

  let def: GradientDef;
  if (el.name === 'linearGradient') {
    const t = template?.kind === 'linearGradient' ? template : null;
    def = {
      kind: 'linearGradient',
      id,
      units,
      spreadMethod,
      transform,
      stops,
      x1: gradientCoordinate(host, el, 'x1', units, 'x', t?.x1 ?? 0),
      y1: gradientCoordinate(host, el, 'y1', units, 'y', t?.y1 ?? 0),
      x2: gradientCoordinate(host, el, 'x2', units, 'x', t?.x2 ?? full('x')),
      y2: gradientCoordinate(host, el, 'y2', units, 'y', t?.y2 ?? 0),
    };
  } else {
    const t = template?.kind === 'radialGradient' ? template : null;
    const cx = gradientCoordinate(host, el, 'cx', units, 'x', t?.cx ?? half('x'));
    const cy = gradientCoordinate(host, el, 'cy', units, 'y', t?.cy ?? half('y'));
    def = {
      kind: 'radialGradient',
      id,
      units,
      spreadMethod,
      transform,
      stops,
      cx,
      cy,
      r: gradientCoordinate(host, el, 'r', units, 'x', t?.r ?? half('x')),
      fx: gradientCoordinate(host, el, 'fx', units, 'x', t?.fx ?? cx),
      fy: gradientCoordinate(host, el, 'fy', units, 'y', t?.fy ?? cy),
      fr: gradientCoordinate(host, el, 'fr', units, 'x', t?.fr ?? 0),
    };
  }
  if (id.length > 0) host.defs[id] = def;
  return def;
}

function buildClipPath(host: DefsHost, el: XmlElement): ClipPathDef {
  const id = el.attrs.id ?? '';
  let transform: Matrix = IDENTITY;
  const rawTransform = el.attrs.transform;
  if (rawTransform !== undefined) {
    const m = parseTransform(rawTransform);
    if (m === null) host.warn('invalid-transform', `Invalid transform "${rawTransform}"; ignored`, 'clipPath', id);
    else transform = m;
  }
  const holder: GroupNode = {
    kind: 'group',
    tag: 'clipPath',
    classes: [],
    transform,
    style: host.rootStyle,
    attrs: el.attrs,
    parent: null,
    children: [],
  };
  if (id.length > 0) holder.id = id;
  host.buildChildrenInto(el, holder);
  return {
    kind: 'clipPath',
    id,
    units: parseUnits(el.attrs.clipPathUnits, 'userSpaceOnUse'),
    transform,
    root: holder,
  };
}

/** Build typed definitions for every collected def element. Gradients and clip paths are interpreted; the rest is kept raw. */
export function buildDefs(host: DefsHost): void {
  for (const [id, el] of host.defElements) {
    if (host.defs[id] !== undefined) continue;
    switch (el.name) {
      case 'linearGradient':
      case 'radialGradient':
        getGradient(host, el);
        break;
      case 'clipPath':
        host.defs[id] = buildClipPath(host, el);
        break;
      default:
        host.defs[id] = { kind: 'raw', id, tag: el.name, element: el };
    }
  }
}

/** True when a paint reference can be honoured by `def`. */
export function isPaintServer(def: DefEntry | undefined): boolean {
  return (
    def !== undefined &&
    (def.kind === 'linearGradient' || def.kind === 'radialGradient' || (def.kind === 'raw' && def.tag === 'pattern'))
  );
}
