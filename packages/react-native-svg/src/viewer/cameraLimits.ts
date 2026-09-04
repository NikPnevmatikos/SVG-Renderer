/**
 * Translation range that keeps at least `minVisible` pixels of the content inside the viewport
 * on each axis, for a camera at `scale`. Mirrors `clampCameraToBounds` in svg-core, in a form a
 * decay animation can use as its clamp. Exported as a const because it runs on the UI thread.
 */
export const panRange = (
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  boundsX: number,
  boundsY: number,
  boundsWidth: number,
  boundsHeight: number,
  minVisible: number
): { minTx: number; maxTx: number; minTy: number; maxTy: number } => {
  'worklet';
  const width = boundsWidth * scale;
  const height = boundsHeight * scale;
  const keepX = Math.min(minVisible, width);
  const keepY = Math.min(minVisible, height);
  return {
    minTx: keepX - (boundsX * scale + width),
    maxTx: viewportWidth - keepX - boundsX * scale,
    minTy: keepY - (boundsY * scale + height),
    maxTy: viewportHeight - keepY - boundsY * scale,
  };
};
