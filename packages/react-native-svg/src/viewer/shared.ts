/**
 * Viewer types shared by every platform (React Native and DOM). Nothing here imports React
 * Native, so the web entry can compile against the DOM lib without pulling native types in.
 */
import type { ReactNode } from 'react';
import type { Camera, Point, Rect, SvgNode } from 'svg-core';

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
   * `svg`: rendered inside the drawing in document coordinates, scales with zoom (return SVG
   * elements of the platform: react-native-svg components on native, `<circle>` and friends on
   * the web). `overlay`: a fixed-size view kept centered on the anchor as the camera moves
   * (return ordinary views or DOM elements). Default `overlay`.
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
  /**
   * Overlay decorations only: when two decorations would overlap on screen, hide the one with
   * the lower `priority` (ties keep the earlier node). Re-evaluated whenever the camera settles or
   * re-anchors, so labels never pile up on dense drawings. Default false.
   */
  avoidOverlap?: boolean;
  /** Priority for `avoidOverlap`. Default: the area of the node's bounding box, so larger elements keep their labels. */
  priority?: number | ((node: SvgNode) => number);
  render: (node: SvgNode, bbox: Rect, index: number) => ReactNode;
}

/** Screen-reader description of an interactive element (see the viewer's `accessibility` prop). */
export interface ElementAccessibility {
  label: string;
  hint?: string;
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
  /** Fit the union of several elements' bounds; false when none of the ids exists. */
  fitToElements(ids: readonly string[], options?: FitOptions): boolean;
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

export type ControlsPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
