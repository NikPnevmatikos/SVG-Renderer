import {
  applyToPoint,
  formatMatrix,
  IDENTITY,
  invert,
  isConformal,
  isIdentity,
  multiply,
  parseTransform,
  rotate,
  scale,
  scaleFactor,
  translate,
} from './matrix';

const close = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));
};

describe('matrix', () => {
  it('multiplies in SVG order (right operand applied first)', () => {
    const m = multiply(translate(10, 20), scale(2));
    const p = applyToPoint(m, { x: 1, y: 1 });
    expect(p).toEqual({ x: 12, y: 22 });
  });

  it('rotates about a center', () => {
    const m = rotate(90, 5, 5);
    const p = applyToPoint(m, { x: 10, y: 5 });
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(10);
  });

  it('inverts', () => {
    const m = multiply(translate(3, 4), multiply(rotate(30), scale(2, 3)));
    const inv = invert(m)!;
    close(multiply(m, inv), IDENTITY);
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
  });

  it('reports scale factor and conformality', () => {
    expect(scaleFactor(scale(2))).toBeCloseTo(2);
    expect(scaleFactor(scale(2, 8))).toBeCloseTo(4);
    expect(isConformal(rotate(33))).toBe(true);
    expect(isConformal(multiply(rotate(33), scale(2)))).toBe(true);
    expect(isConformal(scale(1, -1))).toBe(true);
    expect(isConformal(scale(2, 3))).toBe(false);
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(translate(0.5))).toBe(false);
  });

  describe('parseTransform', () => {
    it('parses every function and composes left to right', () => {
      close(parseTransform('translate(10 20)')!, [1, 0, 0, 1, 10, 20]);
      close(parseTransform('translate(10)')!, [1, 0, 0, 1, 10, 0]);
      close(parseTransform('scale(2)')!, [2, 0, 0, 2, 0, 0]);
      close(parseTransform('scale(2, 3)')!, [2, 0, 0, 3, 0, 0]);
      close(parseTransform('matrix(1 2 3 4 5 6)')!, [1, 2, 3, 4, 5, 6]);
      close(parseTransform('rotate(90)')!, [0, 1, -1, 0, 0, 0]);
      close(parseTransform('rotate(90, 5, 5)')!, rotate(90, 5, 5));
      close(parseTransform('skewX(45)')!, [1, 0, 1, 1, 0, 0]);
      close(parseTransform('skewY(45)')!, [1, 1, 0, 1, 0, 0]);
      close(
        parseTransform('translate(490 60) rotate(-4 0 0)')!,
        multiply(translate(490, 60), rotate(-4))
      );
    });

    it('accepts commas, exponents and odd spacing', () => {
      close(parseTransform(' translate( 1e1 , -2.5 ) , scale(.5) ')!, [0.5, 0, 0, 0.5, 10, -2.5]);
      close(parseTransform('')!, IDENTITY);
    });

    it('rejects malformed lists', () => {
      expect(parseTransform('translate(1 2 3)')).toBeNull();
      expect(parseTransform('rotate(1 2)')).toBeNull();
      expect(parseTransform('matrix(1 2 3)')).toBeNull();
      expect(parseTransform('scale(a)')).toBeNull();
      expect(parseTransform('spin(1)')).toBeNull();
      expect(parseTransform('translate(1) junk')).toBeNull();
    });
  });

  it('formats matrices for SVG output', () => {
    expect(formatMatrix([1, 0, 0, 1, 10.5, -0.0000001])).toBe('matrix(1 0 0 1 10.5 0)');
  });
});
