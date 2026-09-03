import { parseXml, type XmlElement } from '../xml/tokenize';
import { xmlAdapter } from './adapters';
import { cascadeDeclarations, Stylesheet } from './cascade';
import { parseStylesheet } from './parse';
import { extractCustomProperties, substituteVars } from './vars';

const firstElement = (el: XmlElement, name: string): XmlElement => {
  for (const child of el.children) {
    if (child.type === 'element') {
      if (child.name === name) return child;
      const found = child.children.length > 0 ? findDeep(child, name) : null;
      if (found) return found;
    }
  }
  throw new Error(`no <${name}>`);
};
const findDeep = (el: XmlElement, name: string): XmlElement | null => {
  for (const child of el.children) {
    if (child.type !== 'element') continue;
    if (child.name === name) return child;
    const found = findDeep(child, name);
    if (found) return found;
  }
  return null;
};

describe('parseStylesheet', () => {
  it('parses rules, comments, importance and CDATA remnants', () => {
    const { rules, warnings } = parseStylesheet(`
      <!--
      /* Illustrator export */
      .cls-1, .cls-2 { fill: none; }
      .cls-1 { stroke: #000; stroke-width: .5px !important }
      #vip{fill:#fcd34d;stroke:url(#grad)}
      -->`);
    expect(warnings).toEqual([]);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.selectors.map((s) => s.text)).toEqual(['.cls-1', '.cls-2']);
    expect(rules[0]!.declarations).toEqual([{ name: 'fill', value: 'none', important: false }]);
    expect(rules[1]!.declarations).toEqual([
      { name: 'stroke', value: '#000', important: false },
      { name: 'stroke-width', value: '.5px', important: true },
    ]);
    expect(rules[2]!.declarations[1]).toEqual({ name: 'stroke', value: 'url(#grad)', important: false });
    expect(rules.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('skips at-rules and unsupported selectors with warnings, keeping the rest', () => {
    const { rules, warnings } = parseStylesheet(`
      @import url("x.css");
      @media (max-width: 600px) { .a { fill: red } }
      @font-face { font-family: X; src: url(x.woff) }
      .a:hover, .b { fill: blue }
      .c { fill: green`);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.selectors.map((s) => s.text)).toEqual(['.b']);
    expect(warnings).toEqual([
      '@import rules are not supported and were skipped',
      '@media rules are not supported and were skipped',
      '@font-face rules are not supported and were skipped',
      'Selector ".a:hover" is not supported and was skipped',
      'Unterminated rule block was ignored',
    ]);
  });
});

describe('Stylesheet.collect and cascadeDeclarations', () => {
  const xml = parseXml(`
    <svg>
      <style>
        rect { fill: red; stroke: black }
        .room { fill: blue }
        g .room { stroke: green }
        #vip { fill: gold !important }
        .late { fill: purple }
      </style>
      <g>
        <rect id="vip" class="room late" fill="gray" style="fill: white; stroke-width: 3"/>
        <rect id="plain"/>
        <circle id="c" class="late room" style="stroke: silver !important"/>
      </g>
    </svg>`);
  const { stylesheet, warnings } = Stylesheet.parse(
    (findDeep(xml, 'style')!.children[0] as { value: string }).value
  );

  it('orders by specificity then source order', () => {
    expect(warnings).toEqual([]);
    const vip = findDeep(xml, 'rect')!;
    const collected = stylesheet.collect(vip, xmlAdapter);
    // g .room (0,1,0) beats rect (0,0,1) for stroke; .late beats .room by order for fill.
    expect(collected.normal).toEqual({ fill: 'purple', stroke: 'green' });
    expect(collected.important).toEqual({ fill: 'gold' });

    const plain = firstElement(xml, 'g').children.filter((c) => c.type === 'element')[1] as XmlElement;
    expect(stylesheet.collect(plain, xmlAdapter)).toEqual({ normal: { fill: 'red', stroke: 'black' }, important: {} });
  });

  it('cascades presentation attributes, stylesheet, inline and !important in the right order', () => {
    const vip = findDeep(xml, 'rect')!;
    const declarations = cascadeDeclarations(vip.attrs, stylesheet.collect(vip, xmlAdapter));
    // stylesheet !important beats inline; inline beats stylesheet normal; stylesheet beats attribute.
    expect(declarations).toEqual({ fill: 'gold', stroke: 'green', 'stroke-width': '3' });

    const circle = findDeep(xml, 'circle')!;
    const circleDecl = cascadeDeclarations(circle.attrs, stylesheet.collect(circle, xmlAdapter));
    expect(circleDecl).toEqual({ fill: 'purple', stroke: 'silver' });

    // Without a stylesheet the attribute/inline order still holds.
    expect(cascadeDeclarations({ fill: 'a', style: 'fill: b' }, null)).toEqual({ fill: 'b' });
    expect(cascadeDeclarations({ fill: 'a', style: 'fill: b !important' }, null)).toEqual({ fill: 'b' });
  });
});

describe('custom properties', () => {
  it('extracts and substitutes variables with fallbacks and nesting', () => {
    const vars = extractCustomProperties({ '--brand': '#123', '--edge': 'var(--brand)', fill: 'x' })!;
    expect(vars).toEqual({ '--brand': '#123', '--edge': 'var(--brand)' });
    expect(substituteVars('var(--brand)', vars)).toBe('#123');
    expect(substituteVars('var(--edge)', vars)).toBe('#123');
    expect(substituteVars('var(--missing, red)', vars)).toBe('red');
    expect(substituteVars('var(--missing, var(--brand))', vars)).toBe('#123');
    expect(substituteVars('var(--missing)', vars)).toBe('');
    expect(substituteVars('1px solid var(--brand)', vars)).toBe('1px solid #123');
    expect(extractCustomProperties({ fill: 'red' })).toBeNull();
  });

  it('survives self-referencing variables', () => {
    expect(substituteVars('var(--a)', { '--a': 'var(--a)' })).toBe('');
  });
});
