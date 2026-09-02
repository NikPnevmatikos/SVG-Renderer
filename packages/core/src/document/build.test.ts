import { nodeBBox } from '../geometry/bbox';
import { parseSvg } from '../parse';
import type { ShapeNode, TextNode } from '../types';

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
    expect(doc.defs).toEqual({ grad: { id: 'grad', tag: 'linearGradient' } });
    expect(doc.warnings.map((w) => w.code)).toEqual([
      'stylesheet-unsupported',
      'use-unsupported',
      'unsupported-element',
    ]);
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

  it('treats nested svg as a translated group and switch as first child', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 100 100">
        <svg x="10" y="10" viewBox="0 0 5 5"><rect id="inner" width="1" height="1"/></svg>
        <switch><rect id="first" width="1" height="1"/><rect id="second" width="1" height="1"/></switch>
      </svg>`);
    expect(nodeBBox(doc.getElementById('inner')!, 'world')).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    expect(doc.getElementById('first')).toBeDefined();
    expect(doc.getElementById('second')).toBeUndefined();
    expect(doc.warnings.map((w) => w.code)).toEqual(['nested-svg']);
  });

  it('forwards warnings to onWarning', () => {
    const seen: string[] = [];
    parseSvg('<svg><use href="#x"/></svg>', { onWarning: (w) => seen.push(w.code) });
    expect(seen).toEqual(['use-unsupported']);
  });

  it('rejects unsupported selectors clearly', () => {
    const doc = parseSvg('<svg/>');
    expect(() => doc.querySelectorAll('g > rect')).toThrow(/Unsupported selector/);
  });
});
