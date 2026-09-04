import * as React from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  camerasEqual,
  chooseRenderRegion,
  clampCameraScale,
  clampCameraToBounds,
  expandRect,
  fitCamera,
  nodeBBox,
  screenToWorld,
  unionRects,
  visibleWorldRect,
  worldToScreen,
  zoomCamera,
  type Camera,
  type PlanOptions,
  type Point,
  type Rect,
  type RenderRegion,
  type Size,
  type SvgDocument,
  type SvgNode,
} from 'svg-core';
import { ReactNativeSvgBackend } from './backends/reactNativeSvg';
import { panRange } from './cameraLimits';
import { resolveOverlaps, type LabelCandidate } from './collision';
import { ViewerControls } from './controls';
import {
  buildOverrides,
  interactiveFor,
  nextSelection,
  resolveDecorators,
  resolveInteractive,
  sameSelection,
  type DecoratorTarget,
  type ResolvedInteractive,
} from './interactive';
import type { StyleOverride } from '../mapping';
import type { ElementHit, FitOptions, SelectionMode, SharedCamera, SvgViewerProps, SvgViewerRef } from './types';
import { decoratorOpacity } from './visibility';

const DEFAULT_DURATION = 350;
/** Duration of the glide back into bounds after a gesture ends outside them. */
const SETTLE_DURATION = 250;
const DEFAULT_PRESSED_DURATION = 180;
const LONG_PRESS_MS = 400;
/** A gesture that has not moved for this long is paused: the drawing is re-anchored so it is crisp while the fingers rest. */
const PAUSE_MS = 120;
/** Re-anchor during a pause once the live scale differs from the layer's by this factor. */
const REANCHOR_SCALE_RATIO = 1.15;
/** Pixels of content that must stay inside the viewport on each axis (matches `clampCameraToBounds`). */
const MIN_VISIBLE = 48;
const DECAY_DECELERATION = 0.997;
/** Below this release speed (px/s) a pan just stops. */
const DECAY_MIN_VELOCITY = 40;
/** Size of the invisible screen-reader targets. */
const ACCESSIBLE_TARGET = 44;
const DEFAULT_SELECTED_STYLE: StyleOverride = { stroke: { type: 'color', value: '#22c55e' }, strokeWidth: 3 };
/** Fraction of the content's larger dimension added around the rasterized region. */
const REGION_SLACK = 0.03;
const EMPTY_SET: ReadonlySet<string> = new Set();

function fitTarget(document: SvgViewerProps['document'], initialFit: SvgViewerProps['initialFit']): Rect {
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

/** Always-current values for callbacks that must not re-create gestures on every render. */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

/** A rasterized layer: the drawing laid out for one resting camera. */
interface Layer {
  id: number;
  document: SvgDocument;
  camera: Camera;
  region: RenderRegion;
}

/**
 * Fixed-size view kept on a document-space anchor while the camera moves (UI thread). Its
 * opacity follows the decorator's visibility limits, so labels of small elements appear only
 * once the user has zoomed in enough for them to make sense; `hidden` is the overlap resolver's
 * verdict at the resting camera.
 */
function OverlayItem({
  anchor,
  targetMinSide,
  minTargetSize,
  minZoom,
  maxZoom,
  hidden,
  live,
  fitScale,
  onMeasure,
  children,
}: {
  anchor: Point;
  /** Smaller side of the decorated element's world bounding box. */
  targetMinSide: number;
  minTargetSize: number | undefined;
  minZoom: number | undefined;
  maxZoom: number | undefined;
  hidden: boolean;
  live: SharedCamera;
  fitScale: SharedValue<number>;
  onMeasure?: (size: Size) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [size, setSize] = React.useState<Size | null>(null);
  const latestMeasure = useLatest(onMeasure);
  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);
  // Report the size whenever it changes and whenever measuring is switched on later (a layout
  // that already happened never fires onLayout again).
  const measureEnabled = onMeasure !== undefined;
  React.useEffect(() => {
    if (size && measureEnabled) latestMeasure.current?.(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, measureEnabled]);
  const halfWidth = (size?.width ?? 0) / 2;
  const halfHeight = (size?.height ?? 0) / 2;
  const visible = size !== null && !hidden;
  const style = useAnimatedStyle(() => {
    'worklet';
    const scale = live.scale.value;
    const x = anchor.x * scale + live.tx.value;
    const y = anchor.y * scale + live.ty.value;
    const opacity = visible ? decoratorOpacity(scale, fitScale.value, targetMinSide, minTargetSize, minZoom, maxZoom) : 0;
    return {
      transform: [{ translateX: x - halfWidth }, { translateY: y - halfHeight }],
      opacity,
    };
  }, [anchor.x, anchor.y, halfWidth, halfHeight, visible, targetMinSide, minTargetSize, minZoom, maxZoom]);
  return (
    <Animated.View style={[styles.overlayItem, style]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}

/** Invisible, screen-reader focusable target kept on an element's centre; activating it acts like a tap on the element. */
function AccessibleTarget({
  anchor,
  live,
  label,
  hint,
  onActivate,
}: {
  anchor: Point;
  live: SharedCamera;
  label: string;
  hint?: string;
  onActivate: () => void;
}): React.ReactElement {
  const style = useAnimatedStyle(() => {
    'worklet';
    const scale = live.scale.value;
    return {
      transform: [
        { translateX: anchor.x * scale + live.tx.value - ACCESSIBLE_TARGET / 2 },
        { translateY: anchor.y * scale + live.ty.value - ACCESSIBLE_TARGET / 2 },
      ],
    };
  }, [anchor.x, anchor.y]);
  const onAction = React.useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'activate') onActivate();
    },
    [onActivate]
  );
  return (
    <Animated.View
      style={[styles.accessibleTarget, style]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityActions={ACTIVATE_ACTIONS}
      onAccessibilityAction={onAction}
      onAccessibilityTap={onActivate}
    />
  );
}

const ACTIVATE_ACTIONS = [{ name: 'activate' }];

interface TapContext {
  document: SvgViewerProps['document'];
  interactive: ResolvedInteractive;
  hitSlop: number;
  hitMode: NonNullable<SvgViewerProps['hitMode']>;
  onElementPress: SvgViewerProps['onElementPress'];
  onElementLongPress: SvgViewerProps['onElementLongPress'];
  onBackgroundPress: SvgViewerProps['onBackgroundPress'];
  doubleTapZoom: number;
  selectionMode: SelectionMode;
  selection: readonly string[];
  clearOnBackground: boolean;
  pressed: boolean;
  pressedDuration: number;
}

interface SelectionContext {
  selection: readonly string[];
  controlled: boolean;
  onSelectionChange: SvgViewerProps['onSelectionChange'];
}

export const SvgViewer = React.forwardRef<SvgViewerRef, SvgViewerProps>(function SvgViewer(props, ref) {
  const {
    document,
    style,
    backend: Backend = ReactNativeSvgBackend,
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

  const [viewport, setViewport] = React.useState<Size | null>(null);
  // The resting camera: the camera the newest layer is laid out for.
  const [base, setBase] = React.useState<Camera | null>(null);
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const [pressedId, setPressedId] = React.useState<string | null>(null);
  const [measureVersion, setMeasureVersion] = React.useState(0);
  const fitRef = React.useRef<Camera | null>(null);
  const layerIdRef = React.useRef(0);
  const regionRef = React.useRef<RenderRegion | null>(null);
  // Set when the live camera must jump to the next resting camera (first fit, new document).
  const resetLiveRef = React.useRef(false);
  // A fit or zoom requested before the viewer has measured itself; applied once the first fit exists.
  const pendingRef = React.useRef<(() => void) | null>(null);
  const pressedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const measuredSizes = React.useRef(new Map<string, Size>());
  const measureBumpScheduled = React.useRef(false);

  // Selection: controlled through `selection`, otherwise kept here.
  const [internalSelection, setInternalSelection] = React.useState<readonly string[]>(defaultSelection ?? []);
  const selection = selectionProp ?? internalSelection;
  const selectionContext = useLatest<SelectionContext>({
    selection,
    controlled: selectionProp !== undefined,
    onSelectionChange,
  });
  const updateSelection = React.useCallback((next: readonly string[], hit: ElementHit | null) => {
    const ctx = selectionContext.current;
    if (sameSelection(ctx.selection, next)) return;
    if (!ctx.controlled) setInternalSelection(next);
    ctx.onSelectionChange?.([...next], hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The live camera, owned by the UI thread: gestures and animations write it, layers and
  // overlays read it every frame. Nothing here re-renders during a gesture.
  const liveScale = useSharedValue(1);
  const liveTx = useSharedValue(0);
  const liveTy = useSharedValue(0);
  const live = React.useMemo<SharedCamera>(() => ({ scale: liveScale, tx: liveTx, ty: liveTy }), [liveScale, liveTx, liveTy]);
  const fitScale = useSharedValue(1);
  const minScale = useSharedValue(0.1);
  const maxScale = useSharedValue(10);
  const active = useSharedValue(0);
  const decaying = useSharedValue(0);
  const pauseTimer = useSharedValue(0);

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

  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setViewport((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);

  // Initial fit once the viewport is known (and again if the document changes).
  React.useEffect(() => {
    if (!viewport) return;
    const fit = fitCamera(fitTarget(document, initialFit), viewport, padding);
    fitRef.current = fit;
    resetLiveRef.current = true;
    setBase(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, document]);

  const latestCameraChange = useLatest(onCameraChange);

  // A new resting camera: publish the zoom limits, jump the live camera there when this is a
  // fresh fit, and run whatever was requested before the viewer was measured.
  React.useLayoutEffect(() => {
    if (!base) return;
    const fit = fitRef.current ?? base;
    fitScale.value = fit.scale;
    minScale.value = fit.scale * minZoom;
    maxScale.value = fit.scale * maxZoom;
    if (resetLiveRef.current) {
      resetLiveRef.current = false;
      cancelAnimation(liveScale);
      cancelAnimation(liveTx);
      cancelAnimation(liveTy);
      liveScale.value = base.scale;
      liveTx.value = base.tx;
      liveTy.value = base.ty;
    }
    latestCameraChange.current?.(base);
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, minZoom, maxZoom]);

  // Every resting camera gets its own layer. The previous layer stays mounted (still correctly
  // placed, since every layer positions itself against the live camera) until the new one has
  // laid out, so re-anchoring never flashes or jumps. Layers of an earlier document are dropped
  // at once. The region gets a little slack around the content bounds: text bounds are
  // estimated, miter joins can poke past half the stroke width, and cropping either would look
  // like a bug.
  React.useEffect(() => {
    if (!base || !viewport) return;
    const slack = Math.max(content.width, content.height) * REGION_SLACK;
    const region = chooseRenderRegion(base, viewport, expandRect(content, slack), { pixelRatio: PixelRatio.get(), ...regionOptions });
    regionRef.current = region;
    const id = ++layerIdRef.current;
    setLayers((previous) => [...previous.filter((layer) => layer.document === document).slice(-1), { id, document, camera: base, region }]);
  }, [base, viewport, content, regionOptions, document]);

  const onLayerReady = React.useCallback((id: number) => {
    setLayers((previous) => (previous.length > 1 ? previous.filter((layer) => layer.id >= id) : previous));
  }, []);

  const state = useLatest({ base, viewport, content, minZoom, maxZoom, padding });

  const currentCamera = React.useCallback(
    (): Camera => ({ scale: liveScale.value, tx: liveTx.value, ty: liveTy.value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Lay the drawing out for `camera` (a new layer) unless the current layer already is. */
  const rebase = React.useCallback((camera: Camera) => {
    const resting = state.current.base;
    if (resting && camerasEqual(resting, camera, 1e-6)) return;
    setBase(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Move the live camera to `target` (after clamping), animated or immediately, then re-anchor. */
  const settleTo = React.useCallback(
    (target: Camera, animated: boolean, duration: number) => {
      const { viewport: size, content: bounds, minZoom: min, maxZoom: max } = state.current;
      const fit = fitRef.current;
      if (!size || !fit) return;
      let camera = clampCameraScale(target, fit.scale * min, fit.scale * max, { x: size.width / 2, y: size.height / 2 });
      camera = clampCameraToBounds(camera, size, bounds, MIN_VISIBLE);
      const finish = (): void => rebase(camera);
      if (!animated) {
        cancelAnimation(liveScale);
        cancelAnimation(liveTx);
        cancelAnimation(liveTy);
        liveScale.value = camera.scale;
        liveTx.value = camera.tx;
        liveTy.value = camera.ty;
        finish();
        return;
      }
      const config = { duration, easing: Easing.out(Easing.cubic) };
      liveTx.value = withTiming(camera.tx, config);
      liveTy.value = withTiming(camera.ty, config);
      liveScale.value = withTiming(camera.scale, config, (finished) => {
        if (finished) runOnJS(finish)();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rebase]
  );

  /** All fingers are up and any glide has stopped: pull the camera back into bounds if needed, then re-anchor. */
  const onGestureEnd = React.useCallback(() => {
    if (active.value > 0) return;
    const { viewport: size, content: bounds, minZoom: min, maxZoom: max } = state.current;
    const fit = fitRef.current;
    if (!size || !fit) return;
    const camera = currentCamera();
    let clamped = clampCameraScale(camera, fit.scale * min, fit.scale * max, { x: size.width / 2, y: size.height / 2 });
    clamped = clampCameraToBounds(clamped, size, bounds, MIN_VISIBLE);
    if (camerasEqual(clamped, camera, 0.01)) rebase(camera);
    else settleTo(clamped, true, SETTLE_DURATION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCamera, rebase, settleTo]);

  /** Fingers still down but resting: re-anchor when the layer is blurry or no longer covers the viewport. */
  const onGesturePause = React.useCallback(() => {
    if (active.value <= 0) return;
    const { base: resting, viewport: size } = state.current;
    if (!resting || !size) return;
    const camera = currentCamera();
    const ratio = camera.scale / resting.scale;
    const region = regionRef.current;
    const covered = region ? rectContains(region.viewBox, visibleWorldRect(camera, size)) : true;
    if (ratio > REANCHOR_SCALE_RATIO || ratio < 1 / REANCHOR_SCALE_RATIO || !covered) rebase(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCamera, rebase]);

  const tapContext = useLatest<TapContext>({
    document,
    interactive: resolvedInteractive,
    hitSlop,
    hitMode,
    onElementPress,
    onElementLongPress,
    onBackgroundPress,
    doubleTapZoom,
    selectionMode,
    selection,
    clearOnBackground: clearSelectionOnBackgroundPress,
    pressed: pressedStyle !== undefined,
    pressedDuration,
  });

  const flashPressed = React.useCallback((id: string) => {
    setPressedId(id);
    if (pressedTimer.current) clearTimeout(pressedTimer.current);
    pressedTimer.current = setTimeout(() => {
      pressedTimer.current = null;
      setPressedId(null);
    }, tapContext.current.pressedDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(
    () => () => {
      if (pressedTimer.current) clearTimeout(pressedTimer.current);
    },
    []
  );

  /** What lies under a screen point: the interactive element (if any) and the document point. */
  const resolveHit = React.useCallback(
    (x: number, y: number): { hit: ElementHit | null; point: Point; screenPoint: Point } | null => {
      // Before the first fit there is no camera to map the point through; ignore rather than guess.
      if (!state.current.base) return null;
      const ctx = tapContext.current;
      const camera = currentCamera();
      const screenPoint = { x, y };
      const point = screenToWorld(camera, screenPoint);
      const hits = ctx.document.elementsAt(point, { tolerance: ctx.hitSlop / camera.scale, mode: ctx.hitMode });
      for (const target of hits) {
        const node = interactiveFor(target, ctx.interactive.isInteractive);
        if (node) return { hit: { node, data: ctx.interactive.dataFor(node), point, screenPoint, target }, point, screenPoint };
      }
      return { hit: null, point, screenPoint };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCamera]
  );

  /** A press on an interactive element, from a tap or a screen reader: callback, feedback, selection. */
  const pressElement = React.useCallback(
    (hit: ElementHit) => {
      const ctx = tapContext.current;
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
      const ctx = tapContext.current;
      ctx.onBackgroundPress?.(resolved.point, resolved.screenPoint);
      if (ctx.selectionMode !== 'none' && ctx.clearOnBackground) updateSelection([], null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveHit, pressElement, updateSelection]
  );

  const handleLongPress = React.useCallback(
    (x: number, y: number) => {
      const resolved = resolveHit(x, y);
      if (resolved?.hit) tapContext.current.onElementLongPress?.(resolved.hit);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveHit]
  );

  const handleDoubleTap = React.useCallback(
    (x: number, y: number) => {
      const factor = tapContext.current.doubleTapZoom;
      if (factor <= 0) return;
      settleTo(zoomCamera(currentCamera(), factor, { x, y }), true, DEFAULT_DURATION);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settleTo, currentCamera]
  );

  const doubleTapEnabled = doubleTapZoom > 0;
  const longPressEnabled = onElementLongPress !== undefined;
  const gesture = React.useMemo(() => {
    // Explicit worklet directives: the compiled package does not keep the syntax the babel
    // plugin recognizes, so every UI-thread callback declares itself.
    const viewportWidth = viewport?.width ?? 0;
    const viewportHeight = viewport?.height ?? 0;
    const boundsX = content.x;
    const boundsY = content.y;
    const boundsWidth = content.width;
    const boundsHeight = content.height;
    const inertiaEnabled = inertia;

    const stopAnimations = (): void => {
      'worklet';
      cancelAnimation(liveScale);
      cancelAnimation(liveTx);
      cancelAnimation(liveTy);
    };
    // Debounce on the UI thread: the timer restarts on every change and fires once the fingers
    // have rested for PAUSE_MS. Assigning a new animation cancels the previous one.
    const armPause = (): void => {
      'worklet';
      pauseTimer.value = 0;
      pauseTimer.value = withDelay(
        PAUSE_MS,
        withTiming(1, { duration: 1 }, (finished) => {
          if (finished) runOnJS(onGesturePause)();
        })
      );
    };
    const fingerUp = (): boolean => {
      'worklet';
      active.value -= 1;
      if (active.value > 0) return false;
      active.value = 0;
      pauseTimer.value = 0;
      return true;
    };

    const pan = Gesture.Pan()
      .minDistance(4)
      .onStart(() => {
        'worklet';
        active.value += 1;
        stopAnimations();
      })
      .onChange((event) => {
        'worklet';
        liveTx.value += event.changeX;
        liveTy.value += event.changeY;
        armPause();
      })
      .onEnd((event) => {
        'worklet';
        if (!fingerUp()) return;
        const speed = Math.hypot(event.velocityX, event.velocityY);
        if (!inertiaEnabled || speed < DECAY_MIN_VELOCITY) {
          runOnJS(onGestureEnd)();
          return;
        }
        const range = panRange(liveScale.value, viewportWidth, viewportHeight, boundsX, boundsY, boundsWidth, boundsHeight, MIN_VISIBLE);
        const inside =
          liveTx.value >= range.minTx && liveTx.value <= range.maxTx && liveTy.value >= range.minTy && liveTy.value <= range.maxTy;
        if (!inside) {
          // Released outside the bounds: glide straight back instead of decaying further out.
          runOnJS(onGestureEnd)();
          return;
        }
        decaying.value = 2;
        const done = (finished: boolean | undefined): void => {
          'worklet';
          decaying.value -= 1;
          if (finished && decaying.value <= 0) runOnJS(onGestureEnd)();
        };
        liveTx.value = withDecay({ velocity: event.velocityX, deceleration: DECAY_DECELERATION, clamp: [range.minTx, range.maxTx] }, done);
        liveTy.value = withDecay({ velocity: event.velocityY, deceleration: DECAY_DECELERATION, clamp: [range.minTy, range.maxTy] }, done);
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        'worklet';
        active.value += 1;
        stopAnimations();
      })
      .onChange((event) => {
        'worklet';
        const next = Math.min(maxScale.value, Math.max(minScale.value, liveScale.value * event.scaleChange));
        const factor = next / liveScale.value;
        if (factor !== 1) {
          liveTx.value = event.focalX - (event.focalX - liveTx.value) * factor;
          liveTy.value = event.focalY - (event.focalY - liveTy.value) * factor;
          liveScale.value = next;
        }
        armPause();
      })
      .onEnd(() => {
        'worklet';
        if (fingerUp()) runOnJS(onGestureEnd)();
      });
    const singleTap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((event, success) => {
        'worklet';
        if (success) runOnJS(handleTap)(event.x, event.y);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(300)
      .onEnd((event, success) => {
        'worklet';
        if (success) runOnJS(handleDoubleTap)(event.x, event.y);
      });
    const longPress = Gesture.LongPress()
      .minDuration(LONG_PRESS_MS)
      .maxDistance(10)
      .onStart((event) => {
        'worklet';
        runOnJS(handleLongPress)(event.x, event.y);
      });
    const taps = doubleTapEnabled ? Gesture.Exclusive(doubleTap, singleTap) : singleTap;
    const drag = Gesture.Simultaneous(pan, pinch);
    return longPressEnabled ? Gesture.Race(taps, longPress, drag) : Gesture.Race(taps, drag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onGestureEnd, onGesturePause, handleTap, handleDoubleTap, handleLongPress, doubleTapEnabled, longPressEnabled, inertia, viewport, content]);

  const fitTo = React.useCallback(
    (bounds: Rect, options: FitOptions | undefined) => {
      const { viewport: size, padding: pad, base: resting } = state.current;
      if (!size || !resting) {
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

  const api = React.useMemo<SvgViewerRef>(
    () => ({
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
      zoomBy: (factor, focal, options) => {
        const size = state.current.viewport;
        if (!size || !state.current.base) {
          pendingRef.current = () => api.zoomBy(factor, focal, options);
          return;
        }
        const point = focal ?? { x: size.width / 2, y: size.height / 2 };
        settleTo(zoomCamera(currentCamera(), factor, point), options?.animated ?? true, options?.duration ?? DEFAULT_DURATION);
      },
      zoomTo: (scale, focal, options) => {
        const size = state.current.viewport;
        if (!size || !state.current.base) {
          pendingRef.current = () => api.zoomTo(scale, focal, options);
          return;
        }
        const camera = currentCamera();
        const point = focal ?? { x: size.width / 2, y: size.height / 2 };
        settleTo(zoomCamera(camera, scale / camera.scale, point), options?.animated ?? true, options?.duration ?? DEFAULT_DURATION);
      },
      getCamera: () => currentCamera(),
      screenToSvg: (point) => screenToWorld(currentCamera(), point),
      svgToScreen: (point) => worldToScreen(currentCamera(), point),
      getSelection: () => [...selectionContext.current.selection],
      setSelection: (ids) => updateSelection(ids, null),
      select: (id) => {
        const current = selectionContext.current.selection;
        if (!current.includes(id)) updateSelection([...current, id], null);
      },
      deselect: (id) => {
        const current = selectionContext.current.selection;
        if (current.includes(id)) updateSelection(current.filter((other) => other !== id), null);
      },
      toggleSelection: (id) => updateSelection(nextSelection('multiple', selectionContext.current.selection, id), null),
      clearSelection: () => updateSelection([], null),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, initialFit, fitTo, settleTo, currentCamera, updateSelection]
  );
  React.useImperativeHandle(ref, () => api, [api]);

  let controlsElement: React.ReactNode = null;
  if (renderControls) controlsElement = renderControls(api);
  else if (controls !== false) controlsElement = <ViewerControls api={api} options={controls === true ? {} : controls} />;

  // In-SVG decorations cannot fade on the UI thread; their visibility follows the resting camera,
  // so it is re-evaluated whenever a gesture settles or the drawing re-anchors.
  const svgDecorators = React.useMemo(() => {
    if (!base) return undefined;
    const fit = fitRef.current ?? base;
    const items = decoratorTargets.filter(
      (t) =>
        t.decorator.layer === 'svg' &&
        decoratorOpacity(
          base.scale,
          fit.scale,
          Math.min(t.bbox.width, t.bbox.height),
          t.decorator.minTargetSize,
          t.decorator.minZoom,
          t.decorator.maxZoom
        ) > 0
    );
    if (items.length === 0) return undefined;
    return items.map((t, index) => (
      <React.Fragment key={`d${t.decoratorIndex}-${t.node.id ?? index}`}>{t.decorator.render(t.node, t.bbox, index)}</React.Fragment>
    ));
  }, [decoratorTargets, base]);

  const overlayDecorators = React.useMemo(
    () => decoratorTargets.filter((t) => (t.decorator.layer ?? 'overlay') === 'overlay'),
    [decoratorTargets]
  );

  // Overlay labels report their measured size; one state bump per frame re-runs the overlap check.
  const onOverlayMeasure = React.useCallback((key: string, size: Size) => {
    const previous = measuredSizes.current.get(key);
    if (previous && previous.width === size.width && previous.height === size.height) return;
    measuredSizes.current.set(key, size);
    if (measureBumpScheduled.current) return;
    measureBumpScheduled.current = true;
    requestAnimationFrame(() => {
      measureBumpScheduled.current = false;
      setMeasureVersion((version) => version + 1);
    });
  }, []);

  // Overlap resolution at the resting camera: labels that would collide are hidden by priority.
  const overlapHidden = React.useMemo<ReadonlySet<string>>(() => {
    if (!base) return EMPTY_SET;
    const fit = fitRef.current ?? base;
    const candidates: LabelCandidate[] = [];
    overlayDecorators.forEach((target, index) => {
      if (!target.decorator.avoidOverlap) return;
      const key = overlayKey(target, index);
      const size = measuredSizes.current.get(key);
      if (!size) return;
      const shown = decoratorOpacity(
        base.scale,
        fit.scale,
        Math.min(target.bbox.width, target.bbox.height),
        target.decorator.minTargetSize,
        target.decorator.minZoom,
        target.decorator.maxZoom
      );
      if (shown <= 0) return;
      const screen = worldToScreen(base, target.anchor);
      const { priority } = target.decorator;
      candidates.push({
        key,
        x: screen.x,
        y: screen.y,
        width: size.width,
        height: size.height,
        priority: typeof priority === 'function' ? priority(target.node) : priority ?? target.bbox.width * target.bbox.height,
      });
    });
    return resolveOverlaps(candidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, overlayDecorators, measureVersion]);

  const accessibleTargets = React.useMemo(() => {
    if (!accessibility) return [];
    const targets: { node: SvgNode; anchor: Point; label: string; hint?: string }[] = [];
    for (const node of resolvedInteractive.nodes) {
      const description = accessibility(node, resolvedInteractive.dataFor(node));
      if (!description) continue;
      const bbox = nodeBBox(node, 'world');
      if (!bbox) continue;
      targets.push({ node, anchor: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }, label: description.label, hint: description.hint });
    }
    return targets;
  }, [accessibility, resolvedInteractive]);

  const activateNode = React.useCallback(
    (node: SvgNode, anchor: Point) => {
      const camera = currentCamera();
      pressElement({ node, data: tapContext.current.interactive.dataFor(node), point: anchor, screenPoint: worldToScreen(camera, anchor), target: node });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCamera, pressElement]
  );

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {viewport && base
            ? layers.map((layer) => (
                <Backend
                  key={layer.id}
                  document={layer.document}
                  planOptions={planOptions}
                  overrides={overrides}
                  camera={layer.camera}
                  live={live}
                  viewport={viewport}
                  region={layer.region}
                  onReady={() => onLayerReady(layer.id)}
                >
                  {svgDecorators}
                </Backend>
              ))
            : null}
          {viewport && base
            ? overlayDecorators.map((target: DecoratorTarget, index) => {
                const key = overlayKey(target, index);
                return (
                  <OverlayItem
                    key={key}
                    anchor={target.anchor}
                    targetMinSide={Math.min(target.bbox.width, target.bbox.height)}
                    minTargetSize={target.decorator.minTargetSize}
                    minZoom={target.decorator.minZoom}
                    maxZoom={target.decorator.maxZoom}
                    hidden={overlapHidden.has(key)}
                    live={live}
                    fitScale={fitScale}
                    onMeasure={target.decorator.avoidOverlap ? (size) => onOverlayMeasure(key, size) : undefined}
                  >
                    {target.decorator.render(target.node, target.bbox, index)}
                  </OverlayItem>
                );
              })
            : null}
          {viewport && base
            ? accessibleTargets.map((target, index) => (
                <AccessibleTarget
                  key={`a-${target.node.id ?? index}`}
                  anchor={target.anchor}
                  live={live}
                  label={target.label}
                  hint={target.hint}
                  onActivate={() => activateNode(target.node, target.anchor)}
                />
              ))
            : null}
        </View>
      </GestureDetector>
      {/* Controls and app views live outside the gesture detector so their presses are never read as taps on the drawing. */}
      {children}
      {controlsElement}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  overlayItem: {
    position: 'absolute',
    left: 0,
    top: 0,
    pointerEvents: 'none',
  },
  accessibleTarget: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: ACCESSIBLE_TARGET,
    height: ACCESSIBLE_TARGET,
    pointerEvents: 'none',
  },
});
