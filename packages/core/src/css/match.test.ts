import { parseXml, type XmlElement } from '../xml/tokenize';
import { xmlAdapter } from './adapters';
import { matchesSelector } from './match';
import { parseSelectorList } from './selector';

const doc = parseXml(`
  <svg id="root" class="page">
    <g id="rooms" class="layer rooms" data-floor="1">
      <rect id="r1" class="room big" data-kind="hall-a"/>
      <rect id="r2" class="room"/>
      <text id="t1">x</text>
      <g id="inner"><circle id="c1" class="room round"/></g>
    </g>
    <path id="p1" data-kind="Hall-B"/>
  </svg>`);

const byId = new Map<string, XmlElement>();
const index = (el: XmlElement): void => {
  if (el.attrs.id) byId.set(el.attrs.id, el);
  for (const child of el.children) if (child.type === 'element') index(child);
};
index(doc);

const matches = (selector: string, id: string): boolean => {
  const parsed = parseSelectorList(selector);
  if (parsed.selectors.length !== 1) throw new Error(`bad selector ${selector}`);
  return matchesSelector(byId.get(id)!, parsed.selectors[0]!, xmlAdapter);
};

describe('matchesSelector', () => {
  it('matches type, class, id and universal', () => {
    expect(matches('rect', 'r1')).toBe(true);
    expect(matches('circle', 'r1')).toBe(false);
    expect(matches('.room', 'r1')).toBe(true);
    expect(matches('.room.big', 'r1')).toBe(true);
    expect(matches('.room.big', 'r2')).toBe(false);
    expect(matches('#r2', 'r2')).toBe(true);
    expect(matches('*', 't1')).toBe(true);
    expect(matches('rect.room#r1', 'r1')).toBe(true);
  });

  it('matches attribute operators', () => {
    expect(matches('[data-kind]', 'r1')).toBe(true);
    expect(matches('[data-kind]', 'r2')).toBe(false);
    expect(matches('[data-kind="hall-a"]', 'r1')).toBe(true);
    expect(matches('[data-kind|="hall"]', 'r1')).toBe(true);
    expect(matches('[data-kind^="hall"]', 'r1')).toBe(true);
    expect(matches('[data-kind$="-a"]', 'r1')).toBe(true);
    expect(matches('[data-kind*="ll-"]', 'r1')).toBe(true);
    expect(matches('[class~="big"]', 'r1')).toBe(true);
    expect(matches('[class~="bi"]', 'r1')).toBe(false);
    expect(matches('[data-kind="hall-b"]', 'p1')).toBe(false);
    expect(matches('[data-kind="hall-b" i]', 'p1')).toBe(true);
  });

  it('matches combinators', () => {
    expect(matches('g > rect', 'r1')).toBe(true);
    expect(matches('svg > rect', 'r1')).toBe(false);
    expect(matches('svg rect', 'r1')).toBe(true);
    expect(matches('svg circle', 'c1')).toBe(true);
    expect(matches('#rooms > circle', 'c1')).toBe(false);
    expect(matches('#rooms circle', 'c1')).toBe(true);
    expect(matches('rect + rect', 'r2')).toBe(true);
    expect(matches('rect + rect', 'r1')).toBe(false);
    expect(matches('rect ~ text', 't1')).toBe(true);
    expect(matches('text ~ rect', 'r1')).toBe(false);
    expect(matches('.layer[data-floor="1"] > .room + .room', 'r2')).toBe(true);
    expect(matches('svg > g > g > circle.round', 'c1')).toBe(true);
  });

  it('matches structural pseudo-classes', () => {
    expect(matches('rect:first-child', 'r1')).toBe(true);
    expect(matches('rect:first-child', 'r2')).toBe(false);
    expect(matches('g:last-child', 'inner')).toBe(true);
    expect(matches('circle:only-child', 'c1')).toBe(true);
    expect(matches(':root', 'root')).toBe(true);
    expect(matches(':root', 'rooms')).toBe(false);
  });
});
