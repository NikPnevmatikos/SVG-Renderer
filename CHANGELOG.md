# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the packages use
[Semantic Versioning](https://semver.org/).

## Unreleased

Nothing yet.

## 0.1.0 - 2026-09-03

### Fixed

- `document.contentBounds` now includes stroke bands (half the stroke width, scaled by the
  node's world transform). Fitting or cropping to the content no longer cuts the outer half of
  edge strokes; the viewer also keeps a small slack around its rasterized region for estimated
  text bounds and miter joins.

### Added

- `svg-renderer`: `<SvgViewer>`, imported from `svg-renderer/viewer`, with
  pan, pinch and double-tap zoom driven on the UI thread, taps resolved through the core's hit
  testing to the nearest interactive ancestor, `interactive` as selector, predicate or
  id-to-data record, `elementStyles` for selection highlights, `decorators` anchored to
  elements (in-SVG or fixed-size overlay), built-in zoom in / zoom out / fit controls
  (`controls`, `renderControls`), `fitToElement` / `fitToBounds` / `fitToContent` / `zoomBy` /
  `zoomTo` on the ref, camera clamping to zoom limits and content bounds, and a pluggable
  backend contract. The react-native-svg backend rasterizes the whole drawing while it fits a
  pixel budget and an overscanned viewport region beyond that, re-anchoring after each gesture
  so zoomed content stays crisp. gesture-handler and reanimated are optional peers, loaded
  only by the `/viewer` entry. Built-in selection: `selectionMode` (`single` toggles one
  element, tapping it again deselects; `multiple` toggles membership), controlled or
  uncontrolled `selection`, `onSelectionChange`, `selectedStyle`, and `select` / `deselect` /
  `toggleSelection` / `clearSelection` / `getSelection` on the ref.
- `svg-core`: camera math (`fitCamera`, `zoomCamera`, `composeCamera`, `chooseRenderRegion`, ...).
- `svg-renderer`: `overrides` (per-node style overrides), `viewBox` (render a region) and
  `children` (extra elements inside the root `<Svg>`) props on `<SvgRenderer>`.
- Example: a Viewer mode with region badges, selection, fit and zoom controls.
- `svg-renderer`: decorator visibility limits. `minTargetSize` hides a decoration while its element
  is drawn smaller than that many screen pixels and fades it in as the user zooms (evaluated on the
  UI thread for overlay decorators, at rest for in-SVG ones); `minZoom` / `maxZoom` bound it to a
  zoom range. Ref fit and zoom calls made before the first layout are queued and applied once the
  viewer is measured.

- `svg-core`: CSS cascade. `<style>` stylesheets are parsed (comments, `!important`,
  at-rules skipped with warnings) and applied with correct specificity and source order on
  top of presentation attributes and below inline `style`. Selectors: type, universal, `#id`,
  `.class`, attribute operators, descendant/child/adjacent/sibling combinators, selector
  lists, `:first-child`/`:last-child`/`:only-child`/`:root`. CSS custom properties with
  `var()` fallbacks and inheritance. `document.querySelectorAll` uses the same engine.
- `svg-core`: typed definitions. Linear and radial gradients (stops from attributes or
  stylesheet classes, `objectBoundingBox`/`userSpaceOnUse` units, `gradientTransform`,
  `spreadMethod`, `href` inheritance with cycle detection), clip paths built as detached scene
  nodes with `clip-rule`, and raw passthrough for patterns, masks, markers and filters.
  References to missing definitions are replaced by their fallback paint and reported once.
- `svg-core`: `<use>` expansion. The referenced element (any element by id, including
  in-tree groups) is rebuilt under a group carrying the use's style and
  `transform × translate(x, y)`; `<symbol>` viewBoxes are mapped onto the use's width and
  height with `preserveAspectRatio`. Clones never claim ids; cycles, missing and
  non-renderable targets are reported.
- `svg-core`: style batching in the render planner (on by default). Opaque, same-styled
  static shapes are merged into one path with local transforms flattened and stroke metrics
  scaled, even when other styles are interleaved between them, as long as nothing painted in
  between overlaps them; every batch is emitted where its first shape was, so the picture is
  unchanged. Filled shapes have their
  winding normalized so nonzero unions stay exact, fill-and-stroke shapes only merge when they
  do not overlap, and translucent, even-odd, dashed, paint-server, clipped, masked, filtered
  and non-scaling-stroke shapes are left individual. `RenderPlan` reports `batchCount` and
  `mergedShapes`.
- `svg-core`: hit testing. `document.elementsAt(point, options)` returns the leaf nodes under
  a point in document coordinates, topmost first, using a spatial index over world bounds
  and exact geometry (fill rule, stroke bands, nested transforms, world-unit tolerance).
  `painted` mode follows SVG pointer semantics; `geometry` mode treats unfilled outlines as
  hit inside. Also `nodeContainsPoint`, `shapeContainsPoint`, `flattenPath`, `findAncestor`
  and `SpatialIndex`.
- `svg-core`: SVG emitter (`toSvgString`, `planToSvgString`) producing standalone SVG from the
  scene graph or from a render plan; JSON intermediate representation
  (`serializeDocument` / `deserializeDocument`) for caching and server-side normalization;
  `svg-core` CLI with `inspect`, `plan` and `normalize` commands; `<switch>` picks the first
  renderable branch (skips `foreignObject`, required extensions and non-English languages),
  which makes draw.io exports render their text labels.
- Conformance: a resvg round-trip test renders every synthetic fixture three ways (original,
  normalized SVG, batched plan) and compares pixels. Three editor-style fixtures added
  (Inkscape layers, Figma clip and mask, draw.io diagram). `npm run bench` times parse and
  plan on generated 1k/10k/50k element grids.
- Packages now build to CommonJS so Node (CLI, servers, tests) loads them as well as Metro.
- Example app upgraded to Expo SDK 57 (React Native 0.86, React 19.2, react-native-svg 15.15)
  so it runs in the current Expo Go; the renderer's dev dependencies follow the same versions.
- `svg-renderer`: renders `<Defs>` with gradients, clip paths and passthrough definitions.
  Bounding-box gradient coordinates are emitted as percentages because react-native-svg
  reads plain numbers as absolute lengths.

- Monorepo scaffold: `packages/core` (`svg-core`),
  `packages/react-native-svg` (`svg-renderer`), Expo example app, CI.
- `svg-core`: dependency-free XML tokenizer, transform parsing, path data parsing with exact
  bounding boxes (arcs converted to cubics), presentation-attribute and inline-style
  resolution with inheritance, document builder producing a typed scene graph, pass-through
  render planner, minimal `querySelectorAll`, warnings for unsupported features.
- `svg-renderer`: `<SvgRenderer>` rendering a render plan through `react-native-svg`.
- Synthetic fixtures and a generator for 1k / 10k / 50k element benchmark files.
- Design document (`docs/DESIGN.md`).
