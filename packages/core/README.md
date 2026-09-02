# @nikpnevmatikos/svg-core

Dependency-free SVG parser, normalizer, scene graph, render planner and geometry engine in
TypeScript. Runs on React Native, web and Node. This is the engine behind
[`@nikpnevmatikos/svg-renderer`](../react-native-svg); it has no React or native code and can
be used on its own to inspect, measure or pre-process SVG documents.

> Pre-alpha. See the [design document](../../docs/DESIGN.md) for scope and roadmap.

```ts
import { parseSvg, nodeBBox } from '@nikpnevmatikos/svg-core';

const doc = parseSvg(xml);

doc.viewBox;                        // { x, y, width, height } | null
doc.contentBounds;                  // union of everything that paints, in user units
doc.warnings;                       // unsupported features, invalid attributes, bad references

const node = doc.getElementById('room-a1');
if (node) nodeBBox(node, 'world');  // bounding box with all ancestor transforms applied

doc.querySelectorAll('rect.room');  // simple selectors: tag, #id, .class, and lists
doc.plan();                         // ordered draw units for a backend
```

Currently implemented (phase 0): XML tokenizer, `transform` parsing, path data parsing with
exact bounding boxes, presentation attributes and inline `style` with inheritance, shapes,
groups, basic `text`/`tspan`, `image`, viewBox and preserveAspectRatio, pass-through render
plan. Stylesheets (`<style>`), `<use>`/`<symbol>`, gradients, clipPath and style batching are
next (phase 1) and are reported as warnings until then.
