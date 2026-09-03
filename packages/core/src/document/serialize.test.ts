import { nodeBBox } from '../geometry/bbox';
import { parseSvg } from '../parse';
import { toSvgString } from './emit';
import { deserializeDocument, IR_FORMAT, IR_VERSION, serializeDocument } from './serialize';

const FIXTURE = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="400">
    <defs>
      <style>.room { fill: #dbeafe; stroke: #1e40af }</style>
      <linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
      <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
      <pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2"/></pattern>
      <symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
    </defs>
    <rect id="a" class="room" x="10" y="10" width="50" height="30" rx="3"/>
    <g id="wing" transform="translate(100 0) rotate(5)" opacity="0.9">
      <path id="b" class="room" d="M0 10 h40 v30 h-40 z" fill="url(#g)"/>
      <text id="t" x="20" y="60" font-size="8">Hi <tspan fill="green" dx="1">there</tspan></text>
    </g>
    <g clip-path="url(#c)"><rect width="200" height="100" fill="url(#p)"/></g>
    <use href="#s" x="150" y="70" width="20" height="20"/>
    <image href="https://example.com/i.png" x="0" y="80" width="20" height="20"/>
    <rect width="1" height="1" fill="url(#missing)"/>
  </svg>`;

describe('serializeDocument / deserializeDocument', () => {
  const original = parseSvg(FIXTURE);
  const json = JSON.stringify(serializeDocument(original));
  const restored = deserializeDocument(json);

  it('produces a tagged, versioned, JSON-safe object', () => {
    const serialized = serializeDocument(original);
    expect(serialized.format).toBe(IR_FORMAT);
    expect(serialized.version).toBe(IR_VERSION);
    expect(JSON.parse(json).root.kind).toBe('group');
    expect(json).not.toContain('"parent"');
  });

  it('restores viewport, warnings, ids and parent links', () => {
    expect(restored.viewBox).toEqual(original.viewBox);
    expect(restored.width).toBe(400);
    expect(restored.height).toBeUndefined();
    expect(restored.preserveAspectRatio).toEqual(original.preserveAspectRatio);
    expect(restored.warnings).toEqual(original.warnings);
    expect(restored.contentBounds).toEqual(original.contentBounds);
    const b = restored.getElementById('b')!;
    expect(b.parent?.id).toBe('wing');
    expect(b.parent?.parent).toBe(restored.root);
    expect(restored.getElementById('nope')).toBeUndefined();
  });

  it('keeps geometry, styles, text runs and definitions', () => {
    for (const id of ['a', 'b', 't', 'wing']) {
      const before = original.getElementById(id)!;
      const after = restored.getElementById(id)!;
      expect(after.kind).toBe(before.kind);
      expect(nodeBBox(after, 'world')).toEqual(nodeBBox(before, 'world'));
      expect(after.style).toEqual(before.style);
    }
    const text = restored.getElementById('t');
    expect(text?.kind).toBe('text');
    if (text?.kind === 'text') {
      expect(text.runs.map((r) => r.text)).toEqual(['Hi ', 'there']);
      // The first run shares the node style by identity again; the second carries its own.
      expect(text.runs[0]?.style).toBe(text.style);
      expect(text.runs[1]?.style).not.toBe(text.style);
      expect(text.runs[1]?.style.fill).toEqual({ type: 'color', value: 'green' });
    }
    expect(restored.defs.g).toEqual(original.defs.g);
    expect(restored.defs.c).toMatchObject({ kind: 'clipPath', id: 'c' });
    expect(restored.defs.p).toMatchObject({ kind: 'raw', tag: 'pattern' });
  });

  it('round-trips to identical SVG output and identical plans', () => {
    expect(toSvgString(restored)).toBe(toSvgString(original));
    const before = original.plan();
    const after = restored.plan();
    expect(after.units.map((u) => u.kind)).toEqual(before.units.map((u) => u.kind));
    expect(after.batchCount).toBe(before.batchCount);
    expect(restored.querySelectorAll('.room').map((n) => n.id)).toEqual(['a', 'b']);
    expect(restored.elementsAt({ x: 20, y: 20 }).map((n) => n.id)).toEqual(original.elementsAt({ x: 20, y: 20 }).map((n) => n.id));
  });

  it('rejects foreign or newer payloads', () => {
    expect(() => deserializeDocument('{"format":"other","version":1}')).toThrow(/Not a svg-core-ir document/);
    expect(() => deserializeDocument(JSON.stringify({ ...serializeDocument(original), version: 99 }))).toThrow(/version 99/);
  });
});
