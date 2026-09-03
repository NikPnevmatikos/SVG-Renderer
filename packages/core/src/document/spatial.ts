import type { Point, Rect } from '../types';
import { expandRect, rectContainsPoint, rectsIntersect, unionRects } from '../geometry/rect';

interface Entry<T> {
  item: T;
  box: Rect;
  order: number;
}

const MAX_GRID_SIDE = 512;

/**
 * Uniform grid over axis-aligned boxes. Built once per document, it turns "which elements
 * could be under this point" into a handful of candidates even for tens of thousands of shapes.
 */
export class SpatialIndex<T> {
  private readonly entries: Entry<T>[] = [];
  private readonly cells = new Map<number, Entry<T>[]>();
  private readonly bounds: Rect | null;
  private readonly cellSize: number;
  private readonly cols: number;

  constructor(items: readonly { item: T; box: Rect }[]) {
    let bounds: Rect | null = null;
    let area = 0;
    items.forEach(({ item, box }, order) => {
      this.entries.push({ item, box, order });
      bounds = unionRects(bounds, box);
      area += Math.max(box.width, 1e-9) * Math.max(box.height, 1e-9);
    });
    this.bounds = bounds;
    if (!bounds || items.length === 0) {
      this.cellSize = 1;
      this.cols = 1;
      return;
    }
    const b: Rect = bounds;
    const average = Math.sqrt(area / items.length);
    let cellSize = Math.max(average * 2, Math.max(b.width, b.height) / MAX_GRID_SIDE, 1e-6);
    let cols = Math.max(1, Math.ceil(b.width / cellSize));
    if (cols > MAX_GRID_SIDE) {
      cellSize = b.width / MAX_GRID_SIDE;
      cols = MAX_GRID_SIDE;
    }
    this.cellSize = cellSize;
    this.cols = cols;
    for (const entry of this.entries) this.forEachCell(entry.box, (key) => this.push(key, entry));
  }

  get size(): number {
    return this.entries.length;
  }

  private push(key: number, entry: Entry<T>): void {
    const list = this.cells.get(key);
    if (list) list.push(entry);
    else this.cells.set(key, [entry]);
  }

  private cellRange(box: Rect): [number, number, number, number] | null {
    if (!this.bounds) return null;
    const b = this.bounds;
    const x0 = Math.floor((box.x - b.x) / this.cellSize);
    const x1 = Math.floor((box.x + box.width - b.x) / this.cellSize);
    const y0 = Math.floor((box.y - b.y) / this.cellSize);
    const y1 = Math.floor((box.y + box.height - b.y) / this.cellSize);
    const maxRows = Math.max(1, Math.ceil(b.height / this.cellSize));
    return [
      Math.max(0, Math.min(this.cols - 1, x0)),
      Math.max(0, Math.min(this.cols - 1, x1)),
      Math.max(0, Math.min(maxRows, y0)),
      Math.max(0, Math.min(maxRows, y1)),
    ];
  }

  private forEachCell(box: Rect, fn: (key: number) => void): void {
    const range = this.cellRange(box);
    if (!range) return;
    const [x0, x1, y0, y1] = range;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) fn(y * this.cols + x);
    }
  }

  private collect(box: Rect, test: (entry: Entry<T>) => boolean): T[] {
    const seen = new Set<Entry<T>>();
    const hits: Entry<T>[] = [];
    this.forEachCell(box, (key) => {
      const list = this.cells.get(key);
      if (!list) return;
      for (const entry of list) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (test(entry)) hits.push(entry);
      }
    });
    hits.sort((a, b) => a.order - b.order);
    return hits.map((entry) => entry.item);
  }

  /** Items whose box (grown by `tolerance`) contains the point, in insertion order. */
  query(point: Point, tolerance = 0): T[] {
    if (!this.bounds) return [];
    const probe: Rect = { x: point.x - tolerance, y: point.y - tolerance, width: tolerance * 2, height: tolerance * 2 };
    if (!rectsIntersect(expandRect(this.bounds, tolerance + 1e-9), probe) && !rectContainsPoint(expandRect(this.bounds, tolerance), point)) {
      return [];
    }
    return this.collect(probe, (entry) => rectContainsPoint(tolerance > 0 ? expandRect(entry.box, tolerance) : entry.box, point));
  }

  /** Items whose box intersects `rect`, in insertion order. */
  queryRect(rect: Rect): T[] {
    if (!this.bounds) return [];
    return this.collect(rect, (entry) => rectsIntersect(entry.box, rect));
  }
}
