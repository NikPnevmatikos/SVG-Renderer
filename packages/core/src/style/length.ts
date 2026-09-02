const ABSOLUTE_UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  q: 96 / 25.4 / 4,
};

const LENGTH_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/;

export interface LengthContext {
  /** Current font size in user units, for `em`/`ex`. Defaults to 16. */
  fontSize?: number;
  /** Root font size for `rem`. Defaults to 16. */
  rootFontSize?: number;
  /** Reference length for percentages. When absent, percentages are unresolvable (`null`). */
  percentBase?: number;
}

/** Parse a CSS/SVG length into user units. Returns `null` when invalid or unresolvable. */
export function parseLength(value: string | undefined, ctx: LengthContext = {}): number | null {
  if (value === undefined) return null;
  const match = LENGTH_RE.exec(value);
  if (!match) return null;
  const num = parseFloat(match[1] ?? '');
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  switch (unit) {
    case 'em':
      return num * (ctx.fontSize ?? 16);
    case 'ex':
      return num * (ctx.fontSize ?? 16) * 0.5;
    case 'rem':
      return num * (ctx.rootFontSize ?? 16);
    case '%':
      return ctx.percentBase === undefined ? null : (num / 100) * ctx.percentBase;
    default: {
      const factor = ABSOLUTE_UNITS[unit];
      return factor === undefined ? null : num * factor;
    }
  }
}

export function isPercentage(value: string | undefined): boolean {
  return value !== undefined && value.trim().endsWith('%');
}

/** Split a whitespace/comma separated list of numbers. Non-numeric tokens are dropped. */
export function parseNumberList(value: string | undefined): number[] {
  if (value === undefined) return [];
  const out: number[] = [];
  for (const token of value.trim().split(/[\s,]+/)) {
    if (token.length === 0) continue;
    const n = Number(token);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
