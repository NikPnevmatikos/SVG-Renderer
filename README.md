# SVG Renderer for React Native

[![CI](https://github.com/NikPnevmatikos/SVG-Renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/NikPnevmatikos/SVG-Renderer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Render any real-world SVG in React Native **correctly, fast, and interactively** — designer
exports included — and get a queryable model of the document (ids, geometry, hit testing)
instead of an opaque picture.

> **Status: pre-alpha (phase 1 complete).** The core parses, normalizes, plans and hit-tests
> real-world SVG and is verified pixel-for-pixel against a reference renderer; the
> react-native-svg backend renders it. Pan/zoom viewer and the Skia backend are next. See the
> [design document](./docs/DESIGN.md) and its [roadmap](./docs/DESIGN.md#13-roadmap-and-exit-criteria).

## What works today

- **Real-world input.** XML with entities and CDATA, `<style>` stylesheets (type, class, id and
  attribute selectors, all combinators, specificity, `!important`, custom properties),
  presentation attributes and inline styles with inheritance, `use` and `symbol` expansion,
  nested transforms, physical units, editor namespaces (Illustrator, Inkscape, Figma, draw.io
  exports are covered by fixtures).
- **Definitions.** Linear and radial gradients (including `href` inheritance), clip paths,
  and raw passthrough of patterns, masks, markers and filters. Broken references fall back to
  the fallback paint and are reported.
- **Geometry.** Exact bounding boxes for every shape including arcs and nested transforms,
  `document.elementsAt(point)` hit testing with fill rules, stroke bands and touch tolerance,
  backed by a spatial index.
- **Performance.** The render planner merges same-styled opaque shapes into single paths
  wherever that cannot change the picture, so a backend receives a handful of draw units for
  thousands of elements.
- **Tooling.** A JSON intermediate representation for caching and server-side normalization,
  an SVG emitter, and the `svg-core` CLI (`inspect`, `plan`, `normalize`).
- **Nothing silently dropped.** Every unsupported construct is reported in `document.warnings`.

Measured on the generated benchmark grids (Node 24, desktop, `npm run bench`):

| Fixture | Elements | Parse + normalize | Plan | Draw units |
|---|---|---|---|---|
| grid-1000 | 1,032 | 5 ms | 3 ms | 8 |
| grid-10000 | 10,090 | 21 ms | 38 ms | 8 |
| grid-50000 | 50,194 | 72 ms | 191 ms | 8 |

## Why

- **Designer exports do not render.** Real files use `<style>` blocks and classes, `<use>`,
  nested transforms, physical units and editor namespaces. Rendering them element by element
  without applying the CSS cascade gives wrong paint or nothing.
- **Interactive SVG needs geometry.** Tapping a region, highlighting it or zooming to it needs
  bounding boxes and hit testing for *any* shape, which no React Native SVG library exposes.
- **One native view per element does not scale.** A thousand-element floor plan already makes
  mid-range phones lag. This library plans rendering so that cost follows the number of
  *distinct paint styles*, not the number of elements.

## Packages

| Package | Purpose | Native deps |
|---|---|---|
| [`@nikpnevmatikos/svg-core`](./packages/core) | Parser, CSS cascade, normalizer, scene graph, render planner, geometry. Pure TypeScript, zero dependencies. Runs on React Native, web and Node. | none |
| [`@nikpnevmatikos/svg-renderer`](./packages/react-native-svg) | `<SvgRenderer>` for React Native on top of `react-native-svg`. Import `@nikpnevmatikos/svg-renderer/viewer` for `<SvgViewer>`: pan/zoom camera on the UI thread, taps resolved in SVG space, selection highlights, fit-to-element, badges anchored to elements, built-in controls. | `react-native-svg`; the viewer also needs gesture-handler and reanimated (optional peers) |
| `@nikpnevmatikos/svg-renderer/skia` | Skia backend for very large documents and vector-crisp zoom. *(planned, phase 2)* | `@shopify/react-native-skia` (optional peer) |

## Quick start

```bash
npm install @nikpnevmatikos/svg-renderer react-native-svg
```

```tsx
import { SvgRenderer } from '@nikpnevmatikos/svg-renderer';

export function Logo({ xml }: { xml: string }) {
  return <SvgRenderer source={{ xml }} width={200} height={120} />;
}
```

Interactive map with pan, zoom, taps and built-in controls (needs react-native-gesture-handler
and react-native-reanimated):

```tsx
import { parseSvg } from '@nikpnevmatikos/svg-core';
import { SvgViewer } from '@nikpnevmatikos/svg-renderer/viewer';

const doc = parseSvg(xml);
<SvgViewer document={doc} style={{ flex: 1 }} interactive=".room" onElementPress={({ node }) => open(node.id)} />
```

Parse once and work with the document:

```ts
import { parseSvg, nodeBBox, toSvgString, serializeDocument } from '@nikpnevmatikos/svg-core';

const doc = parseSvg(xml);
doc.warnings;                                  // anything unsupported is reported, never silently dropped
const room = doc.getElementById('room-a1');
if (room) nodeBBox(room, 'world');             // bounding box in SVG user space, transforms applied
doc.querySelectorAll('g.zone > rect.room');    // CSS selectors over the scene graph
doc.elementsAt({ x: 120, y: 80 }, { tolerance: 4, mode: 'geometry' }); // topmost first
doc.plan();                                    // draw units for a backend, batched by style
toSvgString(doc);                              // standalone SVG with everything resolved
JSON.stringify(serializeDocument(doc));        // cacheable intermediate representation
```

Command line:

```bash
npx @nikpnevmatikos/svg-core inspect floor.svg --ids rooms.json   # counts, ids, warnings; exit 1 if an id is missing
npx @nikpnevmatikos/svg-core plan floor.svg                       # how many draw units a backend gets
npx @nikpnevmatikos/svg-core normalize floor.svg -o floor.clean.svg
```

## Development

Requires Node 20+.

```bash
npm install                 # all workspaces
npm run build               # core, then renderer (the example resolves the built dist)
npm test                    # unit tests plus the resvg round-trip conformance suite
npm run typecheck
npm run example:web         # Expo example app in the browser
npm run fixtures:generate   # synthetic 1k / 10k / 50k element benchmark fixtures
npm run bench               # parse and plan timings for the generated fixtures
```

Repository layout, testing strategy and performance budgets are described in
[docs/DESIGN.md](./docs/DESIGN.md).

## License

MIT © Nik Pnevmatikos
