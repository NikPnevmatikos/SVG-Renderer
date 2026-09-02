export * from './types';

export { parseSvg } from './parse';
export { parseXml, SvgParseError } from './xml/tokenize';
export type { XmlElement, XmlNode, XmlText } from './xml/tokenize';
export { decodeEntities } from './xml/entities';
export { buildDocument } from './document/build';
export { selectNodes, parseSelectorList, matchesSelector } from './document/select';
export type { SimpleSelector } from './document/select';
export { planDocument } from './plan/plan';

export {
  IDENTITY,
  multiply,
  translate,
  scale,
  rotate,
  skewX,
  skewY,
  applyToPoint,
  isIdentity,
  invert,
  scaleFactor,
  isConformal,
  parseTransform,
  formatMatrix,
} from './geometry/matrix';
export {
  unionRects,
  rectFromPoints,
  transformRect,
  expandRect,
  rectContainsPoint,
  rectCenter,
  formatViewBox,
} from './geometry/rect';
export {
  PathDataError,
  parsePathData,
  arcToCubics,
  pathBBox,
  transformPathSegments,
  serializePathData,
  shapeParamsToPath,
  shapeToPath,
} from './geometry/path';
export type { PathParseResult } from './geometry/path';
export { worldMatrix, nodeBBox, shapeLocalBBox, textApproxLocalBBox } from './geometry/bbox';

export { parseLength, parseNumberList, isPercentage } from './style/length';
export type { LengthContext } from './style/length';
export {
  PRESENTATION_ATTRIBUTES,
  parseInlineStyle,
  collectDeclarations,
  createDefaultStyle,
  resolveStyle,
  parseUrlReference,
} from './style/resolve';
export type { Declarations, StyleWarn } from './style/resolve';

export const VERSION = '0.0.1';
