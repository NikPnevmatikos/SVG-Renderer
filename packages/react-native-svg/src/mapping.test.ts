import { createDefaultStyle, parseSvg } from '@nikpnevmatikos/svg-core';
import { matrixToTransform, paintToString, planToTree, styleToProps, type ElementDesc } from './mapping';

const tree = (xml: string, options?: { width?: number | string; height?: number | string }): ElementDesc => {
  const doc = parseSvg(xml);
  return planToTree(doc.plan(), doc, options);
};

describe('styleToProps', () => {
  it('emits only non-default props', () => {
    expect(styleToProps(createDefaultStyle())).toEqual({ fill: 'black' });
  });

  it('emits stroke props only when there is a stroke', () => {
    const style = createDefaultStyle();
    style.fill = { type: 'none' };
    style.stroke = { type: 'color', value: '#333' };
    style.strokeWidth = 2;
    style.strokeLinecap = 'round';
    style.strokeDasharray = [4, 2];
    style.opacity = 0.5;
    style.clipPath = 'clip';
    expect(styleToProps(style)).toEqual({
      fill: 'none',
      stroke: '#333',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeDasharray: [4, 2],
      opacity: 0.5,
      clipPath: 'url(#clip)',
    });
  });

  it('formats paints and transforms', () => {
    expect(paintToString({ type: 'ref', id: 'g', fallback: 'red' })).toBe('url(#g)');
    expect(matrixToTransform([1, 0, 0, 1, 0, 0])).toBeUndefined();
    expect(matrixToTransform([2, 0, 0, 2, 10, 5])).toBe('matrix(2 0 0 2 10 5)');
  });
});

describe('planToTree', () => {
  it('builds the root Svg with viewBox and sizing', () => {
    const root = tree('<svg viewBox="0 0 100 50"/>', { width: 200 });
    expect(root.type).toBe('Svg');
    expect(root.props).toEqual({
      width: 200,
      height: '100%',
      viewBox: '0 0 100 50',
      preserveAspectRatio: 'xMidYMid meet',
    });
    expect(root.children).toEqual([]);
  });

  it('falls back to content bounds when there is no viewBox', () => {
    const root = tree('<svg><rect x="5" y="5" width="10" height="20"/></svg>');
    expect(root.props.viewBox).toBe('5 5 10 20');
  });

  it('maps shapes with resolved style, ids and transforms', () => {
    const root = tree(`
      <svg viewBox="0 0 10 10">
        <g fill="red" stroke="blue" stroke-width="0.5">
          <rect id="r" x="1" y="2" width="3" height="4" rx="1" transform="translate(1 1)"/>
          <circle cx="1" cy="1" r="1" fill="none"/>
          <polygon points="0 0 1 0 1 1"/>
          <line x1="0" y1="0" x2="1" y2="1" stroke-dasharray="1 2"/>
        </g>
      </svg>`);
    const [rect, circle, polygon, line] = root.children;
    expect(rect).toEqual({
      type: 'Rect',
      key: 'u0',
      children: [],
      props: {
        fill: 'red',
        stroke: 'blue',
        strokeWidth: 0.5,
        id: 'r',
        transform: 'matrix(1 0 0 1 1 1)',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        rx: 1,
        ry: 1,
      },
    });
    expect(circle?.type).toBe('Circle');
    expect(circle?.props.fill).toBe('none');
    expect(polygon?.props.points).toBe('0,0 1,0 1,1');
    expect(line?.props.strokeDasharray).toEqual([1, 2]);
  });

  it('nests groups that need a wrapper and flattens the rest', () => {
    const root = tree(`
      <svg viewBox="0 0 10 10">
        <g><g opacity="0.5" transform="scale(2)"><rect width="1" height="1"/></g></g>
      </svg>`);
    expect(root.children).toHaveLength(1);
    const group = root.children[0]!;
    expect(group.type).toBe('G');
    expect(group.props).toEqual({ opacity: 0.5, transform: 'matrix(2 0 0 2 0 0)' });
    expect(group.children[0]?.type).toBe('Rect');
  });

  it('maps text with tspans and single-run text', () => {
    const root = tree(`
      <svg viewBox="0 0 10 10" font-family="Arial, Helvetica" font-size="12">
        <text x="1" y="2" text-anchor="middle">plain</text>
        <text x="1" y="2">a <tspan dx="1" fill="red" font-weight="bold">b</tspan></text>
      </svg>`);
    const [plain, rich] = root.children;
    expect(plain).toEqual({
      type: 'Text',
      key: 'u0',
      children: [],
      text: 'plain',
      props: { fill: 'black', fontSize: 12, fontFamily: 'Arial', textAnchor: 'middle', x: 1, y: 2 },
    });
    expect(rich?.children).toHaveLength(2);
    expect(rich?.children[0]).toMatchObject({ type: 'TSpan', text: 'a ', props: {} });
    expect(rich?.children[1]).toMatchObject({
      type: 'TSpan',
      text: 'b',
      props: { dx: 1, fill: 'red', fontWeight: 'bold', fontSize: 12, fontFamily: 'Arial' },
    });
  });

  it('re-serializes malformed paths and maps images', () => {
    const root = tree(`
      <svg viewBox="0 0 10 10">
        <path d="M0 0 L5 5 L"/>
        <path d="M0 0h5v5z"/>
        <image href="https://example.com/a.png" width="4" height="4" opacity="0.5"/>
      </svg>`);
    expect(root.children[0]?.props.d).toBe('M0 0L5 5');
    expect(root.children[1]?.props.d).toBe('M0 0h5v5z');
    expect(root.children[2]).toMatchObject({
      type: 'Image',
      props: { href: { uri: 'https://example.com/a.png' }, x: 0, y: 0, width: 4, height: 4, opacity: 0.5 },
    });
  });
});
