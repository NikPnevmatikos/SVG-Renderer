import type {
  DrawUnit,
  GroupNode,
  Paint,
  PathSegment,
  PlanOptions,
  Rect,
  RenderPlan,
  ResolvedStyle,
  ShapeNode,
  SvgDocument,
  SvgNode,
} from '../types';
import { isConformal, isIdentity, scaleFactor } from '../geometry/matrix';
import { pathBBox, shapeToPath, transformPathSegments } from '../geometry/path';
import { expandRect, rectsIntersect, transformRect } from '../geometry/rect';
import { normalizeWinding } from '../geometry/winding';

const MAX_OPEN_RUNS = 64;

interface Candidate {
  node: ShapeNode;
  /** Style signature; equal signatures can share one path. */
  key: string;
  /** Uniform scale of the shape's local transform, applied to stroke metrics when flattening. */
  scale: number;
  /** Shapes that both fill and stroke must not overlap each other inside one path. */
  needsNoOverlap: boolean;
  /** Filled shapes need consistent winding so the nonzero union is exact. */
  normalizeWinding: boolean;
  /** Outline in the parent group's space. */
  path: PathSegment[];
  /** Painted bounds in the parent group's space, stroke band included. */
  box: Rect;
}

interface OpenRun {
  key: string;
  needsNoOverlap: boolean;
  normalizeWinding: boolean;
  items: Candidate[];
  /** Paint order of the first shape; everything painted after it is what later members jump over. */
  slotOrder: number;
  /** Index in `units` where this run will be emitted: the position of its first shape. */
  slot: number;
}

interface PaintedEntry {
  box: Rect;
  order: number;
  /** Style key of the run the shape belongs to, or `null` for shapes outside any run. */
  key: string | null;
}

const SAMPLE_SIZE = 64;
const MAX_CELLS_PER_BOX = 256;
const CROWDED_CELL = 256;
const MAX_REBUILDS = 12;
const CELL_RANGE = 1 << 19;
const CELL_STRIDE = 1 << 20;

/**
 * Everything painted so far in the current region, in a uniform grid, so "does anything
 * painted after X overlap this box" stays cheap for large drawings. The cell size comes from
 * the median shape of the first shapes (a background rect must not dictate it) and halves
 * whenever a cell gets crowded, so distributions the sample missed still end up fast.
 */
class PaintedIndex {
  private readonly entries: PaintedEntry[] = [];
  private cells = new Map<number, PaintedEntry[]>();
  private large: PaintedEntry[] = [];
  private cellSize = 0;
  private rebuilds = 0;

  add(entry: PaintedEntry): void {
    this.entries.push(entry);
    if (this.cellSize === 0) {
      if (this.entries.length >= SAMPLE_SIZE) this.rebuild(this.medianCellSize());
      return;
    }
    if (this.insert(entry) && this.rebuilds < MAX_REBUILDS) this.rebuild(this.cellSize / 2);
  }

  private medianCellSize(): number {
    const sizes = this.entries.map((e) => Math.max(e.box.width, e.box.height)).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 1;
    return Math.max(median * 3, 1e-6);
  }

  private rebuild(cellSize: number): void {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.large = [];
    this.rebuilds++;
    for (const e of this.entries) this.insert(e);
  }

  private range(box: Rect): [number, number, number, number] | null {
    const x0 = Math.floor(box.x / this.cellSize);
    const x1 = Math.floor((box.x + box.width) / this.cellSize);
    const y0 = Math.floor(box.y / this.cellSize);
    const y1 = Math.floor((box.y + box.height) / this.cellSize);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_BOX) return null;
    if (x0 < -CELL_RANGE || x1 >= CELL_RANGE || y0 < -CELL_RANGE || y1 >= CELL_RANGE) return null;
    return [x0, x1, y0, y1];
  }

  /** Insert into the grid; returns true when some cell is now crowded. */
  private insert(entry: PaintedEntry): boolean {
    const range = this.range(entry.box);
    if (!range) {
      this.large.push(entry);
      return false;
    }
    const [x0, x1, y0, y1] = range;
    let crowded = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = (x + CELL_RANGE) * CELL_STRIDE + (y + CELL_RANGE);
        const list = this.cells.get(key);
        if (list) {
          list.push(entry);
          if (list.length > CROWDED_CELL) crowded = true;
        } else {
          this.cells.set(key, [entry]);
        }
      }
    }
    return crowded;
  }

  /** True if any entry intersecting `box` satisfies `predicate`. */
  some(box: Rect, predicate: (entry: PaintedEntry) => boolean): boolean {
    const linear = (list: readonly PaintedEntry[]): boolean =>
      list.some((entry) => rectsIntersect(entry.box, box) && predicate(entry));
    if (this.cellSize === 0) return linear(this.entries);
    if (linear(this.large)) return true;
    const range = this.range(box);
    if (!range) return linear(this.entries);
    const [x0, x1, y0, y1] = range;
    const seen = new Set<PaintedEntry>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells.get((x + CELL_RANGE) * CELL_STRIDE + (y + CELL_RANGE));
        if (!list) continue;
        for (const entry of list) {
          if (seen.has(entry)) continue;
          seen.add(entry);
          if (rectsIntersect(entry.box, box) && predicate(entry)) return true;
        }
      }
    }
    return false;
  }
}

function paintKey(paint: Paint): string | null {
  if (paint.type === 'none') return 'none';
  if (paint.type === 'color') return `c:${paint.value}`;
  return null;
}

function round(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** Bounds of a shape in its parent group's space, grown by the stroke band. */
function paintedBox(node: ShapeNode, path?: PathSegment[]): Rect | null {
  const outline = path ?? (isIdentity(node.transform) ? shapeToPath(node) : transformPathSegments(shapeToPath(node), node.transform));
  const box = pathBBox(outline);
  if (!box) return null;
  if (node.style.stroke.type === 'none') return box;
  const scale = isIdentity(node.transform) ? 1 : scaleFactor(node.transform);
  return expandRect(box, (node.style.strokeWidth / 2) * scale);
}

/**
 * Decide whether a shape can be merged with others of identical paint. Anything whose merged
 * rendering could differ from separate rendering is excluded: translucency (overlaps
 * composite), even-odd fills (overlaps become holes), dashes (patterns restart per subpath
 * differently across renderers), paint servers (bounding-box dependent), clips/masks/filters,
 * non-scaling strokes, and strokes under non-uniform transforms.
 */
function candidate(node: ShapeNode): Candidate | null {
  const s = node.style;
  if (s.clipPath !== undefined || s.mask !== undefined || s.filter !== undefined) return null;
  if (s.opacity !== 1 || s.vectorEffect !== undefined) return null;
  const fill = paintKey(s.fill);
  const stroke = paintKey(s.stroke);
  if (fill === null || stroke === null) return null;
  const hasFill = s.fill.type !== 'none';
  const hasStroke = s.stroke.type !== 'none';
  if (!hasFill && !hasStroke) return null;
  if (hasFill && (s.fillOpacity !== 1 || s.fillRule !== 'nonzero')) return null;
  if (hasStroke && (s.strokeOpacity !== 1 || s.strokeDasharray !== null)) return null;

  const identity = isIdentity(node.transform);
  if (hasStroke && !identity && !isConformal(node.transform)) return null;
  const scale = identity ? 1 : scaleFactor(node.transform);

  const local = shapeToPath(node);
  const path = identity ? local : transformPathSegments(local, node.transform);
  const box = paintedBox(node, path);
  if (!box) return null;

  const parts = [fill];
  if (hasStroke) {
    parts.push(stroke, round(s.strokeWidth * scale), s.strokeLinecap, s.strokeLinejoin, round(s.strokeMiterlimit));
  } else {
    parts.push('none');
  }
  return {
    node,
    key: parts.join('|'),
    scale,
    needsNoOverlap: hasFill && hasStroke,
    normalizeWinding: hasFill,
    path,
    box,
  };
}

function batchStyle(c: Candidate): ResolvedStyle {
  const s = c.node.style;
  const style: ResolvedStyle = { ...s, font: { ...s.font }, strokeDasharray: null };
  if (c.scale !== 1) {
    style.strokeWidth = s.strokeWidth * c.scale;
    style.strokeDashoffset = s.strokeDashoffset * c.scale;
  }
  return style;
}

/**
 * Merges same-styled shapes into batches while keeping the picture identical.
 *
 * Several runs (one per style) stay open at once and each run is emitted at the position of
 * its first shape. Joining a run therefore moves a shape back to that position, which is
 * invisible exactly when nothing painted since the run started overlaps the shape. That
 * question goes to a spatial index of everything painted in the current region. Group
 * boundaries and text close every run.
 */
class Batcher {
  private runs: OpenRun[] = [];
  private painted = new PaintedIndex();
  private order = 0;
  private readonly placeholder: DrawUnit = { kind: 'group-end' };

  constructor(
    private readonly units: DrawUnit[],
    private readonly stats: { batchCount: number; mergedShapes: number }
  ) {}

  /** Something painted at this point outside any run (or with unknown bounds when `null`). */
  paint(box: Rect | null): void {
    if (box === null) {
      this.flushAll();
      return;
    }
    this.painted.add({ box, order: this.order++, key: null });
  }

  add(c: Candidate): void {
    let run = this.runs.find((r) => r.key === c.key);
    if (run) {
      const open = run;
      const blocked = this.painted.some(
        c.box,
        (entry) =>
          (entry.order > open.slotOrder && entry.key !== open.key) ||
          (open.needsNoOverlap && entry.key === open.key && entry.order >= open.slotOrder)
      );
      if (blocked) {
        this.flush(run);
        run = undefined;
      }
    }
    if (!run) {
      const oldest = this.runs[0];
      if (this.runs.length >= MAX_OPEN_RUNS && oldest) this.flush(oldest);
      run = {
        key: c.key,
        needsNoOverlap: c.needsNoOverlap,
        normalizeWinding: c.normalizeWinding,
        items: [],
        slotOrder: this.order,
        slot: this.units.length,
      };
      this.units.push(this.placeholder);
      this.runs.push(run);
    }
    run.items.push(c);
    this.painted.add({ box: c.box, order: this.order++, key: c.key });
  }

  private flush(run: OpenRun): void {
    const index = this.runs.indexOf(run);
    if (index !== -1) this.runs.splice(index, 1);
    const first = run.items[0];
    if (first === undefined) return;
    let unit: DrawUnit;
    if (run.items.length === 1) {
      unit = { kind: 'shape', node: first.node, interactive: false };
    } else {
      let merged: PathSegment[] = [];
      for (const item of run.items) {
        for (const segment of item.path) merged.push(segment);
      }
      if (run.normalizeWinding) merged = normalizeWinding(merged);
      unit = {
        kind: 'batch',
        path: merged,
        style: batchStyle(first),
        bbox: pathBBox(merged),
        sources: run.items.map((item) => item.node),
      };
      this.stats.batchCount++;
      this.stats.mergedShapes += run.items.length;
    }
    this.units[run.slot] = unit;
  }

  /** Close every run and forget what was painted: the next region starts clean. */
  flushAll(): void {
    for (const run of [...this.runs]) this.flush(run);
    this.painted = new PaintedIndex();
    this.order = 0;
  }
}

/**
 * Plan a subtree. The `root` group itself never gets a wrapper; its children are planned in
 * paint order. Used for the document root and for detached groups such as clip paths.
 */
export function planSubtree(root: GroupNode, options: PlanOptions = {}): RenderPlan {
  const units: DrawUnit[] = [];
  const dynamicIds = new Set<string>();
  const stats = { batchCount: 0, mergedShapes: 0 };
  let staticCount = 0;
  const batching = options.batching !== false;
  const isInteractive = options.interactive ?? (() => false);
  const batcher = new Batcher(units, stats);

  const visit = (node: SvgNode): void => {
    if (node.kind !== 'group' && node.style.visibility === 'hidden') return;
    switch (node.kind) {
      case 'group': {
        const style = node.style;
        const needsWrapper =
          node !== root &&
          (style.opacity < 1 ||
            style.clipPath !== undefined ||
            style.mask !== undefined ||
            style.filter !== undefined ||
            !isIdentity(node.transform));
        if (needsWrapper) {
          batcher.flushAll();
          const unit: DrawUnit = { kind: 'group-begin' };
          if (node.id !== undefined) unit.id = node.id;
          if (style.opacity < 1) unit.opacity = style.opacity;
          if (style.clipPath !== undefined) unit.clipPath = style.clipPath;
          if (style.mask !== undefined) unit.mask = style.mask;
          if (style.filter !== undefined) unit.filter = style.filter;
          if (!isIdentity(node.transform)) unit.transform = node.transform;
          units.push(unit);
        }
        for (const child of node.children) visit(child);
        if (needsWrapper) {
          batcher.flushAll();
          units.push({ kind: 'group-end' });
        }
        break;
      }
      case 'shape': {
        const interactive = isInteractive(node);
        if (interactive) {
          if (node.id !== undefined) dynamicIds.add(node.id);
          if (batching) batcher.paint(paintedBox(node));
          units.push({ kind: 'shape', node, interactive: true });
          break;
        }
        staticCount++;
        const c = batching ? candidate(node) : null;
        if (c === null) {
          if (batching) batcher.paint(paintedBox(node));
          units.push({ kind: 'shape', node, interactive: false });
          break;
        }
        batcher.add(c);
        break;
      }
      case 'text':
        batcher.flushAll();
        staticCount++;
        units.push({ kind: 'text', node });
        break;
      case 'image': {
        const box = isIdentity(node.transform) ? node.rect : transformRect(node.rect, node.transform);
        if (batching) batcher.paint(box);
        staticCount++;
        units.push({ kind: 'image', node });
        break;
      }
    }
  };
  visit(root);
  batcher.flushAll();

  return {
    units,
    staticCount,
    dynamicIds,
    batched: batching,
    batchCount: stats.batchCount,
    mergedShapes: stats.mergedShapes,
  };
}

/**
 * Turn the scene graph into an ordered list of draw units for a backend. Static, opaque,
 * same-styled shapes are merged into single paths wherever that cannot change the picture
 * (see `PlanOptions.batching`); groups get a boundary only when they carry opacity, clip,
 * mask, filter or a transform.
 */
export function planDocument(document: SvgDocument, options: PlanOptions = {}): RenderPlan {
  return planSubtree(document.root, options);
}
