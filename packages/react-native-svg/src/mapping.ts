import {
  formatMatrix,
  formatViewBox,
  isIdentity,
  serializePathData,
  type DrawUnit,
  type ImageNode,
  type Matrix,
  type Paint,
  type RenderPlan,
  type ResolvedStyle,
  type ShapeNode,
  type SvgDocument,
  type TextNode,
  type TextRun,
} from '@nikpnevmatikos/svg-core';

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
  | 'Image';

/** Backend-neutral description of a react-native-svg element tree. Pure data, easy to test. */
export interface ElementDesc {
  type: ElementType;
  key: string;
  props: Record<string, unknown>;
  children: ElementDesc[];
  /** Text content for TSpan / Text leaves. */
  text?: string;
}

export interface TreeOptions {
  width?: number | string;
  height?: number | string;
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

export function shapeToDesc(node: ShapeNode, key: string): ElementDesc {
  const props = withCommon(node, styleToProps(node.style));
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

export function textToDesc(node: TextNode, key: string): ElementDesc {
  const props = withCommon(node, { ...styleToProps(node.style), ...fontProps(node.style), x: node.x, y: node.y });
  const single = node.runs.length === 1 ? node.runs[0] : undefined;
  if (single && single.style === node.style && single.x === undefined && single.y === undefined && single.dx === undefined && single.dy === undefined) {
    return { type: 'Text', key, props, children: [], text: single.text };
  }
  return {
    type: 'Text',
    key,
    props,
    children: node.runs.map((run, index) => runToDesc(run, node.style, `${key}-r${index}`)),
  };
}

export function imageToDesc(node: ImageNode, key: string): ElementDesc {
  const props = withCommon(node, {
    href: { uri: node.href },
    x: node.rect.x,
    y: node.rect.y,
    width: node.rect.width,
    height: node.rect.height,
    preserveAspectRatio: node.preserveAspectRatio,
  });
  if (node.style.opacity !== 1) props.opacity = node.style.opacity;
  if (node.style.clipPath !== undefined) props.clipPath = `url(#${node.style.clipPath})`;
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

export function rootProps(document: SvgDocument, options: TreeOptions): Record<string, unknown> {
  const viewBox = document.viewBox ?? document.contentBounds;
  const props: Record<string, unknown> = {
    width: options.width ?? '100%',
    height: options.height ?? '100%',
    viewBox: formatViewBox(viewBox),
  };
  const par = document.preserveAspectRatio;
  props.preserveAspectRatio = par.align === 'none' ? 'none' : `${par.align} ${par.meetOrSlice}`;
  return props;
}

/** Convert a render plan into an element tree description rooted at `<Svg>`. */
export function planToTree(plan: RenderPlan, document: SvgDocument, options: TreeOptions = {}): ElementDesc {
  const root: ElementDesc = { type: 'Svg', key: 'root', props: rootProps(document, options), children: [] };
  const stack: ElementDesc[] = [root];
  let counter = 0;
  for (const unit of plan.units) {
    const parent = stack[stack.length - 1] ?? root;
    const key = `u${counter++}`;
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
        parent.children.push(shapeToDesc(unit.node, key));
        break;
      case 'text':
        parent.children.push(textToDesc(unit.node, key));
        break;
      case 'image':
        parent.children.push(imageToDesc(unit.node, key));
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
  return root;
}
