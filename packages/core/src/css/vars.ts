import type { Declarations } from '../style/resolve';
import { splitTopLevel } from './selector';

/** Custom properties (`--name`) declared on an element, or `null` when there are none. */
export function extractCustomProperties(declarations: Declarations): Record<string, string> | null {
  let out: Record<string, string> | null = null;
  for (const name in declarations) {
    if (!name.startsWith('--')) continue;
    const value = declarations[name];
    if (value === undefined) continue;
    if (!out) out = {};
    out[name] = value;
  }
  return out;
}

const MAX_DEPTH = 16;

/**
 * Replace every `var(--name[, fallback])` in `value`. Unknown variables without a fallback
 * become an empty string, which makes the declaration invalid and thus ignored — the same
 * outcome browsers produce (the property falls back to its inherited or initial value).
 */
export function substituteVars(value: string, vars: Readonly<Record<string, string>>, depth = 0): string {
  let out = value;
  let guard = 0;
  while (guard++ < 64) {
    const start = out.indexOf('var(');
    if (start === -1) break;
    let depthParens = 0;
    let end = -1;
    for (let i = start + 3; i < out.length; i++) {
      const code = out.charCodeAt(i);
      if (code === 40) depthParens++;
      else if (code === 41) {
        depthParens--;
        if (depthParens === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return '';
    const inner = out.slice(start + 4, end);
    const [rawName, ...rest] = splitTopLevel(inner, ',');
    const name = (rawName ?? '').trim();
    const fallback = rest.length > 0 ? rest.join(',').trim() : undefined;
    let replacement: string;
    const defined = vars[name];
    if (defined !== undefined) replacement = depth < MAX_DEPTH ? substituteVars(defined, vars, depth + 1) : '';
    else if (fallback !== undefined) replacement = depth < MAX_DEPTH ? substituteVars(fallback, vars, depth + 1) : '';
    else replacement = '';
    out = out.slice(0, start) + replacement + out.slice(end + 1);
  }
  return out.trim();
}
