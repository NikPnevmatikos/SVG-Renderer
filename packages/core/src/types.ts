import type { XmlElement } from './xml/tokenize';

/**
 * Affine matrix `[a, b, c, d, e, f]` mapping a point (x, y) to
 * (a*x + c*y + e, b*x + d*y + f). Same layout as the SVG `matrix()` transform.
 */
export type Matrix = readonly [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Paint =
  | { type: 'none' }
  | { type: 'color'; value: string }
  | { type: 'ref'; id: string; fallback?: string };

export type FillRule = 'nonzero' | 'evenodd';
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';
export type TextAnchor = 'start' | 'middle' | 'end';
export type Visibility = 'visible' | 'hidden';

export interface FontStyle {
  /** Font family list, first entry preferred. Empty when unspecified. */
  family: string[];
  /** Font size in user units. */
  size: number;
  /** `normal`, `bold`, or a numeric weight as a string (`'700'`). */
  weight: string;
  /** `normal`, `italic` or `oblique`. */
  style: string;
  textAnchor: TextAnchor;
  /** Letter spacing in user units, when specified. */
  letterSpacing?: number;
}

/** Fully resolved style of a node: cascade applied, inheritance applied, keywords resolved. */
export interface ResolvedStyle {
  fill: Paint;
  fillOpacity: number;
  fillRule: FillRule;
  /** Winding rule for shapes used inside a `<clipPath>`. */
  clipRule: FillRule;
  stroke: Paint;
  strokeWidth: number;
  strokeOpacity: number;
  strokeLinecap: LineCap;
  strokeLinejoin: LineJoin;
  strokeMiterlimit: number;
  strokeDasharray: number[] | null;
  strokeDashoffset: number;
  opacity: number;
  visibility: Visibility;
  /** Referenced element ids (without `#`). Mask and filter pass through untested in v1. */
  clipPath?: string;
  mask?: string;
  filter?: string;
  /** The `color` property, used to resolve `currentColor`. */
  color: string;
  font: FontStyle;
  vectorEffect?: 'non-scaling-stroke';
}

export type WarningCode =
  | 'css-unsupported'
  | 'unsupported-element'
  | 'invalid-attribute'
  | 'duplicate-id'
  | 'invalid-transform'
  | 'invalid-viewbox'
  | 'invalid-path'
  | 'percent-length-unsupported'
  | 'nested-svg'
  | 'unresolved-reference';

export interface SvgWarning {
  code: WarningCode;
  message: string;
  tag?: string;
  nodeId?: string;
}

/** Absolute path segments. Relative, shorthand and H/V commands are normalized away. */
export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      type: 'A';
      rx: number;
      ry: number;
      rotation: number;
      largeArc: boolean;
      sweep: boolean;
      x: number;
      y: number;
    }
  | { type: 'Z' };

export type ShapeKind = 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'path';

export interface RectParams {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}
export interface CircleParams {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}
export interface EllipseParams {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export interface LineParams {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PointsParams {
  kind: 'polyline' | 'polygon';
  /** Flat list of x, y pairs. */
  points: number[];
}
export interface PathParams {
  kind: 'path';
  /** Original path data as written in the file. */
  d: string;
  /** Parsed, absolute segments. May be a prefix of `d` when `error` is set. */
  segments: PathSegment[];
  /** Set when path data was malformed; `segments` then holds what parsed before the error. */
  error?: string;
}
export type ShapeParams =
  | RectParams
  | CircleParams
  | EllipseParams
  | LineParams
  | PointsParams
  | PathParams;

export interface NodeBase {
  id?: string;
  classes: string[];
  /** Original element name (`rect`, `g`, `text`, ...). */
  tag: string;
  /** Local transform (this node only). Use `worldMatrix()` for the composed one. */
  transform: Matrix;
  style: ResolvedStyle;
  /** Original attributes, kept for passthrough, debugging and later passes. */
  attrs: Readonly<Record<string, string>>;
  /** Application-attached data (for example region metadata keyed by id). */
  data?: unknown;
  parent: GroupNode | null;
  title?: string;
  desc?: string;
}

export interface GroupNode extends NodeBase {
  kind: 'group';
  children: SvgNode[];
}

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  shape: ShapeKind;
  params: ShapeParams;
}

export interface TextRun {
  text: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  style: ResolvedStyle;
}

export interface TextNode extends NodeBase {
  kind: 'text';
  x: number;
  y: number;
  runs: TextRun[];
}

export interface ImageNode extends NodeBase {
  kind: 'image';
  href: string;
  rect: Rect;
  preserveAspectRatio: string;
}

export type SvgNode = GroupNode | ShapeNode | TextNode | ImageNode;

export interface PreserveAspectRatio {
  /** `none` or an alignment keyword such as `xMidYMid`. */
  align: string;
  meetOrSlice: 'meet' | 'slice';
}

export type GradientUnits = 'objectBoundingBox' | 'userSpaceOnUse';
export type SpreadMethod = 'pad' | 'reflect' | 'repeat';

export interface GradientStop {
  /** 0..1, non-decreasing. */
  offset: number;
  color: string;
  opacity: number;
}

interface GradientBase {
  id: string;
  units: GradientUnits;
  spreadMethod: SpreadMethod;
  transform: Matrix;
  stops: GradientStop[];
}

/** Coordinates are fractions of the bounding box for `objectBoundingBox`, user units otherwise. */
export interface LinearGradientDef extends GradientBase {
  kind: 'linearGradient';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RadialGradientDef extends GradientBase {
  kind: 'radialGradient';
  cx: number;
  cy: number;
  r: number;
  fx: number;
  fy: number;
  fr: number;
}

export interface ClipPathDef {
  kind: 'clipPath';
  id: string;
  units: GradientUnits;
  transform: Matrix;
  /** Detached group holding the shapes and text that define the clip region. */
  root: GroupNode;
}

/** Definitions we pass through to the backend without interpreting them (v1: pattern, mask, marker, filter, symbol, ...). */
export interface RawDef {
  kind: 'raw';
  id: string;
  tag: string;
  element: XmlElement;
}

export type DefEntry = LinearGradientDef | RadialGradientDef | ClipPathDef | RawDef;
export type DefsTable = Record<string, DefEntry>;

export interface PlanOptions {
  /**
   * Merge runs of consecutive, same-styled, opaque static shapes into single paths so the
   * number of draw units follows the number of paint styles, not the number of elements.
   * Paint order is preserved exactly. Default `true`.
   */
  batching?: boolean;
  /** Nodes for which this returns true are planned as individual, restylable units. */
  interactive?: (node: SvgNode) => boolean;
}

export type DrawUnit =
  | { kind: 'batch'; path: PathSegment[]; style: ResolvedStyle; bbox: Rect | null; sources: ShapeNode[] }
  | { kind: 'shape'; node: ShapeNode; interactive: boolean }
  | { kind: 'text'; node: TextNode }
  | { kind: 'image'; node: ImageNode }
  | {
      kind: 'group-begin';
      id?: string;
      opacity?: number;
      clipPath?: string;
      mask?: string;
      filter?: string;
      transform?: Matrix;
    }
  | { kind: 'group-end' };

export interface RenderPlan {
  units: DrawUnit[];
  /** Number of units that never change unless the document changes. */
  staticCount: number;
  /** Ids of interactive nodes planned as individual units. */
  dynamicIds: Set<string>;
  /** Whether style batching was applied. */
  batched: boolean;
  /** Number of `batch` units. */
  batchCount: number;
  /** Number of shapes that were merged into batches. */
  mergedShapes: number;
}

export type HitTestMode = 'painted' | 'geometry';

export interface HitTestOptions {
  /** Count stroke bands. Default true. */
  includeStroke?: boolean;
  /** Extra distance in document units that still counts as a hit (touch slop). Default 0. */
  tolerance?: number;
  /** `painted` (SVG pointer semantics, default) or `geometry` (every outline counts as filled). */
  mode?: HitTestMode;
  /** Only consider nodes for which this returns true. */
  filter?: (node: SvgNode) => boolean;
}

export interface SvgDocument {
  viewBox: Rect | null;
  /** Intrinsic width/height in user units, when the root declares absolute lengths. */
  width?: number;
  height?: number;
  preserveAspectRatio: PreserveAspectRatio;
  root: GroupNode;
  defs: DefsTable;
  /** Union of everything that paints, in user units. Falls back to the viewBox. */
  contentBounds: Rect;
  warnings: SvgWarning[];
  getElementById(id: string): SvgNode | undefined;
  /**
   * CSS selectors: type, `#id`, `.class`, attributes, combinators, lists and the structural
   * pseudo-classes `:first-child`, `:last-child`, `:only-child`, `:root`. Throws otherwise.
   */
  querySelectorAll(selector: string): SvgNode[];
  /**
   * Leaf nodes under a point in document (user) coordinates, topmost first. Uses a spatial
   * index built on first use, then exact geometry (fill rule, stroke width, transforms).
   */
  elementsAt(point: Point, options?: HitTestOptions): SvgNode[];
  plan(options?: PlanOptions): RenderPlan;
}

export interface ParseOptions {
  /** Called for each warning as it is produced, in addition to `document.warnings`. */
  onWarning?: (warning: SvgWarning) => void;
}

export type TextFetcher = (uri: string) => Promise<string>;

export type SvgSource =
  | { xml: string }
  | { uri: string; fetchText?: TextFetcher }
  | { document: SvgDocument };
