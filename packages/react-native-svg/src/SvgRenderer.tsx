import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Ellipse,
  G,
  Image,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Text,
  TSpan,
} from 'react-native-svg';
import { parseSvg, type PlanOptions, type SvgDocument, type SvgSource } from '@nikpnevmatikos/svg-core';
import { planToTree, type ElementDesc, type ElementType } from './mapping';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPONENTS: Record<ElementType, React.ComponentType<any>> = {
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
};

/** Turn an element description into react-native-svg elements. */
export function renderElementTree(
  desc: ElementDesc,
  extraProps?: Record<string, unknown>
): React.ReactElement {
  const Component = COMPONENTS[desc.type];
  const props = extraProps ? { ...desc.props, ...extraProps } : desc.props;
  let children: React.ReactNode;
  if (desc.text !== undefined) children = desc.text;
  else if (desc.children.length > 0) children = desc.children.map((child) => renderElementTree(child));
  return React.createElement(Component, { key: desc.key, ...props }, children);
}

async function defaultFetchText(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Failed to fetch ${uri}: HTTP ${response.status}`);
  return response.text();
}

export interface UseSvgDocumentResult {
  document: SvgDocument | null;
  error: Error | null;
  loading: boolean;
}

interface RemoteState {
  uri: string;
  xml?: string;
  error?: Error;
}

/** Resolve an `SvgSource` into a parsed document, fetching `uri` sources as needed. */
export function useSvgDocument(source: SvgSource): UseSvgDocumentResult {
  const given = 'document' in source ? source.document : null;
  const xml = 'xml' in source ? source.xml : null;
  const uri = 'uri' in source ? source.uri : null;
  const fetchText = 'uri' in source ? source.fetchText : undefined;
  const [remote, setRemote] = React.useState<RemoteState | null>(null);

  React.useEffect(() => {
    if (uri === null) return undefined;
    let cancelled = false;
    const load = fetchText ?? defaultFetchText;
    load(uri).then(
      (text) => {
        if (!cancelled) setRemote({ uri, xml: text });
      },
      (reason: unknown) => {
        if (!cancelled) setRemote({ uri, error: reason instanceof Error ? reason : new Error(String(reason)) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri, fetchText]);

  return React.useMemo<UseSvgDocumentResult>(() => {
    if (given) return { document: given, error: null, loading: false };
    let text: string | undefined;
    if (xml !== null) text = xml;
    else if (uri !== null && remote && remote.uri === uri) {
      if (remote.error) return { document: null, error: remote.error, loading: false };
      text = remote.xml;
    }
    if (text === undefined) return { document: null, error: null, loading: uri !== null };
    try {
      return { document: parseSvg(text), error: null, loading: false };
    } catch (reason: unknown) {
      return {
        document: null,
        error: reason instanceof Error ? reason : new Error(String(reason)),
        loading: false,
      };
    }
  }, [given, xml, uri, remote]);
}

export interface SvgRendererProps {
  source: SvgSource;
  width?: number | string;
  height?: number | string;
  style?: StyleProp<ViewStyle>;
  /** Forwarded to `document.plan()`. */
  planOptions?: PlanOptions;
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
    const options: { width?: number | string; height?: number | string } = {};
    if (width !== undefined) options.width = width;
    if (height !== undefined) options.height = height;
    return planToTree(plan, document, options);
  }, [document, planOptions, width, height]);

  if (!tree) return <>{fallback}</>;
  return renderElementTree(tree, style ? { style } : undefined);
}
