# @nikpnevmatikos/svg-renderer

Render SVG in React Native through `react-native-svg`, with the parsing, CSS cascade,
normalization and geometry of [`@nikpnevmatikos/svg-core`](../core) in front of it.

> Pre-alpha. See the [design document](../../docs/DESIGN.md) for scope and roadmap.

```bash
npm install @nikpnevmatikos/svg-renderer react-native-svg
```

```tsx
import { SvgRenderer } from '@nikpnevmatikos/svg-renderer';

<SvgRenderer source={{ xml }} width="100%" height={240} />
<SvgRenderer source={{ uri: 'https://example.com/plan.svg' }} onDocument={(doc) => console.log(doc.warnings)} />
```

Parse once, render many times:

```tsx
import { parseSvg } from '@nikpnevmatikos/svg-core';

const doc = useMemo(() => parseSvg(xml), [xml]);
<SvgRenderer source={{ document: doc }} />
```

| Prop | Type | Description |
|---|---|---|
| `source` | `{ xml } \| { uri, fetchText? } \| { document }` | What to render. |
| `width`, `height` | `number \| string` | Size of the drawing surface. Default `100%`. |
| `style` | `ViewStyle` | Passed to the root `<Svg>`. |
| `planOptions` | `PlanOptions` | Forwarded to `document.plan()`; use `interactive` to mark nodes. |
| `onDocument` | `(doc) => void` | Called when a document is parsed or received. |
| `onError` | `(error) => void` | Called when parsing or fetching fails; nothing is rendered. |
| `fallback` | `ReactNode` | Rendered while a `uri` source loads or after an error. |
