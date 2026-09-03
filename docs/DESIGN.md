# SVG Renderer for React Native — Design Document

Status: draft v2 · Date: 2026-09-02 · Owner: Nik Pnevmatikos

A general-purpose, standalone SVG library for React Native, published on npm under
`@nikpnevmatikos`. This document captures the plan and the reasoning behind it. It is
meant to be edited as decisions evolve.

---

## 1. Purpose and positioning

**One sentence:** render any real-world SVG in React Native correctly, fast, and
interactively — designer exports included — and give the app a queryable model of the
document (ids, geometry, hit testing) instead of an opaque picture.

**Driving use cases**

- Interactive floor plans, venue and seat maps: tap a region, highlight it, zoom to it.
- Technical drawings and diagrams with thousands of tiny strokes.
- Illustrations and icons exported from design tools, loaded at runtime from an API or CMS.
- Data-driven maps and charts where regions are styled from application state.

**What it is**

- A pure TypeScript SVG *parser and normalizer* that turns messy real-world SVG
  (Illustrator, Inkscape, Figma, Affinity, draw.io, CAD exports) into a clean, typed
  scene graph with the CSS cascade already applied.
- A *render planner* that turns the scene graph into a small number of draw units so the
  cost of a document no longer grows with its element count.
- A *geometry engine*: bounding boxes for every element, precise hit testing, spatial
  indexing, coordinate mapping.
- Pluggable *render backends*: `react-native-svg` and Skia; web later.
- A *viewer*: pan/zoom camera that runs on the UI thread, fit-to-element, per-element
  style overrides, decorators (badges, labels) anchored to elements, presses resolved in
  SVG space.

**What it is not**

- Not a replacement for `react-native-svg` or Skia as drawing primitives. We build on them.
- Not an SVG editor.
- Not an animation runtime (no SMIL, no scripting).

---

## 2. Design principles

1. **Correct on real files.** The test corpus is made of exports from real tools, not
   hand-written ideal SVG.
2. **Performance is a release criterion.** Every release runs the benchmark suite; budgets
   in §9 must hold. Rendering cost must scale with *distinct paint styles*, not with
   element count.
3. **Backend independence.** All intelligence lives in the core. Backends are thin
   adapters that draw a render plan.
4. **Zero native code in the core.** The core runs on React Native, web and Node, so the
   same normalizer can run server-side or at build time.
5. **Nothing silently dropped.** Unsupported features are reported on the document and by
   the CLI.
6. **Standalone.** No company- or product-specific code, naming, fixtures or docs in this
   repository.

---

## 3. Decisions log

| # | Date | Decision | Rationale |
|---|------|----------|-----------|
| D1 | 2026-09-02 | Backend-agnostic core with two first-class backends: `react-native-svg` (zero extra native dependencies) and Skia (scale and crisp zoom). | Most apps already ship `react-native-svg`; Skia is the path to very large documents. Timing of the Skia adapter: see open question 2. |
| D2 | 2026-09-02 | Inputs: raw SVG string, URL, pre-parsed document, and a generic JSON element tree (svgson-style or custom field mapping). | Apps that pre-parse SVG on a server can adopt the library without changing their API first. |
| D3 | 2026-09-02 | v1 commits to a **static profile** (§8). Filters, masks, patterns, markers pass through to the backend untested. | SVG is enormous; a declared profile keeps v1 shippable and honest. |
| D4 | 2026-09-02 | Monorepo under `@nikpnevmatikos/*`, mirroring Html-Renderer (npm workspaces, tsc, jest, Expo example app, GitHub Actions). | Familiar tooling and release flow. |
| D5 | 2026-09-02 | The project is standalone open source. No product-specific references, fixtures or adapters. | Serves the whole community; avoids biasing the API toward one consumer. |
| D6 | 2026-09-02 | Performance-first rendering: static content is batched by paint style into few draw units; the camera runs on the UI thread; hit testing runs in JS over a spatial index; benchmarks gate releases. | The problem this library exists to solve is that per-element rendering makes phones lag past a few hundred elements. |

---

## 4. Problem statement

### 4.1 Designer exports do not render

Real SVG files use `<style>` blocks and classes (the default in Illustrator's modern
export), `<use>` and `<symbol>`, nested transforms, physical units, editor namespaces and
entity-encoded text. Rendering them element-by-element without applying the cascade
produces wrong paint or nothing at all. Teams respond by demanding "clean" SVG from
designers, which does not scale.

### 4.2 Interactive SVG needs geometry

Tapping a region, highlighting it, or zooming to it requires bounding boxes and hit
testing for *any* shape — polygons, paths, groups with transforms — not just rectangles.
No React Native SVG library exposes this, so apps hand-roll fragile math on `x/y/width/
height` and add duplicate transparent tap layers.

### 4.3 One native view per element does not scale

`react-native-svg` creates a native view (shadow node plus platform view) per element.
A modest floor plan has around a thousand elements; technical drawings have tens of
thousands. Mount time, memory and every React reconciliation grow linearly with element
count. Apps end up with "rendering…" delays, never-re-render memo tricks and jank on
mid-range Android devices.

### 4.4 Zoom is blurry or slow

Pan/zoom implemented as a view transform scales a rasterized layer (blurry on iOS until a
re-render) or forces a full redraw of every element per frame (slow on Android). Neither
is acceptable for maps.

**Key observation:** in the drawings that cause the pain, a thousand elements typically
share a handful of paint styles. Merging same-styled shapes into one path turns a
thousand native views into a few dozen, with no visual difference. That is the core
performance idea of this library (§6.5).

---

## 5. Landscape (as known in mid-2026; verify before publishing comparisons)

| Option | Strengths | Gaps for our needs |
|---|---|---|
| `react-native-svg` `SvgXml` | Standard, broad element support, web via `react-native-svg-web`. | Only inline `style=""` is parsed; `<style>` blocks and classes are ignored. One native view per element. No geometry/query API, no pan/zoom. |
| `react-native-svg` `SvgCss` (`react-native-svg/css`) | Inlines `<style>` rules via `css-tree` + `css-select` with specificity ordering and CSS variables. | Drops media queries and pseudo-classes; still one native view per element; no geometry API; no viewer. Apps that pre-parse SVG on a server cannot use it at all. |
| `@shopify/react-native-skia` `ImageSVG` | Very fast, single draw call, vector-crisp at any zoom. | Skia's SVG module has no stylesheet support and no per-element interaction; text needs fonts wired manually; adds a native dependency; web needs CanvasKit. |
| `react-native-svg-transformer` / SVGR | Build-time, great for static icons. | Not runtime; no dynamic documents from an API. |
| `expo-image` (SVG decoding) | Simple static rendering. | Raster output, no interaction, no geometry. |
| WebView with the browser's SVG engine | Perfect fidelity. | Heavy, bridge latency for interaction, non-native feel, no geometry API. |
| `usvg` / `resvg` (Rust) | The reference model for SVG normalization. | Not React Native; used here as a *reference renderer* in tests. |

**Differentiation:** normalization to a queryable scene graph, style batching, geometry
and hit testing, backend independence, a viewer/interaction layer, and a conformance suite
across editor dialects. We do not compete on drawing primitives.

---

## 6. Architecture

```
                 +--------------------------------------------------------------+
  input          |  svg-core (pure TS, zero runtime deps, runs on RN / web / Node)|
  -------------> |  parse XML -> DOM-lite -> CSS cascade -> normalize -> Scene   |
  string / URL / |  render planner: style batching -> DrawUnit[]                  |
  JSON tree /    |  geometry: bbox . hit test . spatial index . path math         |
  IR JSON        +---------------+---------------------------+------------------+
                                 | RenderPlan + Scene        | RenderPlan + Scene
                     +-----------v-----------+   +-----------v------------+
                     | backend: react-native- |   | backend: skia          |
                     | svg (few Path nodes)   |   | (Picture + matrix)     |
                     +-----------+-----------+   +-----------+------------+
                                 +-----------+---------------+
                                 +-----------v----------------------------+
                                 | viewer: UI-thread camera (pan/zoom),    |
                                 | fitTo*, presses in SVG space, style     |
                                 | overrides, decorators, document API     |
                                 +----------------------------------------+
```

### 6.1 Packages

| Directory | npm name | Contents | Peer deps |
|---|---|---|---|
| `packages/core` | `@nikpnevmatikos/svg-core` | Parser, CSS cascade, normalizer, scene graph, render planner, geometry, input adapters, CLI. **Zero runtime dependencies.** | none |
| `packages/react-native-svg` | `@nikpnevmatikos/svg-renderer` | The main RN package: `<SvgRenderer>` on top of `react-native-svg`, draws render plans, style overrides, static/dynamic split. Re-exports core. | `react`, `react-native`, `react-native-svg` |
| `packages/viewer` | `@nikpnevmatikos/svg-renderer-viewer` | `<SvgViewer>`: camera, gestures, fit-to-element, decorators, hit testing wiring. Backend-agnostic. | `react-native-gesture-handler`, `react-native-reanimated` |
| `packages/skia` | `@nikpnevmatikos/svg-renderer-skia` | Skia backend: draw units to Skia paths, picture baking, camera matrix on the UI thread. | `@shopify/react-native-skia` |
| `example` | private | Expo app: fixture gallery, floor-plan demo, benchmarks screen comparing backends. | — |

Naming follows the Html-Renderer pattern (`html-renderer`, `html-renderer-video`).

### 6.2 Input adapters

```ts
type SvgSource =
  | { xml: string }                                   // raw SVG text
  | { uri: string; fetch?: typeof fetch }             // fetched with the given fetcher
  | { json: JsonElementTree; mapping?: JsonMapping }  // svgson-style {name, attributes, children} or custom field names
  | { document: SvgDocument };                        // already parsed (cache, server-side normalization)
```

The JSON adapter rebuilds an XML-equivalent DOM so the same cascade and normalization run
on it. Extra per-element fields the app attached (any key not in the mapping) are surfaced
as `node.data`.

### 6.3 Parsing and the CSS cascade

Own XML tokenizer (no dependency): elements, attributes, text, CDATA, comments, entities
(`&amp; &lt; &gt; &quot; &apos; &#NNN; &#xHH;`), namespaces. Editor namespaces
(`inkscape:`, `sodipodi:`, `i:`, `x:`, `sketch:`) are dropped. `xlink:href` becomes `href`.

Cascade order, lowest to highest: UA defaults, presentation attributes, `<style>` rules by
specificity then source order, inline `style=""`, `!important`. Inheritable properties
inherit; `inherit` and `currentColor` resolve; CSS custom properties (`--x`) resolve within
the document. Selectors supported: type, class, id, attribute, `*`, descendant, child,
adjacent/general sibling, selector lists. Media queries, pseudo-classes and pseudo-elements
are ignored with a warning collected on the document.

### 6.4 Normalization passes (in order)

1. Strip unknown namespaces, comments, `<metadata>`; keep `<title>`/`<desc>` on the node.
2. Resolve `<defs>`, gradients, clipPaths, masks, patterns, markers, filters into a defs table keyed by id.
3. Expand `<use>` into a cloned subtree with the referenced element's own transform composed; `<symbol>` becomes a group with its viewBox mapping; cycle detection.
4. Resolve units (`px pt pc mm cm in %` and `em`/`rem` relative to font size / root) into user units.
5. Parse `transform` lists into matrices (kept per node; world matrices computed lazily).
6. Apply the cascade to produce a `ResolvedStyle` per node; drop `display:none` subtrees; keep `visibility:hidden` (affects hit testing).
7. Normalize shapes: `rect/circle/ellipse/line/polyline/polygon/path` stay typed, each with `toPath()`; path data parsed to absolute segments (M L C Q A Z; H/V/S/T and relative forms converted).
8. Compute bounding boxes lazily with a cache; build the spatial index on demand.
9. Compute `document.contentBounds` (union of rendered bboxes) so fit-to-content works even when the viewBox is wrong.
10. Discard the DOM-lite; only the scene graph is retained.

### 6.5 Render planner and style batching

The planner converts the scene graph into an ordered list of **draw units**. Its goal is
that the number of things a backend must create is proportional to the number of distinct
paint styles, not to the number of elements.

```ts
type DrawUnit =
  | { kind: 'batch'; path: PathSegment[]; style: ResolvedStyle; bbox: Rect; sources: SvgNode[] }
  | { kind: 'shape'; node: ShapeNode }                    // kept individual (interactive / overridden)
  | { kind: 'text'; node: TextNode }
  | { kind: 'image'; node: ImageNode }
  | { kind: 'group-begin'; opacity?: number; clipPath?: string; mask?: string; transform?: Matrix }
  | { kind: 'group-end' };

interface RenderPlan { units: DrawUnit[]; staticCount: number; dynamicIds: Set<string> }
```

Batching rules:

- A batch merges **consecutive shapes in paint order** whose resolved style is identical
  (fill, fill-opacity, fill-rule, stroke paint, width, caps, joins, miter, dash, opacity,
  visibility, clip/mask/filter references). Paint order is always preserved, so batching
  never changes the picture.
- Geometry is flattened into the coordinate space of the nearest retained group by
  applying world matrices to path segments. Stroke widths are multiplied by the matrix's
  uniform scale. Shapes under non-uniform scale or skew are not flattened (they stay in
  their transformed group) unless `vector-effect` says otherwise.
- **Interactive nodes** (those the app marked via `interactive`) and nodes currently
  targeted by a style override are emitted as individual `shape` units so they can be
  restyled and receive press feedback without re-batching their neighbours. Everything
  else is static.
- Text and images are never batched. Groups with `opacity < 1`, `clip-path` or `mask`
  become `group-begin`/`group-end` boundaries; batching happens inside them.
- Batches carry their source nodes so hit testing, debugging and the `inspect` CLI can map
  a drawn unit back to elements.

Expected effect on typical CAD-style drawings: hundreds or thousands of hairline strokes
sharing a few colours collapse into a few dozen draw units. Both backends benefit: fewer
native views for `react-native-svg`, fewer paths to record into a picture for Skia.

Shapes of the same style need not be adjacent. Several runs stay open at once and each run is
emitted at the position of its first shape; a shape joins its style's run only if nothing
painted since that run started overlaps it, which a spatial index of painted bounds answers
cheaply. Interleaved grids (Illustrator exports alternate styles constantly) therefore still
collapse to one path per style, with paint order provably unchanged.

### 6.6 Scene graph (IR) sketch

```ts
type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
interface Rect { x: number; y: number; width: number; height: number }

interface SvgDocument {
  viewBox: Rect | null;
  width?: number; height?: number;          // user units after unit resolution
  preserveAspectRatio: { align: string; meetOrSlice: 'meet' | 'slice' };
  root: GroupNode;
  defs: DefsTable;                          // gradients, clipPaths, masks, patterns, markers, filters
  contentBounds: Rect;
  warnings: SvgWarning[];                   // unsupported features, dropped rules, bad refs
  getElementById(id: string): SvgNode | undefined;
  querySelectorAll(selector: string): SvgNode[];
  elementsAt(point: { x: number; y: number }, opts?: HitTestOptions): SvgNode[]; // topmost first
  plan(options?: PlanOptions): RenderPlan;  // cached per options
}

type SvgNode = GroupNode | ShapeNode | TextNode | ImageNode;

interface NodeBase {
  id?: string; classes: string[]; tag: string;
  transform: Matrix;                        // local
  style: ResolvedStyle;
  attrs: Readonly<Record<string, string>>; // original attributes, for passthrough/debug
  data?: unknown;                           // app-attached data
  parent: GroupNode | null;
  getBBox(space?: 'local' | 'world'): Rect;
  worldMatrix(): Matrix;
}
interface GroupNode extends NodeBase { kind: 'group'; children: SvgNode[] }
interface ShapeNode extends NodeBase {
  kind: 'shape';
  shape: 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'path';
  params: RectParams | CircleParams | EllipseParams | LineParams | PointsParams | PathParams;
  toPath(): PathSegment[];
  containsPoint(p: Point, opts?: { includeStroke?: boolean }): boolean;
}
interface TextNode extends NodeBase { kind: 'text'; runs: TextRun[] } // tspans flattened with resolved styles
interface ImageNode extends NodeBase { kind: 'image'; href: string; rect: Rect }

interface ResolvedStyle {
  fill: Paint; fillOpacity: number; fillRule: 'nonzero' | 'evenodd';
  stroke: Paint; strokeWidth: number; strokeOpacity: number;
  strokeLinecap: 'butt' | 'round' | 'square'; strokeLinejoin: 'miter' | 'round' | 'bevel';
  strokeMiterlimit: number; strokeDasharray: number[] | null; strokeDashoffset: number;
  opacity: number; visibility: 'visible' | 'hidden';
  clipPath?: string; mask?: string; filter?: string;     // ids; mask/filter are passthrough in v1
  color: string;                                         // for currentColor
  font: {
    family: string[]; size: number; weight: string | number; style: string;
    textAnchor: 'start' | 'middle' | 'end'; letterSpacing?: number;
  };
  vectorEffect?: 'non-scaling-stroke';
}
type Paint =
  | { type: 'none' }
  | { type: 'color'; value: string }
  | { type: 'ref'; id: string; fallback?: string };
```

The IR and the render plan are JSON-serializable (`serialize` / `deserialize`), which
enables server-side or build-time normalization and caching.

### 6.7 Interaction model (backend-independent)

- **Which elements are interactive:** the `interactive` prop accepts a CSS selector, a
  predicate `(node) => boolean`, or a record of `id -> data`. Matching nodes get `node.data`
  and are planned as individual units.
- **Hit testing happens in SVG user space, in JS:** screen point, camera inverse,
  `document.elementsAt(point)` (spatial index candidates, then precise containment honoring
  fill rule and optional stroke width), topmost hit, then walk up to the nearest interactive
  ancestor. Identical behavior on every backend; no duplicate transparent tap layer.
- **Style overrides:** `elementStyles={{ [idOrSelector]: Partial<ResolvedStyle> }}`
  re-plan only the affected units (dynamic layer).
- **Decorators:** `decorators=[{ match, anchor: 'center' | 'bbox', layer: 'svg' | 'overlay', render }]`
  render badges/labels at element geometry either inside the SVG (scales with zoom) or as
  native overlay views positioned through the camera (crisp, pressable, fixed size).
- **Imperative API** via ref: `fitToElement(id, { padding, animated })`, `fitToBounds(rect)`,
  `fitToContent()`, `zoomTo(scale, focalPoint)`, `getCamera()`, `svgToScreen(p)`, `screenToSvg(p)`.

### 6.8 Camera

The camera is three reanimated shared values (`scale`, `tx`, `ty`) owned by the viewer.
Gestures update them on the UI thread; no JavaScript runs per frame. Backends consume the
camera as a transform:

- `react-native-svg`: the transform is applied to the wrapping animated view during a
  gesture (GPU composited). When the gesture settles, the backend re-renders the visible
  region at device resolution so zoomed content is crisp. Because the static layer is a few
  dozen paths, this settle re-render is cheap.
- Skia: the static layer is recorded once into an `SkPicture`; each frame draws the picture
  with the camera matrix, so zoom is vector-crisp at all times.

### 6.9 Backend contract

```ts
interface BackendProps {
  document: SvgDocument;
  plan: RenderPlan;                 // from document.plan(options)
  overrides?: StyleOverrides;
  camera?: SharedCamera;            // reanimated shared values
  onLayout?: (layout: { width: number; height: number }) => void;
  renderOptions?: { cullOutside?: Rect; lod?: LodPolicy };
}
```

A backend draws `plan.units` in order. It never walks the scene graph itself, never parses
styles, and never does hit testing.

---

## 7. Public API sketch

```tsx
import { SvgRenderer } from '@nikpnevmatikos/svg-renderer';            // static rendering
import { SvgViewer, type SvgViewerRef } from '@nikpnevmatikos/svg-renderer-viewer';
import { parseSvg } from '@nikpnevmatikos/svg-core';

// 1. Simple: any SVG string, rendered correctly
<SvgRenderer source={{ xml }} width="100%" height={240} />

// 2. Interactive floor plan
const doc = useMemo(() => parseSvg(xml), [xml]);
const viewer = useRef<SvgViewerRef>(null);

<SvgViewer
  ref={viewer}
  document={doc}
  backend="react-native-svg"                 // or "skia", or a backend component
  minScale={0.5} maxScale={8} initialFit="content"
  interactive={regionsById}                  // id -> app data, becomes node.data
  onElementPress={({ node, data }) => openRegion(data)}
  elementStyles={{ [selectedId]: { fill: { type: 'color', value: '#42f5ad' }, fillOpacity: 0.3 } }}
  decorators={[{
    match: (n) => !!n.data,
    anchor: 'center',
    layer: 'svg',
    render: (n, bbox) => <Badge label={n.data.label} bbox={bbox} />,
  }]}
/>

viewer.current?.fitToElement(selectedId, { padding: 24, animated: true });
```

Node/CLI:

```
npx @nikpnevmatikos/svg-core inspect drawing.svg                    # ids, element counts, warnings, unsupported features
npx @nikpnevmatikos/svg-core inspect drawing.svg --ids regions.json # verify every expected id exists
npx @nikpnevmatikos/svg-core plan drawing.svg                       # draw-unit count and batching report
npx @nikpnevmatikos/svg-core normalize drawing.svg -o drawing.ir.json
```

---

## 8. Supported profile — v1

| Area | v1 status |
|---|---|
| `svg`, `g`, `defs`, `use`, `symbol`, `title`, `desc` | Supported |
| `rect` (incl. rx/ry), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` (all commands incl. arcs) | Supported |
| `transform` lists (matrix, translate, scale, rotate, skewX/Y), nested groups | Supported |
| Presentation attributes, inline `style`, `<style>` stylesheets, classes, ids, `inherit`, `currentColor`, custom properties | Supported |
| `linearGradient`, `radialGradient` (units, spread, gradientTransform, stops) | Supported |
| `clipPath` | Supported |
| `text`, `tspan` (single-line runs, x/y/dx/dy, text-anchor, font family/size/weight/style, letter-spacing) | Supported, best effort for fonts |
| `image` (data URI and URL, preserveAspectRatio) | Supported |
| Units `px pt pc mm cm in %`, `em`/`rem` (relative to font size) | Supported |
| `opacity`, `visibility`, `display`, `fill-rule`, dash arrays, line caps/joins, `vector-effect` | Supported |
| `mask`, `pattern`, `marker`, `filter` | Passthrough to backend, untested; warning emitted |
| `textPath`, multi-line text layout, `foreignObject`, `switch`, `a` | Out of scope for v1 |
| SMIL animation, scripting, external stylesheets/fonts, `@import`, `@media` | Out of scope |

Anything unsupported is *reported*, never silently dropped: `document.warnings` and the
`inspect` CLI list them.

---

## 9. Performance

### 9.1 Budgets (targets on a mid-range Android device under Hermes; to be measured, not assumed)

| Tier | Typical document | Parse + normalize + plan | First paint | Pan/zoom | Selection change |
|---|---|---|---|---|---|
| Icon | < 200 elements, < 20 KB | < 5 ms | < 16 ms | n/a | n/a |
| Medium | ~1,000 elements, ~150 KB (floor plan) | < 50 ms | < 100 ms | 60 fps | < 16 ms JS |
| Large | ~10,000 elements, ~1.5 MB (technical drawing) | < 300 ms (async, yielding) | < 500 ms RNSVG · < 200 ms Skia | 60 fps | < 16 ms JS |
| Huge | 50,000+ elements | < 1.5 s (async) | Skia only | 60 fps | < 16 ms JS |

Memory: at most one retained copy of the document (scene graph plus plan); the DOM-lite is
discarded after normalization.

### 9.2 Techniques

- **Style batching** (§6.5): the main lever. Element count stops mattering.
- **Static/dynamic split**: the static plan renders once; selection, overrides and
  decorators live in a small dynamic layer.
- **UI-thread camera** (§6.8): no JavaScript per frame during gestures.
- **Async parsing**: `parseAsync` yields between passes so the JS thread stays responsive
  on large files; documents are cached by content hash; the IR can be pre-normalized on a
  server or at build time.
- **Culling and level of detail** for large documents: the spatial index drops units
  outside the viewport (with hysteresis) and hides hairline strokes below a scale threshold.
- **Skia picture baking** for large and huge tiers; tiled rasterization as a later option.

### 9.3 Benchmarks in the repository

Synthetic fixtures at 1k / 10k / 50k elements plus real-tool exports. In CI (Node): parse,
normalize and plan timings with regression thresholds, and draw-unit counts per fixture.
In the example app: a benchmarks screen reporting parse time, first paint, frame drops
during a scripted pan/zoom, and memory, for each backend side by side.

---

## 10. Reference use case: interactive floor plan

How an app wires a venue map with this library:

1. Fetch the SVG (or a pre-normalized IR) and a map of `elementId -> region data`
   (name, number, description, whatever the app needs).
2. `parseSvg(xml)` once; pass `interactive={regionsById}` so those nodes carry `data`
   and are planned as individual units.
3. Render `<SvgViewer>` with `initialFit="content"` — no dependency on the file's viewBox
   being right.
4. `onElementPress` receives the region's data; the app opens its detail view.
5. Highlight the selected region via `elementStyles`; add number badges with a `decorators`
   entry anchored at each region's center; call `fitToElement` from a search picker.
6. Validate uploads with `inspect --ids regions.json` so every region id exists in the file.

Everything above uses generic APIs; nothing in the library knows what a "room" is.

---

## 11. Testing and quality

- **Unit tests** (jest, ts-jest) for tokenizer, CSS parser and cascade, unit resolution,
  transforms, path parsing, bbox math, hit testing, `use` expansion, planner, input adapters.
- **Round-trip conformance without devices:** normalize a fixture, serialize the IR back
  to plain presentation-attribute SVG, render both the original and the round-tripped file
  with a reference renderer (`@resvg/resvg-js`, dev-only), compare pixels within tolerance.
  Do the same for the *planned* output (batched paths) to prove batching is invisible.
- **Backend snapshot tests** with `react-test-renderer`: plan to expected `react-native-svg`
  element tree.
- **Fixture corpus by editor:** Illustrator (classic and CSS-class export), Inkscape,
  Figma, Affinity, draw.io, hand-written, plus open-licensed SVGs. Only synthetic and
  open-licensed files are committed; third-party or client-owned drawings never are.
- **Performance regression tests** in CI (Node) for parse/plan timings and unit counts.
- **Device smoke tests** via the example app on iOS and Android before each release.
- **CI:** Node 20/22 matrix, then build, typecheck, test, typecheck example.

---

## 12. Repository layout and tooling

```
SVG-Renderer/
├─ package.json            # private, npm workspaces: packages/*, example
├─ tsconfig.base.json
├─ .github/workflows/ci.yml
├─ docs/DESIGN.md          # this file
├─ packages/
│  ├─ core/                # @nikpnevmatikos/svg-core
│  ├─ react-native-svg/    # @nikpnevmatikos/svg-renderer
│  ├─ viewer/              # @nikpnevmatikos/svg-renderer-viewer
│  └─ skia/                # @nikpnevmatikos/svg-renderer-skia
├─ fixtures/               # synthetic + open-licensed corpus
├─ benchmarks/             # Node perf tests and fixture generators
└─ example/                # Expo app: gallery, floor-plan demo, benchmarks
```

Community files as in Html-Renderer: `LICENSE` (MIT), `README.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.editorconfig`, `.nvmrc`.

Targets (to confirm at implementation time): React >= 18, React Native >= 0.73,
`react-native-svg` >= 15, `@shopify/react-native-skia` current major, gesture-handler >= 2,
reanimated >= 3, TypeScript 5, Node 20/22. `sideEffects: false`, ESM-friendly `dist`.

Release flow: manual semver per package as in Html-Renderer; consider Changesets once more
than one package changes per release.

---

## 13. Roadmap and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Foundation** — *scaffold done 2026-09-02* | Monorepo scaffold, CI, example app, this document, fixture generators. Shipped with a thin vertical slice of the core (tokenizer, geometry, presentation-attribute cascade, builder, pass-through planner) so the pipeline runs end to end. | `npm test` green; example renders a hard-coded SVG through the RNSVG backend on both platforms. *Status: tests green, verified on web and on iPhone via Expo Go; Android still to be checked.* |
| **P1 Core** — *done 2026-09-02* | Tokenizer, CSS cascade, normalization passes, geometry, planner with style batching, IR (de)serialization, CLI, round-trip harness, fixture corpus v1, Node perf tests. | All fixtures round-trip within tolerance, batched and unbatched; a 1k-element CSS-class export plans to under 50 draw units; medium-tier parse budget met. *Status: all eight synthetic fixtures pass the resvg round-trip both normalized and batched; the 1k grid plans to 8 units; 1k/10k/50k grids parse in 5/21/72 ms and plan in 3/38/191 ms on desktop Node.* |
| **P2 Backends + viewer** | RNSVG adapter, Skia adapter (recommended in this phase, see open question 2), camera, presses in SVG space, overrides, decorators, fit-to-element, benchmarks screen. | Medium tier meets all budgets on both backends; large tier meets budgets on Skia. |
| **P3 First production integration** | Dogfood in a real app with a floor-plan use case; fix what reality finds. | Shipped in production; no app-side SVG rendering code left. |
| **P4 Scale** | Culling/LOD, picture/tile caching, async parsing polish, web backend decision. | Large tier meets budgets on RNSVG; huge tier usable on Skia. |
| **P5 1.0** | Docs, API freeze, contribution guide, issue templates, published benchmarks. | Semver 1.0 on npm for core, renderer, viewer, skia. |

---

## 14. Open questions

1. Core package name: `svg-core` vs `svg-renderer-core`.
2. Skia adapter timing: in P2 alongside RNSVG (recommended, since performance is the
   reason the project exists and the adapter is thin once the planner exists) or in P4.
3. Text on Skia: how fonts are provided (system font manager vs `useFonts`), and whether
   the viewer should offer a "text as overlay views" mode for guaranteed legibility.
4. Web backend priority: DOM emission vs `react-native-svg-web` passthrough.
5. Minimum React Native / Expo SDK to support at 1.0.
6. Huge-tier strategy: picture playback vs tiled rasterization vs both.

## 15. Non-goals

Editing SVGs, animation, full CSS (layout properties, media queries), font embedding,
pixel-perfect parity with browsers for text.
