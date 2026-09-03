import type { XmlElement, XmlNode } from './tokenize';

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/** Serialize attributes as ` name="value"` pairs; `undefined` values are skipped. */
export function formatAttributes(attrs: Readonly<Record<string, string | undefined>>): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out += ` ${name}="${escapeXmlAttribute(value)}"`;
  }
  return out;
}

/** Serialize an XML subtree back to markup (compact, no added whitespace). */
export function serializeXml(node: XmlNode): string {
  if (node.type === 'text') return escapeXmlText(node.value);
  const el: XmlElement = node;
  const open = `<${el.name}${formatAttributes(el.attrs)}`;
  if (el.children.length === 0) return `${open}/>`;
  let inner = '';
  for (const child of el.children) inner += serializeXml(child);
  return `${open}>${inner}</${el.name}>`;
}
