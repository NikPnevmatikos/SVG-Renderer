import { useCallback, useMemo, useRef, useState } from 'react';
import { parseSvg, type Camera, type SvgNode } from 'svg-renderer/web';
import { SvgViewer, type ElementHit, type SelectionMode, type SvgViewerRef } from 'svg-renderer/web';
import { FIXTURES } from '../../example/fixtures';

interface RegionData {
  label: string;
  index: number;
}

/** always: every badge. when large: only while its region is at least 250 px wide. no overlap: hide colliding badges. */
type BadgeMode = 'always' | 'when large' | 'no overlap';
const BADGE_MODES: BadgeMode[] = ['always', 'when large', 'no overlap'];
const SELECTION_MODES: SelectionMode[] = ['single', 'multiple', 'none'];

function Badge({ label, selected }: { label: string; selected: boolean }): React.ReactElement {
  return (
    <div
      style={{
        minWidth: 22,
        height: 22,
        padding: '0 6px',
        borderRadius: 11,
        background: selected ? '#16a34a' : '#2563eb',
        border: '2px solid #ffffff',
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      {label}
    </div>
  );
}

const pill: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 13,
};
const pillActive: React.CSSProperties = { ...pill, background: '#111827', color: '#ffffff', borderColor: '#111827' };

export function App(): React.ReactElement {
  const [fixtureIndex, setFixtureIndex] = useState(0);
  const fixture = FIXTURES[fixtureIndex] ?? FIXTURES[0]!;
  const document = useMemo(() => parseSvg(fixture.xml), [fixture]);
  const viewer = useRef<SvgViewerRef>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single');
  const [badgeMode, setBadgeMode] = useState<BadgeMode>('always');
  const [camera, setCamera] = useState<Camera | null>(null);
  const [lastHit, setLastHit] = useState('tap a region');

  const regions = useMemo(() => {
    const record: Record<string, RegionData> = {};
    const candidates = new Set<SvgNode>(document.querySelectorAll('.room'));
    const visit = (node: SvgNode): void => {
      if (node.id && (node.id.startsWith('room-') || node.id.startsWith('booth-'))) candidates.add(node);
      if (node.kind === 'group') node.children.forEach(visit);
    };
    visit(document.root);
    let index = 1;
    for (const node of candidates) {
      if (!node.id) continue;
      record[node.id] = { label: String(index), index };
      index++;
    }
    return record;
  }, [document]);

  const describe = useCallback((hit: ElementHit, verb: string): string => {
    const data = hit.data as RegionData | undefined;
    const cam = viewer.current?.getCamera();
    return `${verb} ${hit.node.id ?? hit.node.tag}${data ? ` (#${data.label})` : ''} at ${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}${
      cam ? ` · cam ${cam.scale.toFixed(2)}/${cam.tx.toFixed(0)}/${cam.ty.toFixed(0)}` : ''
    }`;
  }, []);

  const decorators = useMemo(
    () => [
      {
        match: (node: SvgNode) => node.id !== undefined && node.id in regions,
        layer: 'overlay' as const,
        minTargetSize: badgeMode === 'when large' ? 250 : undefined,
        avoidOverlap: badgeMode === 'no overlap',
        render: (node: SvgNode) => (
          <Badge label={regions[node.id ?? '']?.label ?? '?'} selected={node.id !== undefined && selection.includes(node.id)} />
        ),
      },
    ],
    [regions, selection, badgeMode]
  );

  const regionCount = Object.keys(regions).length;
  const first = selection[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, boxSizing: 'border-box', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>svg-renderer example</h1>
        <span style={{ color: '#6b7280', fontSize: 13 }}>react dom · svg-renderer/web</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FIXTURES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            style={index === fixtureIndex ? pillActive : pill}
            onClick={() => {
              setFixtureIndex(index);
              setSelection([]);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <SvgViewer
        ref={viewer}
        document={document}
        style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid #e5e7eb', background: '#ffffff' }}
        interactive={regions}
        selectionMode={selectionMode}
        selection={selection}
        onSelectionChange={setSelection}
        selectedStyle={{ stroke: { type: 'color', value: '#16a34a' }, strokeWidth: 3, fillOpacity: 0.55 }}
        pressedStyle={{ fillOpacity: 0.35 }}
        decorators={regionCount > 0 && regionCount <= 200 ? decorators : undefined}
        accessibility={(node) => {
          const data = regions[node.id ?? ''];
          return data ? { label: `Region ${data.label}`, hint: 'Selects the region' } : null;
        }}
        onElementPress={(hit) => setLastHit(describe(hit, 'pressed'))}
        onElementLongPress={(hit) => setLastHit(describe(hit, 'long press on'))}
        onBackgroundPress={(point) => setLastHit(`background at ${point.x.toFixed(1)}, ${point.y.toFixed(1)}`)}
        onCameraChange={setCamera}
        padding={24}
      >
        {first !== undefined ? (
          <button
            type="button"
            style={{ ...pillActive, position: 'absolute', left: 12, bottom: 12, background: '#16a34a', border: '1px solid #16a34a' }}
            onClick={() => viewer.current?.fitToElements(selection, { padding: 48, maxZoom: 6 })}
          >
            Zoom to {selection.map((id) => `#${regions[id]?.label ?? '?'}`).join(', ')}
          </button>
        ) : null}
      </SvgViewer>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: '#374151' }}>
          {regionCount} regions · zoom {camera ? camera.scale.toFixed(2) : '–'}× · {lastHit} · selected:{' '}
          {selection.length === 0 ? 'none' : selection.map((id) => `#${regions[id]?.label ?? '?'}`).join(', ')}
        </span>
        <button type="button" style={pill} onClick={() => setBadgeMode((m) => BADGE_MODES[(BADGE_MODES.indexOf(m) + 1) % BADGE_MODES.length]!)}>
          badges: {badgeMode}
        </button>
        <button
          type="button"
          style={pill}
          onClick={() => setSelectionMode((m) => SELECTION_MODES[(SELECTION_MODES.indexOf(m) + 1) % SELECTION_MODES.length]!)}
        >
          selection: {selectionMode}
        </button>
      </div>
    </div>
  );
}
