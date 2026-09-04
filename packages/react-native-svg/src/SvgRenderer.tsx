import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import * as RNSVG from 'react-native-svg';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Text,
  TSpan,
} from 'react-native-svg';
import type { PlanOptions, Rect as DocumentRect, SvgDocument, SvgNode, SvgSource } from 'svg-core';
import { planToTree, type ElementDesc, type ElementType, type StyleOverride, type TreeOptions } from './mapping';
import { useSvgDocument } from './useSvgDocument';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = React.ComponentType<any>;

const COMPONENTS: Record<Exclude<ElementType, 'Raw'>, AnyComponent> = {
  Svg,
  G,
  Rect,
  Circle,
  Ellipse,
  Line,
  Polyline,
  Polygon,
  Path,
  Text,
  TSpan,
  Image,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  ClipPath,
};

function resolveComponent(desc: ElementDesc): AnyComponent | null {
  if (desc.type !== 'Raw') return COMPONENTS[desc.type];
  const candidate = (RNSVG as unknown as Record<string, unknown>)[desc.component ?? ''];
  return typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)
    ? (candidate as AnyComponent)
    : null;
}

/**
 * Turn an element description into react-native-svg elements. Unknown passthrough elements
 * render nothing. `extraChildren` are appended inside the root element (in-SVG decorators).
 */
export function renderElementTree(
  desc: ElementDesc,
  extraProps?: Record<string, unknown>,
  extraChildren?: React.ReactNode
): React.ReactElement | null {
  const Component = resolveComponent(desc);
  if (!Component) return null;
  const props = extraProps ? { ...desc.props, ...extraProps } : desc.props;
  let children: React.ReactNode;
  if (desc.text !== undefined) children = desc.text;
  else if (desc.children.length > 0 || extraChildren !== undefined) {
    const rendered: React.ReactNode[] = desc.children
      .map((child) => renderElementTree(child))
      .filter((child) => child !== null);
    if (extraChildren !== undefined) rendered.push(extraChildren);
    children = rendered;
  }
  return React.createElement(Component, { key: desc.key, ...props }, children);
}

export { useSvgDocument } from './useSvgDocument';
export type { UseSvgDocumentResult } from './useSvgDocument';

export interface SvgRendererProps {
  source: SvgSource;
  width?: number | string;
  height?: number | string;
  style?: StyleProp<ViewStyle>;
  /** Forwarded to `document.plan()`. */
  planOptions?: PlanOptions;
  /** Render only this document-space region, stretched onto `width × height`. */
  viewBox?: DocumentRect;
  /** Per-node style overrides, e.g. a selection highlight. Overridden nodes should be marked interactive in `planOptions`. */
  overrides?: ReadonlyMap<SvgNode, StyleOverride>;
  /** react-native-svg elements appended inside the root `<Svg>`, in document coordinates. */
  children?: React.ReactNode;
  /** Called once per parsed or received document. */
  onDocument?: (document: SvgDocument) => void;
  /** Called when fetching or parsing fails. Nothing is rendered in that case. */
  onError?: (error: Error) => void;
  /** Rendered while a remote source loads or after an error. */
  fallback?: React.ReactNode;
}

export function SvgRenderer({
  source,
  width,
  height,
  style,
  planOptions,
  viewBox,
  overrides,
  children,
  onDocument,
  onError,
  fallback = null,
}: SvgRendererProps): React.ReactElement | null {
  const { document, error } = useSvgDocument(source);

  const reportedDocument = React.useRef<SvgDocument | null>(null);
  React.useEffect(() => {
    if (document && reportedDocument.current !== document) {
      reportedDocument.current = document;
      onDocument?.(document);
    }
  }, [document, onDocument]);

  const reportedError = React.useRef<Error | null>(null);
  React.useEffect(() => {
    if (error && reportedError.current !== error) {
      reportedError.current = error;
      onError?.(error);
    }
  }, [error, onError]);

  const tree = React.useMemo(() => {
    if (!document) return null;
    const plan = planOptions ? document.plan(planOptions) : document.plan();
    const options: TreeOptions = {};
    if (width !== undefined) options.width = width;
    if (height !== undefined) options.height = height;
    if (viewBox !== undefined) options.viewBox = viewBox;
    if (overrides !== undefined) options.overrides = overrides;
    return planToTree(plan, document, options);
  }, [document, planOptions, width, height, viewBox, overrides]);

  if (!tree) return <>{fallback}</>;
  return renderElementTree(tree, style ? { style } : undefined, children);
}
