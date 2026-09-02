import type { ParseOptions, SvgDocument } from './types';
import { parseXml } from './xml/tokenize';
import { buildDocument } from './document/build';

/**
 * Parse SVG markup into a document: scene graph with resolved styles, geometry helpers,
 * id lookup and a render plan. Throws `SvgParseError` on malformed XML; everything else
 * that cannot be handled is reported in `document.warnings`.
 */
export function parseSvg(xml: string, options: ParseOptions = {}): SvgDocument {
  return buildDocument(parseXml(xml), options);
}
