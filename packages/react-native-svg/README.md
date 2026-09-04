# svg-renderer

Render real-world SVG in React Native through `react-native-svg`, with the parsing, CSS
cascade, normalization, style batching and geometry of
[`svg-core`](https://github.com/NikPnevmatikos/SVG-Renderer/tree/main/packages/core) in front of it, and a pan/zoom viewer with taps
resolved in SVG space, selection highlights, badges and built-in controls.

> Pre-alpha. See the [design document](https://github.com/NikPnevmatikos/SVG-Renderer/blob/main/docs/DESIGN.md) for scope and roadmap.

## Install

```bash
npm install svg-renderer react-native-svg
```

For the viewer, add the gesture libraries (already present in most Expo apps):

```bash
npm install react-native-gesture-handler react-native-reanimated
```

They are optional peers: apps that only render SVG never load them. `react-native` and
`react-native-svg` are optional peers too, so a web project can install the package without them.

`svg-renderer` re-exports the whole `svg-core` API, so a React Native app needs only this package.
Install [`svg-core`](https://github.com/NikPnevmatikos/SVG-Renderer/tree/main/packages/core) on its own for Node, servers or the CLI.

## Rendering

```tsx
import { SvgRenderer } from 'svg-renderer';

<SvgRenderer source={{ xml }} width="100%" height={240} />
<SvgRenderer source={{ uri: 'https://example.com/plan.svg' }} onDocument={(doc) => console.log(doc.warnings)} />
```

Parse once, render many times:

```tsx
import { parseSvg } from 'svg-renderer';

const doc = useMemo(() => parseSvg(xml), [xml]);
<SvgRenderer source={{ document: doc }} />
```

| Prop | Type | Description |
|---|---|---|
| `source` | `{ xml } \| { uri, fetchText? } \| { document }` | What to render. |
| `width`, `height` | `number \| string` | Size of the drawing surface. Default `100%`. |
| `style` | `ViewStyle` | Passed to the root `<Svg>`. |
| `planOptions` | `PlanOptions` | Forwarded to `document.plan()`; `interactive` marks nodes that stay individual units. |
| `viewBox` | `Rect` | Render only this document region, stretched onto `width × height`. |
| `overrides` | `Map<SvgNode, StyleOverride>` | Per-node style overrides (selection highlights). |
| `children` | react-native-svg elements | Appended inside the root `<Svg>`, in document coordinates. |
| `onDocument` | `(doc) => void` | Called when a document is parsed or received. |
| `onError` | `(error) => void` | Called when parsing or fetching fails; nothing is rendered. |
| `fallback` | `ReactNode` | Rendered while a `uri` source loads or after an error. |

## Viewer

The same component exists for React DOM as `svg-renderer/web`; see [Web](#web) below.

```tsx
import { useMemo, useRef, useState } from 'react';
import { parseSvg } from 'svg-renderer';
import { SvgViewer, type SvgViewerRef } from 'svg-renderer/viewer';

export function FloorPlan({ xml, regions }: { xml: string; regions: Record<string, { name: string }> }) {
  const document = useMemo(() => parseSvg(xml), [xml]);
  const viewer = useRef<SvgViewerRef>(null);
  const [selection, setSelection] = useState<string[]>([]);

  return (
    <SvgViewer
      ref={viewer}
      document={document}
      style={{ flex: 1 }}
      interactive={regions}                        // id -> data; becomes node.data
      selection={selection}                        // built-in selection: tap selects, tap again deselects
      onSelectionChange={setSelection}
      onElementPress={({ node, data }) => console.log('tapped', node.id, data)}
      decorators={[{ match: '.room', anchor: 'center', layer: 'overlay', render: (node) => <Badge label={String(node.data?.name)} /> }]}
      controls={{ position: 'bottom-right' }}      // built-in zoom in / out / fit; `false` hides them
    />
  );
}
```

The app root must be wrapped in `GestureHandlerRootView` (see the gesture-handler docs).

Pan, pinch and double-tap zoom run on the UI thread; a released pan glides on with the finger's
velocity and stops inside the content bounds, and a camera pushed past the bounds eases back.
Taps are converted to document coordinates and resolved through the core's hit testing to the
nearest interactive ancestor, so they work identically on every backend. The drawing is
rasterized for the resting camera (whole content while it fits a pixel budget, an overscanned
viewport region beyond that) and re-anchored when a gesture ends and whenever the fingers rest
for a moment mid-gesture, so a long pinch stays crisp. Each layer positions itself against the
live camera and the previous layer stays until the new one has laid out, so re-anchoring never
flashes or jumps.

| Prop | Type | Description |
|---|---|---|
| `document` | `SvgDocument` | Parsed with `parseSvg`. |
| `interactive` | `string \| (node) => boolean \| Record<id, data>` | Which nodes respond to taps. A record also attaches its values as `node.data`. |
| `onElementPress` | `(hit: ElementHit) => void` | Nearest interactive ancestor of the topmost shape under the tap. |
| `onElementLongPress` | `(hit: ElementHit) => void` | Long press (400 ms) on an interactive element; does not change the selection. |
| `pressedStyle`, `pressedDuration` | `StyleOverride | (node) => StyleOverride`, `number` | Brief highlight of the tapped element for touch feedback. Off unless given; 180 ms. |
| `inertia` | `boolean` | Pan glides after release. Default true. |
| `accessibility` | `(node, data) => { label, hint? } | null` | Screen-reader targets for interactive elements; activating one acts like a tap. |
| `onBackgroundPress` | `(point, screenPoint) => void` | Tap that hit nothing interactive. |
| `selectionMode` | `'single' \| 'multiple' \| 'none'` | Built-in selection by id. `single` (default): tap selects, tapping the selected element again deselects it. `multiple`: taps toggle membership. |
| `selection`, `defaultSelection`, `onSelectionChange` | `string[]` | Controlled or uncontrolled selection; the callback also receives the `ElementHit` (null for background taps and ref calls). |
| `selectedStyle` | `StyleOverride \| (node) => StyleOverride` | Highlight for selected elements. Default green stroke, width 3. |
| `clearSelectionOnBackgroundPress` | `boolean` | Default true. |
| `elementStyles` | `Record<idOrSelector, StyleOverride>` | Restyle any nodes; wins over `selectedStyle`. |
| `decorators` | `Decorator[]` | Badges/labels anchored to matching nodes, in the SVG (`layer: 'svg'`) or as fixed-size overlay views (`layer: 'overlay'`). `minTargetSize` hides a decoration while its element is drawn smaller than that many pixels (labels of small rooms appear as the user zooms in, with a short fade); `minZoom` / `maxZoom` limit it to a zoom range relative to the initial fit. `avoidOverlap` hides the lower-`priority` label of two that would collide on screen (default priority: bounding-box area), re-evaluated whenever the camera settles. |
| `controls` | `boolean \| ViewerControlsOptions` | Built-in buttons. Default `true`, top-right. |
| `renderControls` | `(api) => ReactNode` | Replace the built-in buttons with your own. |
| `initialFit` | `'content' \| 'viewBox' \| Rect` | What to show first. Default `content`. |
| `minZoom`, `maxZoom` | `number` | Relative to the initial fit. Default `0.5` and `8`. |
| `padding` | `number` | Pixels around the fitted content. Default 16. |
| `hitSlop` | `number` | Extra pixels around thin shapes that still count. Default `8`. |
| `hitMode` | `'painted' \| 'geometry'` | `geometry` makes unfilled outlines tappable inside. Default `geometry`. |
| `doubleTapZoom` | `number` | Factor per double tap, `0` disables. Default `2`. |
| `backend` | `ViewerBackend` | Rendering component; defaults to the react-native-svg backend. |
| `onCameraChange` | `(camera) => void` | Called when the resting camera changes: after a gesture or animation settles and after a mid-gesture re-anchor. |
| `children` | `ReactNode` | App views above the drawing that do not move with the camera. |

Ref: `fitToElement(id, opts)`, `fitToElements(ids, opts)`, `fitToBounds(rect, opts)`, `fitToContent(opts)`, `zoomBy(factor, focal?, opts)`,
`zoomTo(scale, focal?, opts)`, `getCamera()`, `screenToSvg(point)`, `svgToScreen(point)`, `getSelection()`,
`setSelection(ids)`, `select(id)`, `deselect(id)`, `toggleSelection(id)`, `clearSelection()`. Fit and zoom calls made before the viewer
 has measured itself (for example right after mounting it for a new floor) are applied as soon as it has.

Custom backends receive `camera` (the camera the layer is laid out for), `live` (the live camera as
shared values) and `onReady`; they display the layer with the transform that maps `camera` onto
`live` and call `onReady` once laid out, so the viewer can drop the layer being replaced.

## Web

```tsx
import { parseSvg, SvgRenderer } from 'svg-renderer/web';
import { SvgViewer, type SvgViewerRef } from 'svg-renderer/web';

<SvgRenderer source={{ xml }} width="100%" height={240} />
<SvgViewer document={parseSvg(xml)} style={{ height: 480 }} interactive={rooms} onElementPress={openRoom} />
```

`svg-renderer/web` renders with React DOM and imports nothing from React Native. It goes through the
same parse, cascade, normalize and plan pipeline, so a document draws the same on both platforms,
and the viewer has the same props and ref API as the native one: `interactive`, selection,
`decorators` (return DOM elements; `layer: 'svg'` decorators return SVG elements such as `<circle>`),
`minTargetSize` / `avoidOverlap`, `fitToElement`, `onElementLongPress`, `pressedStyle`,
`accessibility` (focusable, screen-reader labelled targets) and the built-in controls. Differences:
`style` and `className` are DOM props, `wheelZoom` (default true) zooms about the cursor with the
mouse wheel or a trackpad pinch, touch pinch and drag come from pointer events, and while
`doubleTapZoom` is on a single tap waits 250 ms for a possible second tap (set it to `0` for
instant taps). `svg-core` is re-exported, so one import covers parsing too.

Expo web apps can keep using `svg-renderer/viewer` through react-native-web; `svg-renderer/web` is
for plain React apps (Vite, Next.js, Create React App). The `example-web` workspace is a Vite app
using it: `npm run example:web:dom`.
