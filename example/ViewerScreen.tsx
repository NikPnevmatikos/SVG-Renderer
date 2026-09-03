import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseSvg, type Camera, type SvgNode } from 'svg-renderer';
import { SvgViewer, type ElementHit, type SelectionMode, type SvgViewerRef } from 'svg-renderer/viewer';

import type { Fixture } from './fixtures';

interface RegionData {
  label: string;
  index: number;
}

function Badge({ label, selected }: { label: string; selected: boolean }): React.ReactElement {
  return (
    <View style={[styles.badge, selected && styles.badgeSelected]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

/**
 * Interactive mode: pan, pinch, double-tap to zoom, tap a region to select it, tap it again
 * to deselect. Selection is the viewer's own (controlled here so badges can follow it);
 * zoom and fit buttons come from the viewer; "Zoom to" is an app-level control using the ref.
 */
export function ViewerScreen({ fixture }: { fixture: Fixture }): React.ReactElement {
  const document = useMemo(() => parseSvg(fixture.xml), [fixture]);
  const viewer = useRef<SvgViewerRef>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [mode, setMode] = useState<SelectionMode>('single');
  const [badgesWhenLarge, setBadgesWhenLarge] = useState(false);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [lastHit, setLastHit] = useState<string>('tap a region');

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

  const describeCamera = useCallback((): string => {
    const current = viewer.current?.getCamera();
    return current ? `cam ${current.scale.toFixed(2)}/${current.tx.toFixed(0)}/${current.ty.toFixed(0)}` : 'cam –';
  }, []);

  const onElementPress = useCallback(
    (hit: ElementHit) => {
      const data = hit.data as RegionData | undefined;
      setLastHit(
        `${hit.node.id ?? hit.node.tag}${data ? ` (#${data.label})` : ''} at ${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)} ` +
          `(screen ${hit.screenPoint.x.toFixed(0)}, ${hit.screenPoint.y.toFixed(0)}; ${describeCamera()})`
      );
    },
    [describeCamera]
  );

  const decorators = useMemo(
    () => [
      {
        match: (node: SvgNode) => node.id !== undefined && node.id in regions,
        layer: 'overlay' as const,
        // "when large": a badge shows only once its region is at least 250 px wide on screen.
        minTargetSize: badgesWhenLarge ? 250 : undefined,
        render: (node: SvgNode) => (
          <Badge label={regions[node.id ?? '']?.label ?? '?'} selected={node.id !== undefined && selection.includes(node.id)} />
        ),
      },
    ],
    [regions, selection, badgesWhenLarge]
  );

  const regionCount = Object.keys(regions).length;
  const first = selection[0];

  return (
    <View style={styles.root}>
      <SvgViewer
        ref={viewer}
        document={document}
        style={styles.viewer}
        interactive={regions}
        selectionMode={mode}
        selection={selection}
        onSelectionChange={setSelection}
        selectedStyle={{ stroke: { type: 'color', value: '#16a34a' }, strokeWidth: 3, fillOpacity: 0.55 }}
        decorators={regionCount > 0 && regionCount <= 200 ? decorators : undefined}
        onElementPress={onElementPress}
        onBackgroundPress={(point, screenPoint) => {
          setLastHit(
            `background at ${point.x.toFixed(1)}, ${point.y.toFixed(1)} (screen ${screenPoint.x.toFixed(0)}, ${screenPoint.y.toFixed(0)}; ${describeCamera()})`
          );
        }}
        onCameraChange={setCamera}
        padding={24}
      >
        {first !== undefined ? (
          <Pressable
            style={styles.selectedButton}
            onPress={() => viewer.current?.fitToElement(first, { padding: 48, maxZoom: 6 })}
            accessibilityRole="button"
          >
            <Text style={styles.selectedButtonText}>
              Zoom to #{regions[first]?.label ?? '?'}
              {selection.length > 1 ? ` (+${selection.length - 1})` : ''}
            </Text>
          </Pressable>
        ) : null}
      </SvgViewer>
      <View style={styles.status}>
        <Text style={styles.statusText}>
          {regionCount} regions · zoom {camera ? camera.scale.toFixed(2) : '–'}× · {lastHit}
        </Text>
        <View style={styles.statusRow}>
          <Text style={styles.hint}>
            selected: {selection.length === 0 ? 'none' : selection.map((id) => `#${regions[id]?.label ?? '?'}`).join(', ')} · tap
            again to deselect
          </Text>
          <Pressable
            onPress={() => setBadgesWhenLarge((current) => !current)}
            style={styles.modeButton}
            accessibilityRole="button"
          >
            <Text style={styles.modeButtonText}>badges: {badgesWhenLarge ? 'when large' : 'always'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode((current) => (current === 'single' ? 'multiple' : 'single'))}
            style={styles.modeButton}
            accessibilityRole="button"
          >
            <Text style={styles.modeButtonText}>selection: {mode}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  viewer: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  selectedButton: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#16a34a',
  },
  selectedButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#2563eb',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSelected: {
    backgroundColor: '#16a34a',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  status: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusText: {
    fontSize: 13,
    color: '#111827',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  hint: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
  },
  modeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  modeButtonText: {
    fontSize: 12,
    color: '#374151',
  },
});
