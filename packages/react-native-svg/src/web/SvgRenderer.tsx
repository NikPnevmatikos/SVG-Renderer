import * as React from 'react';
import type { PlanOptions, Rect, SvgDocument, SvgNode, SvgSource } from 'svg-core';
import { planToTree, type StyleOverride, type TreeOptions } from '../mapping';
import { useSvgDocument } from '../useSvgDocument';
import { renderDomTree } from './dom';

export interface SvgRendererProps {
  source: SvgSource;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Forwarded to `document.plan()`. */
  planOptions?: PlanOptions;
  /** Render only this document-space region, stretched onto `width × height`. */
  viewBox?: Rect;
  /** Per-node style overrides, e.g. a selection highlight. Overridden nodes should be marked interactive in `planOptions`. */
  overrides?: ReadonlyMap<SvgNode, StyleOverride>;
  /** SVG elements appended inside the root `<svg>`, in document coordinates. */
  children?: React.ReactNode;
  /** Called once per parsed or received document. */
  onDocument?: (document: SvgDocument) => void;
  /** Called when fetching or parsing fails. Nothing is rendered in that case. */
  onError?: (error: Error) => void;
  /** Rendered while a remote source loads or after an error. */
  fallback?: React.ReactNode;
}

/**
 * Render an SVG document with React DOM, through the same parse, cascade, normalize and plan
 * pipeline as the React Native renderer, so both platforms draw the same element tree.
 */
export function SvgRenderer({
  source,
  width,
  height,
  className,
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
  const extra: Record<string, unknown> = {};
  if (className !== undefined) extra.className = className;
  if (style !== undefined) extra.style = style;
  return renderDomTree(tree, extra, children);
}
