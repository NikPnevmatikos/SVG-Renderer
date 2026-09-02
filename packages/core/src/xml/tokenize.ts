import { decodeEntities } from './entities';

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  parent: XmlElement | null;
}

export interface XmlText {
  type: 'text';
  value: string;
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlText;

export class SvgParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at offset ${position})`);
    this.name = 'SvgParseError';
    this.position = position;
  }
}

const enum Char {
  Tab = 9,
  LF = 10,
  CR = 13,
  Space = 32,
  Quote = 34,
  Apos = 39,
  Slash = 47,
  Lt = 60,
  Eq = 61,
  Gt = 62,
}

function isWhitespace(code: number): boolean {
  return code === Char.Space || code === Char.Tab || code === Char.LF || code === Char.CR;
}

function isNameChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 58 || // :
    code === 46 || // .
    code === 45 || // -
    code > 127 // non-ASCII name characters
  );
}

/** `svg:rect` -> `rect`. Other prefixes (inkscape:, sodipodi:, ...) are kept and handled later. */
function normalizeName(name: string): string {
  return name.startsWith('svg:') ? name.slice(4) : name;
}

/**
 * Parse an XML document into a lightweight tree. Handles prolog, DOCTYPE, comments, CDATA,
 * processing instructions, entities and both quote styles. Throws `SvgParseError` on
 * malformed markup (mismatched or unclosed tags, unterminated constructs).
 */
export function parseXml(input: string): XmlElement {
  const n = input.length;
  let i = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  let root: XmlElement | null = null;
  let current: XmlElement | null = null;

  const appendText = (raw: string, decode: boolean): void => {
    if (!current || raw.length === 0) return;
    const value = decode ? decodeEntities(raw) : raw;
    const last = current.children[current.children.length - 1];
    if (last && last.type === 'text') {
      last.value += value;
    } else {
      current.children.push({ type: 'text', value, parent: current });
    }
  };

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      appendText(input.slice(i), true);
      break;
    }
    if (lt > i) appendText(input.slice(i, lt), true);
    i = lt;

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      if (end === -1) throw new SvgParseError('Unterminated comment', i);
      i = end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', i)) {
      const end = input.indexOf(']]>', i + 9);
      if (end === -1) throw new SvgParseError('Unterminated CDATA section', i);
      appendText(input.slice(i + 9, end), false);
      i = end + 3;
      continue;
    }
    if (input.startsWith('<?', i)) {
      const end = input.indexOf('?>', i + 2);
      if (end === -1) throw new SvgParseError('Unterminated processing instruction', i);
      i = end + 2;
      continue;
    }
    if (input.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ... ].
      let j = i + 2;
      let depth = 0;
      while (j < n) {
        const code = input.charCodeAt(j);
        if (code === 91 /* [ */) depth++;
        else if (code === 93 /* ] */) depth--;
        else if (code === Char.Gt && depth <= 0) break;
        j++;
      }
      if (j >= n) throw new SvgParseError('Unterminated declaration', i);
      i = j + 1;
      continue;
    }
    if (input.charCodeAt(i + 1) === Char.Slash) {
      let j = i + 2;
      const start = j;
      while (j < n && isNameChar(input.charCodeAt(j))) j++;
      const name = normalizeName(input.slice(start, j));
      const gt = input.indexOf('>', j);
      if (gt === -1) throw new SvgParseError(`Unterminated closing tag </${name}`, i);
      if (!current) throw new SvgParseError(`Unexpected closing tag </${name}>`, i);
      if (current.name !== name) {
        throw new SvgParseError(
          `Mismatched closing tag </${name}>, expected </${current.name}>`,
          i
        );
      }
      current = current.parent;
      i = gt + 1;
      continue;
    }

    // Start tag.
    let j = i + 1;
    const nameStart = j;
    while (j < n && isNameChar(input.charCodeAt(j))) j++;
    if (j === nameStart) throw new SvgParseError('Invalid tag name', i);
    const element: XmlElement = {
      type: 'element',
      name: normalizeName(input.slice(nameStart, j)),
      attrs: {},
      children: [],
      parent: current,
    };

    let selfClosing = false;
    for (;;) {
      while (j < n && isWhitespace(input.charCodeAt(j))) j++;
      if (j >= n) throw new SvgParseError(`Unterminated start tag <${element.name}`, i);
      const code = input.charCodeAt(j);
      if (code === Char.Gt) {
        j++;
        break;
      }
      if (code === Char.Slash) {
        if (input.charCodeAt(j + 1) !== Char.Gt) {
          throw new SvgParseError(`Unexpected '/' in tag <${element.name}>`, j);
        }
        selfClosing = true;
        j += 2;
        break;
      }
      const attrStart = j;
      while (j < n && isNameChar(input.charCodeAt(j))) j++;
      if (j === attrStart) {
        throw new SvgParseError(
          `Unexpected character '${input[j] ?? ''}' in tag <${element.name}>`,
          j
        );
      }
      const attrName = input.slice(attrStart, j);
      while (j < n && isWhitespace(input.charCodeAt(j))) j++;
      let value = '';
      if (input.charCodeAt(j) === Char.Eq) {
        j++;
        while (j < n && isWhitespace(input.charCodeAt(j))) j++;
        const quote = input.charCodeAt(j);
        if (quote === Char.Quote || quote === Char.Apos) {
          const end = input.indexOf(quote === Char.Quote ? '"' : "'", j + 1);
          if (end === -1) {
            throw new SvgParseError(`Unterminated attribute value for ${attrName}`, j);
          }
          value = decodeEntities(input.slice(j + 1, end));
          j = end + 1;
        } else {
          // Unquoted value: not valid XML, but tolerated.
          const valueStart = j;
          while (
            j < n &&
            !isWhitespace(input.charCodeAt(j)) &&
            input.charCodeAt(j) !== Char.Gt &&
            input.charCodeAt(j) !== Char.Slash
          ) {
            j++;
          }
          value = decodeEntities(input.slice(valueStart, j));
        }
      }
      element.attrs[attrName] = value;
    }

    if (current) {
      current.children.push(element);
    } else if (root) {
      throw new SvgParseError('Multiple root elements', i);
    } else {
      root = element;
    }
    if (!selfClosing) current = element;
    i = j;
  }

  if (current) throw new SvgParseError(`Unclosed tag <${current.name}>`, n);
  if (!root) throw new SvgParseError('No root element found', 0);
  return root;
}
