import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { formatViewBox, parseSvg, type SvgDocument, type SvgNode } from 'svg-renderer';
import { SvgRenderer } from 'svg-renderer';

import { FIXTURES } from './fixtures';
import { ViewerScreen } from './ViewerScreen';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

function countNodes(document: SvgDocument): number {
  let count = 0;
  const visit = (node: SvgNode): void => {
    count++;
    if (node.kind === 'group') node.children.forEach(visit);
  };
  visit(document.root);
  return count;
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

type Mode = 'gallery' | 'viewer';

function GalleryScreen({ fixtureIndex }: { fixtureIndex: number }): React.ReactElement {
  const fixture = FIXTURES[fixtureIndex] ?? FIXTURES[0]!;
  const parsed = useMemo(() => {
    const start = now();
    try {
      const document = parseSvg(fixture.xml);
      return { document, ms: now() - start, error: null as string | null };
    } catch (reason: unknown) {
      return {
        document: null,
        ms: now() - start,
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [fixture]);

  const plan = parsed.document ? parsed.document.plan() : null;
  const warnings = parsed.document?.warnings ?? [];

  return (
    <>
      <View style={styles.canvas} testID="canvas">
        {parsed.document ? (
          <SvgRenderer source={{ document: parsed.document }} width="100%" height="100%" />
        ) : (
          <Text style={styles.error}>{parsed.error}</Text>
        )}
      </View>

      <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent}>
        <Text style={styles.description}>{fixture.description}</Text>
        <View style={styles.stats}>
          <Stat label="parse + normalize" value={`${parsed.ms.toFixed(2)} ms`} />
          <Stat label="nodes" value={parsed.document ? String(countNodes(parsed.document)) : '–'} />
          <Stat label="draw units" value={plan ? String(plan.units.length) : '–'} />
          <Stat
            label="batched shapes"
            value={plan ? `${plan.mergedShapes} in ${plan.batchCount} ${plan.batchCount === 1 ? 'path' : 'paths'}` : '–'}
          />
          <Stat label="viewBox" value={parsed.document?.viewBox ? formatViewBox(parsed.document.viewBox) : '–'} />
        </View>
        <Text style={styles.sectionTitle}>Warnings ({warnings.length})</Text>
        {warnings.length === 0 ? <Text style={styles.warningNone}>none</Text> : null}
        {warnings.map((warning, index) => (
          <Text key={`${warning.code}-${index}`} style={styles.warning}>
            • [{warning.code}] {warning.message}
          </Text>
        ))}
      </ScrollView>
    </>
  );
}

export default function App(): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('gallery');
  const fixture = FIXTURES[selected] ?? FIXTURES[0]!;

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>svg-renderer example</Text>
            <Text style={styles.subtitle}>phase 2 · react-native-svg backend · {Platform.OS}</Text>
          </View>
          <View style={styles.modeSwitch}>
            {(['gallery', 'viewer'] as Mode[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => setMode(item)}
                style={[styles.modeButton, mode === item && styles.modeButtonActive]}
                testID={`mode-${item}`}
              >
                <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {FIXTURES.map((item, index) => {
          const active = index === selected;
          return (
            <Pressable
              key={item.name}
              onPress={() => setSelected(index)}
              style={[styles.tab, active && styles.tabActive]}
              testID={`fixture-${index}`}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {mode === 'gallery' ? <GalleryScreen fixtureIndex={selected} /> : <ViewerScreen fixture={fixture} />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'web' ? 0 : 48,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    padding: 3,
  },
  modeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modeButtonActive: {
    backgroundColor: '#111827',
  },
  modeText: {
    fontSize: 13,
    color: '#374151',
  },
  modeTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabs: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  tabActive: {
    backgroundColor: '#111827',
  },
  tabText: {
    fontSize: 14,
    color: '#374151',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  canvas: {
    height: 320,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#b91c1c',
    padding: 16,
  },
  details: {
    flex: 1,
    marginTop: 12,
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  description: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  stat: {
    minWidth: 120,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginTop: 16,
    marginBottom: 6,
  },
  warningNone: {
    fontSize: 13,
    color: '#6b7280',
  },
  warning: {
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
    marginBottom: 4,
  },
});
