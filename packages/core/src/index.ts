export * from './types';

export { parseSvg } from './parse';
export { parseXml, SvgParseError } from './xml/tokenize';
export type { XmlElement, XmlNode, XmlText } from './xml/tokenize';
export { decodeEntities } from './xml/entities';
export { buildDocument } from './document/build';
export { createDocument, indexIds } from './document/create';
export type { DocumentParts } from './document/create';
export { serializeDocument, deserializeDocument, IR_FORMAT, IR_VERSION } from './document/serialize';
export type { SerializedDocument, SerializedNode, SerializedDef, SerializedRun } from './document/serialize';
export { selectNodes } from './document/select';
export { toSvgString, planToSvgString, styleAttributes } from './document/emit';
export type { EmitOptions } from './document/emit';
export { serializeXml, escapeXmlText, escapeXmlAttribute, formatAttributes } from './xml/serialize';
export { buildDefs, getGradient, isPaintServer, DEF_LIKE_TAGS } from './document/defs';
export type { DefsHost } from './document/defs';
export { planDocument, planSubtree } from './plan/plan';

export {
  parseSelectorList,
  splitTopLevel,
  compareSpecificity,
  SUPPORTED_PSEUDO_CLASSES,
} from './css/selector';
export type {
  AttributeOperator,
  AttributeSelector,
  Combinator,
  ComplexSelector,
  CompoundSelector,
  SelectorListParseResult,
  Specificity,
} from './css/selector';
export { matchesSelector, matchesCompound } from './css/match';
export type { SelectorAdapter } from './css/match';
export { xmlAdapter, nodeAdapter } from './css/adapters';
export { parseStylesheet, parseDeclarationBlock, stripCssComments } from './css/parse';
export type { CssDeclaration, CssRule, StylesheetParseResult } from './css/parse';
export { Stylesheet, cascadeDeclarations } from './css/cascade';
export type { CascadedDeclarations } from './css/cascade';
export { extractCustomProperties, substituteVars } from './css/vars';

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
  rectsIntersect,
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
export { viewBoxTransform, parsePreserveAspectRatio } from './geometry/viewport';
export {
  IDENTITY_CAMERA,
  fitCamera,
  worldToScreen,
  screenToWorld,
  visibleWorldRect,
  zoomCamera,
  panCamera,
  clampCameraScale,
  clampCameraToBounds,
  composeCamera,
  relativeCamera,
  cameraToMatrix,
  camerasEqual,
  chooseRenderRegion,
} from './geometry/camera';
export type { Camera, Size, RenderRegion, RenderRegionOptions } from './geometry/camera';
export { normalizeWinding, reverseSubpath, splitSubpaths, subpathSignedArea } from './geometry/winding';
export { flattenPath } from './geometry/flatten';
export {
  pointInPolygons,
  distanceToPolylines,
  shapeContainsPoint,
  nodeContainsPoint,
  findAncestor,
} from './geometry/hit';
export type { ShapeHitOptions, NodeHitOptions } from './geometry/hit';
export { SpatialIndex } from './document/spatial';

export { parseLength, parseNumberList, isPercentage } from './style/length';
export type { LengthContext } from './style/length';
export {
  PRESENTATION_ATTRIBUTES,
  parseInlineStyle,
  collectDeclarations,
  createDefaultStyle,
  resolveStyle,
  parseUrlReference,
  parseOpacity,
} from './style/resolve';
export type { Declarations, StyleWarn } from './style/resolve';

export const VERSION = '0.0.1';
