import type { Matrix, PathSegment, Rect, ShapeNode, ShapeParams } from '../types';
import { applyToPoint } from './matrix';

export class PathDataError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at offset ${position})`);
    this.name = 'PathDataError';
    this.position = position;
  }
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

class Scanner {
  index = 0;

  constructor(private readonly source: string) {}

  private skipSeparators(): void {
    const s = this.source;
    while (this.index < s.length) {
      const c = s.charCodeAt(this.index);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44 /* , */) this.index++;
      else break;
    }
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.index >= this.source.length;
  }

  peekCommand(): string | null {
    this.skipSeparators();
    if (this.index >= this.source.length) return null;
    const c = this.source.charCodeAt(this.index);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    return isLetter ? this.source.charAt(this.index) : null;
  }

  readNumber(): number | null {
    this.skipSeparators();
    const s = this.source;
    const start = this.index;
    let i = start;
    const sign = s.charCodeAt(i);
    if (sign === 43 || sign === 45) i++;
    let digits = false;
    while (isDigit(s.charCodeAt(i))) {
      i++;
      digits = true;
    }
    if (s.charCodeAt(i) === 46 /* . */) {
      i++;
      while (isDigit(s.charCodeAt(i))) {
        i++;
        digits = true;
      }
    }
    if (!digits) return null;
    const e = s.charCodeAt(i);
    if (e === 101 || e === 69) {
      let j = i + 1;
      const expSign = s.charCodeAt(j);
      if (expSign === 43 || expSign === 45) j++;
      if (isDigit(s.charCodeAt(j))) {
        i = j;
        while (isDigit(s.charCodeAt(i))) i++;
      }
    }
    this.index = i;
    return parseFloat(s.slice(start, i));
  }

  readFlag(): boolean | null {
    this.skipSeparators();
    const c = this.source.charCodeAt(this.index);
    if (c === 48) {
      this.index++;
      return false;
    }
    if (c === 49) {
      this.index++;
      return true;
    }
    return null;
  }
}

export interface PathParseResult {
  segments: PathSegment[];
  /** Set when the data was malformed. `segments` holds everything parsed before the error. */
  error?: string;
}

/**
 * Parse SVG path data into absolute segments. Relative commands, `H`/`V`, and the `S`/`T`
 * shorthands are normalized to `M`, `L`, `C`, `Q`, `A` and `Z`. Like browsers, a malformed
 * command keeps what was parsed before it.
 */
export function parsePathData(d: string): PathParseResult {
  const segments: PathSegment[] = [];
  const sc = new Scanner(d);
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let command: string | null = null;
  let lastKind = '';
  let ctrlX = 0;
  let ctrlY = 0;

  const fail = (message: string): PathParseResult => ({
    segments,
    error: `${message} (at offset ${sc.index})`,
  });

  try {
    while (!sc.atEnd()) {
      const next = sc.peekCommand();
      if (next !== null) {
        command = next;
        sc.index++;
      } else if (command === null) {
        return fail('Path data must start with a command');
      } else if (command === 'Z' || command === 'z') {
        return fail('Unexpected number after closepath');
      } else if (command === 'M') {
        command = 'L';
      } else if (command === 'm') {
        command = 'l';
      }

      const relative = command >= 'a' && command <= 'z';
      const kind = command.toUpperCase();
      const num = (): number => {
        const value = sc.readNumber();
        if (value === null) throw new PathDataError(`Expected number for command ${command}`, sc.index);
        return value;
      };
      const flag = (): boolean => {
        const value = sc.readFlag();
        if (value === null) throw new PathDataError(`Expected flag for command ${command}`, sc.index);
        return value;
      };

      switch (kind) {
        case 'M': {
          let x = num();
          let y = num();
          if (relative) {
            x += cx;
            y += cy;
          }
          segments.push({ type: 'M', x, y });
          cx = sx = x;
          cy = sy = y;
          break;
        }
        case 'L': {
          let x = num();
          let y = num();
          if (relative) {
            x += cx;
            y += cy;
          }
          segments.push({ type: 'L', x, y });
          cx = x;
          cy = y;
          break;
        }
        case 'H': {
          let x = num();
          if (relative) x += cx;
          segments.push({ type: 'L', x, y: cy });
          cx = x;
          break;
        }
        case 'V': {
          let y = num();
          if (relative) y += cy;
          segments.push({ type: 'L', x: cx, y });
          cy = y;
          break;
        }
        case 'C': {
          let x1 = num();
          let y1 = num();
          let x2 = num();
          let y2 = num();
          let x = num();
          let y = num();
          if (relative) {
            x1 += cx;
            y1 += cy;
            x2 += cx;
            y2 += cy;
            x += cx;
            y += cy;
          }
          segments.push({ type: 'C', x1, y1, x2, y2, x, y });
          ctrlX = x2;
          ctrlY = y2;
          cx = x;
          cy = y;
          break;
        }
        case 'S': {
          let x2 = num();
          let y2 = num();
          let x = num();
          let y = num();
          if (relative) {
            x2 += cx;
            y2 += cy;
            x += cx;
            y += cy;
          }
          const reflect = lastKind === 'C' || lastKind === 'S';
          const x1 = reflect ? 2 * cx - ctrlX : cx;
          const y1 = reflect ? 2 * cy - ctrlY : cy;
          segments.push({ type: 'C', x1, y1, x2, y2, x, y });
          ctrlX = x2;
          ctrlY = y2;
          cx = x;
          cy = y;
          break;
        }
        case 'Q': {
          let x1 = num();
          let y1 = num();
          let x = num();
          let y = num();
          if (relative) {
            x1 += cx;
            y1 += cy;
            x += cx;
            y += cy;
          }
          segments.push({ type: 'Q', x1, y1, x, y });
          ctrlX = x1;
          ctrlY = y1;
          cx = x;
          cy = y;
          break;
        }
        case 'T': {
          let x = num();
          let y = num();
          if (relative) {
            x += cx;
            y += cy;
          }
          const reflect = lastKind === 'Q' || lastKind === 'T';
          const x1 = reflect ? 2 * cx - ctrlX : cx;
          const y1 = reflect ? 2 * cy - ctrlY : cy;
          segments.push({ type: 'Q', x1, y1, x, y });
          ctrlX = x1;
          ctrlY = y1;
          cx = x;
          cy = y;
          break;
        }
        case 'A': {
          const rx = Math.abs(num());
          const ry = Math.abs(num());
          const rotation = num();
          const largeArc = flag();
          const sweep = flag();
          let x = num();
          let y = num();
          if (relative) {
            x += cx;
            y += cy;
          }
          segments.push({ type: 'A', rx, ry, rotation, largeArc, sweep, x, y });
          cx = x;
          cy = y;
          break;
        }
        case 'Z': {
          segments.push({ type: 'Z' });
          cx = sx;
          cy = sy;
          break;
        }
        default:
          return fail(`Unknown path command '${command}'`);
      }
      lastKind = kind;
    }
  } catch (error) {
    if (error instanceof PathDataError) return { segments, error: error.message };
    throw error;
  }
  return { segments };
}

type CubicSegment = Extract<PathSegment, { type: 'C' }>;
type ArcSegment = Extract<PathSegment, { type: 'A' }>;

/**
 * Convert an elliptical arc from (x0, y0) to the arc's end point into cubic Béziers
 * (SVG implementation notes F.6.5/F.6.6). Each piece spans at most 90 degrees.
 */
export function arcToCubics(x0: number, y0: number, arc: ArcSegment): CubicSegment[] {
  const { rotation, largeArc, sweep, x: x1, y: y1 } = arc;
  if (x0 === x1 && y0 === y1) return [];
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  if (rx === 0 || ry === 0) {
    return [{ type: 'C', x1: x0, y1: y0, x2: x1, y2: y1, x: x1, y: y1 }];
  }

  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x0p = cosPhi * dx + sinPhi * dy;
  const y0p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x0p * x0p) / (rx * rx) + (y0p * y0p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = Math.max(0, rx2 * ry2 - rx2 * y0p * y0p - ry2 * x0p * x0p);
  const denominator = rx2 * y0p * y0p + ry2 * x0p * x0p;
  let coef = denominator === 0 ? 0 : Math.sqrt(numerator / denominator);
  if (largeArc === sweep) coef = -coef;
  const cxp = coef * ((rx * y0p) / ry);
  const cyp = coef * (-(ry * x0p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const ux = (x0p - cxp) / rx;
  const uy = (y0p - cyp) / ry;
  const vx = (-x0p - cxp) / rx;
  const vy = (-y0p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let dtheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / pieces;
  const t = (4 / 3) * Math.tan(delta / 4);

  const result: CubicSegment[] = [];
  let theta = theta1;
  let px = x0;
  let py = y0;
  for (let i = 0; i < pieces; i++) {
    const cos1 = Math.cos(theta);
    const sin1 = Math.sin(theta);
    const theta2 = theta + delta;
    const cos2 = Math.cos(theta2);
    const sin2 = Math.sin(theta2);
    const ex = cx + rx * cos2 * cosPhi - ry * sin2 * sinPhi;
    const ey = cy + rx * cos2 * sinPhi + ry * sin2 * cosPhi;
    const d1x = -rx * sin1 * cosPhi - ry * cos1 * sinPhi;
    const d1y = -rx * sin1 * sinPhi + ry * cos1 * cosPhi;
    const d2x = -rx * sin2 * cosPhi - ry * cos2 * sinPhi;
    const d2y = -rx * sin2 * sinPhi + ry * cos2 * cosPhi;
    const last = i === pieces - 1;
    const endX = last ? x1 : ex;
    const endY = last ? y1 : ey;
    result.push({
      type: 'C',
      x1: px + t * d1x,
      y1: py + t * d1y,
      x2: endX - t * d2x,
      y2: endY - t * d2y,
      x: endX,
      y: endY,
    });
    px = endX;
    py = endY;
    theta = theta2;
  }
  return result;
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadAt(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  addX(x: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
  }

  addY(y: number): void {
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  addCubic(x0: number, y0: number, seg: CubicSegment): void {
    this.add(seg.x, seg.y);
    for (const t of solveQuadratic(
      -x0 + 3 * seg.x1 - 3 * seg.x2 + seg.x,
      2 * (x0 - 2 * seg.x1 + seg.x2),
      seg.x1 - x0
    )) {
      if (t > 0 && t < 1) this.addX(cubicAt(x0, seg.x1, seg.x2, seg.x, t));
    }
    for (const t of solveQuadratic(
      -y0 + 3 * seg.y1 - 3 * seg.y2 + seg.y,
      2 * (y0 - 2 * seg.y1 + seg.y2),
      seg.y1 - y0
    )) {
      if (t > 0 && t < 1) this.addY(cubicAt(y0, seg.y1, seg.y2, seg.y, t));
    }
  }

  toRect(): Rect | null {
    if (this.minX === Infinity) return null;
    return {
      x: this.minX,
      y: this.minY,
      width: this.maxX - this.minX,
      height: this.maxY - this.minY,
    };
  }
}

/** Exact geometric bounding box of the path outline (stroke width not included). */
export function pathBBox(segments: readonly PathSegment[]): Rect | null {
  const bounds = new Bounds();
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        bounds.add(seg.x, seg.y);
        cx = sx = seg.x;
        cy = sy = seg.y;
        break;
      case 'L':
        bounds.add(seg.x, seg.y);
        cx = seg.x;
        cy = seg.y;
        break;
      case 'C':
        bounds.addCubic(cx, cy, seg);
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Q': {
        bounds.add(seg.x, seg.y);
        const denomX = cx - 2 * seg.x1 + seg.x;
        if (Math.abs(denomX) > 1e-12) {
          const t = (cx - seg.x1) / denomX;
          if (t > 0 && t < 1) bounds.addX(quadAt(cx, seg.x1, seg.x, t));
        }
        const denomY = cy - 2 * seg.y1 + seg.y;
        if (Math.abs(denomY) > 1e-12) {
          const t = (cy - seg.y1) / denomY;
          if (t > 0 && t < 1) bounds.addY(quadAt(cy, seg.y1, seg.y, t));
        }
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'A': {
        let px = cx;
        let py = cy;
        for (const cubic of arcToCubics(cx, cy, seg)) {
          bounds.addCubic(px, py, cubic);
          px = cubic.x;
          py = cubic.y;
        }
        bounds.add(seg.x, seg.y);
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'Z':
        cx = sx;
        cy = sy;
        break;
    }
  }
  return bounds.toRect();
}

/** Apply a matrix to every point. Arcs are converted to cubics first so any affine map is exact. */
export function transformPathSegments(segments: readonly PathSegment[], m: Matrix): PathSegment[] {
  const out: PathSegment[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const map = (x: number, y: number) => applyToPoint(m, { x, y });
  for (const seg of segments) {
    switch (seg.type) {
      case 'M': {
        const p = map(seg.x, seg.y);
        out.push({ type: 'M', x: p.x, y: p.y });
        cx = sx = seg.x;
        cy = sy = seg.y;
        break;
      }
      case 'L': {
        const p = map(seg.x, seg.y);
        out.push({ type: 'L', x: p.x, y: p.y });
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'C': {
        const p1 = map(seg.x1, seg.y1);
        const p2 = map(seg.x2, seg.y2);
        const p = map(seg.x, seg.y);
        out.push({ type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y });
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'Q': {
        const p1 = map(seg.x1, seg.y1);
        const p = map(seg.x, seg.y);
        out.push({ type: 'Q', x1: p1.x, y1: p1.y, x: p.x, y: p.y });
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'A': {
        for (const cubic of arcToCubics(cx, cy, seg)) {
          const p1 = map(cubic.x1, cubic.y1);
          const p2 = map(cubic.x2, cubic.y2);
          const p = map(cubic.x, cubic.y);
          out.push({ type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y });
        }
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case 'Z':
        out.push({ type: 'Z' });
        cx = sx;
        cy = sy;
        break;
    }
  }
  return out;
}

/** Serialize segments back to path data. Full precision unless `precision` (decimals) is given. */
export function serializePathData(segments: readonly PathSegment[], precision?: number): string {
  const f = (v: number): string =>
    precision === undefined ? String(v) : String(Number(v.toFixed(precision)));
  const parts: string[] = [];
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        parts.push(`M${f(seg.x)} ${f(seg.y)}`);
        break;
      case 'L':
        parts.push(`L${f(seg.x)} ${f(seg.y)}`);
        break;
      case 'C':
        parts.push(`C${f(seg.x1)} ${f(seg.y1)} ${f(seg.x2)} ${f(seg.y2)} ${f(seg.x)} ${f(seg.y)}`);
        break;
      case 'Q':
        parts.push(`Q${f(seg.x1)} ${f(seg.y1)} ${f(seg.x)} ${f(seg.y)}`);
        break;
      case 'A':
        parts.push(
          `A${f(seg.rx)} ${f(seg.ry)} ${f(seg.rotation)} ${seg.largeArc ? 1 : 0} ${seg.sweep ? 1 : 0} ${f(seg.x)} ${f(seg.y)}`
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join('');
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathSegment[] {
  const arc = (x: number, y: number): PathSegment => ({
    type: 'A',
    rx,
    ry,
    rotation: 0,
    largeArc: false,
    sweep: true,
    x,
    y,
  });
  return [
    { type: 'M', x: cx + rx, y: cy },
    arc(cx, cy + ry),
    arc(cx - rx, cy),
    arc(cx, cy - ry),
    arc(cx + rx, cy),
    { type: 'Z' },
  ];
}

/** Outline of any shape as path segments, in the shape's local coordinates. */
export function shapeParamsToPath(params: ShapeParams): PathSegment[] {
  switch (params.kind) {
    case 'path':
      return params.segments;
    case 'line':
      return [
        { type: 'M', x: params.x1, y: params.y1 },
        { type: 'L', x: params.x2, y: params.y2 },
      ];
    case 'polyline':
    case 'polygon': {
      const segments: PathSegment[] = [];
      const pts = params.points;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = pts[i] ?? 0;
        const y = pts[i + 1] ?? 0;
        segments.push(i === 0 ? { type: 'M', x, y } : { type: 'L', x, y });
      }
      if (params.kind === 'polygon' && segments.length > 0) segments.push({ type: 'Z' });
      return segments;
    }
    case 'circle':
      return ellipsePath(params.cx, params.cy, params.r, params.r);
    case 'ellipse':
      return ellipsePath(params.cx, params.cy, params.rx, params.ry);
    case 'rect': {
      const { x, y, width: w, height: h } = params;
      const rx = Math.min(params.rx, w / 2);
      const ry = Math.min(params.ry, h / 2);
      if (rx <= 0 || ry <= 0) {
        return [
          { type: 'M', x, y },
          { type: 'L', x: x + w, y },
          { type: 'L', x: x + w, y: y + h },
          { type: 'L', x, y: y + h },
          { type: 'Z' },
        ];
      }
      const arc = (ex: number, ey: number): PathSegment => ({
        type: 'A',
        rx,
        ry,
        rotation: 0,
        largeArc: false,
        sweep: true,
        x: ex,
        y: ey,
      });
      return [
        { type: 'M', x: x + rx, y },
        { type: 'L', x: x + w - rx, y },
        arc(x + w, y + ry),
        { type: 'L', x: x + w, y: y + h - ry },
        arc(x + w - rx, y + h),
        { type: 'L', x: x + rx, y: y + h },
        arc(x, y + h - ry),
        { type: 'L', x, y: y + ry },
        arc(x + rx, y),
        { type: 'Z' },
      ];
    }
  }
}

export function shapeToPath(shape: ShapeNode): PathSegment[] {
  return shapeParamsToPath(shape.params);
}
