/**
 * Opacity of a decoration for the current camera.
 *
 * `scale` is the camera scale (screen pixels per document unit), `fitScale` the scale of the
 * initial fit, `targetMinSide` the smaller side of the decorated element's world bounding box.
 * Returns 0 while the zoom (relative to the initial fit) is outside `[minZoom, maxZoom]` or the
 * element is drawn smaller than `minTargetSize` pixels, 1 when fully visible, and a value in
 * between while the element grows through the last 20% below `minTargetSize`, so labels fade in
 * instead of popping. Runs on the UI thread inside animated styles, hence the worklet directive.
 *
 * Declared as an exported const on purpose: the worklets babel plugin rewrites a workletized
 * function declaration into a `const`, and the hoisted `exports.x = x` that TypeScript emits for
 * `export function` would then run before that const is initialized.
 */
export const decoratorOpacity = (
  scale: number,
  fitScale: number,
  targetMinSide: number,
  minTargetSize: number | undefined,
  minZoom: number | undefined,
  maxZoom: number | undefined
): number => {
  'worklet';
  const zoom = fitScale > 0 ? scale / fitScale : 1;
  if (minZoom !== undefined && zoom < minZoom) return 0;
  if (maxZoom !== undefined && zoom > maxZoom) return 0;
  if (minTargetSize !== undefined && minTargetSize > 0) {
    const size = targetMinSide * scale;
    const fadeStart = minTargetSize * 0.8;
    if (size <= fadeStart) return 0;
    if (size >= minTargetSize) return 1;
    return (size - fadeStart) / (minTargetSize - fadeStart);
  }
  return 1;
};
