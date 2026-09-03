import { parseSvg } from '@nikpnevmatikos/svg-core';
import { buildOverrides, interactiveFor, nextSelection, resolveDecorators, resolveInteractive, sameSelection } from './interactive';

describe('nextSelection', () => {
  it('toggles the single selected element', () => {
    expect(nextSelection('single', [], 'a')).toEqual(['a']);
    expect(nextSelection('single', ['a'], 'a')).toEqual([]);
    expect(nextSelection('single', ['a'], 'b')).toEqual(['b']);
  });

  it('toggles membership in multiple mode and keeps order', () => {
    expect(nextSelection('multiple', [], 'a')).toEqual(['a']);
    expect(nextSelection('multiple', ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextSelection('multiple', ['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('leaves the selection alone when off, and compares selections', () => {
    expect(nextSelection('none', ['a'], 'b')).toEqual(['a']);
    expect(sameSelection(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSelection([], [])).toBe(true);
  });
});

const doc = parseSvg(`
  <svg viewBox="0 0 100 100">
    <g id="rooms">
      <rect id="a" class="room" x="0" y="0" width="10" height="10"/>
      <g id="b" class="room"><rect id="b-shape" x="20" y="0" width="10" height="10"/><text x="25" y="5">B</text></g>
      <circle id="c" cx="50" cy="50" r="5"/>
    </g>
  </svg>`);

describe('resolveInteractive', () => {
  it('accepts records (attaching data), selectors and predicates', () => {
    const record = resolveInteractive(doc, { a: { name: 'A' }, b: { name: 'B' }, missing: {} });
    expect(record.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(record.isInteractive(doc.getElementById('a')!)).toBe(true);
    expect(record.isInteractive(doc.getElementById('c')!)).toBe(false);
    expect(record.dataFor(doc.getElementById('b')!)).toEqual({ name: 'B' });
    expect(doc.getElementById('a')!.data).toEqual({ name: 'A' });

    const selector = resolveInteractive(doc, '.room');
    expect(selector.nodes.map((n) => n.id)).toEqual(['a', 'b']);

    const predicate = resolveInteractive(doc, (n) => n.tag === 'circle');
    expect(predicate.nodes.map((n) => n.id)).toEqual(['c']);
    expect(resolveInteractive(doc, undefined).nodes).toEqual([]);
  });

  it('walks up from a hit leaf to the interactive ancestor', () => {
    const { isInteractive } = resolveInteractive(doc, '.room');
    expect(interactiveFor(doc.getElementById('b-shape')!, isInteractive)?.id).toBe('b');
    expect(interactiveFor(doc.getElementById('a')!, isInteractive)?.id).toBe('a');
    expect(interactiveFor(doc.getElementById('c')!, isInteractive)).toBeNull();
  });
});

describe('buildOverrides', () => {
  it('maps ids and selectors to nodes and merges later keys', () => {
    const overrides = buildOverrides(doc, {
      '.room': { fillOpacity: 0.5 },
      a: { strokeWidth: 3 },
    });
    expect(overrides.get(doc.getElementById('a')!)).toEqual({ fillOpacity: 0.5, strokeWidth: 3 });
    expect(overrides.get(doc.getElementById('b')!)).toEqual({ fillOpacity: 0.5 });
    expect(overrides.has(doc.getElementById('c')!)).toBe(false);
    expect(buildOverrides(doc, undefined).size).toBe(0);
    expect(buildOverrides(doc, { 'rect:hover': { strokeWidth: 1 } }).size).toBe(0);
  });
});

describe('resolveDecorators', () => {
  it('produces anchor points per matching node', () => {
    const targets = resolveDecorators(doc, [
      { match: '.room', render: () => null },
      { match: (n) => n.id === 'c', anchor: 'topLeft', layer: 'svg', render: () => null },
    ]);
    expect(targets.map((t) => [t.node.id, t.decoratorIndex, t.anchor])).toEqual([
      ['a', 0, { x: 5, y: 5 }],
      ['b', 0, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })],
      ['c', 1, { x: 45, y: 45 }],
    ]);
    expect(targets[0]!.bbox).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});
