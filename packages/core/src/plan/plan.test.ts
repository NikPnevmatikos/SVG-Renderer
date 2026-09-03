import { pathBBox, serializePathData } from '../geometry/path';
import { splitSubpaths, subpathSignedArea } from '../geometry/winding';
import { parseSvg } from '../parse';
import type { DrawUnit } from '../types';

const batch = (unit: DrawUnit | undefined): Extract<DrawUnit, { kind: 'batch' }> => {
  if (!unit || unit.kind !== 'batch') throw new Error(`expected batch, got ${unit?.kind ?? 'nothing'}`);
  return unit;
};

describe('planDocument without batching', () => {
  it('flattens trivial groups and wraps groups that carry opacity, clip or transform', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 10 10">
        <defs><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>
        <g fill="red">
          <rect width="1" height="1"/>
          <g opacity="0.5"><circle r="1"/></g>
          <g transform="translate(1 1)" id="moved"><line x2="1"/></g>
          <g clip-path="url(#c)"><text x="0" y="0">hi</text></g>
        </g>
      </svg>`);
    const plan = doc.plan({ batching: false });
    expect(plan.units.map((u) => u.kind)).toEqual([
      'shape',
      'group-begin',
      'shape',
      'group-end',
      'group-begin',
      'shape',
      'group-end',
      'group-begin',
      'text',
      'group-end',
    ]);
    expect(plan.units[4]).toEqual({ kind: 'group-begin', id: 'moved', transform: [1, 0, 0, 1, 1, 1] });
    expect(plan.units[1]).toEqual({ kind: 'group-begin', opacity: 0.5 });
    expect(plan.units[7]).toEqual({ kind: 'group-begin', clipPath: 'c' });
    expect(plan.batched).toBe(false);
  });

  it('skips hidden leaves and counts static units', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="1" height="1" visibility="hidden"/>
        <g visibility="hidden"><rect width="1" height="1" visibility="visible"/></g>
        <rect id="a" width="1" height="1"/>
      </svg>`);
    const plan = doc.plan({ batching: false });
    expect(plan.units.map((u) => u.kind)).toEqual(['shape', 'shape']);
    expect(plan.staticCount).toBe(2);
  });

  it('marks interactive nodes and caches the default plan', () => {
    const doc = parseSvg('<svg><rect id="room" width="1" height="1"/><rect width="1" height="1"/></svg>');
    const plan = doc.plan({ interactive: (node) => node.id === 'room', batching: false });
    expect(plan.dynamicIds).toEqual(new Set(['room']));
    expect(plan.staticCount).toBe(1);
    expect(plan.units[0]).toMatchObject({ kind: 'shape', interactive: true });
    expect(doc.plan()).toBe(doc.plan());
  });
});

describe('style batching', () => {
  it('merges a grid of same-styled rects into one path and keeps different styles apart', () => {
    const rects: string[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        rects.push(`<rect x="${c * 10}" y="${r * 10}" width="8" height="8" fill="#dbeafe" stroke="#334155" stroke-width="0.5"/>`);
      }
    }
    const doc = parseSvg(`<svg viewBox="0 0 100 100">${rects.join('')}<rect x="0" y="0" width="1" height="1" fill="red"/></svg>`);
    const plan = doc.plan();
    expect(plan.batched).toBe(true);
    expect(plan.units.map((u) => u.kind)).toEqual(['batch', 'shape']);
    const merged = batch(plan.units[0]);
    expect(merged.sources).toHaveLength(100);
    expect(splitSubpaths(merged.path)).toHaveLength(100);
    expect(merged.style.fill).toEqual({ type: 'color', value: '#dbeafe' });
    expect(merged.style.strokeWidth).toBe(0.5);
    expect(merged.bbox).toEqual({ x: 0, y: 0, width: 98, height: 98 });
    expect(plan.batchCount).toBe(1);
    expect(plan.mergedShapes).toBe(100);
    expect(plan.staticCount).toBe(101);
  });

  it('merges interleaved styles when nothing painted in between overlaps', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="1" height="1" fill="red"/>
        <rect x="2" width="1" height="1" fill="blue"/>
        <rect x="4" width="1" height="1" fill="red"/>
        <rect x="6" width="1" height="1" fill="red"/>
      </svg>`);
    const plan = doc.plan();
    // The red run is emitted where its first shape was; blue keeps its place.
    expect(plan.units.map((u) => u.kind)).toEqual(['batch', 'shape']);
    expect(batch(plan.units[0]).sources).toHaveLength(3);
    expect(plan.batchCount).toBe(1);
  });

  it('never moves a shape across something it overlaps', () => {
    const doc = parseSvg(`
      <svg>
        <rect id="a" width="10" height="10" fill="red"/>
        <rect id="b" x="5" y="5" width="10" height="10" fill="blue"/>
        <rect id="c" x="20" width="5" height="5" fill="red"/>
        <rect id="d" x="8" y="8" width="4" height="4" fill="red"/>
        <rect id="e" x="30" width="1" height="1" fill="red"/>
      </svg>`);
    const plan = doc.plan();
    // a and c merge (c is clear of b); d overlaps b so it must stay after b and starts a new run,
    // which e then joins.
    expect(plan.units.map((u) => u.kind)).toEqual(['batch', 'shape', 'batch']);
    expect(batch(plan.units[0]).sources.map((n) => n.id)).toEqual(['a', 'c']);
    expect(plan.units[1]).toMatchObject({ kind: 'shape', node: { id: 'b' } });
    expect(batch(plan.units[2]).sources.map((n) => n.id)).toEqual(['d', 'e']);
  });

  it('keeps interactive shapes individual at their position', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="1" height="1"/><rect x="2" width="1" height="1"/>
        <rect id="room" x="4" width="1" height="1"/>
        <rect x="6" width="1" height="1"/><rect x="8" width="1" height="1"/>
      </svg>`);
    const plan = doc.plan({ interactive: (n) => n.id === 'room' });
    // The four static rects do not overlap the room, so they form one batch before it.
    expect(plan.units.map((u) => u.kind)).toEqual(['batch', 'shape']);
    expect(batch(plan.units[0]).sources).toHaveLength(4);
    expect(plan.units[1]).toMatchObject({ kind: 'shape', interactive: true });
    expect(plan.dynamicIds).toEqual(new Set(['room']));

    const overlapping = parseSvg(`
      <svg>
        <rect width="10" height="10"/>
        <rect id="room" x="5" y="5" width="10" height="10"/>
        <rect x="8" y="8" width="10" height="10"/>
      </svg>`);
    const overlappingPlan = overlapping.plan({ interactive: (n) => n.id === 'room' });
    expect(overlappingPlan.units.map((u) => u.kind)).toEqual(['shape', 'shape', 'shape']);
  });

  it('flattens local transforms into the path and scales stroke metrics', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="10" height="10" fill="none" stroke="#000" stroke-width="2" transform="translate(5 5)"/>
        <rect width="10" height="10" fill="none" stroke="#000" stroke-width="1" transform="scale(2) rotate(90)"/>
      </svg>`);
    const merged = batch(doc.plan().units[0]);
    expect(merged.sources).toHaveLength(2);
    // Both end up with an effective stroke width of 2 in the parent space.
    expect(merged.style.strokeWidth).toBe(2);
    expect(pathBBox(merged.path)).toEqual({ x: -20, y: 0, width: 35, height: 20 });
  });

  it('does not batch strokes under non-uniform transforms but batches fills', () => {
    const stroked = parseSvg(`
      <svg>
        <rect width="1" height="1" fill="none" stroke="#000" transform="scale(2 1)"/>
        <rect width="1" height="1" fill="none" stroke="#000"/>
      </svg>`);
    expect(stroked.plan().units.map((u) => u.kind)).toEqual(['shape', 'shape']);
    const filled = parseSvg(`
      <svg>
        <rect width="1" height="1" transform="scale(2 1)"/>
        <rect x="5" width="1" height="1"/>
      </svg>`);
    expect(filled.plan().units.map((u) => u.kind)).toEqual(['batch']);
  });

  it('excludes shapes whose merged rendering could differ', () => {
    const doc = parseSvg(`
      <svg>
        <defs><linearGradient id="g"><stop offset="0"/></linearGradient><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>
        <rect width="1" height="1" fill-opacity="0.5"/><rect x="2" width="1" height="1" fill-opacity="0.5"/>
        <rect x="4" width="1" height="1" fill-rule="evenodd"/><rect x="6" width="1" height="1" fill-rule="evenodd"/>
        <rect x="8" width="1" height="1" fill="none" stroke="#000" stroke-dasharray="1 1"/><rect x="10" width="1" height="1" fill="none" stroke="#000" stroke-dasharray="1 1"/>
        <rect x="12" width="1" height="1" fill="url(#g)"/><rect x="14" width="1" height="1" fill="url(#g)"/>
        <rect x="16" width="1" height="1" clip-path="url(#c)"/><rect x="18" width="1" height="1" clip-path="url(#c)"/>
        <rect x="20" width="1" height="1" opacity="0.9"/><rect x="22" width="1" height="1" opacity="0.9"/>
        <rect x="24" width="1" height="1" fill="none" stroke="#000" vector-effect="non-scaling-stroke"/><rect x="26" width="1" height="1" fill="none" stroke="#000" vector-effect="non-scaling-stroke"/>
      </svg>`);
    const plan = doc.plan();
    expect(plan.units.every((u) => u.kind === 'shape')).toBe(true);
    expect(plan.units).toHaveLength(14);
    expect(plan.batchCount).toBe(0);
  });

  it('separates overlapping fill-and-stroke shapes but merges non-overlapping ones', () => {
    const overlapping = parseSvg(`
      <svg>
        <rect width="10" height="10" fill="red" stroke="#000"/>
        <rect x="5" y="5" width="10" height="10" fill="red" stroke="#000"/>
      </svg>`);
    expect(overlapping.plan().units.map((u) => u.kind)).toEqual(['shape', 'shape']);
    const apart = parseSvg(`
      <svg>
        <rect width="10" height="10" fill="red" stroke="#000"/>
        <rect x="20" width="10" height="10" fill="red" stroke="#000"/>
      </svg>`);
    expect(apart.plan().units.map((u) => u.kind)).toEqual(['batch']);
  });

  it('normalizes winding so overlapping fills stay filled under nonzero', () => {
    const doc = parseSvg(`
      <svg>
        <polygon points="0,0 10,0 10,10 0,10"/>
        <polygon points="5,5 5,15 15,15 15,5"/>
      </svg>`);
    const merged = batch(doc.plan().units[0]);
    const subpaths = splitSubpaths(merged.path);
    expect(subpaths).toHaveLength(2);
    for (const subpath of subpaths) expect(subpathSignedArea(subpath)).toBeGreaterThan(0);
    // The second polygon was authored in the opposite direction and is reversed in place.
    expect(serializePathData(merged.path)).toBe('M0 0L10 0L10 10L0 10ZM15 5L15 15L5 15L5 5Z');
  });

  it('closes runs at group boundaries and text, and leaves single shapes as shapes', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="1" height="1"/><rect x="2" width="1" height="1"/>
        <g transform="translate(1 1)"><rect width="1" height="1"/><rect x="2" width="1" height="1"/></g>
        <rect x="4" width="1" height="1"/>
        <text x="0" y="0">t</text>
        <rect x="6" width="1" height="1"/>
      </svg>`);
    expect(doc.plan().units.map((u) => u.kind)).toEqual([
      'batch',
      'group-begin',
      'batch',
      'group-end',
      'shape',
      'text',
      'shape',
    ]);
  });

  it('collapses an interleaved grid to one path per style', () => {
    const rects: string[] = [];
    const fills = ['#a', '#b', '#c', '#d', '#e', '#f'];
    for (let r = 0; r < 25; r++) {
      for (let c = 0; c < 40; c++) {
        rects.push(`<rect x="${c * 30}" y="${r * 30}" width="24" height="24" fill="${fills[(r * 7 + c) % 6]}" stroke="#333" stroke-width="0.5"/>`);
      }
      rects.push(`<line x1="0" y1="${r * 30 - 3}" x2="1200" y2="${r * 30 - 3}" stroke="#ccc" stroke-width="0.25"/>`);
    }
    const doc = parseSvg(`<svg viewBox="0 0 1200 750">${rects.join('')}</svg>`);
    const plan = doc.plan();
    expect(plan.units.every((u) => u.kind === 'batch')).toBe(true);
    expect(plan.units).toHaveLength(7);
    expect(plan.mergedShapes).toBe(1025);
    expect(plan.staticCount).toBe(1025);
  });
});
