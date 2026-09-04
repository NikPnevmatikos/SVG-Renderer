/**
 * `svg-renderer/web`: the renderer and the pan/zoom viewer for React DOM. Same parsing, planning,
 * hit testing, selection and decorator model as the React Native entry, driven by pointer events
 * and CSS transforms instead of gesture-handler and reanimated. Imports nothing from React Native.
 */
export * from 'svg-core';
export { SvgRenderer } from './SvgRenderer';
export type { SvgRendererProps } from './SvgRenderer';
export { renderDomTree, domProps } from './dom';
export { SvgViewer } from './SvgViewer';
export type { SvgViewerProps } from './SvgViewer';
export { ViewerControls } from './controls';
export type { WebControlsOptions } from './controls';
export { useSvgDocument } from '../useSvgDocument';
export type { UseSvgDocumentResult } from '../useSvgDocument';
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
} from '../mapping';
export type { ElementDesc, ElementType, TreeOptions, StyleOverride } from '../mapping';
export {
  resolveInteractive,
  buildOverrides,
  resolveDecorators,
  nodesFor,
  interactiveFor,
  nextSelection,
  sameSelection,
} from '../viewer/interactive';
export type { ResolvedInteractive, DecoratorTarget } from '../viewer/interactive';
export { resolveOverlaps } from '../viewer/collision';
export type { LabelCandidate } from '../viewer/collision';
export { decoratorOpacity } from '../viewer/visibility';
export type {
  InteractiveSpec,
  ElementHit,
  Decorator,
  ElementAccessibility,
  FitOptions,
  SelectionMode,
  SvgViewerRef,
  ControlsPosition,
} from '../viewer/shared';
