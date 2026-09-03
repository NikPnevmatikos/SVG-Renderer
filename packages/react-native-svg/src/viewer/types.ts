import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type {
  Camera,
  HitTestMode,
  PlanOptions,
  Point,
  Rect,
  RenderRegion,
  RenderRegionOptions,
  Size,
  SvgDocument,
  SvgNode,
} from 'svg-core';
import type { StyleOverride } from '../mapping';
import type { ViewerControlsOptions } from './controls';

/** Live gesture delta, applied after the resting camera: `screen = delta(base(user))`. */
export interface SharedCamera {
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
}

/** Everything a rendering backend receives from the viewer. Backends never do hit testing. */
export interface ViewerBackendProps {
  document: SvgDocument;
  planOptions: PlanOptions;
  overrides?: ReadonlyMap<SvgNode, StyleOverride>;
  /** Camera at rest; the backend lays content out for it. */
  base: Camera;
  /** Live gesture delta on the UI thread. */
  delta: SharedCamera;
  viewport: Size;
  /** Region a rasterizing backend should draw for `base` (whole content while it fits a pixel budget). */
  region: RenderRegion;
  /** Extra react-native-svg children in document coordinates (in-SVG decorators). */
  children?: ReactNode;
}

export type ViewerBackend = React.ComponentType<ViewerBackendProps>;

export type InteractiveSpec = string | ((node: SvgNode) => boolean) | Readonly<Record<string, unknown>>;

export interface ElementHit {
  /** Nearest interactive ancestor (or the shape itself) under the tap. */
  node: SvgNode;
  /** Data attached through an `interactive` record, if any. */
  data: unknown;
  /** Tap position in document (user) coordinates. */
  point: Point;
  /** Tap position in viewer pixels. */
  screenPoint: Point;
  /** The topmost leaf that was actually hit. */
  target: SvgNode;
}

export interface Decorator {
  /** Selector or predicate choosing the nodes to decorate. */
  match: string | ((node: SvgNode) => boolean);
  /** Where the decoration is anchored on the node's world bounding box. Default `center`. */
  anchor?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  /**
   * `svg`: rendered inside the drawing in document coordinates, scales with zoom (return
   * react-native-svg elements). `overlay`: a fixed-size React Native view kept centered on the
   * anchor as the camera moves (return ordinary views). Default `overlay`.
   */
  layer?: 'svg' | 'overlay';
  /**
   * Hide the decoration while the smaller side of the node's bounding box is drawn smaller than
   * this many screen pixels. Labels of small elements then appear only once the user has zoomed
   * in enough for them to make sense (overlay decorations fade in over the last 20%).
   */
  minTargetSize?: number;
  /** Show the decoration only while the zoom relative to the initial fit is at least this. */
  minZoom?: number;
  /** Show the decoration only while the zoom relative to the initial fit is at most this. */
  maxZoom?: number;
  render: (node: SvgNode, bbox: Rect, index: number) => ReactNode;
}

export interface FitOptions {
  /** Pixels between the target and the viewport edges. Default `padding` prop. */
  padding?: number;
  /** Animate the camera. Default true. */
  animated?: boolean;
  /** Animation duration in ms. Default 350. */
  duration?: number;
  /** Do not zoom in beyond this factor of the initial fit (keeps small elements from filling the screen). */
  maxZoom?: number;
}

/**
 * Built-in selection behaviour. `single`: a tap selects the element and a second tap on the
 * same element deselects it. `multiple`: taps toggle membership. `none`: selection is off.
 */
export type SelectionMode = 'none' | 'single' | 'multiple';

export interface SvgViewerRef {
  fitToElement(id: string, options?: FitOptions): boolean;
  fitToBounds(bounds: Rect, options?: FitOptions): void;
  fitToContent(options?: FitOptions): void;
  zoomBy(factor: number, focal?: Point, options?: FitOptions): void;
  zoomTo(scale: number, focal?: Point, options?: FitOptions): void;
  getCamera(): Camera;
  screenToSvg(point: Point): Point;
  svgToScreen(point: Point): Point;
  /** Ids currently selected, in selection order. */
  getSelection(): string[];
  setSelection(ids: readonly string[]): void;
  select(id: string): void;
  deselect(id: string): void;
  /** Add or remove one id regardless of `selectionMode`. */
  toggleSelection(id: string): void;
  clearSelection(): void;
}

export interface SvgViewerProps {
  document: SvgDocument;
  style?: StyleProp<ViewStyle>;
  backend?: ViewerBackend;
  interactive?: InteractiveSpec;
  elementStyles?: Readonly<Record<string, StyleOverride>>;
  decorators?: readonly Decorator[];
  onElementPress?: (hit: ElementHit) => void;
  onBackgroundPress?: (point: Point, screenPoint: Point) => void;
  onCameraChange?: (camera: Camera) => void;
  /** Built-in selection of interactive elements (by id). Default `single`. */
  selectionMode?: SelectionMode;
  /** Controlled selection. Omit to let the viewer keep the selection itself. */
  selection?: readonly string[];
  /** Initial selection when uncontrolled. */
  defaultSelection?: readonly string[];
  /** Fires on every selection change made by taps or the ref; `hit` is null for background taps and ref calls. */
  onSelectionChange?: (selection: string[], hit: ElementHit | null) => void;
  /** Style applied to selected elements. Default: green stroke, width 3. `elementStyles` entries win over it. */
  selectedStyle?: StyleOverride | ((node: SvgNode) => StyleOverride);
  /** A tap on empty space clears the selection. Default true. */
  clearSelectionOnBackgroundPress?: boolean;
  /** What the viewer shows first. Default `content`. */
  initialFit?: 'content' | 'viewBox' | Rect;
  /** Zoom limits relative to the initial fit. Defaults 0.5 and 8. */
  minZoom?: number;
  maxZoom?: number;
  /** Pixels around fitted content. Default 16. */
  padding?: number;
  /** Extra pixels around thin shapes that still count as a hit. Default 8. */
  hitSlop?: number;
  /** Hit test mode. Default `geometry` so unfilled outlines are tappable inside. */
  hitMode?: HitTestMode;
  /** Double tap zooms by this factor about the tap point. 0 disables. Default 2. */
  doubleTapZoom?: number;
  /** Options for the rasterizing backend's region choice. */
  regionOptions?: RenderRegionOptions;
  /**
   * Built-in zoom in / zoom out / fit buttons. `true` (default) shows them top-right, an
   * options object customizes them, `false` hides them.
   */
  controls?: boolean | ViewerControlsOptions;
  /** Replace the built-in controls with your own, wired to the same imperative API. */
  renderControls?: (api: SvgViewerRef) => ReactNode;
  /** Views rendered above the drawing that do not move with the camera (legends, app buttons). */
  children?: ReactNode;
}
