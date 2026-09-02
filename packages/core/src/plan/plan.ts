import type { DrawUnit, PlanOptions, RenderPlan, SvgDocument, SvgNode } from '../types';
import { isIdentity } from '../geometry/matrix';

/**
 * Turn the scene graph into an ordered list of draw units for a backend.
 *
 * This version is a pass-through: one unit per leaf, with group boundaries only where a
 * group carries something a backend must honour (opacity, clip, mask, filter, transform).
 * Style batching of static shapes is the next step and will slot in here.
 */
export function planDocument(document: SvgDocument, options: PlanOptions = {}): RenderPlan {
  const units: DrawUnit[] = [];
  const dynamicIds = new Set<string>();
  let staticCount = 0;
  const isInteractive = options.interactive ?? (() => false);

  const visit = (node: SvgNode): void => {
    if (node.kind !== 'group' && node.style.visibility === 'hidden') return;
    switch (node.kind) {
      case 'group': {
        const style = node.style;
        const needsWrapper =
          node !== document.root &&
          (style.opacity < 1 ||
            style.clipPath !== undefined ||
            style.mask !== undefined ||
            style.filter !== undefined ||
            !isIdentity(node.transform));
        if (needsWrapper) {
          const unit: DrawUnit = { kind: 'group-begin' };
          if (node.id !== undefined) unit.id = node.id;
          if (style.opacity < 1) unit.opacity = style.opacity;
          if (style.clipPath !== undefined) unit.clipPath = style.clipPath;
          if (style.mask !== undefined) unit.mask = style.mask;
          if (style.filter !== undefined) unit.filter = style.filter;
          if (!isIdentity(node.transform)) unit.transform = node.transform;
          units.push(unit);
        }
        for (const child of node.children) visit(child);
        if (needsWrapper) units.push({ kind: 'group-end' });
        break;
      }
      case 'shape': {
        const interactive = isInteractive(node);
        if (interactive && node.id !== undefined) dynamicIds.add(node.id);
        if (!interactive) staticCount++;
        units.push({ kind: 'shape', node, interactive });
        break;
      }
      case 'text':
        staticCount++;
        units.push({ kind: 'text', node });
        break;
      case 'image':
        staticCount++;
        units.push({ kind: 'image', node });
        break;
    }
  };
  visit(document.root);

  return { units, staticCount, dynamicIds, batched: false };
}
