import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SvgRenderer } from '../../SvgRenderer';
import type { ViewerBackendProps } from '../types';

/**
 * react-native-svg backend for the viewer. The drawing is rasterized once per resting camera
 * for the chosen region and moved with the live gesture delta as a GPU transform; the viewer
 * re-anchors (re-renders for the new resting camera) when a gesture ends, so content is crisp
 * again after every zoom.
 */
export function ReactNativeSvgBackend({
  document,
  planOptions,
  overrides,
  delta,
  region,
  children,
}: ViewerBackendProps): React.ReactElement {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateX: delta.tx.value }, { translateY: delta.ty.value }, { scale: delta.scale.value }],
    };
  });
  const svgStyle = React.useMemo(
    () => ({ position: 'absolute' as const, left: region.x, top: region.y }),
    [region.x, region.y]
  );
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, animatedStyle]}>
      <SvgRenderer
        source={{ document }}
        planOptions={planOptions}
        overrides={overrides}
        viewBox={region.viewBox}
        width={region.width}
        height={region.height}
        style={svgStyle}
      >
        {children}
      </SvgRenderer>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    transformOrigin: '0 0',
    pointerEvents: 'none',
  },
});
