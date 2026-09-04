import { resolveOverlaps, type LabelCandidate } from './collision';

function label(key: string, x: number, y: number, priority = 0, size = 20): LabelCandidate {
  return { key, x, y, width: size, height: size, priority };
}

describe('resolveOverlaps', () => {
  it('keeps labels that do not touch', () => {
    const hidden = resolveOverlaps([label('a', 0, 0), label('b', 100, 0), label('c', 0, 100)]);
    expect(hidden.size).toBe(0);
  });

  it('hides the lower-priority label of an overlapping pair', () => {
    const hidden = resolveOverlaps([label('small', 0, 0, 1), label('big', 5, 5, 10)]);
    expect([...hidden]).toEqual(['small']);
  });

  it('keeps the earlier candidate when priorities tie', () => {
    const hidden = resolveOverlaps([label('first', 0, 0), label('second', 5, 5)]);
    expect([...hidden]).toEqual(['second']);
  });

  it('accounts for the gap between labels', () => {
    // Boxes of 20 px whose edges are exactly 1 px apart collide once a 2 px gap is required.
    expect(resolveOverlaps([label('a', 0, 0), label('b', 21, 0)], 0).size).toBe(0);
    expect(resolveOverlaps([label('a', 0, 0), label('b', 21, 0)], 2).size).toBe(1);
  });

  it('does not hide a label because of one that was itself hidden', () => {
    // b overlaps a (hidden), c overlaps b only: c must stay visible.
    const hidden = resolveOverlaps([label('a', 0, 0, 3), label('b', 12, 0, 2), label('c', 30, 0, 1)]);
    expect([...hidden]).toEqual(['b']);
  });
});
