export { SvgRenderer, useSvgDocument, renderElementTree } from './SvgRenderer';
export type { SvgRendererProps, UseSvgDocumentResult } from './SvgRenderer';
export {
  planToTree,
  shapeToDesc,
  textToDesc,
  imageToDesc,
  gradientToDesc,
  clipPathToDesc,
  rawToDesc,
  defsToDesc,
  styleToProps,
  overrideStyle,
  paintToString,
  matrixToTransform,
  rootProps,
} from './mapping';
export type { ElementDesc, ElementType, TreeOptions, StyleOverride } from './mapping';

// The core is part of this package's public surface so consumers need one import.
export * from '@nikpnevmatikos/svg-core';
