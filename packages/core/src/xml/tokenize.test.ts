import { parseXml, SvgParseError, type XmlElement, type XmlText } from './tokenize';

const el = (node: XmlElement['children'][number]): XmlElement => {
  if (node.type !== 'element') throw new Error('expected element');
  return node;
};
const text = (node: XmlElement['children'][number]): XmlText => {
  if (node.type !== 'text') throw new Error('expected text');
  return node;
};

describe('parseXml', () => {
  it('parses nested elements with attributes', () => {
    const root = parseXml('<svg viewBox="0 0 10 10"><g id="a"><rect x="1" y=\'2\'/></g></svg>');
    expect(root.name).toBe('svg');
    expect(root.attrs).toEqual({ viewBox: '0 0 10 10' });
    const g = el(root.children[0]!);
    expect(g.name).toBe('g');
    expect(g.attrs.id).toBe('a');
    const rect = el(g.children[0]!);
    expect(rect.name).toBe('rect');
    expect(rect.attrs).toEqual({ x: '1', y: '2' });
    expect(rect.children).toHaveLength(0);
    expect(rect.parent).toBe(g);
  });

  it('skips prolog, doctype, comments and processing instructions', () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [ <!ENTITY ns_svg "x"> ]>\n' +
        '<!-- a comment > with a gt -->\n' +
        '<svg><?pi data?><!-- inner --><rect/></svg>'
    );
    expect(root.name).toBe('svg');
    expect(root.children).toHaveLength(1);
    expect(el(root.children[0]!).name).toBe('rect');
  });

  it('decodes entities in text and attributes, keeps CDATA raw', () => {
    const root = parseXml(
      '<svg><text title="a &amp; b &lt;c&gt; &#65;&#x42;">x &amp; y &quot;z&quot;</text><style><![CDATA[.a { fill: red } &amp;]]></style></svg>'
    );
    const t = el(root.children[0]!);
    expect(t.attrs.title).toBe('a & b <c> AB');
    expect(text(t.children[0]!).value).toBe('x & y "z"');
    const style = el(root.children[1]!);
    expect(text(style.children[0]!).value).toBe('.a { fill: red } &amp;');
  });

  it('merges adjacent text nodes and preserves whitespace', () => {
    const root = parseXml('<svg><text> a <![CDATA[b]]> c </text></svg>');
    const t = el(root.children[0]!);
    expect(t.children).toHaveLength(1);
    expect(text(t.children[0]!).value).toBe(' a b c ');
  });

  it('normalizes the svg: namespace prefix and keeps other prefixes', () => {
    const root = parseXml(
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:rect/><sodipodi:namedview inkscape:zoom="1"/></svg:svg>'
    );
    expect(root.name).toBe('svg');
    expect(el(root.children[0]!).name).toBe('rect');
    const nv = el(root.children[1]!);
    expect(nv.name).toBe('sodipodi:namedview');
    expect(nv.attrs['inkscape:zoom']).toBe('1');
  });

  it('tolerates unquoted and valueless attributes', () => {
    const root = parseXml('<svg><rect x=1 hidden/></svg>');
    const rect = el(root.children[0]!);
    expect(rect.attrs).toEqual({ x: '1', hidden: '' });
  });

  it('handles attribute values containing > and newlines between attributes', () => {
    const root = parseXml('<svg>\n  <path\n    d="M0 0 L1 1"\n    data-x="a>b"\n  />\n</svg>');
    // Whitespace between tags is kept as text nodes; skip to the element.
    const path = el(root.children.find((child) => child.type === 'element')!);
    expect(path.attrs.d).toBe('M0 0 L1 1');
    expect(path.attrs['data-x']).toBe('a>b');
  });

  it('throws on mismatched closing tags', () => {
    expect(() => parseXml('<svg><g></svg>')).toThrow(SvgParseError);
    expect(() => parseXml('<svg><g></svg>')).toThrow(/Mismatched closing tag/);
  });

  it('throws on unclosed root', () => {
    expect(() => parseXml('<svg><rect/>')).toThrow(/Unclosed tag <svg>/);
  });

  it('throws on multiple roots and on empty input', () => {
    expect(() => parseXml('<svg/><svg/>')).toThrow(/Multiple root elements/);
    expect(() => parseXml('   ')).toThrow(/No root element/);
  });

  it('reports the offset of the problem', () => {
    try {
      parseXml('<svg><rect></svg>');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SvgParseError);
      expect((error as SvgParseError).position).toBe(11);
    }
  });
});
