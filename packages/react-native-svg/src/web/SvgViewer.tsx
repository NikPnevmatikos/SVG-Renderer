import * as React from 'react';
import {
  camerasEqual,
  chooseRenderRegion,
  clampCameraScale,
  clampCameraToBounds,
  expandRect,
  fitCamera,
  nodeBBox,
  relativeCamera,
  screenToWorld,
  unionRects,
  visibleWorldRect,
  worldToScreen,
  zoomCamera,
  type Camera,
  type HitTestMode,
  type PlanOptions,
  type Point,
  type Rect,
  type RenderRegion,
  type RenderRegionOptions,
  type Size,
  type SvgDocument,
  type SvgNode,
} from 'svg-core';
import type { StyleOverride } from '../mapping';
import { panRange } from '../viewer/cameraLimits';
import { resolveOverlaps, type LabelCandidate } from '../viewer/collision';
import {
  buildOverrides,
  interactiveFor,
  nextSelection,
  resolveDecorators,
  resolveInteractive,
  sameSelection,
  type DecoratorTarget,
} from '../viewer/interactive';
import type {
  Decorator,
  ElementAccessibility,
  ElementHit,
  FitOptions,
  InteractiveSpec,
  SelectionMode,
  SvgViewerRef,
} from '../viewer/shared';
import { decoratorOpacity } from '../viewer/visibility';
import { decayStep, distance, easeOutCubic, estimateVelocity, midpoint, wheelZoomFactor, type VelocitySample } from './camera';
import { ViewerControls, type WebControlsOptions } from './controls';
import { SvgRenderer } from './SvgRenderer';

const DEFAULT_DURATION = 350;
/** Duration of the glide back into bounds after a gesture ends outside them. */
const SETTLE_DURATION = 250;
const DEFAULT_PRESSED_DURATION = 180;
const LONG_PRESS_MS = 400;
/** A pointer that moves more than this before release is a drag, not a tap. */
const TAP_MOVE_TOLERANCE = 6;
/** Movement that cancels a pending long press. */
const LONG_PRESS_MOVE = 10;
const TAP_MAX_MS = 500;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
/** Single taps wait this long for a possible second tap while double-tap zoom is enabled. */
const SINGLE_TAP_DELAY = 250;
/** A gesture that has not moved for this long is paused: the drawing is re-anchored so it is crisp while the pointer rests. */
const PAUSE_MS = 120;
/** Wheel zoom settles (clamps and re-anchors) this long after the last wheel event. */
const WHEEL_SETTLE_MS = 150;
/** Re-anchor during a pause once the live scale differs from the layer's by this factor. */
const REANCHOR_SCALE_RATIO = 1.15;
/** Pixels of content that must stay inside the viewport on each axis (matches `clampCameraToBounds`). */
const MIN_VISIBLE = 48;
const DECAY_DECELERATION = 0.997;
/** Below this release speed (px/s) a pan just stops. */
const DECAY_MIN_VELOCITY = 40;
/** A glide this slow (px/s) has finished. */
const DECAY_STOP_VELOCITY = 20;
/** Release speeds above this (px/s) are scaled down; a fast finger fling is around 3000. */
const MAX_VELOCITY = 4000;
/** Size of the invisible screen-reader targets. */
const ACCESSIBLE_TARGET = 44;
const DEFAULT_SELECTED_STYLE: StyleOverride = { stroke: { type: 'color', value: '#22c55e' }, strokeWidth: 3 };
/** Fraction of the content's larger dimension added around the rasterized region. */
const REGION_SLACK = 0.03;

export interface SvgViewerProps {
  document: SvgDocument;
  className?: string;
  style?: React.CSSProperties;
  interactive?: InteractiveSpec;
  elementStyles?: Readonly<Record<string, StyleOverride>>;
  decorators?: readonly Decorator[];
  onElementPress?: (hit: ElementHit) => void;
  /** Long press (400 ms without moving) on an interactive element. Does not change the selection. */
  onElementLongPress?: (hit: ElementHit) => void;
  onBackgroundPress?: (point: Point, screenPoint: Point) => void;
  /** Called whenever the resting camera changes: after a gesture or animation settles and after a mid-gesture re-anchor. */
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
  /** Brief highlight of the tapped element, for touch feedback. Off unless given. */
  pressedStyle?: StyleOverride | ((node: SvgNode) => StyleOverride);
  /** How long `pressedStyle` stays, in ms. Default 180. */
  pressedDuration?: number;
  /** Pan keeps moving with the pointer's velocity after release and glides to a stop within the content bounds. Default true. */
  inertia?: boolean;
  /** Mouse wheel and trackpad pinch zoom about the cursor. Default true. */
  wheelZoom?: boolean;
  /**
   * Make interactive elements reachable by keyboard and screen readers: each one gets an
   * invisible focusable button that reads `label` / `hint` and, when activated, fires
   * `onElementPress` (and the selection change) exactly like a tap. Return null to skip an element.
   */
  accessibility?: (node: SvgNode, data: unknown) => ElementAccessibility | null | undefined;
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
  /** Double tap / double click zooms by this factor about the point. 0 disables it and makes single taps immediate. Default 2. */
  doubleTapZoom?: number;
  /** Options for the region the drawing is laid out for. */
  regionOptions?: RenderRegionOptions;
  /** Built-in zoom in / zoom out / fit buttons. `true` (default) shows them top-right, an options object customizes them, `false` hides them. */
  controls?: boolean | WebControlsOptions;
  /** Replace the built-in controls with your own, wired to the same imperative API. */
  renderControls?: (api: SvgViewerRef) => React.ReactNode;
  /** Elements rendered above the drawing that do not move with the camera (legends, app buttons). Position them absolutely. */
  children?: React.ReactNode;
}

function fitTarget(document: SvgDocument, initialFit: SvgViewerProps['initialFit']): Rect {
  if (initialFit === 'viewBox') return document.viewBox ?? document.contentBounds;
  if (initialFit && typeof initialFit === 'object') return initialFit;
  return document.contentBounds;
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlayKey(target: DecoratorTarget, index: number): string {
  return `o${target.decoratorIndex}-${target.node.id ?? index}`;
}

function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  return { scale: from.scale + (to.scale - from.scale) * t, tx: from.tx + (to.tx - from.tx) * t, ty: from.ty + (to.ty - from.ty) * t };
}

/** Always-current values for handlers that are created once. */
function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

interface OverlayEntry {
  key: string;
  target: DecoratorTarget;
  element: HTMLDivElement | null;
  width: number;
  height: number;
  /** Verdict of the overlap resolver at the resting camera. */
  hidden: boolean;
}

interface AccessibleEntry {
  key: string;
  node: SvgNode;
  anchor: Point;
  label: string;
  hint: string | undefined;
  element: HTMLButtonElement | null;
}

type Animation =
  | { kind: 'timing'; from: Camera; to: Camera; start: number; duration: number; onDone: () => void }
  | { kind: 'decay'; vx: number; vy: number; last: number; range: ReturnType<typeof panRange> };

interface GestureState {
  pointers: Map<number, Point>;
  mode: 'idle' | 'pan' | 'pinch';
  startPoint: Point;
  startTime: number;
  lastPoint: Point;
  moved: boolean;
  longPressFired: boolean;
  pinchDistance: number;
  pinchMid: Point;
  samples: VelocitySample[];
  lastTap: { time: number; point: Point } | null;
}

interface Timers {
  longPress: ReturnType<typeof setTimeout> | null;
  pause: ReturnType<typeof setTimeout> | null;
  wheel: ReturnType<typeof setTimeout> | null;
  tap: ReturnType<typeof setTimeout> | null;
  pressed: ReturnType<typeof setTimeout> | null;
}

const STAGE_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  cursor: 'grab',
};
const WRAPPER_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  transformOrigin: '0 0',
  pointerEvents: 'none',
  willChange: 'transform',
};
const LAYER_STYLE: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };
const OVERLAY_ITEM_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  pointerEvents: 'none',
  opacity: 0,
  willChange: 'transform, opacity',
};
const ACCESSIBLE_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: ACCESSIBLE_TARGET,
  height: ACCESSIBLE_TARGET,
  margin: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * Pan/zoom viewer for React DOM. The drawing is laid out for a resting camera (a region and a
 * viewBox) and moved with a CSS transform while the pointer or an animation drives the live
 * camera; when a gesture ends, or pauses, the layout is re-anchored to the live camera in the
 * same commit that resets the transform, so the swap is invisible. Taps are resolved through
 * the core's hit testing, exactly like the React Native viewer.
 */
export const SvgViewer = React.forwardRef<SvgViewerRef, SvgViewerProps>(function SvgViewer(props, ref) {
  const {
    document,
    className,
    style,
    interactive,
    elementStyles,
    decorators,
    onElementPress,
    onElementLongPress,
    onBackgroundPress,
    onCameraChange,
    pressedStyle,
    pressedDuration = DEFAULT_PRESSED_DURATION,
    inertia = true,
    wheelZoom = true,
    accessibility,
    initialFit = 'content',
    minZoom = 0.5,
    maxZoom = 8,
    padding = 16,
    hitSlop = 8,
    hitMode = 'geometry',
    doubleTapZoom = 2,
    regionOptions,
    controls = true,
    renderControls,
    selectionMode = 'single',
    selection: selectionProp,
    defaultSelection,
    onSelectionChange,
    selectedStyle,
    clearSelectionOnBackgroundPress = true,
    children,
  } = props;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState<Size | null>(null);
  // The resting camera: the camera the drawing is currently laid out for.
  const [base, setBase] = React.useState<Camera | null>(null);
  const [pressedId, setPressedId] = React.useState<string | null>(null);
  const liveRef = React.useRef<Camera>({ scale: 1, tx: 0, ty: 0 });
  const baseRef = React.useRef<Camera | null>(null);
  const fitRef = React.useRef<Camera | null>(null);
  const regionRef = React.useRef<RenderRegion | null>(null);
  const pendingRef = React.useRef<(() => void) | null>(null);
  const animationRef = React.useRef<Animation | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const overlaysRef = React.useRef<OverlayEntry[]>([]);
  const accessiblesRef = React.useRef<AccessibleEntry[]>([]);
  const gestureRef = React.useRef<GestureState>({
    pointers: new Map(),
    mode: 'idle',
    startPoint: { x: 0, y: 0 },
    startTime: 0,
    lastPoint: { x: 0, y: 0 },
    moved: false,
    longPressFired: false,
    pinchDistance: 0,
    pinchMid: { x: 0, y: 0 },
    samples: [],
    lastTap: null,
  });
  const timersRef = React.useRef<Timers>({ longPress: null, pause: null, wheel: null, tap: null, pressed: null });

  // Selection: controlled through `selection`, otherwise kept here.
  const [internalSelection, setInternalSelection] = React.useState<readonly string[]>(defaultSelection ?? []);
  const selection = selectionProp ?? internalSelection;

  const content = document.contentBounds;
  const resolvedInteractive = React.useMemo(() => resolveInteractive(document, interactive), [document, interactive]);
  const overrides = React.useMemo(() => {
    const map = buildOverrides(document, elementStyles);
    if (selectionMode !== 'none') {
      for (const id of selection) {
        const node = document.getElementById(id);
        if (!node) continue;
        const highlight = typeof selectedStyle === 'function' ? selectedStyle(node) : selectedStyle ?? DEFAULT_SELECTED_STYLE;
        const explicit = map.get(node);
        map.set(node, explicit ? { ...highlight, ...explicit } : highlight);
      }
    }
    if (pressedId !== null && pressedStyle) {
      const node = document.getElementById(pressedId);
      if (node) {
        const feedback = typeof pressedStyle === 'function' ? pressedStyle(node) : pressedStyle;
        map.set(node, { ...(map.get(node) ?? {}), ...feedback });
      }
    }
    return map;
  }, [document, elementStyles, selection, selectedStyle, selectionMode, pressedId, pressedStyle]);
  const decoratorTargets = React.useMemo(() => resolveDecorators(document, decorators), [document, decorators]);
  const planOptions = React.useMemo<PlanOptions>(() => {
    const { isInteractive } = resolvedInteractive;
    return { interactive: (node: SvgNode) => isInteractive(node) || overrides.has(node) };
  }, [resolvedInteractive, overrides]);

  const latest = useLatest({
    document,
    resolvedInteractive,
    content,
    viewport,
    minZoom,
    maxZoom,
    padding,
    hitSlop,
    hitMode,
    doubleTapZoom,
    inertia,
    wheelZoom,
    selectionMode,
    selection,
    controlled: selectionProp !== undefined,
    clearOnBackground: clearSelectionOnBackgroundPress,
    pressed: pressedStyle !== undefined,
    pressedDuration,
    onElementPress,
    onElementLongPress,
    onBackgroundPress,
    onSelectionChange,
    onCameraChange,
  });

  const updateSelection = React.useCallback((next: readonly string[], hit: ElementHit | null) => {
    const ctx = latest.current;
    if (sameSelection(ctx.selection, next)) return;
    if (!ctx.controlled) setInternalSelection(next);
    ctx.onSelectionChange?.([...next], hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewport: the container's size, tracked with a ResizeObserver.
  React.useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return;
      setViewport((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
    };
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- Frame loop: the live camera is written to the DOM directly, never through React state. ----

  const applyFrame = React.useCallback(() => {
    const live = liveRef.current;
    const resting = baseRef.current;
    const wrapper = wrapperRef.current;
    if (wrapper && resting) {
      const rel = relativeCamera(resting, live);
      wrapper.style.transform = `translate(${rel.tx}px, ${rel.ty}px) scale(${rel.scale})`;
    }
    const fitScale = (fitRef.current ?? resting ?? live).scale;
    for (const entry of overlaysRef.current) {
      const element = entry.element;
      if (!element) continue;
      const { anchor, bbox, decorator } = entry.target;
      const x = anchor.x * live.scale + live.tx - entry.width / 2;
      const y = anchor.y * live.scale + live.ty - entry.height / 2;
      element.style.transform = `translate(${x}px, ${y}px)`;
      const opacity =
        entry.hidden || entry.width === 0
          ? 0
          : decoratorOpacity(live.scale, fitScale, Math.min(bbox.width, bbox.height), decorator.minTargetSize, decorator.minZoom, decorator.maxZoom);
      element.style.opacity = String(opacity);
    }
    for (const entry of accessiblesRef.current) {
      const element = entry.element;
      if (!element) continue;
      const x = entry.anchor.x * live.scale + live.tx - ACCESSIBLE_TARGET / 2;
      const y = entry.anchor.y * live.scale + live.ty - ACCESSIBLE_TARGET / 2;
      element.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, []);

  const tickRef = React.useRef<(now: number) => void>(() => undefined);
  const requestFrame = React.useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame((now) => {
      frameRef.current = null;
      tickRef.current(now);
    });
  }, []);

  const setLiveCamera = React.useCallback(
    (camera: Camera) => {
      liveRef.current = camera;
      requestFrame();
    },
    [requestFrame]
  );

  const cancelAnimation = React.useCallback(() => {
    animationRef.current = null;
  }, []);

  /** Lay the drawing out for `camera` unless it already is. */
  const rebase = React.useCallback((camera: Camera) => {
    const resting = baseRef.current;
    if (resting && camerasEqual(resting, camera, 1e-6)) return;
    setBase(camera);
  }, []);

  const clampCamera = React.useCallback((camera: Camera): Camera | null => {
    const { viewport: size, content: bounds, minZoom: min, maxZoom: max } = latest.current;
    const fit = fitRef.current;
    if (!size || !fit) return null;
    const scaled = clampCameraScale(camera, fit.scale * min, fit.scale * max, { x: size.width / 2, y: size.height / 2 });
    return clampCameraToBounds(scaled, size, bounds, MIN_VISIBLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Move the live camera to `target` (after clamping), animated or immediately, then re-anchor. */
  const settleTo = React.useCallback(
    (target: Camera, animated: boolean, duration: number) => {
      const camera = clampCamera(target);
      if (!camera) return;
      if (!animated) {
        cancelAnimation();
        setLiveCamera(camera);
        rebase(camera);
        return;
      }
      animationRef.current = {
        kind: 'timing',
        from: liveRef.current,
        to: camera,
        start: performance.now(),
        duration,
        onDone: () => rebase(camera),
      };
      requestFrame();
    },
    [clampCamera, cancelAnimation, setLiveCamera, rebase, requestFrame]
  );

  /** Every pointer is up and any glide has stopped: pull the camera back into bounds if needed, then re-anchor. */
  const onGestureEnd = React.useCallback(() => {
    if (gestureRef.current.pointers.size > 0) return;
    const camera = liveRef.current;
    const clamped = clampCamera(camera);
    if (!clamped) return;
    if (camerasEqual(clamped, camera, 0.01)) rebase(camera);
    else settleTo(clamped, true, SETTLE_DURATION);
  }, [clampCamera, rebase, settleTo]);

  /** Pointer still down but resting: re-anchor when the layout is blurry or no longer covers the viewport. */
  const onGesturePause = React.useCallback(() => {
    if (gestureRef.current.pointers.size === 0) return;
    const resting = baseRef.current;
    const size = latest.current.viewport;
    if (!resting || !size) return;
    const camera = liveRef.current;
    const ratio = camera.scale / resting.scale;
    const region = regionRef.current;
    const covered = region ? rectContains(region.viewBox, visibleWorldRect(camera, size)) : true;
    if (ratio > REANCHOR_SCALE_RATIO || ratio < 1 / REANCHOR_SCALE_RATIO || !covered) rebase(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebase]);

  tickRef.current = (now: number): void => {
    const animation = animationRef.current;
    if (animation) {
      if (animation.kind === 'timing') {
        const t = Math.min(1, (now - animation.start) / Math.max(1, animation.duration));
        liveRef.current = lerpCamera(animation.from, animation.to, easeOutCubic(t));
        if (t >= 1) {
          animationRef.current = null;
          animation.onDone();
        } else requestFrame();
      } else {
        const dt = Math.min(64, Math.max(0, now - animation.last));
        animation.last = now;
        const live = liveRef.current;
        const stepX = decayStep(live.tx, animation.vx, dt, DECAY_DECELERATION);
        const stepY = decayStep(live.ty, animation.vy, dt, DECAY_DECELERATION);
        let { position: tx, velocity: vx } = stepX;
        let { position: ty, velocity: vy } = stepY;
        const { range } = animation;
        if (tx < range.minTx) {
          tx = range.minTx;
          vx = 0;
        } else if (tx > range.maxTx) {
          tx = range.maxTx;
          vx = 0;
        }
        if (ty < range.minTy) {
          ty = range.minTy;
          vy = 0;
        } else if (ty > range.maxTy) {
          ty = range.maxTy;
          vy = 0;
        }
        animation.vx = vx;
        animation.vy = vy;
        liveRef.current = { scale: live.scale, tx, ty };
        if (Math.abs(vx) < DECAY_STOP_VELOCITY && Math.abs(vy) < DECAY_STOP_VELOCITY) {
          animationRef.current = null;
          onGestureEnd();
        } else requestFrame();
      }
    }
    applyFrame();
  };

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const timers = timersRef.current;
      for (const key of Object.keys(timers) as (keyof Timers)[]) {
        const timer = timers[key];
        if (timer) clearTimeout(timer);
      }
    },
    []
  );

  // ---- Fit and layout ----

  // Initial fit once the viewport is known (and again if the document changes).
  React.useEffect(() => {
    if (!viewport) return;
    const fit = fitCamera(fitTarget(document, initialFit), viewport, padding);
    fitRef.current = fit;
    cancelAnimation();
    liveRef.current = fit;
    setBase(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, document]);

  const region = React.useMemo(() => {
    if (!base || !viewport) return null;
    const slack = Math.max(content.width, content.height) * REGION_SLACK;
    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return chooseRenderRegion(base, viewport, expandRect(content, slack), { pixelRatio, ...regionOptions });
  }, [base, viewport, content, regionOptions]);

  // A new resting camera was laid out in this commit: reset the transform against it before paint.
  React.useLayoutEffect(() => {
    baseRef.current = base;
    regionRef.current = region;
    if (!base) return;
    applyFrame();
    latest.current.onCameraChange?.(base);
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, region]);

  // ---- Hit testing and presses ----

  const resolveHit = React.useCallback((x: number, y: number): { hit: ElementHit | null; point: Point; screenPoint: Point } | null => {
    if (!baseRef.current) return null;
    const ctx = latest.current;
    const camera = liveRef.current;
    const screenPoint = { x, y };
    const point = screenToWorld(camera, screenPoint);
    const hits = ctx.document.elementsAt(point, { tolerance: ctx.hitSlop / camera.scale, mode: ctx.hitMode });
    for (const target of hits) {
      const node = interactiveFor(target, ctx.resolvedInteractive.isInteractive);
      if (node) return { hit: { node, data: ctx.resolvedInteractive.dataFor(node), point, screenPoint, target }, point, screenPoint };
    }
    return { hit: null, point, screenPoint };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flashPressed = React.useCallback((id: string) => {
    setPressedId(id);
    const timers = timersRef.current;
    if (timers.pressed) clearTimeout(timers.pressed);
    timers.pressed = setTimeout(() => {
      timers.pressed = null;
      setPressedId(null);
    }, latest.current.pressedDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A press on an interactive element, from a tap or a keyboard/screen-reader activation: callback, feedback, selection. */
  const pressElement = React.useCallback(
    (hit: ElementHit) => {
      const ctx = latest.current;
      ctx.onElementPress?.(hit);
      if (hit.node.id !== undefined) {
        if (ctx.pressed) flashPressed(hit.node.id);
        if (ctx.selectionMode !== 'none') updateSelection(nextSelection(ctx.selectionMode, ctx.selection, hit.node.id), hit);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flashPressed, updateSelection]
  );

  const handleTap = React.useCallback(
    (x: number, y: number) => {
      const resolved = resolveHit(x, y);
      if (!resolved) return;
      if (resolved.hit) {
        pressElement(resolved.hit);
        return;
      }
      const ctx = latest.current;
      ctx.onBackgroundPress?.(resolved.point, resolved.screenPoint);
      if (ctx.selectionMode !== 'none' && ctx.clearOnBackground) updateSelection([], null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveHit, pressElement, updateSelection]
  );

  const handleLongPress = React.useCallback(
    (x: number, y: number) => {
      const resolved = resolveHit(x, y);
      if (resolved?.hit) latest.current.onElementLongPress?.(resolved.hit);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveHit]
  );

  const handleDoubleTap = React.useCallback(
    (x: number, y: number) => {
      const factor = latest.current.doubleTapZoom;
      if (factor <= 0) return;
      settleTo(zoomCamera(liveRef.current, factor, { x, y }), true, DEFAULT_DURATION);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settleTo]
  );

  // ---- Pointer gestures ----

  const localPoint = React.useCallback((event: { clientX: number; clientY: number }): Point => {
    const stage = stageRef.current;
    if (!stage) return { x: event.clientX, y: event.clientY };
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const clearTimer = React.useCallback((name: keyof Timers) => {
    const timers = timersRef.current;
    const timer = timers[name];
    if (timer) {
      clearTimeout(timer);
      timers[name] = null;
    }
  }, []);

  const armPause = React.useCallback(() => {
    clearTimer('pause');
    timersRef.current.pause = setTimeout(() => {
      timersRef.current.pause = null;
      onGesturePause();
    }, PAUSE_MS);
  }, [clearTimer, onGesturePause]);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const stage = stageRef.current;
      if (!stage) return;
      stage.setPointerCapture(event.pointerId);
      const gesture = gestureRef.current;
      const point = localPoint(event);
      gesture.pointers.set(event.pointerId, point);
      cancelAnimation();
      clearTimer('pause');
      if (gesture.pointers.size === 1) {
        gesture.mode = 'idle';
        gesture.startPoint = point;
        gesture.lastPoint = point;
        gesture.startTime = performance.now();
        gesture.moved = false;
        gesture.longPressFired = false;
        gesture.samples = [{ t: gesture.startTime, x: point.x, y: point.y }];
        clearTimer('longPress');
        if (latest.current.onElementLongPress) {
          timersRef.current.longPress = setTimeout(() => {
            timersRef.current.longPress = null;
            if (gestureRef.current.pointers.size !== 1 || gestureRef.current.moved) return;
            gestureRef.current.longPressFired = true;
            handleLongPress(point.x, point.y);
          }, LONG_PRESS_MS);
        }
      } else if (gesture.pointers.size === 2) {
        clearTimer('longPress');
        clearTimer('tap');
        const [a, b] = [...gesture.pointers.values()];
        if (a && b) {
          gesture.mode = 'pinch';
          gesture.moved = true;
          gesture.pinchDistance = distance(a, b);
          gesture.pinchMid = midpoint(a, b);
        }
      }
    },
    [localPoint, cancelAnimation, clearTimer, handleLongPress]
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture.pointers.has(event.pointerId)) return;
      const point = localPoint(event);
      gesture.pointers.set(event.pointerId, point);
      const stage = stageRef.current;
      if (gesture.pointers.size >= 2) {
        const [a, b] = [...gesture.pointers.values()];
        if (!a || !b) return;
        const dist = distance(a, b);
        const mid = midpoint(a, b);
        let camera = liveRef.current;
        const fit = fitRef.current;
        if (gesture.pinchDistance > 0 && fit) {
          const { minZoom: min, maxZoom: max } = latest.current;
          const next = Math.min(fit.scale * max, Math.max(fit.scale * min, camera.scale * (dist / gesture.pinchDistance)));
          const factor = next / camera.scale;
          if (factor !== 1) camera = zoomCamera(camera, factor, gesture.pinchMid);
        }
        camera = { scale: camera.scale, tx: camera.tx + (mid.x - gesture.pinchMid.x), ty: camera.ty + (mid.y - gesture.pinchMid.y) };
        gesture.pinchDistance = dist;
        gesture.pinchMid = mid;
        setLiveCamera(camera);
        armPause();
        return;
      }
      if (!gesture.moved) {
        const travelled = distance(point, gesture.startPoint);
        if (travelled > LONG_PRESS_MOVE) clearTimer('longPress');
        if (travelled <= TAP_MOVE_TOLERANCE) return;
        gesture.moved = true;
        gesture.mode = 'pan';
        gesture.lastPoint = gesture.startPoint;
        clearTimer('longPress');
        clearTimer('tap');
        if (stage) stage.style.cursor = 'grabbing';
      }
      const live = liveRef.current;
      setLiveCamera({ scale: live.scale, tx: live.tx + (point.x - gesture.lastPoint.x), ty: live.ty + (point.y - gesture.lastPoint.y) });
      gesture.lastPoint = point;
      const now = performance.now();
      gesture.samples.push({ t: now, x: point.x, y: point.y });
      while (gesture.samples.length > 20) gesture.samples.shift();
      armPause();
    },
    [localPoint, setLiveCamera, armPause, clearTimer]
  );

  const finishPointer = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture.pointers.has(event.pointerId)) return;
      gesture.pointers.delete(event.pointerId);
      const stage = stageRef.current;
      if (stage && stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      clearTimer('longPress');
      const now = performance.now();
      if (gesture.pointers.size === 1) {
        // Pinch ended with one pointer still down: continue as a pan from where it is.
        const remaining = [...gesture.pointers.values()][0];
        if (remaining) {
          gesture.mode = 'pan';
          gesture.moved = true;
          gesture.lastPoint = remaining;
          gesture.samples = [{ t: now, x: remaining.x, y: remaining.y }];
        }
        return;
      }
      if (gesture.pointers.size > 0) return;
      clearTimer('pause');
      if (stage) stage.style.cursor = 'grab';
      const wasDrag = gesture.moved;
      gesture.mode = 'idle';
      if (wasDrag) {
        const ctx = latest.current;
        const size = ctx.viewport;
        if (!cancelled && ctx.inertia && size) {
          const raw = estimateVelocity(gesture.samples, now);
          // Synthetic or jittery input can report absurd speeds; a real fling tops out well below this.
          const speed = Math.hypot(raw.vx, raw.vy);
          const scaleDown = speed > MAX_VELOCITY ? MAX_VELOCITY / speed : 1;
          const vx = raw.vx * scaleDown;
          const vy = raw.vy * scaleDown;
          const live = liveRef.current;
          const range = panRange(live.scale, size.width, size.height, ctx.content.x, ctx.content.y, ctx.content.width, ctx.content.height, MIN_VISIBLE);
          const inside = live.tx >= range.minTx && live.tx <= range.maxTx && live.ty >= range.minTy && live.ty <= range.maxTy;
          if (Math.hypot(vx, vy) >= DECAY_MIN_VELOCITY && inside) {
            animationRef.current = { kind: 'decay', vx, vy, last: now, range };
            requestFrame();
            return;
          }
        }
        onGestureEnd();
        return;
      }
      if (cancelled || gesture.longPressFired || now - gesture.startTime > TAP_MAX_MS) return;
      const point = localPoint(event);
      if (latest.current.doubleTapZoom > 0) {
        const previous = gesture.lastTap;
        if (previous && now - previous.time < DOUBLE_TAP_MS && distance(point, previous.point) < DOUBLE_TAP_DISTANCE) {
          clearTimer('tap');
          gesture.lastTap = null;
          handleDoubleTap(point.x, point.y);
          return;
        }
        gesture.lastTap = { time: now, point };
        clearTimer('tap');
        timersRef.current.tap = setTimeout(() => {
          timersRef.current.tap = null;
          handleTap(point.x, point.y);
        }, SINGLE_TAP_DELAY);
        return;
      }
      handleTap(point.x, point.y);
    },
    [clearTimer, localPoint, onGestureEnd, requestFrame, handleDoubleTap, handleTap]
  );

  const onPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => finishPointer(event, false), [finishPointer]);
  const onPointerCancel = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => finishPointer(event, true), [finishPointer]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling; React's onWheel is passive.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!latest.current.wheelZoom || !baseRef.current) return;
      event.preventDefault();
      cancelAnimation();
      const fit = fitRef.current;
      const { minZoom: min, maxZoom: max } = latest.current;
      const focal = localPoint(event);
      let camera = zoomCamera(liveRef.current, wheelZoomFactor(event.deltaY, event.deltaMode), focal);
      if (fit) camera = clampCameraScale(camera, fit.scale * min, fit.scale * max, focal);
      setLiveCamera(camera);
      clearTimer('wheel');
      timersRef.current.wheel = setTimeout(() => {
        timersRef.current.wheel = null;
        onGestureEnd();
      }, WHEEL_SETTLE_MS);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [cancelAnimation, localPoint, setLiveCamera, clearTimer, onGestureEnd]);

  // ---- Imperative API ----

  const fitTo = React.useCallback(
    (bounds: Rect, options: FitOptions | undefined) => {
      const { viewport: size, padding: pad } = latest.current;
      if (!size || !baseRef.current) {
        pendingRef.current = () => fitTo(bounds, options);
        return;
      }
      let camera = fitCamera(bounds, size, options?.padding ?? pad);
      const fit = fitRef.current;
      if (fit && options?.maxZoom !== undefined && camera.scale > fit.scale * options.maxZoom) {
        const scale = fit.scale * options.maxZoom;
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        camera = { scale, tx: size.width / 2 - center.x * scale, ty: size.height / 2 - center.y * scale };
      }
      settleTo(camera, options?.animated ?? true, options?.duration ?? DEFAULT_DURATION);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settleTo]
  );

  const api = React.useMemo<SvgViewerRef>(() => {
    const zoomAt = (compute: (camera: Camera, focal: Point) => Camera, focal: Point | undefined, options: FitOptions | undefined, retry: () => void): void => {
      const size = latest.current.viewport;
      if (!size || !baseRef.current) {
        pendingRef.current = retry;
        return;
      }
      const point = focal ?? { x: size.width / 2, y: size.height / 2 };
      settleTo(compute(liveRef.current, point), options?.animated ?? true, options?.duration ?? DEFAULT_DURATION);
    };
    const current = (): SvgViewerRef => api;
    return {
      fitToElement: (id, options) => {
        const node = document.getElementById(id);
        const bounds = node ? nodeBBox(node, 'world') : null;
        if (!bounds) return false;
        fitTo(bounds, options);
        return true;
      },
      fitToElements: (ids, options) => {
        let bounds: Rect | null = null;
        for (const id of ids) {
          const node = document.getElementById(id);
          const box = node ? nodeBBox(node, 'world') : null;
          if (box) bounds = unionRects(bounds, box);
        }
        if (!bounds) return false;
        fitTo(bounds, options);
        return true;
      },
      fitToBounds: (bounds, options) => fitTo(bounds, options),
      fitToContent: (options) => fitTo(fitTarget(document, initialFit), options),
      zoomBy: (factor, focal, options) =>
        zoomAt((camera, point) => zoomCamera(camera, factor, point), focal, options, () => current().zoomBy(factor, focal, options)),
      zoomTo: (scale, focal, options) =>
        zoomAt((camera, point) => zoomCamera(camera, scale / camera.scale, point), focal, options, () => current().zoomTo(scale, focal, options)),
      getCamera: () => liveRef.current,
      screenToSvg: (point) => screenToWorld(liveRef.current, point),
      svgToScreen: (point) => worldToScreen(liveRef.current, point),
      getSelection: () => [...latest.current.selection],
      setSelection: (ids) => updateSelection(ids, null),
      select: (id) => {
        const selected = latest.current.selection;
        if (!selected.includes(id)) updateSelection([...selected, id], null);
      },
      deselect: (id) => {
        const selected = latest.current.selection;
        if (selected.includes(id)) updateSelection(selected.filter((other) => other !== id), null);
      },
      toggleSelection: (id) => updateSelection(nextSelection('multiple', latest.current.selection, id), null),
      clearSelection: () => updateSelection([], null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, initialFit, fitTo, settleTo, updateSelection]);
  React.useImperativeHandle(ref, () => api, [api]);

  // ---- Decorators and accessibility ----

  // In-SVG decorations follow the resting camera's visibility verdict, re-evaluated on every re-anchor.
  const svgDecorators = React.useMemo(() => {
    if (!base) return undefined;
    const fit = fitRef.current ?? base;
    const items = decoratorTargets.filter(
      (t) =>
        t.decorator.layer === 'svg' &&
        decoratorOpacity(base.scale, fit.scale, Math.min(t.bbox.width, t.bbox.height), t.decorator.minTargetSize, t.decorator.minZoom, t.decorator.maxZoom) > 0
    );
    if (items.length === 0) return undefined;
    return items.map((t, index) => (
      <React.Fragment key={`d${t.decoratorIndex}-${t.node.id ?? index}`}>{t.decorator.render(t.node, t.bbox, index)}</React.Fragment>
    ));
  }, [decoratorTargets, base]);

  const overlayEntries = React.useMemo<OverlayEntry[]>(() => {
    const previous = new Map(overlaysRef.current.map((entry) => [entry.key, entry]));
    return decoratorTargets
      .filter((t) => (t.decorator.layer ?? 'overlay') === 'overlay')
      .map((target, index) => {
        const key = overlayKey(target, index);
        const old = previous.get(key);
        return { key, target, element: old?.element ?? null, width: old?.width ?? 0, height: old?.height ?? 0, hidden: false };
      });
  }, [decoratorTargets]);
  overlaysRef.current = overlayEntries;

  const accessibleEntries = React.useMemo<AccessibleEntry[]>(() => {
    if (!accessibility) return [];
    const previous = new Map(accessiblesRef.current.map((entry) => [entry.key, entry]));
    const entries: AccessibleEntry[] = [];
    resolvedInteractive.nodes.forEach((node, index) => {
      const description = accessibility(node, resolvedInteractive.dataFor(node));
      if (!description) return;
      const bbox = nodeBBox(node, 'world');
      if (!bbox) return;
      const key = `a-${node.id ?? index}`;
      entries.push({
        key,
        node,
        anchor: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
        label: description.label,
        hint: description.hint,
        element: previous.get(key)?.element ?? null,
      });
    });
    return entries;
  }, [accessibility, resolvedInteractive]);
  accessiblesRef.current = accessibleEntries;

  // Measure overlay labels, resolve overlaps at the resting camera, then place everything.
  React.useLayoutEffect(() => {
    const resting = baseRef.current;
    for (const entry of overlaysRef.current) {
      if (!entry.element) continue;
      entry.width = entry.element.offsetWidth;
      entry.height = entry.element.offsetHeight;
    }
    if (resting) {
      const fit = fitRef.current ?? resting;
      const candidates: LabelCandidate[] = [];
      for (const entry of overlaysRef.current) {
        entry.hidden = false;
        const { decorator, bbox, anchor, node } = entry.target;
        if (!decorator.avoidOverlap || entry.width === 0) continue;
        const shown = decoratorOpacity(resting.scale, fit.scale, Math.min(bbox.width, bbox.height), decorator.minTargetSize, decorator.minZoom, decorator.maxZoom);
        if (shown <= 0) continue;
        const screen = worldToScreen(resting, anchor);
        const { priority } = decorator;
        candidates.push({
          key: entry.key,
          x: screen.x,
          y: screen.y,
          width: entry.width,
          height: entry.height,
          priority: typeof priority === 'function' ? priority(node) : priority ?? bbox.width * bbox.height,
        });
      }
      const hidden = resolveOverlaps(candidates);
      for (const entry of overlaysRef.current) entry.hidden = hidden.has(entry.key);
    }
    applyFrame();
  }, [overlayEntries, accessibleEntries, base, applyFrame]);

  const activateNode = React.useCallback(
    (entry: AccessibleEntry) => {
      const camera = liveRef.current;
      pressElement({
        node: entry.node,
        data: latest.current.resolvedInteractive.dataFor(entry.node),
        point: entry.anchor,
        screenPoint: worldToScreen(camera, entry.anchor),
        target: entry.node,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pressElement]
  );

  let controlsElement: React.ReactNode = null;
  if (renderControls) controlsElement = renderControls(api);
  else if (controls !== false) controlsElement = <ViewerControls api={api} options={controls === true ? {} : controls} />;

  const ready = viewport !== null && base !== null && region !== null;

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      <div
        ref={stageRef}
        style={STAGE_STYLE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div ref={wrapperRef} style={WRAPPER_STYLE}>
          {ready ? (
            <SvgRenderer
              source={{ document }}
              planOptions={planOptions}
              overrides={overrides}
              viewBox={region.viewBox}
              width={region.width}
              height={region.height}
              style={{ position: 'absolute', left: region.x, top: region.y, display: 'block', overflow: 'visible' }}
            >
              {svgDecorators}
            </SvgRenderer>
          ) : null}
        </div>
        <div style={LAYER_STYLE}>
          {ready
            ? overlayEntries.map((entry, index) => (
                <div
                  key={entry.key}
                  style={OVERLAY_ITEM_STYLE}
                  ref={(element) => {
                    entry.element = element;
                  }}
                >
                  {entry.target.decorator.render(entry.target.node, entry.target.bbox, index)}
                </div>
              ))
            : null}
          {ready
            ? accessibleEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  style={ACCESSIBLE_STYLE}
                  aria-label={entry.label}
                  title={entry.hint}
                  ref={(element) => {
                    entry.element = element;
                  }}
                  onClick={() => activateNode(entry)}
                />
              ))
            : null}
        </div>
      </div>
      {/* App elements and the controls are siblings of the stage, so their clicks never reach the drawing. */}
      {children}
      {controlsElement}
    </div>
  );
});
