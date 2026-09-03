# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the packages use
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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

- Monorepo scaffold: `packages/core` (`@nikpnevmatikos/svg-core`),
  `packages/react-native-svg` (`@nikpnevmatikos/svg-renderer`), Expo example app, CI.
- `svg-core`: dependency-free XML tokenizer, transform parsing, path data parsing with exact
  bounding boxes (arcs converted to cubics), presentation-attribute and inline-style
  resolution with inheritance, document builder producing a typed scene graph, pass-through
  render planner, minimal `querySelectorAll`, warnings for unsupported features.
- `svg-renderer`: `<SvgRenderer>` rendering a render plan through `react-native-svg`.
- Synthetic fixtures and a generator for 1k / 10k / 50k element benchmark files.
- Design document (`docs/DESIGN.md`).
