import type { Rect } from 'svg-core';

/** A screen-space label candidate for overlap resolution. */
export interface LabelCandidate {
  key: string;
  /** Center of the label on screen, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Higher wins when two labels overlap. Ties keep the earlier candidate. */
  priority: number;
}

/**
 * Greedy label placement: candidates are visited by descending priority (stable for ties) and
 * kept only when their box does not overlap a box already kept. Returns the keys that must be
 * hidden. `gap` adds breathing room between labels, in pixels.
 */
export function resolveOverlaps(candidates: readonly LabelCandidate[], gap = 2): Set<string> {
  const hidden = new Set<string>();
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index);
  const kept: Rect[] = [];
  for (const { candidate } of ordered) {
    const box: Rect = {
      x: candidate.x - candidate.width / 2 - gap / 2,
      y: candidate.y - candidate.height / 2 - gap / 2,
      width: candidate.width + gap,
      height: candidate.height + gap,
    };
    if (kept.some((other) => overlaps(other, box))) hidden.add(candidate.key);
    else kept.push(box);
  }
  return hidden;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
