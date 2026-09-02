# SVG Renderer for React Native

[![CI](https://github.com/NikPnevmatikos/SVG-Renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/NikPnevmatikos/SVG-Renderer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Render any real-world SVG in React Native **correctly, fast, and interactively** — designer
exports included — and get a queryable model of the document (ids, geometry, hit testing)
instead of an opaque picture.

> **Status: pre-alpha (phase 0).** The architecture is in place and the packages build, test
> and render, but the feature set is a thin vertical slice. See the
> [design document](./docs/DESIGN.md) for the plan and the [roadmap](./docs/DESIGN.md#13-roadmap-and-exit-criteria).

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
| [`@nikpnevmatikos/svg-renderer`](./packages/react-native-svg) | `<SvgRenderer>` for React Native on top of `react-native-svg`. | `react-native-svg` |
| `@nikpnevmatikos/svg-renderer-viewer` | Pan/zoom camera, fit-to-element, presses in SVG space, decorators. *(planned, phase 2)* | gesture-handler, reanimated |
| `@nikpnevmatikos/svg-renderer-skia` | Skia backend for very large documents and vector-crisp zoom. *(planned, phase 2)* | `@shopify/react-native-skia` |

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

Parse once and inspect the document:

```ts
import { parseSvg, nodeBBox } from '@nikpnevmatikos/svg-core';

const doc = parseSvg(xml);
doc.warnings;                       // anything unsupported is reported, never silently dropped
const room = doc.getElementById('room-a1');
if (room) nodeBBox(room, 'world');  // bounding box in SVG user space, transforms applied
```

## Development

Requires Node 20+.

```bash
npm install                 # all workspaces
npm run build               # core, then renderer (the example resolves the built dist)
npm test                    # unit tests for every package
npm run typecheck
npm run example:web         # Expo example app in the browser
npm run fixtures:generate   # synthetic 1k / 10k / 50k element benchmark fixtures
```

Repository layout, testing strategy and performance budgets are described in
[docs/DESIGN.md](./docs/DESIGN.md).

## License

MIT © Nik Pnevmatikos
