import { parseSvg } from '../parse';

describe('planDocument', () => {
  it('flattens trivial groups and wraps groups that carry opacity, clip or transform', () => {
    const doc = parseSvg(`
      <svg viewBox="0 0 10 10">
        <g fill="red">
          <rect width="1" height="1"/>
          <g opacity="0.5"><circle r="1"/></g>
          <g transform="translate(1 1)" id="moved"><line x2="1"/></g>
          <g clip-path="url(#c)"><text x="0" y="0">hi</text></g>
        </g>
      </svg>`);
    const kinds = doc.plan().units.map((u) => u.kind);
    expect(kinds).toEqual([
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
    const moved = doc.plan().units[4];
    expect(moved).toEqual({ kind: 'group-begin', id: 'moved', transform: [1, 0, 0, 1, 1, 1] });
    expect(doc.plan().units[1]).toEqual({ kind: 'group-begin', opacity: 0.5 });
    expect(doc.plan().units[7]).toEqual({ kind: 'group-begin', clipPath: 'c' });
  });

  it('skips hidden leaves and counts static units', () => {
    const doc = parseSvg(`
      <svg>
        <rect width="1" height="1" visibility="hidden"/>
        <g visibility="hidden"><rect width="1" height="1" visibility="visible"/></g>
        <rect id="a" width="1" height="1"/>
      </svg>`);
    const plan = doc.plan();
    expect(plan.units.map((u) => u.kind)).toEqual(['shape', 'shape']);
    expect(plan.staticCount).toBe(2);
    expect(plan.batched).toBe(false);
  });

  it('marks interactive nodes and caches the default plan', () => {
    const doc = parseSvg('<svg><rect id="room" width="1" height="1"/><rect width="1" height="1"/></svg>');
    const plan = doc.plan({ interactive: (node) => node.id === 'room' });
    expect(plan.dynamicIds).toEqual(new Set(['room']));
    expect(plan.staticCount).toBe(1);
    expect(plan.units[0]).toMatchObject({ kind: 'shape', interactive: true });
    expect(doc.plan()).toBe(doc.plan());
  });
});
