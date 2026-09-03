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

They are optional peers: apps that only render SVG never load them.

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

Pan, pinch and double-tap zoom run on the UI thread. Taps are converted to document
coordinates and resolved through the core's hit testing to the nearest interactive ancestor,
so they work identically on every backend. The drawing is rasterized for the resting camera
(whole content while it fits a pixel budget, an overscanned viewport region beyond that) and
re-anchored after each gesture, so zoomed content is crisp again.

| Prop | Type | Description |
|---|---|---|
| `document` | `SvgDocument` | Parsed with `parseSvg`. |
| `interactive` | `string \| (node) => boolean \| Record<id, data>` | Which nodes respond to taps. A record also attaches its values as `node.data`. |
| `onElementPress` | `(hit: ElementHit) => void` | Nearest interactive ancestor of the topmost shape under the tap. |
| `onBackgroundPress` | `(point, screenPoint) => void` | Tap that hit nothing interactive. |
| `selectionMode` | `'single' \| 'multiple' \| 'none'` | Built-in selection by id. `single` (default): tap selects, tapping the selected element again deselects it. `multiple`: taps toggle membership. |
| `selection`, `defaultSelection`, `onSelectionChange` | `string[]` | Controlled or uncontrolled selection; the callback also receives the `ElementHit` (null for background taps and ref calls). |
| `selectedStyle` | `StyleOverride \| (node) => StyleOverride` | Highlight for selected elements. Default green stroke, width 3. |
| `clearSelectionOnBackgroundPress` | `boolean` | Default true. |
| `elementStyles` | `Record<idOrSelector, StyleOverride>` | Restyle any nodes; wins over `selectedStyle`. |
| `decorators` | `Decorator[]` | Badges/labels anchored to matching nodes, in the SVG (`layer: 'svg'`) or as fixed-size overlay views (`layer: 'overlay'`). `minTargetSize` hides a decoration while its element is drawn smaller than that many pixels (labels of small rooms appear as the user zooms in, with a short fade); `minZoom` / `maxZoom` limit it to a zoom range relative to the initial fit. |
| `controls` | `boolean \| ViewerControlsOptions` | Built-in buttons. Default `true`, top-right. |
| `renderControls` | `(api) => ReactNode` | Replace the built-in buttons with your own. |
| `initialFit` | `'content' \| 'viewBox' \| Rect` | What to show first. Default `content`. |
| `minZoom`, `maxZoom` | `number` | Relative to the initial fit. Default `0.5` and `8`. |
| `padding` | `number` | Pixels around the fitted content. Default 16. |
| `hitSlop` | `number` | Extra pixels around thin shapes that still count. Default `8`. |
| `hitMode` | `'painted' \| 'geometry'` | `geometry` makes unfilled outlines tappable inside. Default `geometry`. |
| `doubleTapZoom` | `number` | Factor per double tap, `0` disables. Default `2`. |
| `backend` | `ViewerBackend` | Rendering component; defaults to the react-native-svg backend. |
| `onCameraChange` | `(camera) => void` | Called when a gesture or animation settles. |
| `children` | `ReactNode` | App views above the drawing that do not move with the camera. |

Ref: `fitToElement(id, opts)`, `fitToBounds(rect, opts)`, `fitToContent(opts)`, `zoomBy(factor, focal?, opts)`,
`zoomTo(scale, focal?, opts)`, `getCamera()`, `screenToSvg(point)`, `svgToScreen(point)`, `getSelection()`,
`setSelection(ids)`, `select(id)`, `deselect(id)`, `toggleSelection(id)`, `clearSelection()`. Fit and zoom calls made before the viewer
 has measured itself (for example right after mounting it for a new floor) are applied as soon as it has.
