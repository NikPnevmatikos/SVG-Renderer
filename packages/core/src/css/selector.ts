export type AttributeOperator = 'exists' | '=' | '~=' | '|=' | '^=' | '$=' | '*=';

export interface AttributeSelector {
  name: string;
  operator: AttributeOperator;
  value: string;
  caseInsensitive: boolean;
}

export interface CompoundSelector {
  /** Type selector, or `null` for universal / none. */
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: AttributeSelector[];
  pseudoClasses: string[];
  pseudoElements: string[];
}

export type Combinator = 'descendant' | 'child' | 'adjacent' | 'sibling';

/** `[ids, classes + attributes + pseudo-classes, types]` */
export type Specificity = readonly [number, number, number];

export interface ComplexSelector {
  text: string;
  /** Left to right. `compounds[i]` and `compounds[i + 1]` are joined by `combinators[i]`. */
  compounds: CompoundSelector[];
  combinators: Combinator[];
  specificity: Specificity;
}

export interface SelectorListParseResult {
  selectors: ComplexSelector[];
  /** Syntactically valid selectors we cannot evaluate (pseudo-elements, dynamic pseudo-classes). */
  unsupported: string[];
  /** Selectors that failed to parse. */
  invalid: string[];
}

export const SUPPORTED_PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  'first-child',
  'last-child',
  'only-child',
  'root',
]);

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function isIdentStart(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    code === 45 ||
    code === 92 || // backslash escape
    code > 127
  );
}

function isIdentChar(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

class SelectorScanner {
  index = 0;

  constructor(readonly source: string) {}

  get done(): boolean {
    return this.index >= this.source.length;
  }

  peek(offset = 0): number {
    return this.source.charCodeAt(this.index + offset);
  }

  skipWhitespace(): boolean {
    const start = this.index;
    while (!this.done && isWhitespace(this.peek())) this.index++;
    return this.index > start;
  }

  /** Read a CSS identifier, resolving backslash escapes. Returns `null` if none starts here. */
  readIdent(): string | null {
    if (this.done || !isIdentStart(this.peek())) return null;
    let out = '';
    while (!this.done && isIdentChar(this.peek())) {
      const code = this.peek();
      if (code === 92) {
        this.index++;
        if (this.done) break;
        let hex = '';
        while (hex.length < 6 && isHex(this.peek())) {
          hex += this.source.charAt(this.index);
          this.index++;
        }
        if (hex.length > 0) {
          out += String.fromCodePoint(parseInt(hex, 16));
          if (isWhitespace(this.peek())) this.index++;
        } else {
          out += this.source.charAt(this.index);
          this.index++;
        }
        continue;
      }
      out += this.source.charAt(this.index);
      this.index++;
    }
    return out.length > 0 ? out : null;
  }

  readString(): string | null {
    const quote = this.peek();
    if (quote !== 34 && quote !== 39) return null;
    this.index++;
    let out = '';
    while (!this.done && this.peek() !== quote) {
      if (this.peek() === 92) {
        this.index++;
        if (this.done) break;
      }
      out += this.source.charAt(this.index);
      this.index++;
    }
    if (this.done) return null;
    this.index++;
    return out;
  }
}

/** Split on `separator` at nesting depth zero (outside quotes, parentheses and brackets). */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (quote !== 0) {
      if (code === 92) i++;
      else if (code === quote) quote = 0;
      continue;
    }
    if (code === 34 || code === 39) quote = code;
    else if (code === 40 || code === 91) depth++;
    else if (code === 41 || code === 93) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i));
      start = i + separator.length;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function emptyCompound(): CompoundSelector {
  return { tag: null, id: null, classes: [], attributes: [], pseudoClasses: [], pseudoElements: [] };
}

function isEmptyCompound(c: CompoundSelector): boolean {
  return (
    c.tag === null &&
    c.id === null &&
    c.classes.length === 0 &&
    c.attributes.length === 0 &&
    c.pseudoClasses.length === 0 &&
    c.pseudoElements.length === 0
  );
}

function parseAttribute(sc: SelectorScanner): AttributeSelector | null {
  // sc positioned after '['
  sc.skipWhitespace();
  const name = sc.readIdent();
  if (name === null) return null;
  sc.skipWhitespace();
  if (sc.peek() === 93 /* ] */) {
    sc.index++;
    return { name, operator: 'exists', value: '', caseInsensitive: false };
  }
  let operator: AttributeOperator;
  const code = sc.peek();
  if (code === 61 /* = */) {
    operator = '=';
    sc.index++;
  } else if (sc.peek(1) === 61) {
    const first = sc.source.charAt(sc.index);
    if (first === '~') operator = '~=';
    else if (first === '|') operator = '|=';
    else if (first === '^') operator = '^=';
    else if (first === '$') operator = '$=';
    else if (first === '*') operator = '*=';
    else return null;
    sc.index += 2;
  } else return null;
  sc.skipWhitespace();
  const value = sc.readString() ?? sc.readIdent();
  if (value === null) return null;
  sc.skipWhitespace();
  let caseInsensitive = false;
  const flag = sc.source.charAt(sc.index).toLowerCase();
  if (flag === 'i' || flag === 's') {
    caseInsensitive = flag === 'i';
    sc.index++;
    sc.skipWhitespace();
  }
  if (sc.peek() !== 93) return null;
  sc.index++;
  return { name, operator, value, caseInsensitive };
}

type ComplexParse =
  | { ok: true; selector: ComplexSelector; supported: boolean }
  | { ok: false };

function parseComplex(text: string): ComplexParse {
  const sc = new SelectorScanner(text);
  const compounds: CompoundSelector[] = [];
  const combinators: Combinator[] = [];
  let current: CompoundSelector | null = null;
  let pending: Combinator | null = null;
  let supported = true;

  const startCompoundIfNeeded = (): CompoundSelector => {
    if (current === null) {
      current = emptyCompound();
      return current;
    }
    if (pending !== null) {
      compounds.push(current);
      combinators.push(pending);
      current = emptyCompound();
      pending = null;
    }
    return current;
  };

  while (!sc.done) {
    if (sc.skipWhitespace()) {
      if (current !== null && pending === null && !sc.done) pending = 'descendant';
      continue;
    }
    const code = sc.peek();
    if (code === 62 /* > */ || code === 43 /* + */ || code === 126 /* ~ */) {
      if (current === null) return { ok: false };
      pending = code === 62 ? 'child' : code === 43 ? 'adjacent' : 'sibling';
      sc.index++;
      continue;
    }
    const compound = startCompoundIfNeeded();
    if (code === 42 /* * */) {
      if (!isEmptyCompound(compound)) return { ok: false };
      sc.index++;
      continue;
    }
    if (code === 35 /* # */) {
      sc.index++;
      const id = sc.readIdent();
      if (id === null) return { ok: false };
      compound.id = id;
      continue;
    }
    if (code === 46 /* . */) {
      sc.index++;
      const className = sc.readIdent();
      if (className === null) return { ok: false };
      compound.classes.push(className);
      continue;
    }
    if (code === 91 /* [ */) {
      sc.index++;
      const attribute = parseAttribute(sc);
      if (attribute === null) return { ok: false };
      compound.attributes.push(attribute);
      continue;
    }
    if (code === 58 /* : */) {
      sc.index++;
      const isElement = sc.peek() === 58;
      if (isElement) sc.index++;
      const name = sc.readIdent();
      if (name === null) return { ok: false };
      let full = name.toLowerCase();
      if (sc.peek() === 40 /* ( */) {
        let depth = 0;
        const start = sc.index;
        while (!sc.done) {
          const c = sc.peek();
          if (c === 40) depth++;
          else if (c === 41) {
            depth--;
            if (depth === 0) break;
          }
          sc.index++;
        }
        if (sc.done) return { ok: false };
        sc.index++;
        full += sc.source.slice(start, sc.index);
      }
      if (isElement) {
        compound.pseudoElements.push(full);
        supported = false;
      } else {
        compound.pseudoClasses.push(full);
        if (!SUPPORTED_PSEUDO_CLASSES.has(full)) supported = false;
      }
      continue;
    }
    if (isIdentStart(code)) {
      if (!isEmptyCompound(compound)) return { ok: false };
      const tag = sc.readIdent();
      if (tag === null) return { ok: false };
      compound.tag = tag;
      continue;
    }
    return { ok: false };
  }

  if (current === null || pending !== null) return { ok: false };
  compounds.push(current);

  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const c of compounds) {
    if (c.id !== null) ids++;
    classes += c.classes.length + c.attributes.length + c.pseudoClasses.length;
    if (c.tag !== null) types++;
    types += c.pseudoElements.length;
  }
  return {
    ok: true,
    supported,
    selector: { text: text.trim(), compounds, combinators, specificity: [ids, classes, types] },
  };
}

/**
 * Parse a selector list (`a, b > c, .d[e="f"]`). Supported selectors come back in `selectors`;
 * pseudo-elements and dynamic pseudo-classes are reported in `unsupported`, syntax errors in
 * `invalid`. Both are dropped without affecting the other selectors in the list.
 */
export function parseSelectorList(text: string): SelectorListParseResult {
  const result: SelectorListParseResult = { selectors: [], unsupported: [], invalid: [] };
  for (const part of splitTopLevel(text, ',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      result.invalid.push(part);
      continue;
    }
    const parsed = parseComplex(trimmed);
    if (!parsed.ok) result.invalid.push(trimmed);
    else if (!parsed.supported) result.unsupported.push(trimmed);
    else result.selectors.push(parsed.selector);
  }
  return result;
}
