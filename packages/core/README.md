# svg-core

Dependency-free SVG parser, normalizer, scene graph, render planner and geometry engine in
TypeScript. Runs on React Native, web and Node. This is the engine behind
[`svg-renderer`](https://github.com/NikPnevmatikos/SVG-Renderer/tree/main/packages/react-native-svg); it has no React or native code and can
be used on its own to inspect, measure, hit-test or pre-process SVG documents.

> Pre-alpha. See the [design document](https://github.com/NikPnevmatikos/SVG-Renderer/blob/main/docs/DESIGN.md) for scope and roadmap.

```ts
import { parseSvg, nodeBBox, toSvgString, serializeDocument, deserializeDocument } from 'svg-core';

const doc = parseSvg(xml);

doc.viewBox;                                   // { x, y, width, height } | null
doc.contentBounds;                             // union of everything that paints, in user units
doc.warnings;                                  // unsupported features, invalid attributes, bad references

const node = doc.getElementById('room-a1');
if (node) nodeBBox(node, 'world');             // bounding box with all ancestor transforms applied
doc.querySelectorAll('g.zone > rect[data-kind="vip"]');  // CSS selectors with combinators
doc.elementsAt({ x: 120, y: 80 }, { tolerance: 4 });    // leaf nodes under a point, topmost first

doc.plan();                                    // ordered draw units, same-styled shapes batched
doc.plan({ batching: false, interactive: (n) => n.id in rooms });

toSvgString(doc);                              // standalone SVG: stylesheets, use, units resolved
const json = JSON.stringify(serializeDocument(doc));   // intermediate representation
deserializeDocument(json);                     // back to a live document
```

## What is implemented

- **Parsing:** own XML tokenizer (prolog, DOCTYPE, comments, CDATA, entities, both quote
  styles), editor namespaces dropped, `svg:` prefix normalized.
- **CSS cascade:** `<style>` stylesheets with type, universal, `#id`, `.class`, attribute
  selectors, all four combinators, selector lists, `:first-child`/`:last-child`/`:only-child`/
  `:root`, specificity and source order, `!important`, CSS custom properties with `var()`
  fallbacks; presentation attributes; inline `style`; inheritance; `inherit`, `currentColor`.
- **Structure:** shapes, groups, `text`/`tspan` runs, `image`, nested `svg` as a group,
  `switch` (first renderable branch), `use` and `symbol` expansion with viewBox mapping,
  `display:none`, `visibility`.
- **Definitions:** linear and radial gradients (units, spread, transform, `href` inheritance),
  clip paths built as scene nodes, raw passthrough for pattern, mask, marker and filter;
  unresolved references replaced by fallbacks and reported.
- **Geometry:** transforms as matrices, path data parsing (all commands, arcs converted to
  cubics), exact bounding boxes, viewBox mapping, winding normalization, path flattening,
  point-in-shape tests, spatial index.
- **Planning:** style batching that keeps paint order exact (see the design document).
- **Output:** SVG emitter for documents and plans, JSON intermediate representation.
- **Diagnostics:** every unsupported construct becomes a `SvgWarning` with a stable `code`.

Not yet: percentage stroke widths, `textPath`, multi-line text layout, filters and masks
beyond passthrough, animation.

## Command line

```bash
npx svg-core inspect drawing.svg [--ids ids.json] [--json]
npx svg-core plan drawing.svg [--no-batching] [--json]
npx svg-core normalize drawing.svg [--ir | --plan] [--precision 3] [-o out.svg]
```

`inspect --ids` exits with code 1 when an expected id is missing, which makes it usable as a
pre-upload check for files whose element ids must match application records.
