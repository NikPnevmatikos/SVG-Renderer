#!/usr/bin/env node
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { planToSvgString, toSvgString } from './document/emit';
import { serializeDocument } from './document/serialize';
import { parseSvg } from './parse';
import type { PlanOptions, SvgDocument, SvgNode, SvgWarning } from './types';

const USAGE = `svg-core — inspect, plan and normalize SVG documents

Usage:
  svg-core inspect <file.svg> [--ids <ids.json>] [--json]
  svg-core plan <file.svg> [--no-batching] [--json]
  svg-core normalize <file.svg> [--ir | --plan] [--precision <n>] [-o <out>]

Commands:
  inspect     Summary of the document: viewport, element counts, ids, definitions and warnings.
              --ids <file>   JSON array of ids (or object keyed by id) that must exist; exit 1 if any is missing.
  plan        Draw-unit report: how many units, batches and merged shapes a backend would receive.
  normalize   Emit standalone SVG with stylesheets, use/symbol and units resolved (default),
              the JSON intermediate representation (--ir), or the batched plan as SVG (--plan).

Exit codes: 0 ok · 1 validation failed · 2 usage or input error
`;

interface Args {
  command: string | undefined;
  file: string | undefined;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (name === 'ids' || name === 'precision') {
        if (next === undefined) throw new Error(`--${name} needs a value`);
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    } else if (arg === '-o') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('-o needs a file name');
      flags.set('out', next);
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], file: positional[1], flags };
}

function countByTag(document: SvgDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (node: SvgNode): void => {
    counts[node.tag] = (counts[node.tag] ?? 0) + 1;
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(document.root);
  return counts;
}

function collectIds(document: SvgDocument): string[] {
  const ids: string[] = [];
  const visit = (node: SvgNode): void => {
    if (node.id !== undefined) ids.push(node.id);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(document.root);
  return ids;
}

function formatWarnings(warnings: readonly SvgWarning[]): string[] {
  return warnings.map((w) => `[${w.code}]${w.tag ? ` <${w.tag}>` : ''}${w.nodeId ? ` #${w.nodeId}` : ''}: ${w.message}`);
}

function readIds(file: string): string[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object') return Object.keys(raw as Record<string, unknown>);
  throw new Error(`${file} must contain a JSON array of ids or an object keyed by id`);
}

function inspect(document: SvgDocument, file: string, args: Args): number {
  const counts = countByTag(document);
  const ids = collectIds(document);
  const defs = Object.values(document.defs).map((d) => `${d.kind === 'raw' ? d.tag : d.kind}#${d.id}`);
  const report = {
    file: basename(file),
    viewBox: document.viewBox,
    width: document.width ?? null,
    height: document.height ?? null,
    contentBounds: document.contentBounds,
    elements: Object.values(counts).reduce((a, b) => a + b, 0),
    byTag: counts,
    ids,
    definitions: defs,
    warnings: document.warnings,
  };

  let missing: string[] = [];
  const idsFile = args.flags.get('ids');
  if (typeof idsFile === 'string') {
    const expected = readIds(idsFile);
    const present = new Set(ids);
    missing = expected.filter((id) => !present.has(id));
  }

  if (args.flags.has('json')) {
    console.log(JSON.stringify({ ...report, missingIds: missing }, null, 2));
  } else {
    console.log(`${report.file}`);
    console.log(`  viewBox      ${document.viewBox ? `${document.viewBox.x} ${document.viewBox.y} ${document.viewBox.width} ${document.viewBox.height}` : '(none)'}`);
    console.log(`  size         ${document.width ?? '-'} x ${document.height ?? '-'}`);
    const cb = document.contentBounds;
    console.log(`  content      ${cb.x} ${cb.y} ${cb.width} ${cb.height}`);
    console.log(`  elements     ${report.elements}`);
    for (const [tag, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${tag.padEnd(12)} ${count}`);
    }
    console.log(`  ids          ${ids.length}${ids.length > 0 ? `: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}` : ''}`);
    console.log(`  definitions  ${defs.length}${defs.length > 0 ? `: ${defs.join(', ')}` : ''}`);
    console.log(`  warnings     ${document.warnings.length}`);
    for (const line of formatWarnings(document.warnings)) console.log(`    ${line}`);
    if (typeof idsFile === 'string') {
      console.log(`  ids check    ${missing.length === 0 ? 'all present' : `${missing.length} missing: ${missing.join(', ')}`}`);
    }
  }
  return missing.length > 0 ? 1 : 0;
}

function plan(document: SvgDocument, file: string, args: Args): number {
  const options: PlanOptions = { batching: !args.flags.has('no-batching') };
  const started = Date.now();
  const result = document.plan(options);
  const elapsed = Date.now() - started;
  const kinds: Record<string, number> = {};
  for (const unit of result.units) kinds[unit.kind] = (kinds[unit.kind] ?? 0) + 1;
  const report = {
    file: basename(file),
    batching: result.batched,
    units: result.units.length,
    byKind: kinds,
    batches: result.batchCount,
    mergedShapes: result.mergedShapes,
    staticShapes: result.staticCount,
    planMs: elapsed,
  };
  if (args.flags.has('json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.file}`);
    console.log(`  batching       ${result.batched ? 'on' : 'off'}`);
    console.log(`  draw units     ${result.units.length}`);
    for (const [kind, count] of Object.entries(kinds)) console.log(`    ${kind.padEnd(12)} ${count}`);
    console.log(`  batches        ${result.batchCount} (${result.mergedShapes} shapes merged)`);
    console.log(`  static leaves  ${result.staticCount}`);
    console.log(`  plan time      ${elapsed} ms`);
  }
  return 0;
}

function normalize(document: SvgDocument, args: Args): number {
  const precisionFlag = args.flags.get('precision');
  const precision = typeof precisionFlag === 'string' ? Number(precisionFlag) : undefined;
  if (precision !== undefined && (!Number.isInteger(precision) || precision < 0)) {
    throw new Error('--precision must be a non-negative integer');
  }
  let output: string;
  if (args.flags.has('ir')) output = JSON.stringify(serializeDocument(document));
  else if (args.flags.has('plan')) output = planToSvgString(document.plan(), document, { precision });
  else output = toSvgString(document, { precision });
  const out = args.flags.get('out');
  if (typeof out === 'string') {
    writeFileSync(out, `${output}\n`, 'utf8');
    console.error(`wrote ${out} (${(output.length / 1024).toFixed(1)} KB, ${document.warnings.length} warnings)`);
  } else {
    process.stdout.write(`${output}\n`);
  }
  return 0;
}

export function main(argv: string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (args.command === undefined || args.flags.has('help') || args.command === 'help') {
    console.log(USAGE);
    return args.command === undefined && !args.flags.has('help') ? 2 : 0;
  }
  if (args.file === undefined) {
    console.error(`Missing input file.\n\n${USAGE}`);
    return 2;
  }
  let document: SvgDocument;
  try {
    document = parseSvg(readFileSync(args.file, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${args.file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  try {
    switch (args.command) {
      case 'inspect':
        return inspect(document, args.file, args);
      case 'plan':
        return plan(document, args.file, args);
      case 'normalize':
        return normalize(document, args);
      default:
        console.error(`Unknown command "${args.command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
