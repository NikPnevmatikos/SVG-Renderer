import type { GroupNode, SvgNode } from '../types';

export interface SimpleSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
}

const COMPOUND_RE = /^([a-zA-Z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+)*)$/;
const PART_RE = /#([\w-]+)|\.([\w-]+)/g;

/**
 * Parse a comma-separated list of compound selectors made of an optional type, one `#id`
 * and any number of `.class` parts. Combinators, attributes and pseudo-classes are not
 * supported yet; the function returns `null` for them.
 */
export function parseSelectorList(selector: string): SimpleSelector[] | null {
  const list: SimpleSelector[] = [];
  for (const raw of selector.split(',')) {
    const compound = raw.trim();
    if (compound.length === 0) return null;
    const match = COMPOUND_RE.exec(compound);
    if (!match) return null;
    const tag = match[1] !== undefined && match[1] !== '*' ? match[1] : null;
    let id: string | null = null;
    const classes: string[] = [];
    PART_RE.lastIndex = 0;
    let part: RegExpExecArray | null;
    while ((part = PART_RE.exec(match[2] ?? ''))) {
      if (part[1] !== undefined) id = part[1];
      else if (part[2] !== undefined) classes.push(part[2]);
    }
    list.push({ tag, id, classes });
  }
  return list;
}

export function matchesSelector(node: SvgNode, selector: SimpleSelector): boolean {
  if (selector.tag !== null && node.tag !== selector.tag) return false;
  if (selector.id !== null && node.id !== selector.id) return false;
  for (const className of selector.classes) {
    if (!node.classes.includes(className)) return false;
  }
  return true;
}

/** All nodes under (and including) `root` matching any selector in the list, in document order. */
export function selectNodes(root: GroupNode, selector: string): SvgNode[] {
  const list = parseSelectorList(selector);
  if (!list) {
    throw new Error(
      `Unsupported selector "${selector}": only type, #id, .class compounds and comma lists are supported in this version`
    );
  }
  const out: SvgNode[] = [];
  const visit = (node: SvgNode): void => {
    if (list.some((s) => matchesSelector(node, s))) out.push(node);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}
