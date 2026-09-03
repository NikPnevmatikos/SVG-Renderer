import {
  formatMatrix,
  formatViewBox,
  isIdentity,
  parseInlineStyle,
  planSubtree,
  serializePathData,
  type ClipPathDef,
  type DrawUnit,
  type ImageNode,
  type LinearGradientDef,
  type Matrix,
  type Paint,
  type RadialGradientDef,
  type RenderPlan,
  type ResolvedStyle,
  type ShapeNode,
  type SvgDocument,
  type SvgNode,
  type TextNode,
  type TextRun,
  type XmlElement,
} from 'svg-core';

export type ElementType =
  | 'Svg'
  | 'G'
  | 'Rect'
  | 'Circle'
  | 'Ellipse'
  | 'Line'
  | 'Polyline'
  | 'Polygon'
  | 'Path'
  | 'Text'
  | 'TSpan'
  | 'Image'
  | 'Defs'
  | 'LinearGradient'
  | 'RadialGradient'
  | 'Stop'
  | 'ClipPath'
  /** Passthrough of an uninterpreted definition (pattern, mask, marker, filter); see `component`. */
  | 'Raw';

/** Backend-neutral description of a react-native-svg element tree. Pure data, easy to test. */
export interface ElementDesc {
  type: ElementType;
  key: string;
  props: Record<string, unknown>;
  children: ElementDesc[];
  /** Text content for TSpan / Text leaves. */
  text?: string;
  /** react-native-svg export name for `Raw` elements (`Pattern`, `FeGaussianBlur`, ...). */
  component?: string;
}

export type StyleOverride = Partial<Omit<ResolvedStyle, 'font'>> & { font?: Partial<ResolvedStyle['font']> };

export interface TreeOptions {
  width?: number | string;
  height?: number | string;
  /** Replace the document viewBox (a viewer renders just the visible region this way). */
  viewBox?: { x: number; y: number; width: number; height: number };
  /** Per-node style overrides (selection highlights). Overridden nodes must be individual plan units. */
  overrides?: ReadonlyMap<SvgNode, StyleOverride>;
}

/** Node style with an override applied on top. */
export function overrideStyle(style: ResolvedStyle, override: StyleOverride | undefined): ResolvedStyle {
  if (!override) return style;
  const { font, ...rest } = override;
  return { ...style, ...rest, font: font ? { ...style.font, ...font } : style.font };
}

export function paintToString(paint: Paint): string {
  switch (paint.type) {
    case 'none':
      return 'none';
    case 'color':
      return paint.value;
    case 'ref':
      return `url(#${paint.id})`;
  }
}

export function matrixToTransform(m: Matrix): string | undefined {
  return isIdentity(m) ? undefined : formatMatrix(m);
}

/** Paint and stroke props for a shape. Defaults are omitted to keep the native prop set small. */
export function styleToProps(style: ResolvedStyle): Record<string, unknown> {
  const props: Record<string, unknown> = {
    fill: paintToString(style.fill),
  };
  if (style.fill.type !== 'none') {
    if (style.fillOpacity !== 1) props.fillOpacity = style.fillOpacity;
    if (style.fillRule !== 'nonzero') props.fillRule = style.fillRule;
  }
  if (style.clipRule !== 'nonzero') props.clipRule = style.clipRule;
  if (style.stroke.type !== 'none') {
    props.stroke = paintToString(style.stroke);
    props.strokeWidth = style.strokeWidth;
    if (style.strokeOpacity !== 1) props.strokeOpacity = style.strokeOpacity;
    if (style.strokeLinecap !== 'butt') props.strokeLinecap = style.strokeLinecap;
    if (style.strokeLinejoin !== 'miter') props.strokeLinejoin = style.strokeLinejoin;
    if (style.strokeMiterlimit !== 4) props.strokeMiterlimit = style.strokeMiterlimit;
    if (style.strokeDasharray) props.strokeDasharray = [...style.strokeDasharray];
    if (style.strokeDashoffset !== 0) props.strokeDashoffset = style.strokeDashoffset;
  }
  if (style.opacity !== 1) props.opacity = style.opacity;
  if (style.clipPath !== undefined) props.clipPath = `url(#${style.clipPath})`;
  if (style.mask !== undefined) props.mask = `url(#${style.mask})`;
  if (style.filter !== undefined) props.filter = `url(#${style.filter})`;
  if (style.vectorEffect !== undefined) props.vectorEffect = style.vectorEffect;
  return props;
}

function fontProps(style: ResolvedStyle): Record<string, unknown> {
  const props: Record<string, unknown> = { fontSize: style.font.size };
  const family = style.font.family[0];
  if (family !== undefined) props.fontFamily = family;
  if (style.font.weight !== 'normal') props.fontWeight = style.font.weight;
  if (style.font.style !== 'normal') props.fontStyle = style.font.style;
  if (style.font.textAnchor !== 'start') props.textAnchor = style.font.textAnchor;
  if (style.font.letterSpacing !== undefined) props.letterSpacing = style.font.letterSpacing;
  return props;
}

function withCommon(node: { id?: string; transform: Matrix }, props: Record<string, unknown>): Record<string, unknown> {
  if (node.id !== undefined) props.id = node.id;
  const transform = matrixToTransform(node.transform);
  if (transform !== undefined) props.transform = transform;
  return props;
}

function pointsToString(points: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) parts.push(`${points[i]},${points[i + 1]}`);
  return parts.join(' ');
}

export function shapeToDesc(node: ShapeNode, key: string, override?: StyleOverride): ElementDesc {
  const props = withCommon(node, styleToProps(overrideStyle(node.style, override)));
  const p = node.params;
  switch (p.kind) {
    case 'rect': {
      Object.assign(props, { x: p.x, y: p.y, width: p.width, height: p.height });
      if (p.rx > 0) props.rx = p.rx;
      if (p.ry > 0) props.ry = p.ry;
      return { type: 'Rect', key, props, children: [] };
    }
    case 'circle':
      Object.assign(props, { cx: p.cx, cy: p.cy, r: p.r });
      return { type: 'Circle', key, props, children: [] };
    case 'ellipse':
      Object.assign(props, { cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry });
      return { type: 'Ellipse', key, props, children: [] };
    case 'line':
      Object.assign(props, { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 });
      return { type: 'Line', key, props, children: [] };
    case 'polyline':
      props.points = pointsToString(p.points);
      return { type: 'Polyline', key, props, children: [] };
    case 'polygon':
      props.points = pointsToString(p.points);
      return { type: 'Polygon', key, props, children: [] };
    case 'path':
      // Malformed data is re-serialized from the segments that did parse; browsers do the same.
      props.d = p.error === undefined ? p.d : serializePathData(p.segments);
      return { type: 'Path', key, props, children: [] };
  }
}

function runToDesc(run: TextRun, parentStyle: ResolvedStyle, key: string): ElementDesc {
  const props: Record<string, unknown> = {};
  if (run.x !== undefined) props.x = run.x;
  if (run.y !== undefined) props.y = run.y;
  if (run.dx !== undefined) props.dx = run.dx;
  if (run.dy !== undefined) props.dy = run.dy;
  if (run.style !== parentStyle) {
    Object.assign(props, fontProps(run.style));
    props.fill = paintToString(run.style.fill);
    if (run.style.fillOpacity !== 1) props.fillOpacity = run.style.fillOpacity;
  }
  return { type: 'TSpan', key, props, children: [], text: run.text };
}

export function textToDesc(node: TextNode, key: string, override?: StyleOverride): ElementDesc {
  const style = overrideStyle(node.style, override);
  const props = withCommon(node, { ...styleToProps(style), ...fontProps(style), x: node.x, y: node.y });
  const single = node.runs.length === 1 ? node.runs[0] : undefined;
  if (
    single &&
    single.style === node.style &&
    single.x === undefined &&
    single.y === undefined &&
    single.dx === undefined &&
    single.dy === undefined
  ) {
    return { type: 'Text', key, props, children: [], text: single.text };
  }
  return {
    type: 'Text',
    key,
    props,
    children: node.runs.map((run, index) => runToDesc(run, node.style, `${key}-r${index}`)),
  };
}

export function imageToDesc(node: ImageNode, key: string, override?: StyleOverride): ElementDesc {
  const style = overrideStyle(node.style, override);
  const props = withCommon(node, {
    href: { uri: node.href },
    x: node.rect.x,
    y: node.rect.y,
    width: node.rect.width,
    height: node.rect.height,
    preserveAspectRatio: node.preserveAspectRatio,
  });
  if (style.opacity !== 1) props.opacity = style.opacity;
  if (style.clipPath !== undefined) props.clipPath = `url(#${style.clipPath})`;
  return { type: 'Image', key, props, children: [] };
}

function groupBeginToDesc(unit: Extract<DrawUnit, { kind: 'group-begin' }>, key: string): ElementDesc {
  const props: Record<string, unknown> = {};
  if (unit.id !== undefined) props.id = unit.id;
  if (unit.opacity !== undefined) props.opacity = unit.opacity;
  if (unit.clipPath !== undefined) props.clipPath = `url(#${unit.clipPath})`;
  if (unit.mask !== undefined) props.mask = `url(#${unit.mask})`;
  if (unit.filter !== undefined) props.filter = `url(#${unit.filter})`;
  if (unit.transform !== undefined) {
    const transform = matrixToTransform(unit.transform);
    if (transform !== undefined) props.transform = transform;
  }
  return { type: 'G', key, props, children: [] };
}

/** Append draw units as children of `container`, nesting `group-begin` / `group-end` pairs. */
function appendUnits(
  container: ElementDesc,
  units: readonly DrawUnit[],
  keyPrefix: string,
  overrides?: ReadonlyMap<SvgNode, StyleOverride>
): void {
  const stack: ElementDesc[] = [container];
  let counter = 0;
  for (const unit of units) {
    const parent = stack[stack.length - 1] ?? container;
    const key = `${keyPrefix}${counter++}`;
    switch (unit.kind) {
      case 'group-begin': {
        const group = groupBeginToDesc(unit, key);
        parent.children.push(group);
        stack.push(group);
        break;
      }
      case 'group-end':
        if (stack.length > 1) stack.pop();
        break;
      case 'shape':
        parent.children.push(shapeToDesc(unit.node, key, overrides?.get(unit.node)));
        break;
      case 'text':
        parent.children.push(textToDesc(unit.node, key, overrides?.get(unit.node)));
        break;
      case 'image':
        parent.children.push(imageToDesc(unit.node, key, overrides?.get(unit.node)));
        break;
      case 'batch':
        parent.children.push({
          type: 'Path',
          key,
          props: { ...styleToProps(unit.style), d: serializePathData(unit.path) },
          children: [],
        });
        break;
    }
  }
}

/**
 * Gradient coordinates. With `objectBoundingBox` units react-native-svg treats plain numbers
 * as absolute lengths, unlike browsers, so fractions are emitted as percentages.
 */
function gradientCoordinate(value: number, units: 'objectBoundingBox' | 'userSpaceOnUse'): number | string {
  return units === 'objectBoundingBox' ? `${value * 100}%` : value;
}

export function gradientToDesc(def: LinearGradientDef | RadialGradientDef, key: string): ElementDesc {
  const common: Record<string, unknown> = { id: def.id, gradientUnits: def.units };
  if (!isIdentity(def.transform)) common.gradientTransform = formatMatrix(def.transform);
  const children: ElementDesc[] = def.stops.map((stop, index) => {
    const props: Record<string, unknown> = { offset: stop.offset, stopColor: stop.color };
    if (stop.opacity !== 1) props.stopOpacity = stop.opacity;
    return { type: 'Stop', key: `${key}-s${index}`, props, children: [] };
  });
  const c = (value: number): number | string => gradientCoordinate(value, def.units);
  if (def.kind === 'linearGradient') {
    return {
      type: 'LinearGradient',
      key,
      props: { ...common, x1: c(def.x1), y1: c(def.y1), x2: c(def.x2), y2: c(def.y2) },
      children,
    };
  }
  return {
    type: 'RadialGradient',
    key,
    props: { ...common, cx: c(def.cx), cy: c(def.cy), r: c(def.r), fx: c(def.fx), fy: c(def.fy) },
    children,
  };
}

export function clipPathToDesc(def: ClipPathDef, key: string): ElementDesc {
  const props: Record<string, unknown> = { id: def.id };
  const transform = matrixToTransform(def.transform);
  if (transform !== undefined) props.transform = transform;
  const desc: ElementDesc = { type: 'ClipPath', key, props, children: [] };
  appendUnits(desc, planSubtree(def.root).units, `${key}-`);
  return desc;
}

const RAW_COMPONENTS: Record<string, string> = {
  clipPath: 'ClipPath',
  linearGradient: 'LinearGradient',
  radialGradient: 'RadialGradient',
  tspan: 'TSpan',
  textPath: 'TextPath',
  foreignObject: 'ForeignObject',
};

const RAW_PASSTHROUGH_TAGS: ReadonlySet<string> = new Set(['pattern', 'mask', 'marker', 'filter']);

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Generic element passthrough: tag to component name, attributes camel-cased, inline style expanded. */
export function rawToDesc(el: XmlElement, key: string): ElementDesc {
  const component = RAW_COMPONENTS[el.name] ?? el.name.charAt(0).toUpperCase() + el.name.slice(1);
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(el.attrs)) {
    if (name === 'class' || name.startsWith('xmlns')) continue;
    if (name === 'style') {
      for (const [property, propertyValue] of Object.entries(parseInlineStyle(value))) {
        props[camelCase(property)] = propertyValue;
      }
      continue;
    }
    if (name.includes(':')) {
      if (name === 'xlink:href') props.href = value;
      continue;
    }
    props[camelCase(name)] = value;
  }
  const children: ElementDesc[] = [];
  let text: string | undefined;
  for (const child of el.children) {
    if (child.type === 'text') {
      if (child.value.trim().length > 0) text = (text ?? '') + child.value;
    } else {
      children.push(rawToDesc(child, `${key}-${children.length}`));
    }
  }
  const desc: ElementDesc = { type: 'Raw', component, key, props, children };
  if (text !== undefined) desc.text = text;
  return desc;
}

/** `<Defs>` with every definition the backend can use, or `null` when there are none. */
export function defsToDesc(document: SvgDocument): ElementDesc | null {
  const children: ElementDesc[] = [];
  let index = 0;
  for (const def of Object.values(document.defs)) {
    const key = `def${index++}`;
    switch (def.kind) {
      case 'linearGradient':
      case 'radialGradient':
        children.push(gradientToDesc(def, key));
        break;
      case 'clipPath':
        children.push(clipPathToDesc(def, key));
        break;
      case 'raw':
        if (RAW_PASSTHROUGH_TAGS.has(def.tag)) children.push(rawToDesc(def.element, key));
        break;
    }
  }
  if (children.length === 0) return null;
  return { type: 'Defs', key: 'defs', props: {}, children };
}

export function rootProps(document: SvgDocument, options: TreeOptions): Record<string, unknown> {
  const viewBox = options.viewBox ?? document.viewBox ?? document.contentBounds;
  const props: Record<string, unknown> = {
    width: options.width ?? '100%',
    height: options.height ?? '100%',
    viewBox: formatViewBox(viewBox),
  };
  if (options.viewBox) {
    // An explicit region maps exactly onto the given size; no letterboxing.
    props.preserveAspectRatio = 'none';
  } else {
    const par = document.preserveAspectRatio;
    props.preserveAspectRatio = par.align === 'none' ? 'none' : `${par.align} ${par.meetOrSlice}`;
  }
  return props;
}

/** Convert a render plan into an element tree description rooted at `<Svg>`. */
export function planToTree(plan: RenderPlan, document: SvgDocument, options: TreeOptions = {}): ElementDesc {
  const root: ElementDesc = { type: 'Svg', key: 'root', props: rootProps(document, options), children: [] };
  const defs = defsToDesc(document);
  if (defs) root.children.push(defs);
  appendUnits(root, plan.units, 'u', options.overrides);
  return root;
}
