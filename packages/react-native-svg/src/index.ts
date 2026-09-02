export { SvgRenderer, useSvgDocument, renderElementTree } from './SvgRenderer';
export type { SvgRendererProps, UseSvgDocumentResult } from './SvgRenderer';
export {
  planToTree,
  shapeToDesc,
  textToDesc,
  imageToDesc,
  styleToProps,
  paintToString,
  matrixToTransform,
  rootProps,
} from './mapping';
export type { ElementDesc, ElementType, TreeOptions } from './mapping';

// The core is part of this package's public surface so consumers need one import.
export * from '@nikpnevmatikos/svg-core';
