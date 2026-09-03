/**
 * Round-trip conformance: render each fixture with a reference renderer (resvg), then render
 * our normalized SVG and our batched plan the same way and compare pixels. Any difference
 * beyond anti-aliasing noise means parsing, the cascade, definitions, `use` expansion or
 * batching changed the picture.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { Resvg } from '@resvg/resvg-js';
import { planToSvgString, toSvgString } from '../document/emit';
import { parseSvg } from '../parse';

const FIXTURES_DIR = resolve(__dirname, '../../../../fixtures/synthetic');
const RENDER_WIDTH = 512;
/** Per-channel difference that counts as a changed pixel. */
const CHANNEL_TOLERANCE = 24;
/** Fraction of changed pixels tolerated (edge anti-aliasing after transforms are flattened). */
const MAX_CHANGED_RATIO = 0.004;

interface Raster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function render(svg: string): Raster {
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: RENDER_WIDTH },
    font: { loadSystemFonts: true },
    background: 'white',
  });
  const image = renderer.render();
  return { width: image.width, height: image.height, pixels: image.pixels };
}

function changedRatio(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  const total = a.width * a.height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (
      Math.abs(a.pixels[o]! - b.pixels[o]!) > CHANNEL_TOLERANCE ||
      Math.abs(a.pixels[o + 1]! - b.pixels[o + 1]!) > CHANNEL_TOLERANCE ||
      Math.abs(a.pixels[o + 2]! - b.pixels[o + 2]!) > CHANNEL_TOLERANCE ||
      Math.abs(a.pixels[o + 3]! - b.pixels[o + 3]!) > CHANNEL_TOLERANCE
    ) {
      changed++;
    }
  }
  return changed / total;
}

const fixtures = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.svg'));

describe('round-trip conformance against resvg', () => {
  it('finds fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const name of fixtures) {
    describe(name, () => {
      const xml = readFileSync(join(FIXTURES_DIR, name), 'utf8');
      const document = parseSvg(xml);
      const reference = render(xml);

      it('normalized SVG renders like the original', () => {
        const normalized = render(toSvgString(document));
        const ratio = changedRatio(reference, normalized);
        expect(ratio).toBeLessThanOrEqual(MAX_CHANGED_RATIO);
      });

      it('batched plan renders like the original', () => {
        const plan = document.plan();
        const planned = render(planToSvgString(plan, document));
        const ratio = changedRatio(reference, planned);
        expect(ratio).toBeLessThanOrEqual(MAX_CHANGED_RATIO);
      });
    });
  }
});
