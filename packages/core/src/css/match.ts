import type { AttributeSelector, ComplexSelector, CompoundSelector } from './selector';

/** Minimal tree access the matcher needs. Implemented for the XML tree and for the scene graph. */
export interface SelectorAdapter<T> {
  tag(el: T): string;
  id(el: T): string | undefined;
  classes(el: T): readonly string[];
  attribute(el: T, name: string): string | undefined;
  parent(el: T): T | null;
  previousSibling(el: T): T | null;
  nextSibling(el: T): T | null;
}

function matchesAttribute(actual: string | undefined, selector: AttributeSelector): boolean {
  if (actual === undefined) return false;
  if (selector.operator === 'exists') return true;
  const value = selector.caseInsensitive ? actual.toLowerCase() : actual;
  const expected = selector.caseInsensitive ? selector.value.toLowerCase() : selector.value;
  switch (selector.operator) {
    case '=':
      return value === expected;
    case '~=':
      return expected.length > 0 && value.split(/\s+/).includes(expected);
    case '|=':
      return value === expected || value.startsWith(`${expected}-`);
    case '^=':
      return expected.length > 0 && value.startsWith(expected);
    case '$=':
      return expected.length > 0 && value.endsWith(expected);
    case '*=':
      return expected.length > 0 && value.includes(expected);
  }
}

export function matchesCompound<T>(el: T, compound: CompoundSelector, adapter: SelectorAdapter<T>): boolean {
  if (compound.tag !== null && adapter.tag(el) !== compound.tag) return false;
  if (compound.id !== null && adapter.id(el) !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = adapter.classes(el);
    for (const className of compound.classes) {
      if (!classes.includes(className)) return false;
    }
  }
  for (const attribute of compound.attributes) {
    if (!matchesAttribute(adapter.attribute(el, attribute.name), attribute)) return false;
  }
  for (const pseudo of compound.pseudoClasses) {
    switch (pseudo) {
      case 'first-child':
        if (adapter.previousSibling(el) !== null) return false;
        break;
      case 'last-child':
        if (adapter.nextSibling(el) !== null) return false;
        break;
      case 'only-child':
        if (adapter.previousSibling(el) !== null || adapter.nextSibling(el) !== null) return false;
        break;
      case 'root':
        if (adapter.parent(el) !== null) return false;
        break;
      default:
        return false;
    }
  }
  return compound.pseudoElements.length === 0;
}

/** Match a complex selector right to left, backtracking through descendant and sibling chains. */
export function matchesSelector<T>(el: T, selector: ComplexSelector, adapter: SelectorAdapter<T>): boolean {
  const { compounds, combinators } = selector;
  const matchFrom = (node: T, index: number): boolean => {
    const compound = compounds[index];
    if (compound === undefined || !matchesCompound(node, compound, adapter)) return false;
    if (index === 0) return true;
    switch (combinators[index - 1]) {
      case 'child': {
        const parent = adapter.parent(node);
        return parent !== null && matchFrom(parent, index - 1);
      }
      case 'descendant': {
        let parent = adapter.parent(node);
        while (parent !== null) {
          if (matchFrom(parent, index - 1)) return true;
          parent = adapter.parent(parent);
        }
        return false;
      }
      case 'adjacent': {
        const sibling = adapter.previousSibling(node);
        return sibling !== null && matchFrom(sibling, index - 1);
      }
      case 'sibling': {
        let sibling = adapter.previousSibling(node);
        while (sibling !== null) {
          if (matchFrom(sibling, index - 1)) return true;
          sibling = adapter.previousSibling(sibling);
        }
        return false;
      }
      default:
        return false;
    }
  };
  return matchFrom(el, compounds.length - 1);
}
