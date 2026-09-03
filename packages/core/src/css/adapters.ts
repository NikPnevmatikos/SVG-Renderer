import type { SvgNode } from '../types';
import type { XmlElement } from '../xml/tokenize';
import type { SelectorAdapter } from './match';

function splitClasses(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.trim().split(/\s+/).filter((c) => c.length > 0);
}

function xmlSibling(el: XmlElement, direction: -1 | 1): XmlElement | null {
  const parent = el.parent;
  if (!parent) return null;
  const siblings = parent.children;
  let index = siblings.indexOf(el) + direction;
  while (index >= 0 && index < siblings.length) {
    const candidate = siblings[index];
    if (candidate && candidate.type === 'element') return candidate;
    index += direction;
  }
  return null;
}

/** Selector matching over the parsed XML tree (used by the cascade while building). */
export const xmlAdapter: SelectorAdapter<XmlElement> = {
  tag: (el) => el.name,
  id: (el) => el.attrs.id,
  classes: (el) => splitClasses(el.attrs.class),
  attribute: (el, name) => el.attrs[name],
  parent: (el) => el.parent,
  previousSibling: (el) => xmlSibling(el, -1),
  nextSibling: (el) => xmlSibling(el, 1),
};

function nodeSibling(node: SvgNode, direction: -1 | 1): SvgNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const index = parent.children.indexOf(node) + direction;
  return parent.children[index] ?? null;
}

/** Selector matching over the scene graph (used by `document.querySelectorAll`). */
export const nodeAdapter: SelectorAdapter<SvgNode> = {
  tag: (node) => node.tag,
  id: (node) => node.id,
  classes: (node) => node.classes,
  attribute: (node, name) => node.attrs[name],
  parent: (node) => node.parent,
  previousSibling: (node) => nodeSibling(node, -1),
  nextSibling: (node) => nodeSibling(node, 1),
};
