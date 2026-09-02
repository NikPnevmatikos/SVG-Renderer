import { collectDeclarations, createDefaultStyle, parseInlineStyle, resolveStyle } from './resolve';

describe('parseInlineStyle', () => {
  it('parses declarations and strips !important', () => {
    expect(parseInlineStyle('fill: red; stroke-width : 2px ;; opacity:0.5 !important')).toEqual({
      fill: 'red',
      'stroke-width': '2px',
      opacity: '0.5',
    });
  });
});

describe('collectDeclarations', () => {
  it('lets inline style override presentation attributes', () => {
    const decl = collectDeclarations({ fill: 'red', 'stroke-width': '3', style: 'fill: blue', x: '1' });
    expect(decl).toEqual({ fill: 'blue', 'stroke-width': '3' });
  });
});

describe('resolveStyle', () => {
  it('applies defaults', () => {
    const style = resolveStyle({}, null);
    expect(style).toEqual(createDefaultStyle());
  });

  it('inherits inheritable properties and resets non-inherited ones', () => {
    const parent = resolveStyle(
      { fill: 'red', stroke: 'blue', 'stroke-width': '4', opacity: '0.5', 'clip-path': 'url(#c)', 'font-size': '20' },
      null
    );
    const child = resolveStyle({}, parent);
    expect(child.fill).toEqual({ type: 'color', value: 'red' });
    expect(child.stroke).toEqual({ type: 'color', value: 'blue' });
    expect(child.strokeWidth).toBe(4);
    expect(child.font.size).toBe(20);
    expect(child.opacity).toBe(1);
    expect(child.clipPath).toBeUndefined();
    // `inherit` pulls a non-inherited value from the parent explicitly.
    expect(resolveStyle({ opacity: 'inherit' }, parent).opacity).toBe(0.5);
  });

  it('resolves paints', () => {
    const style = resolveStyle(
      { color: '#123456', fill: 'currentColor', stroke: 'url(#grad) red' },
      null
    );
    expect(style.fill).toEqual({ type: 'color', value: '#123456' });
    expect(style.stroke).toEqual({ type: 'ref', id: 'grad', fallback: 'red' });
    expect(resolveStyle({ fill: 'none' }, null).fill).toEqual({ type: 'none' });
    expect(resolveStyle({ fill: "url('#p')" }, null).fill).toEqual({ type: 'ref', id: 'p' });
  });

  it('parses opacities, dash arrays and lengths with units', () => {
    const style = resolveStyle(
      {
        'fill-opacity': '50%',
        'stroke-opacity': '2',
        'stroke-dasharray': '5, 3 1',
        'stroke-dashoffset': '1em',
        'stroke-width': '1pt',
        'font-size': '2em',
      },
      null
    );
    expect(style.fillOpacity).toBe(0.5);
    expect(style.strokeOpacity).toBe(1);
    expect(style.strokeDasharray).toEqual([5, 3, 1, 5, 3, 1]);
    expect(style.font.size).toBe(32);
    expect(style.strokeDashoffset).toBe(32);
    expect(style.strokeWidth).toBeCloseTo(96 / 72);
    expect(resolveStyle({ 'stroke-dasharray': '0 0' }, null).strokeDasharray).toBeNull();
    expect(resolveStyle({ 'stroke-dasharray': 'none' }, null).strokeDasharray).toBeNull();
  });

  it('parses font and text properties', () => {
    const style = resolveStyle(
      {
        'font-family': '"Helvetica Neue", Arial, sans-serif',
        'font-weight': '700',
        'font-style': 'italic',
        'text-anchor': 'middle',
        'letter-spacing': '2',
        'font-size': 'large',
      },
      null
    );
    expect(style.font).toEqual({
      family: ['Helvetica Neue', 'Arial', 'sans-serif'],
      size: 18,
      weight: '700',
      style: 'italic',
      textAnchor: 'middle',
      letterSpacing: 2,
    });
  });

  it('reports invalid values and keeps the inherited value', () => {
    const warnings: string[] = [];
    const parent = resolveStyle({ 'stroke-linecap': 'round' }, null);
    const style = resolveStyle(
      {
        'stroke-linecap': 'pointy',
        'fill-rule': 'weird',
        'stroke-width': '-2',
        'stroke-miterlimit': '0',
        'clip-path': 'circle(50%)',
        'stroke-dasharray': '1 -1',
      },
      parent,
      (code, message) => warnings.push(`${code}: ${message}`)
    );
    expect(style.strokeLinecap).toBe('round');
    expect(style.fillRule).toBe('nonzero');
    expect(style.strokeWidth).toBe(1);
    expect(style.strokeMiterlimit).toBe(4);
    expect(style.clipPath).toBeUndefined();
    expect(style.strokeDasharray).toBeNull();
    expect(warnings).toHaveLength(6);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/invalid-attribute: Invalid value "pointy" for stroke-linecap/),
        expect.stringMatching(/invalid-attribute: Invalid value "weird" for fill-rule/),
        expect.stringMatching(/invalid-attribute: Invalid value "1 -1" for stroke-dasharray/),
      ])
    );
  });

  it('reports percentage stroke widths as unsupported', () => {
    const warnings: string[] = [];
    resolveStyle({ 'stroke-width': '5%' }, null, (code) => warnings.push(code));
    expect(warnings).toEqual(['percent-length-unsupported']);
  });

  it('handles visibility, vector-effect and references', () => {
    const style = resolveStyle(
      { visibility: 'collapse', 'vector-effect': 'non-scaling-stroke', mask: 'url(#m)', filter: 'none' },
      null
    );
    expect(style.visibility).toBe('hidden');
    expect(style.vectorEffect).toBe('non-scaling-stroke');
    expect(style.mask).toBe('m');
    expect(style.filter).toBeUndefined();
  });
});
