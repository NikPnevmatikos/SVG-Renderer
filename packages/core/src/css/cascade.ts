import { PRESENTATION_ATTRIBUTES, type Declarations } from '../style/resolve';
import { matchesSelector, type SelectorAdapter } from './match';
import { parseDeclarationBlock, parseStylesheet, type CssRule } from './parse';
import { compareSpecificity, type ComplexSelector, type Specificity } from './selector';

export interface CascadedDeclarations {
  normal: Declarations;
  important: Declarations;
}

interface IndexedSelector {
  rule: CssRule;
  selector: ComplexSelector;
}

interface Match {
  specificity: Specificity;
  order: number;
  rule: CssRule;
}

/**
 * A parsed stylesheet with an index on the rightmost compound of every selector, so matching
 * an element only evaluates rules that could possibly apply to it.
 */
export class Stylesheet {
  private readonly byId = new Map<string, IndexedSelector[]>();
  private readonly byClass = new Map<string, IndexedSelector[]>();
  private readonly byTag = new Map<string, IndexedSelector[]>();
  private readonly universal: IndexedSelector[] = [];

  constructor(readonly rules: readonly CssRule[]) {
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        const last = selector.compounds[selector.compounds.length - 1];
        if (!last) continue;
        const entry: IndexedSelector = { rule, selector };
        const firstClass = last.classes[0];
        if (last.id !== null) push(this.byId, last.id, entry);
        else if (firstClass !== undefined) push(this.byClass, firstClass, entry);
        else if (last.tag !== null) push(this.byTag, last.tag, entry);
        else this.universal.push(entry);
      }
    }
  }

  static parse(css: string): { stylesheet: Stylesheet; warnings: string[] } {
    const { rules, warnings } = parseStylesheet(css);
    return { stylesheet: new Stylesheet(rules), warnings };
  }

  isEmpty(): boolean {
    return this.rules.length === 0;
  }

  /** Declarations from every matching rule, later and more specific rules overriding earlier ones. */
  collect<T>(el: T, adapter: SelectorAdapter<T>): CascadedDeclarations {
    const matches: Match[] = [];
    const consider = (entries: IndexedSelector[] | undefined): void => {
      if (!entries) return;
      for (const entry of entries) {
        if (matchesSelector(el, entry.selector, adapter)) {
          matches.push({ specificity: entry.selector.specificity, order: entry.rule.order, rule: entry.rule });
        }
      }
    };
    consider(this.universal);
    consider(this.byTag.get(adapter.tag(el)));
    const id = adapter.id(el);
    if (id !== undefined) consider(this.byId.get(id));
    for (const className of adapter.classes(el)) consider(this.byClass.get(className));

    matches.sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.order - b.order);
    const normal: Declarations = {};
    const important: Declarations = {};
    for (const match of matches) {
      for (const declaration of match.rule.declarations) {
        (declaration.important ? important : normal)[declaration.name] = declaration.value;
      }
    }
    return { normal, important };
  }
}

function push(map: Map<string, IndexedSelector[]>, key: string, entry: IndexedSelector): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/**
 * Final declarations for one element, lowest to highest priority: presentation attributes,
 * stylesheet rules, inline `style`, stylesheet `!important`, inline `!important`.
 */
export function cascadeDeclarations(
  attrs: Readonly<Record<string, string>>,
  fromStylesheet: CascadedDeclarations | null
): Declarations {
  const out: Declarations = {};
  for (const name of PRESENTATION_ATTRIBUTES) {
    const value = attrs[name];
    if (value !== undefined) out[name] = value;
  }
  if (fromStylesheet) Object.assign(out, fromStylesheet.normal);
  const inline = attrs.style !== undefined && attrs.style.length > 0 ? parseDeclarationBlock(attrs.style) : [];
  for (const declaration of inline) {
    if (!declaration.important) out[declaration.name] = declaration.value;
  }
  if (fromStylesheet) Object.assign(out, fromStylesheet.important);
  for (const declaration of inline) {
    if (declaration.important) out[declaration.name] = declaration.value;
  }
  return out;
}
