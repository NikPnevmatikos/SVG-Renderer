import { parseSelectorList, splitTopLevel, type ComplexSelector } from './selector';

export interface CssDeclaration {
  /** Lower-case property name (`stroke-width`, `--brand`). */
  name: string;
  value: string;
  important: boolean;
}

export interface CssRule {
  selectors: ComplexSelector[];
  declarations: CssDeclaration[];
  /** Source order across the whole document; later rules win ties. */
  order: number;
}

export interface StylesheetParseResult {
  rules: CssRule[];
  /** Human-readable notes about skipped constructs (at-rules, unsupported selectors, syntax errors). */
  warnings: string[];
}

const IMPORTANT_RE = /!\s*important\s*$/i;

/** Remove `/* ... *\/` comments and legacy `<!--` / `-->` guards. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--|-->/g, ' ');
}

/** Index of the `}` closing the `{` at `open`, honouring nesting and strings; -1 if unterminated. */
function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = 0;
  for (let i = open; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (quote !== 0) {
      if (code === 92) i++;
      else if (code === quote) quote = 0;
      continue;
    }
    if (code === 34 || code === 39) quote = code;
    else if (code === 123) depth++;
    else if (code === 125) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse the inside of a `{ ... }` block or an inline `style` attribute into declarations. */
export function parseDeclarationBlock(body: string): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (name.length === 0 || value.length === 0) continue;
    let important = false;
    if (IMPORTANT_RE.test(value)) {
      important = true;
      value = value.replace(IMPORTANT_RE, '').trim();
      if (value.length === 0) continue;
    }
    out.push({ name, value, important });
  }
  return out;
}

/** Parse a stylesheet (the text of one or more `<style>` elements). Never throws. */
export function parseStylesheet(css: string, firstOrder = 0): StylesheetParseResult {
  const text = stripCssComments(css);
  const rules: CssRule[] = [];
  const warnings: string[] = [];
  const skippedAtRules = new Set<string>();
  let order = firstOrder;
  let i = 0;
  const n = text.length;

  while (i < n) {
    while (i < n && /\s/.test(text.charAt(i))) i++;
    if (i >= n) break;

    if (text.charCodeAt(i) === 64 /* @ */) {
      const nameMatch = /^@([\w-]+)/.exec(text.slice(i));
      const name = nameMatch?.[1] ?? '';
      // An at-rule ends at ';' or at the end of its block, whichever comes first.
      let j = i;
      let quote = 0;
      let end = -1;
      while (j < n) {
        const code = text.charCodeAt(j);
        if (quote !== 0) {
          if (code === 92) j++;
          else if (code === quote) quote = 0;
        } else if (code === 34 || code === 39) quote = code;
        else if (code === 59 /* ; */) {
          end = j + 1;
          break;
        } else if (code === 123 /* { */) {
          const close = findMatchingBrace(text, j);
          end = close === -1 ? n : close + 1;
          break;
        }
        j++;
      }
      if (end === -1) end = n;
      if (!skippedAtRules.has(name)) {
        skippedAtRules.add(name);
        warnings.push(`@${name} rules are not supported and were skipped`);
      }
      i = end;
      continue;
    }

    const open = text.indexOf('{', i);
    if (open === -1) {
      if (text.slice(i).trim().length > 0) warnings.push('Trailing text after the last rule was ignored');
      break;
    }
    const close = findMatchingBrace(text, open);
    if (close === -1) {
      warnings.push('Unterminated rule block was ignored');
      break;
    }
    const selectorText = text.slice(i, open).trim();
    const body = text.slice(open + 1, close);
    i = close + 1;
    if (selectorText.length === 0) continue;

    const parsed = parseSelectorList(selectorText);
    for (const s of parsed.unsupported) warnings.push(`Selector "${s}" is not supported and was skipped`);
    for (const s of parsed.invalid) warnings.push(`Selector "${s}" could not be parsed and was skipped`);
    const declarations = parseDeclarationBlock(body);
    if (parsed.selectors.length === 0 || declarations.length === 0) continue;
    rules.push({ selectors: parsed.selectors, declarations, order: order++ });
  }

  return { rules, warnings };
}
