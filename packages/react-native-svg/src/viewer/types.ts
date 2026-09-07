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
// (Point and Rect stay imported for the props below.)
import type { StyleOverride } from '../mapping';
import type { ViewerControlsOptions } from './controls';

/** The live camera on the UI thread, `screen = user * scale + t`, updated by gestures and animations every frame. */
export interface SharedCamera {
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
}

/**
 * Everything a rendering backend receives from the viewer. A backend lays the drawing out for
 * `camera` once and, every frame, displays it with the transform that maps `camera` onto `live`
 * (`scale = live.scale / camera.scale`, `translate = live.t - camera.t * scale`). The viewer may
 * keep two backends mounted while it re-anchors; each positions itself correctly on its own,
 * so the swap is invisible. Backends never do hit testing.
 */
export interface ViewerBackendProps {
  document: SvgDocument;
  planOptions: PlanOptions;
  overrides?: ReadonlyMap<SvgNode, StyleOverride>;
  /** Camera this layer was laid out for. */
  camera: Camera;
  /** The live camera, read on the UI thread. */
  live: SharedCamera;
  viewport: Size;
  /** Region a rasterizing backend should draw for `camera` (whole content while it fits a pixel budget). */
  region: RenderRegion;
  /** Call once the layer is laid out; the viewer then drops the layer it replaced. */
  onReady?: () => void;
  /** Extra react-native-svg children in document coordinates (in-SVG decorators). */
  children?: ReactNode;
}

export type ViewerBackend = React.ComponentType<ViewerBackendProps>;

// Platform-neutral viewer types live in ./shared so the web entry can use them too.
export type {
  InteractiveSpec,
  ElementHit,
  Decorator,
  ElementAccessibility,
  FitOptions,
  SelectionMode,
  SvgViewerRef,
} from './shared';
import type { Decorator, ElementAccessibility, ElementHit, InteractiveSpec, SelectionMode, SvgViewerRef } from './shared';

export interface SvgViewerProps {
  document: SvgDocument;
  style?: StyleProp<ViewStyle>;
  backend?: ViewerBackend;
  interactive?: InteractiveSpec;
  elementStyles?: Readonly<Record<string, StyleOverride>>;
  decorators?: readonly Decorator[];
  onElementPress?: (hit: ElementHit) => void;
  /** Long press (400 ms without moving) on an interactive element. Does not change the selection. */
  onElementLongPress?: (hit: ElementHit) => void;
  onBackgroundPress?: (point: Point, screenPoint: Point) => void;
  /** Called whenever the resting camera changes: after a gesture or animation settles and after a mid-gesture re-anchor. */
  onCameraChange?: (camera: Camera) => void;
  /** Brief highlight of the tapped element, for touch feedback. Off unless given. */
  pressedStyle?: StyleOverride | ((node: SvgNode) => StyleOverride);
  /** How long `pressedStyle` stays, in ms. Default 180. */
  pressedDuration?: number;
  /** Pan keeps moving with the finger's velocity after release and glides to a stop within the content bounds. Default true. */
  inertia?: boolean;
  /**
   * Make interactive elements reachable by screen readers: each one gets an invisible
   * accessible target that reads `label` / `hint` and, when activated, fires `onElementPress`
   * (and the selection change) exactly like a tap. Return null to skip an element.
   */
  accessibility?: (node: SvgNode, data: unknown) => ElementAccessibility | null | undefined;
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
