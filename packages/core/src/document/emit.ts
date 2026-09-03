import type {
  DefEntry,
  DrawUnit,
  GroupNode,
  Matrix,
  Paint,
  RenderPlan,
  ResolvedStyle,
  SvgDocument,
  SvgNode,
  TextNode,
} from '../types';
import { formatMatrix, isIdentity } from '../geometry/matrix';
import { serializePathData } from '../geometry/path';
import { formatViewBox } from '../geometry/rect';
import { createDefaultStyle } from '../style/resolve';
import { escapeXmlText, formatAttributes, serializeXml } from '../xml/serialize';

export interface EmitOptions {
  /** Decimal places for coordinates and lengths. Default: exact (shortest round-trip). */
  precision?: number;
  /** Indent nested elements for readability. Default true. */
  pretty?: boolean;
}

const XMLNS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | undefined>;

/** Number formatter carrying its precision so path data can use the same setting. */
interface Num {
  (n: number): string;
  precision: number | undefined;
}

function numberFormatter(precision: number | undefined): Num {
  const format = (n: number): string => {
    const value = precision === undefined ? n : Number(n.toFixed(precision));
    return String(value === 0 ? 0 : value);
  };
  return Object.assign(format, { precision });
}

function paintAttr(paint: Paint): string {
  switch (paint.type) {
    case 'none':
      return 'none';
    case 'color':
      return paint.value;
    case 'ref':
      return paint.fallback !== undefined ? `url(#${paint.id}) ${paint.fallback}` : `url(#${paint.id})`;
  }
}

function fontFamilyAttr(families: readonly string[]): string {
  return families.map((f) => (/[\s,]/.test(f) ? `'${f}'` : f)).join(', ');
}

function transformAttr(m: Matrix): string | undefined {
  return isIdentity(m) ? undefined : formatMatrix(m);
}

/**
 * Presentation attributes that make `style` render correctly given that its parent already
 * renders `base`. Inherited properties are emitted only when they differ from the parent;
 * non-inherited ones whenever they are not the initial value.
 */
export function styleAttributes(style: ResolvedStyle, base: ResolvedStyle, num: (n: number) => string = String): Attrs {
  const out: Attrs = {};
  const fill = paintAttr(style.fill);
  if (fill !== paintAttr(base.fill)) out.fill = fill;
  if (style.fillOpacity !== base.fillOpacity) out['fill-opacity'] = num(style.fillOpacity);
  if (style.fillRule !== base.fillRule) out['fill-rule'] = style.fillRule;
  if (style.clipRule !== base.clipRule) out['clip-rule'] = style.clipRule;
  const stroke = paintAttr(style.stroke);
  if (stroke !== paintAttr(base.stroke)) out.stroke = stroke;
  if (style.strokeWidth !== base.strokeWidth) out['stroke-width'] = num(style.strokeWidth);
  if (style.strokeOpacity !== base.strokeOpacity) out['stroke-opacity'] = num(style.strokeOpacity);
  if (style.strokeLinecap !== base.strokeLinecap) out['stroke-linecap'] = style.strokeLinecap;
  if (style.strokeLinejoin !== base.strokeLinejoin) out['stroke-linejoin'] = style.strokeLinejoin;
  if (style.strokeMiterlimit !== base.strokeMiterlimit) out['stroke-miterlimit'] = num(style.strokeMiterlimit);
  const dash = style.strokeDasharray ? style.strokeDasharray.map(num).join(' ') : 'none';
  const baseDash = base.strokeDasharray ? base.strokeDasharray.map(num).join(' ') : 'none';
  if (dash !== baseDash) out['stroke-dasharray'] = dash;
  if (style.strokeDashoffset !== base.strokeDashoffset) out['stroke-dashoffset'] = num(style.strokeDashoffset);
  if (style.visibility !== base.visibility) out.visibility = style.visibility;
  if (style.color !== base.color) out.color = style.color;
  const family = fontFamilyAttr(style.font.family);
  if (family !== fontFamilyAttr(base.font.family) && family.length > 0) out['font-family'] = family;
  if (style.font.size !== base.font.size) out['font-size'] = num(style.font.size);
  if (style.font.weight !== base.font.weight) out['font-weight'] = style.font.weight;
  if (style.font.style !== base.font.style) out['font-style'] = style.font.style;
  if (style.font.textAnchor !== base.font.textAnchor) out['text-anchor'] = style.font.textAnchor;
  if (style.font.letterSpacing !== base.font.letterSpacing) {
    out['letter-spacing'] = style.font.letterSpacing === undefined ? 'normal' : num(style.font.letterSpacing);
  }
  // Non-inherited.
  if (style.opacity !== 1) out.opacity = num(style.opacity);
  if (style.clipPath !== undefined) out['clip-path'] = `url(#${style.clipPath})`;
  if (style.mask !== undefined) out.mask = `url(#${style.mask})`;
  if (style.filter !== undefined) out.filter = `url(#${style.filter})`;
  if (style.vectorEffect !== undefined) out['vector-effect'] = style.vectorEffect;
  return out;
}

class Writer {
  private readonly lines: string[] = [];
  private depth = 0;

  constructor(private readonly pretty: boolean) {}

  open(tag: string, attrs: Attrs): void {
    this.line(`<${tag}${formatAttributes(attrs)}>`);
    this.depth++;
  }

  close(tag: string): void {
    this.depth--;
    this.line(`</${tag}>`);
  }

  empty(tag: string, attrs: Attrs): void {
    this.line(`<${tag}${formatAttributes(attrs)}/>`);
  }

  raw(markup: string): void {
    this.line(markup);
  }

  line(text: string): void {
    this.lines.push(this.pretty ? `${'  '.repeat(this.depth)}${text}` : text);
  }

  toString(): string {
    return this.lines.join(this.pretty ? '\n' : '');
  }
}

function emitText(w: Writer, node: TextNode, base: ResolvedStyle, num: Num): void {
  const attrs: Attrs = { id: node.id, x: num(node.x), y: num(node.y), transform: transformAttr(node.transform), ...styleAttributes(node.style, base, num) };
  const single = node.runs.length === 1 ? node.runs[0] : undefined;
  if (single && single.style === node.style && single.x === undefined && single.y === undefined && single.dx === undefined && single.dy === undefined) {
    w.raw(`<text${formatAttributes(attrs)}>${escapeXmlText(single.text)}</text>`);
    return;
  }
  let inner = '';
  for (const run of node.runs) {
    const runAttrs: Attrs = {
      x: run.x === undefined ? undefined : num(run.x),
      y: run.y === undefined ? undefined : num(run.y),
      dx: run.dx === undefined ? undefined : num(run.dx),
      dy: run.dy === undefined ? undefined : num(run.dy),
      ...(run.style === node.style ? {} : styleAttributes(run.style, node.style, num)),
    };
    inner += `<tspan${formatAttributes(runAttrs)}>${escapeXmlText(run.text)}</tspan>`;
  }
  w.raw(`<text${formatAttributes(attrs)}>${inner}</text>`);
}

function emitNode(w: Writer, node: SvgNode, base: ResolvedStyle, num: Num): void {
  switch (node.kind) {
    case 'group': {
      const attrs: Attrs = { id: node.id, transform: transformAttr(node.transform), ...styleAttributes(node.style, base, num) };
      w.open('g', attrs);
      for (const child of node.children) emitNode(w, child, node.style, num);
      w.close('g');
      return;
    }
    case 'shape': {
      const attrs: Attrs = { id: node.id };
      const p = node.params;
      switch (p.kind) {
        case 'rect':
          Object.assign(attrs, { x: num(p.x), y: num(p.y), width: num(p.width), height: num(p.height) });
          if (p.rx > 0) attrs.rx = num(p.rx);
          if (p.ry > 0) attrs.ry = num(p.ry);
          break;
        case 'circle':
          Object.assign(attrs, { cx: num(p.cx), cy: num(p.cy), r: num(p.r) });
          break;
        case 'ellipse':
          Object.assign(attrs, { cx: num(p.cx), cy: num(p.cy), rx: num(p.rx), ry: num(p.ry) });
          break;
        case 'line':
          Object.assign(attrs, { x1: num(p.x1), y1: num(p.y1), x2: num(p.x2), y2: num(p.y2) });
          break;
        case 'polyline':
        case 'polygon': {
          const pairs: string[] = [];
          for (let i = 0; i + 1 < p.points.length; i += 2) pairs.push(`${num(p.points[i] ?? 0)},${num(p.points[i + 1] ?? 0)}`);
          attrs.points = pairs.join(' ');
          break;
        }
        case 'path':
          attrs.d = serializePathData(p.segments, num.precision);
          break;
      }
      attrs.transform = transformAttr(node.transform);
      Object.assign(attrs, styleAttributes(node.style, base, num));
      w.empty(p.kind, attrs);
      return;
    }
    case 'text':
      emitText(w, node, base, num);
      return;
    case 'image':
      w.empty('image', {
        id: node.id,
        href: node.href,
        x: num(node.rect.x),
        y: num(node.rect.y),
        width: num(node.rect.width),
        height: num(node.rect.height),
        preserveAspectRatio: node.preserveAspectRatio === 'xMidYMid meet' ? undefined : node.preserveAspectRatio,
        transform: transformAttr(node.transform),
        ...styleAttributes(node.style, base, num),
      });
      return;
  }
}

function emitDef(w: Writer, def: DefEntry, base: ResolvedStyle, num: Num): void {
  switch (def.kind) {
    case 'linearGradient':
    case 'radialGradient': {
      const attrs: Attrs = {
        id: def.id,
        gradientUnits: def.units === 'objectBoundingBox' ? undefined : def.units,
        gradientTransform: transformAttr(def.transform),
        spreadMethod: def.spreadMethod === 'pad' ? undefined : def.spreadMethod,
      };
      if (def.kind === 'linearGradient') {
        Object.assign(attrs, { x1: num(def.x1), y1: num(def.y1), x2: num(def.x2), y2: num(def.y2) });
      } else {
        Object.assign(attrs, { cx: num(def.cx), cy: num(def.cy), r: num(def.r), fx: num(def.fx), fy: num(def.fy) });
        if (def.fr !== 0) attrs.fr = num(def.fr);
      }
      w.open(def.kind, attrs);
      for (const stop of def.stops) {
        w.empty('stop', {
          offset: num(stop.offset),
          'stop-color': stop.color,
          'stop-opacity': stop.opacity === 1 ? undefined : num(stop.opacity),
        });
      }
      w.close(def.kind);
      return;
    }
    case 'clipPath':
      w.open('clipPath', {
        id: def.id,
        clipPathUnits: def.units === 'userSpaceOnUse' ? undefined : def.units,
        transform: transformAttr(def.transform),
      });
      for (const child of def.root.children) emitNode(w, child, base, num);
      w.close('clipPath');
      return;
    case 'raw':
      w.raw(serializeXml(def.element));
      return;
  }
}

function rootAttributes(document: SvgDocument, num: Num): Attrs {
  const par = document.preserveAspectRatio;
  return {
    xmlns: XMLNS,
    viewBox: formatViewBox(document.viewBox ?? document.contentBounds),
    width: document.width === undefined ? undefined : num(document.width),
    height: document.height === undefined ? undefined : num(document.height),
    preserveAspectRatio:
      par.align === 'xMidYMid' && par.meetOrSlice === 'meet' ? undefined : par.align === 'none' ? 'none' : `${par.align} ${par.meetOrSlice}`,
  };
}

function emitDefs(w: Writer, document: SvgDocument, base: ResolvedStyle, num: Num): void {
  const defs = Object.values(document.defs);
  if (defs.length === 0) return;
  w.open('defs', {});
  for (const def of defs) emitDef(w, def, base, num);
  w.close('defs');
}

/**
 * Serialize the scene graph back to plain SVG: stylesheets, `use` and units already resolved,
 * every element carrying the presentation attributes it needs. Rendering this with any SVG
 * engine should match rendering the original file.
 */
export function toSvgString(document: SvgDocument, options: EmitOptions = {}): string {
  const num = numberFormatter(options.precision);
  const w = new Writer(options.pretty ?? true);
  const defaults = createDefaultStyle();
  const root: GroupNode = document.root;
  w.open('svg', { ...rootAttributes(document, num), ...styleAttributes(root.style, defaults, num) });
  emitDefs(w, document, root.style, num);
  for (const child of root.children) emitNode(w, child, root.style, num);
  w.close('svg');
  return w.toString();
}

/**
 * Serialize a render plan as SVG: batches become single `<path>` elements, wrappers become
 * `<g>`. Comparing this against `toSvgString` pixel for pixel is how batching is proven safe.
 */
export function planToSvgString(plan: RenderPlan, document: SvgDocument, options: EmitOptions = {}): string {
  const num = numberFormatter(options.precision);
  const w = new Writer(options.pretty ?? true);
  const defaults = createDefaultStyle();
  w.open('svg', rootAttributes(document, num));
  emitDefs(w, document, defaults, num);
  for (const unit of plan.units) {
    switch (unit.kind) {
      case 'group-begin':
        w.open('g', {
          id: unit.id,
          opacity: unit.opacity === undefined ? undefined : num(unit.opacity),
          'clip-path': unit.clipPath === undefined ? undefined : `url(#${unit.clipPath})`,
          mask: unit.mask === undefined ? undefined : `url(#${unit.mask})`,
          filter: unit.filter === undefined ? undefined : `url(#${unit.filter})`,
          transform: unit.transform === undefined ? undefined : transformAttr(unit.transform),
        });
        break;
      case 'group-end':
        w.close('g');
        break;
      case 'shape':
      case 'text':
      case 'image':
        emitNode(w, unit.node, defaults, num);
        break;
      case 'batch':
        w.empty('path', { d: serializePathData(unit.path, num.precision), ...styleAttributes(unit.style, defaults, num) });
        break;
    }
  }
  w.close('svg');
  return w.toString();
}

export { serializeXml, escapeXmlText, formatAttributes } from '../xml/serialize';
export type { DrawUnit };
