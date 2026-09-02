import type { FillRule, LineCap, LineJoin, Paint, ResolvedStyle, TextAnchor, Visibility } from '../types';
import { isPercentage, parseLength } from './length';

/** SVG presentation attributes the cascade understands in this version. */
export const PRESENTATION_ATTRIBUTES: readonly string[] = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'visibility',
  'display',
  'clip-path',
  'mask',
  'filter',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'letter-spacing',
  'vector-effect',
];

/** Property name (kebab-case) to raw value. */
export type Declarations = Record<string, string>;

export type StyleWarn = (
  code: 'invalid-attribute' | 'percent-length-unsupported',
  message: string
) => void;

/** Parse an inline `style="..."` attribute. `!important` is stripped (inline already wins). */
export function parseInlineStyle(css: string): Declarations {
  const out: Declarations = {};
  for (const part of css.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s*!important\s*$/i, '');
    if (name.length === 0 || value.length === 0) continue;
    out[name] = value;
  }
  return out;
}

/** Presentation attributes overridden by inline `style`, as one declaration map. */
export function collectDeclarations(attrs: Readonly<Record<string, string>>): Declarations {
  const declarations: Declarations = {};
  for (const name of PRESENTATION_ATTRIBUTES) {
    const value = attrs[name];
    if (value !== undefined) declarations[name] = value;
  }
  const inline = attrs.style;
  if (inline !== undefined && inline.length > 0) Object.assign(declarations, parseInlineStyle(inline));
  return declarations;
}

export function createDefaultStyle(): ResolvedStyle {
  return {
    fill: { type: 'color', value: 'black' },
    fillOpacity: 1,
    fillRule: 'nonzero',
    stroke: { type: 'none' },
    strokeWidth: 1,
    strokeOpacity: 1,
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    strokeMiterlimit: 4,
    strokeDasharray: null,
    strokeDashoffset: 0,
    opacity: 1,
    visibility: 'visible',
    color: 'black',
    font: {
      family: [],
      size: 16,
      weight: 'normal',
      style: 'normal',
      textAnchor: 'start',
    },
  };
}

const FONT_SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

const LINE_CAPS: ReadonlySet<string> = new Set(['butt', 'round', 'square']);
const LINE_JOINS: ReadonlySet<string> = new Set(['miter', 'round', 'bevel']);
const FILL_RULES: ReadonlySet<string> = new Set(['nonzero', 'evenodd']);
const TEXT_ANCHORS: ReadonlySet<string> = new Set(['start', 'middle', 'end']);
const FONT_WEIGHTS: ReadonlySet<string> = new Set([
  'normal',
  'bold',
  'bolder',
  'lighter',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
]);
const FONT_STYLES: ReadonlySet<string> = new Set(['normal', 'italic', 'oblique']);

const URL_REF_RE = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)\s*(.*)$/;

type PaintValue = Paint | 'currentColor' | null;

function parsePaint(value: string): PaintValue {
  if (value.length === 0) return null;
  if (value === 'none') return { type: 'none' };
  if (value === 'currentColor') return 'currentColor';
  const url = URL_REF_RE.exec(value);
  if (url) {
    const id = url[1] ?? '';
    const fallback = (url[2] ?? '').trim();
    return fallback.length > 0 ? { type: 'ref', id, fallback } : { type: 'ref', id };
  }
  return { type: 'color', value };
}

/** `url(#id)` -> `id`; `none` -> `null`; anything else -> `undefined` (invalid). */
export function parseUrlReference(value: string): string | null | undefined {
  if (value === 'none') return null;
  const match = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/.exec(value);
  return match ? match[1] : undefined;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function parseOpacity(value: string): number | null {
  if (value.endsWith('%')) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? clamp01(n / 100) : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? clamp01(n) : null;
}

/**
 * Resolve the declarations of one element on top of its parent's resolved style.
 * Inherited properties inherit; `inherit` and `currentColor` are resolved; invalid values
 * are reported through `warn` and leave the inherited/default value in place.
 */
export function resolveStyle(
  declarations: Declarations,
  parent: ResolvedStyle | null,
  warn?: StyleWarn
): ResolvedStyle {
  const base = parent ?? createDefaultStyle();
  const style: ResolvedStyle = {
    ...base,
    font: { ...base.font },
    strokeDasharray: base.strokeDasharray ? [...base.strokeDasharray] : null,
    // Non-inherited properties start from their initial values.
    opacity: 1,
    clipPath: undefined,
    mask: undefined,
    filter: undefined,
    vectorEffect: undefined,
  };

  const get = (name: string): string | undefined => {
    const raw = declarations[name];
    if (raw === undefined) return undefined;
    const value = raw.trim();
    return value.length === 0 ? undefined : value;
  };
  const invalid = (name: string, value: string): void => {
    warn?.('invalid-attribute', `Invalid value "${value}" for ${name}`);
  };

  const color = get('color');
  if (color !== undefined && color !== 'inherit' && color !== 'currentColor') style.color = color;

  const fontSize = get('font-size');
  if (fontSize !== undefined && fontSize !== 'inherit') {
    const keyword = FONT_SIZE_KEYWORDS[fontSize];
    if (keyword !== undefined) style.font.size = keyword;
    else if (fontSize === 'larger') style.font.size = base.font.size * 1.2;
    else if (fontSize === 'smaller') style.font.size = base.font.size / 1.2;
    else {
      const n = parseLength(fontSize, { fontSize: base.font.size, percentBase: base.font.size });
      if (n !== null && n >= 0) style.font.size = n;
      else invalid('font-size', fontSize);
    }
  }

  const paintProperty = (name: 'fill' | 'stroke'): void => {
    const value = get(name);
    if (value === undefined || value === 'inherit') return;
    const paint = parsePaint(value);
    if (paint === null) invalid(name, value);
    else if (paint === 'currentColor') style[name] = { type: 'color', value: style.color };
    else style[name] = paint;
  };
  paintProperty('fill');
  paintProperty('stroke');

  const opacityProperty = (
    name: 'fill-opacity' | 'stroke-opacity' | 'opacity',
    key: 'fillOpacity' | 'strokeOpacity' | 'opacity'
  ): void => {
    const value = get(name);
    if (value === undefined) return;
    if (value === 'inherit') {
      style[key] = base[key];
      return;
    }
    const n = parseOpacity(value);
    if (n === null) invalid(name, value);
    else style[key] = n;
  };
  opacityProperty('fill-opacity', 'fillOpacity');
  opacityProperty('stroke-opacity', 'strokeOpacity');
  opacityProperty('opacity', 'opacity');

  const fillRule = get('fill-rule');
  if (fillRule !== undefined && fillRule !== 'inherit') {
    if (FILL_RULES.has(fillRule)) style.fillRule = fillRule as FillRule;
    else invalid('fill-rule', fillRule);
  }

  const strokeWidth = get('stroke-width');
  if (strokeWidth !== undefined && strokeWidth !== 'inherit') {
    const n = parseLength(strokeWidth, { fontSize: style.font.size });
    if (n !== null && n >= 0) style.strokeWidth = n;
    else if (isPercentage(strokeWidth)) {
      warn?.('percent-length-unsupported', `Percentage stroke-width "${strokeWidth}" is not supported`);
    } else invalid('stroke-width', strokeWidth);
  }

  const linecap = get('stroke-linecap');
  if (linecap !== undefined && linecap !== 'inherit') {
    if (LINE_CAPS.has(linecap)) style.strokeLinecap = linecap as LineCap;
    else invalid('stroke-linecap', linecap);
  }

  const linejoin = get('stroke-linejoin');
  if (linejoin !== undefined && linejoin !== 'inherit') {
    if (LINE_JOINS.has(linejoin)) style.strokeLinejoin = linejoin as LineJoin;
    else invalid('stroke-linejoin', linejoin);
  }

  const miterlimit = get('stroke-miterlimit');
  if (miterlimit !== undefined && miterlimit !== 'inherit') {
    const n = Number(miterlimit);
    if (Number.isFinite(n) && n >= 1) style.strokeMiterlimit = n;
    else invalid('stroke-miterlimit', miterlimit);
  }

  const dasharray = get('stroke-dasharray');
  if (dasharray !== undefined && dasharray !== 'inherit') {
    if (dasharray === 'none') style.strokeDasharray = null;
    else {
      const values: number[] = [];
      let valid = true;
      for (const token of dasharray.split(/[\s,]+/)) {
        if (token.length === 0) continue;
        const n = parseLength(token, { fontSize: style.font.size });
        if (n === null || n < 0) {
          valid = false;
          break;
        }
        values.push(n);
      }
      if (!valid || values.length === 0) invalid('stroke-dasharray', dasharray);
      else if (values.every((v) => v === 0)) style.strokeDasharray = null;
      else style.strokeDasharray = values.length % 2 === 1 ? values.concat(values) : values;
    }
  }

  const dashoffset = get('stroke-dashoffset');
  if (dashoffset !== undefined && dashoffset !== 'inherit') {
    const n = parseLength(dashoffset, { fontSize: style.font.size });
    if (n !== null) style.strokeDashoffset = n;
    else invalid('stroke-dashoffset', dashoffset);
  }

  const visibility = get('visibility');
  if (visibility !== undefined && visibility !== 'inherit') {
    if (visibility === 'visible') style.visibility = 'visible';
    else if (visibility === 'hidden' || visibility === 'collapse') style.visibility = 'hidden' as Visibility;
    else invalid('visibility', visibility);
  }

  for (const [name, key] of [
    ['clip-path', 'clipPath'],
    ['mask', 'mask'],
    ['filter', 'filter'],
  ] as const) {
    const value = get(name);
    if (value === undefined || value === 'inherit') continue;
    const ref = parseUrlReference(value);
    if (ref === undefined) invalid(name, value);
    else style[key] = ref ?? undefined;
  }

  const family = get('font-family');
  if (family !== undefined && family !== 'inherit') {
    style.font.family = family
      .split(',')
      .map((f) => f.trim().replace(/^["']|["']$/g, ''))
      .filter((f) => f.length > 0);
  }

  const weight = get('font-weight');
  if (weight !== undefined && weight !== 'inherit') {
    if (FONT_WEIGHTS.has(weight)) style.font.weight = weight;
    else invalid('font-weight', weight);
  }

  const fontStyle = get('font-style');
  if (fontStyle !== undefined && fontStyle !== 'inherit') {
    if (FONT_STYLES.has(fontStyle)) style.font.style = fontStyle;
    else invalid('font-style', fontStyle);
  }

  const anchor = get('text-anchor');
  if (anchor !== undefined && anchor !== 'inherit') {
    if (TEXT_ANCHORS.has(anchor)) style.font.textAnchor = anchor as TextAnchor;
    else invalid('text-anchor', anchor);
  }

  const spacing = get('letter-spacing');
  if (spacing !== undefined && spacing !== 'inherit') {
    if (spacing === 'normal') style.font.letterSpacing = undefined;
    else {
      const n = parseLength(spacing, { fontSize: style.font.size });
      if (n !== null) style.font.letterSpacing = n;
      else invalid('letter-spacing', spacing);
    }
  }

  const vectorEffect = get('vector-effect');
  if (vectorEffect !== undefined) {
    if (vectorEffect === 'non-scaling-stroke') style.vectorEffect = 'non-scaling-stroke';
    else if (vectorEffect !== 'none') invalid('vector-effect', vectorEffect);
  }

  return style;
}
