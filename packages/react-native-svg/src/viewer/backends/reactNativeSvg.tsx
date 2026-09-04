import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SvgRenderer } from '../../SvgRenderer';
import type { ViewerBackendProps } from '../types';

/**
 * react-native-svg backend for the viewer. The drawing is rasterized once for the layer's
 * camera over the chosen region; every frame the layer is displayed with the GPU transform
 * that maps that camera onto the live one, so gestures never re-render and a layer stays
 * correctly placed whether or not it is the newest. The viewer mounts a new layer whenever it
 * re-anchors (after a gesture, and during pauses of a long pinch or pan) and drops the old one
 * once this layer reports `onReady`.
 */
export function ReactNativeSvgBackend({
  document,
  planOptions,
  overrides,
  camera,
  live,
  region,
  onReady,
  children,
}: ViewerBackendProps): React.ReactElement {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const scale = live.scale.value / camera.scale;
    return {
      transform: [
        { translateX: live.tx.value - camera.tx * scale },
        { translateY: live.ty.value - camera.ty * scale },
        { scale },
      ],
    };
  }, [camera.scale, camera.tx, camera.ty]);
  const svgStyle = React.useMemo(
    () => ({ position: 'absolute' as const, left: region.x, top: region.y }),
    [region.x, region.y]
  );
  const handleLayout = React.useCallback(() => {
    onReady?.();
  }, [onReady]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, animatedStyle]} onLayout={handleLayout}>
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
