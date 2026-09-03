import type { GroupNode, SvgNode } from '../types';
import { nodeAdapter } from '../css/adapters';
import { matchesSelector } from '../css/match';
import { parseSelectorList } from '../css/selector';

/**
 * All nodes under (and including) `root` matching the selector list, in document order.
 * Supports type, `#id`, `.class`, attribute selectors, all four combinators, selector lists
 * and the structural pseudo-classes `:first-child`, `:last-child`, `:only-child`, `:root`.
 * Throws for syntax errors and for pseudo-classes/elements that cannot be evaluated.
 */
export function selectNodes(root: GroupNode, selector: string): SvgNode[] {
  const parsed = parseSelectorList(selector);
  if (parsed.invalid.length > 0) {
    throw new Error(`Invalid selector "${selector}"`);
  }
  if (parsed.unsupported.length > 0) {
    throw new Error(
      `Unsupported selector "${selector}": pseudo-elements and pseudo-classes other than ` +
        ':first-child, :last-child, :only-child and :root are not supported'
    );
  }
  const out: SvgNode[] = [];
  const visit = (node: SvgNode): void => {
    if (parsed.selectors.some((s) => matchesSelector(node, s, nodeAdapter))) out.push(node);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}
