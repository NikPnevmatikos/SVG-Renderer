import { parseSelectorList, splitTopLevel } from './selector';

describe('splitTopLevel', () => {
  it('splits outside quotes, parentheses and brackets', () => {
    expect(splitTopLevel('a, b[x=","], c(1,2), "d,e"', ',')).toEqual(['a', ' b[x=","]', ' c(1,2)', ' "d,e"']);
    expect(splitTopLevel('fill: url(#a); stroke: red', ';')).toEqual(['fill: url(#a)', ' stroke: red']);
  });
});

describe('parseSelectorList', () => {
  it('parses compounds, combinators and lists', () => {
    const { selectors, unsupported, invalid } = parseSelectorList('g.room > rect#a.b[data-x="1"], text');
    expect(unsupported).toEqual([]);
    expect(invalid).toEqual([]);
    expect(selectors).toHaveLength(2);
    const first = selectors[0]!;
    expect(first.combinators).toEqual(['child']);
    expect(first.compounds[0]).toMatchObject({ tag: 'g', classes: ['room'], id: null });
    expect(first.compounds[1]).toMatchObject({
      tag: 'rect',
      id: 'a',
      classes: ['b'],
      attributes: [{ name: 'data-x', operator: '=', value: '1', caseInsensitive: false }],
    });
    expect(first.specificity).toEqual([1, 3, 2]);
    expect(selectors[1]!.specificity).toEqual([0, 0, 1]);
  });

  it('parses descendant, adjacent and sibling combinators with loose whitespace', () => {
    const { selectors } = parseSelectorList('svg   g\n rect + circle ~ path');
    expect(selectors[0]!.combinators).toEqual(['descendant', 'descendant', 'adjacent', 'sibling']);
    expect(selectors[0]!.compounds.map((c) => c.tag)).toEqual(['svg', 'g', 'rect', 'circle', 'path']);
  });

  it('parses attribute operators, quotes and the case flag', () => {
    const { selectors } = parseSelectorList("[a][b~=x][c|='y'][d^=z][e$=w][f*=v i]");
    const attrs = selectors[0]!.compounds[0]!.attributes;
    expect(attrs.map((a) => a.operator)).toEqual(['exists', '~=', '|=', '^=', '$=', '*=']);
    expect(attrs[2]!.value).toBe('y');
    expect(attrs[5]!.caseInsensitive).toBe(true);
    expect(selectors[0]!.specificity).toEqual([0, 6, 0]);
  });

  it('handles the universal selector and escaped identifiers', () => {
    const { selectors } = parseSelectorList('*, .cls\\:1, #\\31 23');
    expect(selectors[0]!.compounds[0]!.tag).toBeNull();
    expect(selectors[0]!.specificity).toEqual([0, 0, 0]);
    expect(selectors[1]!.compounds[0]!.classes).toEqual(['cls:1']);
    expect(selectors[2]!.compounds[0]!.id).toBe('123');
  });

  it('keeps supported structural pseudo-classes and reports the rest', () => {
    const { selectors, unsupported } = parseSelectorList('g > rect:first-child, rect:hover, a::before, li:nth-child(2n+1)');
    expect(selectors).toHaveLength(1);
    expect(selectors[0]!.compounds[1]!.pseudoClasses).toEqual(['first-child']);
    expect(selectors[0]!.specificity).toEqual([0, 1, 2]);
    expect(unsupported).toEqual(['rect:hover', 'a::before', 'li:nth-child(2n+1)']);
  });

  it('reports syntax errors without dropping the rest of the list', () => {
    const { selectors, invalid } = parseSelectorList('rect, > g, #, .a.b, rect#x y >, [a=]');
    expect(selectors.map((s) => s.text)).toEqual(['rect', '.a.b']);
    expect(invalid).toEqual(['> g', '#', 'rect#x y >', '[a=]']);
  });
});
