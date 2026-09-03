import * as React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { SvgViewerRef } from './types';

export type ControlsPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface ViewerControlsOptions {
  /** Corner of the viewer. Default `top-right`. */
  position?: ControlsPosition;
  /** Show zoom in / zoom out. Default true. */
  zoom?: boolean;
  /** Show the fit-to-content button. Default true. */
  fit?: boolean;
  /** Zoom factor per press. Default 1.5. */
  zoomStep?: number;
  /** Distance from the viewer edges in pixels. Default 12. */
  inset?: number;
  /** Button labels. Defaults: `+`, `−`, `⤢`. */
  labels?: { zoomIn?: string; zoomOut?: string; fit?: string };
  /** Accessibility labels. Defaults: `Zoom in`, `Zoom out`, `Fit to content`. */
  accessibilityLabels?: { zoomIn?: string; zoomOut?: string; fit?: string };
  style?: StyleProp<ViewStyle>;
  buttonStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

interface ViewerControlsProps {
  api: SvgViewerRef;
  options: ViewerControlsOptions;
}

function ControlButton({
  label,
  accessibilityLabel,
  onPress,
  buttonStyle,
  labelStyle,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, buttonStyle]}
    >
      <Text style={[styles.label, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

/** Default zoom in / zoom out / fit controls. Rendered by `SvgViewer` unless `controls={false}`. */
export function ViewerControls({ api, options }: ViewerControlsProps): React.ReactElement | null {
  const {
    position = 'top-right',
    zoom = true,
    fit = true,
    zoomStep = 1.5,
    inset = 12,
    labels,
    accessibilityLabels,
    style,
    buttonStyle,
    labelStyle,
  } = options;
  if (!zoom && !fit) return null;
  const placement: ViewStyle = {
    [position.startsWith('top') ? 'top' : 'bottom']: inset,
    [position.endsWith('right') ? 'right' : 'left']: inset,
  };
  return (
    <View style={[styles.container, placement, style]}>
      {zoom ? (
        <ControlButton
          label={labels?.zoomIn ?? '+'}
          accessibilityLabel={accessibilityLabels?.zoomIn ?? 'Zoom in'}
          onPress={() => api.zoomBy(zoomStep)}
          buttonStyle={buttonStyle}
          labelStyle={labelStyle}
        />
      ) : null}
      {zoom ? (
        <ControlButton
          label={labels?.zoomOut ?? '−'}
          accessibilityLabel={accessibilityLabels?.zoomOut ?? 'Zoom out'}
          onPress={() => api.zoomBy(1 / zoomStep)}
          buttonStyle={buttonStyle}
          labelStyle={labelStyle}
        />
      ) : null}
      {fit ? (
        <ControlButton
          label={labels?.fit ?? '⤢'}
          accessibilityLabel={accessibilityLabels?.fit ?? 'Fit to content'}
          onPress={() => api.fitToContent()}
          buttonStyle={buttonStyle}
          labelStyle={labelStyle}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    gap: 6,
    pointerEvents: 'box-none',
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
  },
  label: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 22,
  },
});
