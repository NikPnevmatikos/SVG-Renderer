import * as React from 'react';
import type { ElementDesc, ElementType } from '../mapping';

/** DOM tag for each element description type (the description uses react-native-svg names). */
const TAGS: Record<Exclude<ElementType, 'Raw'>, string> = {
  Svg: 'svg',
  G: 'g',
  Rect: 'rect',
  Circle: 'circle',
  Ellipse: 'ellipse',
  Line: 'line',
  Polyline: 'polyline',
  Polygon: 'polygon',
  Path: 'path',
  Text: 'text',
  TSpan: 'tspan',
  Image: 'image',
  Defs: 'defs',
  LinearGradient: 'linearGradient',
  RadialGradient: 'radialGradient',
  Stop: 'stop',
  ClipPath: 'clipPath',
};

/** `Pattern` -> `pattern`, `FeGaussianBlur` -> `feGaussianBlur`: SVG tags are the component names with a lower-case initial. */
function rawTag(component: string | undefined): string | null {
  if (!component) return null;
  return component.charAt(0).toLowerCase() + component.slice(1);
}

/**
 * Props of an element description as React DOM expects them. The description carries
 * react-native-svg conventions; the two that differ from the DOM are image hrefs (an object
 * with `uri`) and dash arrays (number arrays). React DOM already accepts camel-cased SVG
 * attribute names such as `strokeWidth` or `textAnchor`.
 */
export function domProps(desc: ElementDesc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(desc.props)) {
    if (value === undefined) continue;
    if (name === 'href' && value !== null && typeof value === 'object' && 'uri' in value) {
      out.href = (value as { uri: string }).uri;
      continue;
    }
    if (name === 'strokeDasharray' && Array.isArray(value)) {
      out.strokeDasharray = value.join(' ');
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Turn an element description into React DOM SVG elements. Unknown passthrough elements render
 * nothing. `extraChildren` are appended inside the root element (in-SVG decorators).
 */
export function renderDomTree(
  desc: ElementDesc,
  extraProps?: Record<string, unknown>,
  extraChildren?: React.ReactNode
): React.ReactElement | null {
  const tag = desc.type === 'Raw' ? rawTag(desc.component) : TAGS[desc.type];
  if (!tag) return null;
  const props = extraProps ? { ...domProps(desc), ...extraProps } : domProps(desc);
  let children: React.ReactNode;
  if (desc.text !== undefined) children = desc.text;
  else if (desc.children.length > 0 || extraChildren !== undefined) {
    const rendered: React.ReactNode[] = desc.children
      .map((child) => renderDomTree(child))
      .filter((child): child is React.ReactElement => child !== null);
    if (extraChildren !== undefined) rendered.push(<React.Fragment key="extra">{extraChildren}</React.Fragment>);
    children = rendered;
  }
  return React.createElement(tag, { key: desc.key, ...props }, children);
}
