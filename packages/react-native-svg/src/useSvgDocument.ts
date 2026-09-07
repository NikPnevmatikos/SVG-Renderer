import * as React from 'react';
import { parseSvg, type SvgDocument, type SvgSource } from 'svg-core';

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

/** Resolve an `SvgSource` into a parsed document, fetching `uri` sources as needed. Platform-neutral. */
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
