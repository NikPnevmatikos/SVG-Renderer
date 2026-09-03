import * as React from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  camerasEqual,
  chooseRenderRegion,
  clampCameraScale,
  clampCameraToBounds,
  composeCamera,
  expandRect,
  fitCamera,
  nodeBBox,
  relativeCamera,
  screenToWorld,
  worldToScreen,
  zoomCamera,
  type Camera,
  type PlanOptions,
  type Point,
  type Rect,
  type Size,
  type SvgNode,
} from 'svg-core';
import { ReactNativeSvgBackend } from './backends/reactNativeSvg';
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
const DEFAULT_SELECTED_STYLE: StyleOverride = { stroke: { type: 'color', value: '#22c55e' }, strokeWidth: 3 };
/** Fraction of the content's larger dimension added around the rasterized region. */
const REGION_SLACK = 0.03;

function fitTarget(document: SvgViewerProps['document'], initialFit: SvgViewerProps['initialFit']): Rect {
  if (initialFit === 'viewBox') return document.viewBox ?? document.contentBounds;
  if (initialFit && typeof initialFit === 'object') return initialFit;
  return document.contentBounds;
}

/** Always-current values for callbacks that must not re-create gestures on every render. */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Fixed-size view kept on a document-space anchor while the camera moves (UI thread). Its
 * opacity follows the decorator's visibility limits, so labels of small elements appear only
 * once the user has zoomed in enough for them to make sense.
 */
function OverlayItem({
  anchor,
  targetMinSide,
  minTargetSize,
  minZoom,
  maxZoom,
  base,
  fitScale,
  delta,
  children,
}: {
  anchor: Point;
  /** Smaller side of the decorated element's world bounding box. */
  targetMinSide: number;
  minTargetSize: number | undefined;
  minZoom: number | undefined;
  maxZoom: number | undefined;
  base: { scale: SharedValue<number>; tx: SharedValue<number>; ty: SharedValue<number> };
  fitScale: SharedValue<number>;
  delta: SharedCamera;
  children: React.ReactNode;
}): React.ReactElement {
  const [size, setSize] = React.useState<Size | null>(null);
  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);
  const halfWidth = (size?.width ?? 0) / 2;
  const halfHeight = (size?.height ?? 0) / 2;
  const measured = size !== null;
  const style = useAnimatedStyle(() => {
    'worklet';
    const scale = delta.scale.value * base.scale.value;
    const x = anchor.x * scale + delta.scale.value * base.tx.value + delta.tx.value;
    const y = anchor.y * scale + delta.scale.value * base.ty.value + delta.ty.value;
    const opacity = measured ? decoratorOpacity(scale, fitScale.value, targetMinSide, minTargetSize, minZoom, maxZoom) : 0;
    return {
      transform: [{ translateX: x - halfWidth }, { translateY: y - halfHeight }],
      opacity,
    };
  }, [anchor.x, anchor.y, halfWidth, halfHeight, measured, targetMinSide, minTargetSize, minZoom, maxZoom]);
  return (
    <Animated.View style={[styles.overlayItem, style]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}

interface TapContext {
  document: SvgViewerProps['document'];
  interactive: ResolvedInteractive;
  hitSlop: number;
  hitMode: NonNullable<SvgViewerProps['hitMode']>;
  onElementPress: SvgViewerProps['onElementPress'];
  onBackgroundPress: SvgViewerProps['onBackgroundPress'];
  doubleTapZoom: number;
  selectionMode: SelectionMode;
  selection: readonly string[];
  clearOnBackground: boolean;
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
    onBackgroundPress,
    onCameraChange,
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
  const [base, setBase] = React.useState<Camera | null>(null);
  const fitRef = React.useRef<Camera | null>(null);

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

  // Live gesture delta and mirrors of the resting camera, all readable on the UI thread.
  const deltaScale = useSharedValue(1);
  const deltaTx = useSharedValue(0);
  const deltaTy = useSharedValue(0);
  const delta = React.useMemo<SharedCamera>(() => ({ scale: deltaScale, tx: deltaTx, ty: deltaTy }), [deltaScale, deltaTx, deltaTy]);
  const baseScale = useSharedValue(1);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);
  const fitScale = useSharedValue(1);
  const minDelta = useSharedValue(0.1);
  // A fit or zoom requested before the viewer has measured itself; applied once the first fit exists.
  const pendingRef = React.useRef<(() => void) | null>(null);
  const maxDelta = useSharedValue(10);
  const active = useSharedValue(0);

  const content = document.contentBounds;
  const resolvedInteractive = React.useMemo(() => resolveInteractive(document, interactive), [document, interactive]);
  const overrides = React.useMemo(() => {
    const map = buildOverrides(document, elementStyles);
    if (selectionMode === 'none') return map;
    for (const id of selection) {
      const node = document.getElementById(id);
      if (!node) continue;
      const style = typeof selectedStyle === 'function' ? selectedStyle(node) : selectedStyle ?? DEFAULT_SELECTED_STYLE;
      const explicit = map.get(node);
      map.set(node, explicit ? { ...style, ...explicit } : style);
    }
    return map;
  }, [document, elementStyles, selection, selectedStyle, selectionMode]);
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
    setBase(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, document]);

  const latestCameraChange = useLatest(onCameraChange);

  // Whenever the resting camera changes, the layout below was rendered for it: reset the delta.
  React.useLayoutEffect(() => {
    if (!base) return;
    baseScale.value = base.scale;
    baseTx.value = base.tx;
    baseTy.value = base.ty;
    const fit = fitRef.current ?? base;
    fitScale.value = fit.scale;
    minDelta.value = (fit.scale * minZoom) / base.scale;
    maxDelta.value = (fit.scale * maxZoom) / base.scale;
    deltaScale.value = 1;
    deltaTx.value = 0;
    deltaTy.value = 0;
    latestCameraChange.current?.(base);
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, minZoom, maxZoom]);

  const state = useLatest({ base, viewport, content, minZoom, maxZoom, padding });

  const currentCamera = React.useCallback((): Camera => {
    const resting = state.current.base ?? { scale: 1, tx: 0, ty: 0 };
    return composeCamera(resting, { scale: deltaScale.value, tx: deltaTx.value, ty: deltaTy.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Make `target` the new resting camera (after clamping), animated or immediately. */
  const settleTo = React.useCallback(
    (target: Camera, animated: boolean, duration: number) => {
      const { base: resting, viewport: size, content: bounds, minZoom: min, maxZoom: max } = state.current;
      if (!resting || !size) return;
      const fit = fitRef.current ?? resting;
      let camera = clampCameraScale(target, fit.scale * min, fit.scale * max, { x: size.width / 2, y: size.height / 2 });
      camera = clampCameraToBounds(camera, size, bounds);
      const finish = (): void => {
        if (camerasEqual(camera, resting)) {
          deltaScale.value = 1;
          deltaTx.value = 0;
          deltaTy.value = 0;
        } else {
          setBase(camera);
        }
      };
      const rel = relativeCamera(resting, camera);
      if (!animated) {
        deltaScale.value = rel.scale;
        deltaTx.value = rel.tx;
        deltaTy.value = rel.ty;
        finish();
        return;
      }
      const config = { duration, easing: Easing.out(Easing.cubic) };
      deltaTx.value = withTiming(rel.tx, config);
      deltaTy.value = withTiming(rel.ty, config);
      deltaScale.value = withTiming(rel.scale, config, (finished) => {
        if (finished) runOnJS(finish)();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const onGestureEnd = React.useCallback(() => {
    settleTo(currentCamera(), false, 0);
  }, [settleTo, currentCamera]);

  const tapContext = useLatest<TapContext>({
    document,
    interactive: resolvedInteractive,
    hitSlop,
    hitMode,
    onElementPress,
    onBackgroundPress,
    doubleTapZoom,
    selectionMode,
    selection,
    clearOnBackground: clearSelectionOnBackgroundPress,
  });

  const handleTap = React.useCallback(
    (x: number, y: number) => {
      // Before the first fit there is no camera to map the tap through; ignore rather than guess.
      if (!state.current.base) return;
      const ctx = tapContext.current;
      const camera = currentCamera();
      const point = screenToWorld(camera, { x, y });
      const screenPoint = { x, y };
      const hits = ctx.document.elementsAt(point, { tolerance: ctx.hitSlop / camera.scale, mode: ctx.hitMode });
      for (const target of hits) {
        const node = interactiveFor(target, ctx.interactive.isInteractive);
        if (node) {
          const hit: ElementHit = { node, data: ctx.interactive.dataFor(node), point, screenPoint, target };
          ctx.onElementPress?.(hit);
          if (ctx.selectionMode !== 'none' && node.id !== undefined) {
            updateSelection(nextSelection(ctx.selectionMode, ctx.selection, node.id), hit);
          }
          return;
        }
      }
      ctx.onBackgroundPress?.(point, screenPoint);
      if (ctx.selectionMode !== 'none' && ctx.clearOnBackground) updateSelection([], null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCamera, updateSelection]
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
  const gesture = React.useMemo(() => {
    // Explicit worklet directives: the compiled package does not keep the syntax the babel
    // plugin recognizes, so every UI-thread callback declares itself.
    const pan = Gesture.Pan()
      .minDistance(4)
      .onStart(() => {
        'worklet';
        active.value += 1;
      })
      .onChange((event) => {
        'worklet';
        deltaTx.value += event.changeX;
        deltaTy.value += event.changeY;
      })
      .onEnd(() => {
        'worklet';
        active.value -= 1;
        if (active.value <= 0) {
          active.value = 0;
          runOnJS(onGestureEnd)();
        }
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        'worklet';
        active.value += 1;
      })
      .onChange((event) => {
        'worklet';
        const next = Math.min(maxDelta.value, Math.max(minDelta.value, deltaScale.value * event.scaleChange));
        const factor = next / deltaScale.value;
        if (factor === 1) return;
        deltaTx.value = event.focalX - (event.focalX - deltaTx.value) * factor;
        deltaTy.value = event.focalY - (event.focalY - deltaTy.value) * factor;
        deltaScale.value = next;
      })
      .onEnd(() => {
        'worklet';
        active.value -= 1;
        if (active.value <= 0) {
          active.value = 0;
          runOnJS(onGestureEnd)();
        }
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
    const taps = doubleTapEnabled ? Gesture.Exclusive(doubleTap, singleTap) : singleTap;
    return Gesture.Race(taps, Gesture.Simultaneous(pan, pinch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onGestureEnd, handleTap, handleDoubleTap, doubleTapEnabled]);

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

  // The render region gets a little slack around the content bounds: text bounds are estimated,
  // miter joins can poke past half the stroke width, and cropping either would look like a bug.
  const region = React.useMemo(() => {
    if (!base || !viewport) return null;
    const slack = Math.max(content.width, content.height) * REGION_SLACK;
    return chooseRenderRegion(base, viewport, expandRect(content, slack), { pixelRatio: PixelRatio.get(), ...regionOptions });
  }, [base, viewport, content, regionOptions]);

  // In-SVG decorations cannot fade on the UI thread; their visibility follows the resting camera,
  // so it is re-evaluated whenever a gesture settles.
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

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {base && viewport && region ? (
            <>
              <Backend
                document={document}
                planOptions={planOptions}
                overrides={overrides}
                base={base}
                delta={delta}
                viewport={viewport}
                region={region}
              >
                {svgDecorators}
              </Backend>
              {overlayDecorators.map((target: DecoratorTarget, index) => (
                <OverlayItem
                  key={`o${target.decoratorIndex}-${target.node.id ?? index}`}
                  anchor={target.anchor}
                  targetMinSide={Math.min(target.bbox.width, target.bbox.height)}
                  minTargetSize={target.decorator.minTargetSize}
                  minZoom={target.decorator.minZoom}
                  maxZoom={target.decorator.maxZoom}
                  base={{ scale: baseScale, tx: baseTx, ty: baseTy }}
                  fitScale={fitScale}
                  delta={delta}
                >
                  {target.decorator.render(target.node, target.bbox, index)}
                </OverlayItem>
              ))}
            </>
          ) : null}
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
});
