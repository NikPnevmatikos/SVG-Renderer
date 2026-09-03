import type { Matrix, Point, Rect } from '../types';

/**
 * A 2D camera: uniform scale plus translation mapping document (user) units to screen
 * pixels, `screen = user * scale + t`. Backend-neutral; the viewer keeps one of these in
 * shared values and backends apply it as a transform or a matrix.
 */
export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export const IDENTITY_CAMERA: Camera = { scale: 1, tx: 0, ty: 0 };

/** Camera that shows all of `bounds` centered in `viewport` with `padding` pixels around it. */
export function fitCamera(bounds: Rect, viewport: Size, padding = 0): Camera {
  const availableWidth = Math.max(viewport.width - padding * 2, 1e-6);
  const availableHeight = Math.max(viewport.height - padding * 2, 1e-6);
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { scale: 1, tx: viewport.width / 2 - bounds.x, ty: viewport.height / 2 - bounds.y };
  }
  const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  return {
    scale,
    tx: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    ty: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.scale + camera.tx, y: p.y * camera.scale + camera.ty };
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.tx) / camera.scale, y: (p.y - camera.ty) / camera.scale };
}

/** Document-space rectangle currently covering the viewport. */
export function visibleWorldRect(camera: Camera, viewport: Size): Rect {
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: viewport.width, y: viewport.height });
  return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
}

/** Scale by `factor` keeping the screen point `focal` fixed. */
export function zoomCamera(camera: Camera, factor: number, focal: Point): Camera {
  return {
    scale: camera.scale * factor,
    tx: focal.x - (focal.x - camera.tx) * factor,
    ty: focal.y - (focal.y - camera.ty) * factor,
  };
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, tx: camera.tx + dx, ty: camera.ty + dy };
}

/** Clamp the scale into `[min, max]`, zooming about `focal` so that point stays put. */
export function clampCameraScale(camera: Camera, min: number, max: number, focal: Point): Camera {
  const scale = Math.min(max, Math.max(min, camera.scale));
  if (scale === camera.scale) return camera;
  return zoomCamera(camera, scale / camera.scale, focal);
}

/**
 * Keep at least `minVisible` pixels of `bounds` inside the viewport on each axis, so content
 * can be pushed towards an edge but never lost off-screen entirely.
 */
export function clampCameraToBounds(camera: Camera, viewport: Size, bounds: Rect, minVisible = 48): Camera {
  const left = bounds.x * camera.scale + camera.tx;
  const top = bounds.y * camera.scale + camera.ty;
  const width = bounds.width * camera.scale;
  const height = bounds.height * camera.scale;
  const keepX = Math.min(minVisible, width);
  const keepY = Math.min(minVisible, height);
  let tx = camera.tx;
  let ty = camera.ty;
  if (left + width < keepX) tx += keepX - (left + width);
  else if (left > viewport.width - keepX) tx -= left - (viewport.width - keepX);
  if (top + height < keepY) ty += keepY - (top + height);
  else if (top > viewport.height - keepY) ty -= top - (viewport.height - keepY);
  return { scale: camera.scale, tx, ty };
}

/** `delta` applied after `base`: `screen = delta(base(user))`. */
export function composeCamera(base: Camera, delta: Camera): Camera {
  return {
    scale: delta.scale * base.scale,
    tx: delta.scale * base.tx + delta.tx,
    ty: delta.scale * base.ty + delta.ty,
  };
}

/** The `delta` such that `composeCamera(from, delta)` equals `to`. */
export function relativeCamera(from: Camera, to: Camera): Camera {
  const scale = to.scale / from.scale;
  return { scale, tx: to.tx - scale * from.tx, ty: to.ty - scale * from.ty };
}

export function cameraToMatrix(camera: Camera): Matrix {
  return [camera.scale, 0, 0, camera.scale, camera.tx, camera.ty];
}

export function camerasEqual(a: Camera, b: Camera, epsilon = 1e-9): boolean {
  return Math.abs(a.scale - b.scale) < epsilon && Math.abs(a.tx - b.tx) < epsilon && Math.abs(a.ty - b.ty) < epsilon;
}

/** Where a backend should draw: a document-space `viewBox` placed at `x, y` with `width × height` screen pixels. */
export interface RenderRegion {
  viewBox: Rect;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderRegionOptions {
  /** Upper bound on rendered pixels (width × height × pixelRatio²) before falling back to the viewport region. Default 8 million. */
  maxPixels?: number;
  /** How much larger than the viewport the fallback region is, so small pans stay filled. Default 1.5. */
  overscan?: number;
  /** Device pixel ratio used for the pixel budget. Default 1. */
  pixelRatio?: number;
}

/**
 * Pick what a rasterizing backend renders for the current camera: the whole content when it
 * fits the pixel budget (panning never reveals blank areas), otherwise a viewport-sized region
 * with overscan (bounded memory at any zoom level).
 */
export function chooseRenderRegion(camera: Camera, viewport: Size, content: Rect, options: RenderRegionOptions = {}): RenderRegion {
  const pixelRatio = options.pixelRatio ?? 1;
  const maxPixels = options.maxPixels ?? 8_000_000;
  const overscan = options.overscan ?? 1.5;
  const fullWidth = content.width * camera.scale;
  const fullHeight = content.height * camera.scale;
  if (fullWidth * fullHeight * pixelRatio * pixelRatio <= maxPixels) {
    return {
      viewBox: content,
      x: camera.tx + content.x * camera.scale,
      y: camera.ty + content.y * camera.scale,
      width: fullWidth,
      height: fullHeight,
    };
  }
  const width = viewport.width * overscan;
  const height = viewport.height * overscan;
  const x = (viewport.width - width) / 2;
  const y = (viewport.height - height) / 2;
  const topLeft = screenToWorld(camera, { x, y });
  return {
    viewBox: { x: topLeft.x, y: topLeft.y, width: width / camera.scale, height: height / camera.scale },
    x,
    y,
    width,
    height,
  };
}
