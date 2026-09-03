import { SpatialIndex } from './spatial';

describe('SpatialIndex', () => {
  const items: { item: string; box: { x: number; y: number; width: number; height: number } }[] = [];
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 20; c++) {
      items.push({ item: `${c},${r}`, box: { x: c * 10, y: r * 10, width: 8, height: 8 } });
    }
  }
  items.push({ item: 'big', box: { x: 0, y: 0, width: 200, height: 200 } });
  const index = new SpatialIndex(items);

  it('returns candidates under a point in insertion order', () => {
    expect(index.query({ x: 34, y: 54 })).toEqual(['3,5', 'big']);
    expect(index.query({ x: 39, y: 54 })).toEqual(['big']); // in the gap between cells
    expect(index.query({ x: 39, y: 54 }, 1)).toEqual(['3,5', '4,5', 'big']); // tolerance grows the boxes on both sides
    expect(index.query({ x: 500, y: 500 })).toEqual([]);
  });

  it('returns candidates intersecting a rectangle', () => {
    const hits = index.queryRect({ x: 15, y: 15, width: 20, height: 5 });
    expect(hits).toEqual(['1,1', '2,1', '3,1', 'big']);
  });

  it('handles empty input', () => {
    const empty = new SpatialIndex<string>([]);
    expect(empty.size).toBe(0);
    expect(empty.query({ x: 0, y: 0 })).toEqual([]);
    expect(empty.queryRect({ x: 0, y: 0, width: 1, height: 1 })).toEqual([]);
  });
});
