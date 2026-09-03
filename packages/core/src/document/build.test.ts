import { nodeBBox } from '../geometry/bbox';
import { parseSvg } from '../parse';
import type { ClipPathDef, LinearGradientDef, RadialGradientDef, ShapeNode, TextNode } from '../types';

const shape = (node: unknown): ShapeNode => {
  if (!node || (node as ShapeNode).kind !== 'shape') throw new Error('expected shape');
  return node as ShapeNode;
};

describe('buildDocument', () => {
  it('parses the viewport', () => {
    const doc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 300 200" width="30mm" preserveAspectRatio="xMinYMax slice"/>');
    expect(doc.viewBox).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(doc.width).toBeCloseTo((30 * 96) / 25.4);
    expect(doc.height).toBeUndefined();
    expect(doc.preserveAspectRatio).toEqual({ align: 'xMinYMax', meetOrSlice: 'slice' });
    expect(doc.warnings).toEqual([]);
  });

  it('derives a viewBox from absolute width/height and reports invalid viewBox values', () => {
    const doc = parseSvg('<svg width="100" height="50" viewBox="0 0 -1 5"/>');
    expect(doc.warnings[0]?.code).toBe('invalid-viewbox');
    expect(doc.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('rejects non-svg roots', () => {
    expect(() => parseSvg('<html/>')).toThrow(/Root element must be <svg>/);
  });

  it('builds shapes with resolved geometry and inherited style', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <g id="rooms" fill="red" stroke="#333" stroke-width="2" class="a b">
          <rect id="r1" x="10" y="10" width="20" height="30" rx="4" class="room"/>
          <circle id="c1" cx="50" cy="50" r="5" fill="blue" style="stroke: none"/>
          <ellipse cx="1" cy="1" rx="3"/>
          <line x1="0" y1="0" x2="10" y2="10"/>
          <polygon points="0,0 10,0 10,10 5"/>
          <polyline points="1 1 2 2"/>
          <path id="p1" d="M0 0 L10 0 L10 10 Z"/>
          <rect x="0" y="0" width="0" height="10"/>
        </g>
      </svg>`);
    const group = doc.getElementById('rooms');
    expect(group?.kind).toBe('group');
    expect(group?.classes).toEqual(['a', 'b']);
    const rooms = doc.querySelectorAll('rect.room');
    expect(rooms).toHaveLength(1);

    const r1 = shape(doc.getElementById('r1'));
    expect(r1.params).toEqual({ kind: 'rect', x: 10, y: 10, width: 20, height: 30, rx: 4, ry: 4 });
    expect(r1.style.fill).toEqual({ type: 'color', value: 'red' });
    expect(r1.style.stroke).toEqual({ type: 'color', value: '#333' });
    expect(r1.style.strokeWidth).toBe(2);

    const c1 = shape(doc.getElementById('c1'));
    expect(c1.style.fill).toEqual({ type: 'color', value: 'blue' });
    expect(c1.style.stroke).toEqual({ type: 'none' });

    const children = (group as { children: unknown[] }).children;
    // The zero-width rect is not rendered; everything else is.
    expect(children).toHaveLength(7);
    expect(shape(children[2]).params).toEqual({ kind: 'ellipse', cx: 1, cy: 1, rx: 3, ry: 3 });
    expect(shape(children[4]).params).toEqual({ kind: 'polygon', points: [0, 0, 10, 0, 10, 10] });
    expect(doc.warnings.map((w) => w.code)).toEqual(['invalid-attribute']);
  });

  it('composes transforms for world-space bounds', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <g transform="translate(10 20)">
          <g transform="scale(2)">
            <rect id="r" x="1" y="1" width="5" height="5" transform="translate(1 0)"/>
          </g>
        </g>
      </svg>`);
    const r = doc.getElementById('r')!;
    expect(nodeBBox(r, 'local')).toEqual({ x: 1, y: 1, width: 5, height: 5 });
    expect(nodeBBox(r, 'world')).toEqual({ x: 14, y: 22, width: 10, height: 10 });
    expect(doc.contentBounds).toEqual({ x: 14, y: 22, width: 10, height: 10 });
  });

  it('includes stroke bands in the content bounds', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <g transform="scale(2)">
          <rect x="10" y="10" width="20" height="10" fill="none" stroke="#000" stroke-width="3"/>
        </g>
        <circle cx="80" cy="80" r="5"/>
      </svg>`);
    // Rect spans 20..60 x 20..40 in world space; the 3-unit stroke scaled by 2 adds 3 on every side.
    expect(doc.contentBounds).toEqual({ x: 17, y: 17, width: 68, height: 68 });
  });

  it('reports and ignores invalid transforms', () => {
    const doc = parseSvg('<svg><rect id="r" width="1" height="1" transform="spin(3)"/></svg>');
    expect(doc.warnings[0]?.code).toBe('invalid-transform');
    expect(doc.getElementById('r')?.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('builds text runs from text and tspans with collapsed whitespace', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100" font-family="Arial">
        <text id="t" x="10 20" y="30" font-size="12">
          Hello <tspan dx="2" font-weight="bold">big</tspan>
          world
        </text>
        <text x="0" y="0">   </text>
      </svg>`);
    const t = doc.getElementById('t') as TextNode;
    expect(t.kind).toBe('text');
    expect(t.x).toBe(10);
    expect(t.y).toBe(30);
    expect(t.runs.map((r) => r.text)).toEqual(['Hello ', 'big', ' world']);
    expect(t.runs[1]?.dx).toBe(2);
    expect(t.runs[1]?.style.font.weight).toBe('bold');
    expect(t.runs[0]?.style.font.family).toEqual(['Arial']);
    // Empty text elements are dropped.
    expect(doc.root.children).toHaveLength(1);
  });

  it('builds images and skips ones without size', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <image id="i" xlink:href="data:image/png;base64,AAAA" x="1" y="2" width="10" height="20"/>
        <image href="x.png"/>
      </svg>`);
    const image = doc.getElementById('i');
    expect(image?.kind).toBe('image');
    expect((image as { rect: unknown }).rect).toEqual({ x: 1, y: 2, width: 10, height: 20 });
    expect(doc.warnings[0]?.code).toBe('invalid-attribute');
  });

  it('skips display:none subtrees, defs and editor namespaces; warns for unsupported features', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100" xmlns:inkscape="x" xmlns:sodipodi="y">
        <sodipodi:namedview inkscape:zoom="1"/>
        <defs>
          <linearGradient id="grad"><stop offset="0"/></linearGradient>
          <style>.a { fill: red }</style>
        </defs>
        <g style="display:none"><rect id="hidden" width="1" height="1"/></g>
        <use href="#grad"/>
        <foreignObject width="1" height="1"/>
        <foreignObject width="1" height="1"/>
        <rect id="visible" width="1" height="1" fill="url(#grad)"/>
      </svg>`);
    expect(doc.getElementById('hidden')).toBeUndefined();
    expect(doc.getElementById('visible')).toBeDefined();
    expect(doc.defs.grad).toMatchObject({ kind: 'linearGradient', id: 'grad' });
    // <use href="#grad"/> points at a gradient, which cannot be rendered.
    expect(doc.warnings.map((w) => w.code)).toEqual(['unresolved-reference', 'unsupported-element']);
    expect(shape(doc.getElementById('visible')).style.fill).toEqual({ type: 'ref', id: 'grad' });
  });

  it('reports duplicate ids and keeps the first element', () => {
    const doc = parseSvg('<svg><rect id="a" width="1" height="1"/><circle id="a" r="2"/></svg>');
    expect(doc.getElementById('a')?.tag).toBe('rect');
    expect(doc.warnings.map((w) => w.code)).toEqual(['duplicate-id']);
  });

  it('keeps malformed paths up to the error and reports them', () => {
    const doc = parseSvg('<svg><path id="p" d="M0 0 L10 10 L"/></svg>');
    const p = shape(doc.getElementById('p'));
    expect(p.params.kind).toBe('path');
    if (p.params.kind === 'path') {
      expect(p.params.segments).toHaveLength(2);
      expect(p.params.error).toMatch(/Expected number/);
    }
    expect(doc.warnings[0]?.code).toBe('invalid-path');
  });

  it('resolves percentages against the viewBox', () => {
    const doc = parseSvg('<svg viewBox="0 0 200 100"><rect id="r" x="10%" y="50%" width="50%" height="10%"/></svg>');
    expect(shape(doc.getElementById('r')).params).toEqual({ kind: 'rect', x: 20, y: 50, width: 100, height: 10, rx: 0, ry: 0 });
  });

  it('treats nested svg as a translated group and switch as the first renderable child', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <svg x="10" y="10" viewBox="0 0 5 5"><rect id="inner" width="1" height="1"/></svg>
        <switch><rect id="first" width="1" height="1"/><rect id="second" width="1" height="1"/></switch>
        <switch>
          <foreignObject width="1" height="1" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"><div>html</div></foreignObject>
          <g requiredExtensions="http://example.com/ext"><rect id="ext" width="1" height="1"/></g>
          <text id="de" systemLanguage="de" x="0" y="0">Hallo</text>
          <text id="en" systemLanguage="en-GB, fr" x="0" y="0">Hello</text>
          <text id="fallback" x="0" y="0">Fallback</text>
        </switch>
      </svg>`);
    expect(nodeBBox(doc.getElementById('inner')!, 'world')).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    expect(doc.getElementById('first')).toBeDefined();
    expect(doc.getElementById('second')).toBeUndefined();
    expect(doc.getElementById('ext')).toBeUndefined();
    expect(doc.getElementById('de')).toBeUndefined();
    expect(doc.getElementById('en')).toBeDefined();
    expect(doc.getElementById('fallback')).toBeUndefined();
    expect(doc.warnings.map((w) => w.code)).toEqual(['nested-svg']);
  });

  it('forwards warnings to onWarning', () => {
    const seen: string[] = [];
    parseSvg('<svg><use href="#x"/></svg>', { onWarning: (w) => seen.push(w.code) });
    expect(seen).toEqual(['unresolved-reference']);
  });

  it('supports full selectors in querySelectorAll and rejects dynamic pseudo-classes', () => {
    const doc = parseSvg(`
      <svg>
        <g id="a" class="layer"><rect id="r1" width="1" height="1"/><rect id="r2" width="1" height="1" data-kind="vip"/></g>
        <rect id="r3" width="1" height="1"/>
      </svg>`);
    const ids = (selector: string): (string | undefined)[] => doc.querySelectorAll(selector).map((n) => n.id);
    expect(ids('g > rect')).toEqual(['r1', 'r2']);
    expect(ids('.layer rect + rect')).toEqual(['r2']);
    expect(ids('[data-kind="vip"], #r3')).toEqual(['r2', 'r3']);
    expect(ids('svg > rect:last-child')).toEqual(['r3']);
    expect(() => doc.querySelectorAll('rect:hover')).toThrow(/Unsupported selector/);
    expect(() => doc.querySelectorAll('rect >')).toThrow(/Invalid selector/);
  });
});

describe('stylesheets', () => {
  it('applies an Illustrator-style class stylesheet from inside defs', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <defs>
          <style>
            .cls-1, .cls-2 { fill: none; }
            .cls-1 { stroke: #000; stroke-width: .5; stroke-linecap: round }
            .cls-2 { stroke: #ff0000; }
            .cls-3 { fill: #dbeafe; stroke: #1e40af; }
          </style>
        </defs>
        <line id="l" class="cls-1" x1="0" y1="0" x2="10" y2="10"/>
        <polyline id="pl" class="cls-2" points="0,0 5,5"/>
        <rect id="r" class="cls-3" width="10" height="10"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    const l = shape(doc.getElementById('l'));
    expect(l.style.fill).toEqual({ type: 'none' });
    expect(l.style.stroke).toEqual({ type: 'color', value: '#000' });
    expect(l.style.strokeWidth).toBe(0.5);
    expect(l.style.strokeLinecap).toBe('round');
    expect(shape(doc.getElementById('pl')).style.stroke).toEqual({ type: 'color', value: '#ff0000' });
    expect(shape(doc.getElementById('r')).style.fill).toEqual({ type: 'color', value: '#dbeafe' });
  });

  it('cascades stylesheet, attributes, inline style and !important; classes inherit through groups', () => {
    const doc = parseSvg(`
      <svg>
        <style>
          g.zone rect { fill: blue }
          #vip { fill: gold !important }
          .thick { stroke-width: 4 }
          .zone { stroke: green }
        </style>
        <g class="zone thick">
          <rect id="vip" width="1" height="1" fill="gray" style="fill: white"/>
          <rect id="plain" width="1" height="1" fill="gray" style="fill: white"/>
          <rect id="attr" width="1" height="1" fill="gray"/>
        </g>
      </svg>`);
    expect(shape(doc.getElementById('vip')).style.fill).toEqual({ type: 'color', value: 'gold' });
    expect(shape(doc.getElementById('plain')).style.fill).toEqual({ type: 'color', value: 'white' });
    expect(shape(doc.getElementById('attr')).style.fill).toEqual({ type: 'color', value: 'blue' });
    // Inherited from the group's stylesheet declarations.
    expect(shape(doc.getElementById('attr')).style.stroke).toEqual({ type: 'color', value: 'green' });
    expect(shape(doc.getElementById('attr')).style.strokeWidth).toBe(4);
  });

  it('resolves CSS custom properties with inheritance and fallbacks', () => {
    const doc = parseSvg(`
      <svg style="--brand: #123456">
        <style>.accent { fill: var(--brand); stroke: var(--missing, red) }</style>
        <g style="--brand: #abcdef">
          <rect id="inner" class="accent" width="1" height="1"/>
        </g>
        <rect id="outer" class="accent" width="1" height="1"/>
        <rect id="unset" width="1" height="1" style="fill: var(--nope)"/>
      </svg>`);
    expect(shape(doc.getElementById('inner')).style.fill).toEqual({ type: 'color', value: '#abcdef' });
    expect(shape(doc.getElementById('outer')).style.fill).toEqual({ type: 'color', value: '#123456' });
    expect(shape(doc.getElementById('outer')).style.stroke).toEqual({ type: 'color', value: 'red' });
    // An unresolvable var() leaves the inherited/default value in place.
    expect(shape(doc.getElementById('unset')).style.fill).toEqual({ type: 'color', value: 'black' });
  });

  it('reports skipped CSS constructs and ignores non-CSS style types', () => {
    const doc = parseSvg(`
      <svg>
        <style type="text/less">.a { fill: red }</style>
        <style>
          @media print { .b { fill: red } }
          .c:hover { fill: red }
          .d { fill: red }
        </style>
        <rect class="d" width="1" height="1" id="d"/>
      </svg>`);
    expect(doc.warnings.map((w) => w.code)).toEqual(['css-unsupported', 'css-unsupported', 'css-unsupported']);
    expect(doc.warnings.map((w) => w.message)).toEqual([
      '<style type="text/less"> was ignored',
      '@media rules are not supported and were skipped',
      'Selector ".c:hover" is not supported and was skipped',
    ]);
    expect(shape(doc.getElementById('d')).style.fill).toEqual({ type: 'color', value: 'red' });
  });

  it('collects stylesheets from several style elements in document order', () => {
    const doc = parseSvg(`
      <svg>
        <style>.a { fill: red }</style>
        <rect id="r" class="a" width="1" height="1"/>
        <style>.a { fill: blue }</style>
      </svg>`);
    expect(shape(doc.getElementById('r')).style.fill).toEqual({ type: 'color', value: 'blue' });
  });
});

describe('definitions', () => {
  it('builds linear and radial gradients with stops, units and href inheritance', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 200 100" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <style>.s { stop-color: #00f; stop-opacity: 50% }</style>
          <linearGradient id="a" x1="0" y1="0" x2="0" y2="1" gradientTransform="rotate(90)">
            <stop offset="0%" stop-color="red"/>
            <stop offset="100%" class="s"/>
            <stop offset="50%" stop-color="green"/>
          </linearGradient>
          <linearGradient id="b" xlink:href="#a" x1="1" spreadMethod="reflect"/>
          <radialGradient id="c" gradientUnits="userSpaceOnUse" cx="50%" cy="20" r="10">
            <stop offset="0" stop-color="currentColor" color="#abc"/>
          </radialGradient>
          <radialGradient id="d"/>
        </defs>
        <rect id="r" width="10" height="10" fill="url(#b)"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    const a = doc.defs.a as LinearGradientDef;
    expect(a.kind).toBe('linearGradient');
    expect(a.units).toBe('objectBoundingBox');
    expect([a.x1, a.y1, a.x2, a.y2]).toEqual([0, 0, 0, 1]);
    expect(a.transform[0]).toBeCloseTo(0);
    expect(a.transform[1]).toBeCloseTo(1);
    // Offsets clamp to 0..1 and never decrease.
    expect(a.stops).toEqual([
      { offset: 0, color: 'red', opacity: 1 },
      { offset: 1, color: '#00f', opacity: 0.5 },
      { offset: 1, color: 'green', opacity: 1 },
    ]);
    const b = doc.defs.b as LinearGradientDef;
    expect(b.stops).toEqual(a.stops);
    expect(b.x1).toBe(1);
    expect(b.y2).toBe(1);
    expect(b.spreadMethod).toBe('reflect');
    expect(b.transform).toEqual(a.transform);
    const c = doc.defs.c as RadialGradientDef;
    expect(c.units).toBe('userSpaceOnUse');
    expect([c.cx, c.cy, c.r, c.fx, c.fy, c.fr]).toEqual([100, 20, 10, 100, 20, 0]);
    expect(c.stops[0]?.color).toBe('#abc');
    const d = doc.defs.d as RadialGradientDef;
    expect([d.cx, d.cy, d.r, d.fx, d.fy, d.fr]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0]);
    expect(d.stops).toEqual([]);
    expect(shape(doc.getElementById('r')).style.fill).toEqual({ type: 'ref', id: 'b' });
  });

  it('builds clip paths with their shapes and clip-rule', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 10 10">
        <clipPath id="c" transform="translate(1 1)">
          <rect width="5" height="5" clip-rule="evenodd"/>
          <circle r="2"/>
        </clipPath>
        <rect id="r" width="10" height="10" clip-path="url(#c)"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    const c = doc.defs.c as ClipPathDef;
    expect(c.kind).toBe('clipPath');
    expect(c.units).toBe('userSpaceOnUse');
    expect(c.transform).toEqual([1, 0, 0, 1, 1, 1]);
    expect(c.root.children).toHaveLength(2);
    expect(shape(c.root.children[0]).style.clipRule).toBe('evenodd');
    expect(shape(doc.getElementById('r')).style.clipPath).toBe('c');
    // Clip path shapes are not part of the rendered tree.
    expect(doc.root.children).toHaveLength(1);
  });

  it('replaces unresolved references with fallbacks and warns once per id', () => {
    const doc = parseSvg(`
      <svg>
        <rect id="a" width="1" height="1" fill="url(#nope) red" stroke="url(#nope)" clip-path="url(#zzz)"/>
        <rect id="b" width="1" height="1" fill="url(#nope)" mask="url(#zzz)"/>
      </svg>`);
    const a = shape(doc.getElementById('a'));
    expect(a.style.fill).toEqual({ type: 'color', value: 'red' });
    expect(a.style.stroke).toEqual({ type: 'none' });
    expect(a.style.clipPath).toBeUndefined();
    const b = shape(doc.getElementById('b'));
    expect(b.style.fill).toEqual({ type: 'none' });
    expect(b.style.mask).toBeUndefined();
    expect(doc.warnings.map((w) => w.code)).toEqual(['unresolved-reference', 'unresolved-reference']);
    expect(doc.warnings[0]?.message).toMatch(/fill paint references "#nope"/);
  });

  it('expands use of defs content with position, inherited style and no duplicate ids', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <rect id="tpl" width="10" height="5" stroke="#000"/>
        </defs>
        <use id="u1" href="#tpl" x="20" y="30" fill="red"/>
        <use id="u2" xlink:href="#tpl" transform="scale(2)" x="5" y="5" fill="blue" style="display:none"/>
        <use id="u3" xlink:href="#tpl" transform="scale(2)" x="5" y="5" fill="blue"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    expect(doc.root.children).toHaveLength(2);
    const u1 = doc.getElementById('u1')!;
    expect(u1.kind).toBe('group');
    expect(u1.tag).toBe('use');
    expect(u1.transform).toEqual([1, 0, 0, 1, 20, 30]);
    const clone = shape((u1 as { children: unknown[] }).children[0]);
    expect(clone.id).toBeUndefined();
    expect(clone.attrs.id).toBe('tpl');
    expect(clone.style.fill).toEqual({ type: 'color', value: 'red' });
    expect(clone.style.stroke).toEqual({ type: 'color', value: '#000' });
    expect(nodeBBox(clone, 'world')).toEqual({ x: 20, y: 30, width: 10, height: 5 });
    // The template itself is only addressable through its id; it is not rendered.
    expect(doc.getElementById('tpl')).toBeUndefined();
    // transform applies after the x/y translation: scale(2) × translate(5, 5).
    expect(doc.getElementById('u3')!.transform).toEqual([2, 0, 0, 2, 10, 10]);
  });

  it('maps symbol viewBoxes onto the use width and height', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 200 200">
        <symbol id="pin" viewBox="0 0 24 24"><rect width="24" height="24"/></symbol>
        <use id="big" href="#pin" x="10" y="10" width="48" height="48"/>
        <use id="wide" href="#pin" width="48" height="24"/>
        <use id="bare" href="#pin"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    const big = doc.getElementById('big')!;
    const bigInner = (big as { children: { transform: unknown; children: unknown[] }[] }).children[0]!;
    expect(bigInner.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(nodeBBox(shape(bigInner.children[0]), 'world')).toEqual({ x: 10, y: 10, width: 48, height: 48 });
    // meet + xMidYMid: scale 1, centered horizontally in 48.
    const wideInner = (doc.getElementById('wide') as { children: { transform: unknown }[] }).children[0]!;
    expect(wideInner.transform).toEqual([1, 0, 0, 1, 12, 0]);
    // Without a size the symbol maps onto the whole viewport.
    const bareInner = (doc.getElementById('bare') as { children: { transform: unknown }[] }).children[0]!;
    expect(bareInner.transform).toEqual([200 / 24, 0, 0, 200 / 24, 0, 0]);
  });

  it('expands use of in-tree groups, nested use, and reports cycles and missing targets', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <g id="row"><rect id="cell" width="4" height="4"/><use href="#cell" x="5"/></g>
        <use id="copy" href="#row" y="10"/>
        <g id="loop"><use href="#loop"/></g>
        <use href="#nowhere"/>
        <use/>
      </svg>`);
    const copy = doc.getElementById('copy') as { children: { children: unknown[] }[] };
    expect(copy.children[0]!.children).toHaveLength(2);
    expect(doc.getElementById('cell')?.parent?.id).toBe('row');
    expect(doc.warnings.map((w) => w.code)).toEqual(['unresolved-reference', 'unresolved-reference', 'unresolved-reference']);
    expect(doc.warnings[0]?.message).toMatch(/cycle through "#loop"/);
    expect(doc.warnings[1]?.message).toMatch(/"#nowhere" which does not exist/);
    expect(doc.warnings[2]?.message).toMatch(/without a local href/);
  });

  it('keeps patterns, masks, markers and filters as raw definitions that satisfy references', () => {
    const doc = parseSvg(`
      <svg>
        <defs>
          <pattern id="p" width="2" height="2" patternUnits="userSpaceOnUse"><circle r="1"/></pattern>
          <mask id="m"><rect width="1" height="1" fill="white"/></mask>
        </defs>
        <rect id="r" width="1" height="1" fill="url(#p)" mask="url(#m)"/>
      </svg>`);
    expect(doc.warnings).toEqual([]);
    expect(doc.defs.p).toMatchObject({ kind: 'raw', tag: 'pattern', id: 'p' });
    expect(doc.defs.m).toMatchObject({ kind: 'raw', tag: 'mask', id: 'm' });
    expect(shape(doc.getElementById('r')).style.fill).toEqual({ type: 'ref', id: 'p' });
    expect(shape(doc.getElementById('r')).style.mask).toBe('m');
  });
});
