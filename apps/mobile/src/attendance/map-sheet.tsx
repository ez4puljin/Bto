import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  type GestureResponderEvent,
  PanResponder,
  type PanResponderGestureState,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

/**
 * The bottom sheet of «Ирц»: a grab handle, content in a scroll view, dragged between a low
 * position (`collapsedHeight` shows) and a high one (`expandedHeight`, over the map). Collapsed, a
 * vertical drag anywhere on it moves it; expanded, only the handle does, so the content scrolls and
 * pulls to refresh. `floating` (the round punch button) rides on the sheet's top edge and fades
 * out as the sheet rises.
 */
export function MapSheet({
  collapsedHeight,
  expandedHeight,
  floating,
  floatingRise,
  handleLabel,
  refreshControl,
  bottomInset,
  children,
}: {
  collapsedHeight: number;
  expandedHeight: number;
  floating: ReactNode;
  /** How far the floating node stands above the sheet's top edge. */
  floatingRise: number;
  handleLabel: string;
  refreshControl: React.ReactElement<RefreshControlProps>;
  bottomInset: number;
  children: ReactNode;
}) {
  const range = Math.max(0, expandedHeight - collapsedHeight);
  const offset = useRef(new Animated.Value(range)).current;
  const current = useRef(range);
  const start = useRef(range);
  const open = useRef(false);
  const rangeRef = useRef(range);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    rangeRef.current = range;
    // The window changed (a turn): keep the sheet on its snap point.
    const target = open.current ? 0 : range;
    current.current = target;
    offset.setValue(target);
  }, [range, offset]);

  useEffect(() => {
    const id = offset.addListener(({ value }) => {
      current.current = value;
    });
    return () => offset.removeListener(id);
  }, [offset]);

  const snap = useRef((to: number) => {
    open.current = to === 0;
    setExpanded(to === 0);
    Animated.spring(offset, {
      toValue: to,
      useNativeDriver: true,
      bounciness: 0,
      speed: 16,
    }).start();
  }).current;

  const handlers = useMemo(() => {
    const moved = (gesture: PanResponderGestureState) =>
      Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
    const grant = () => {
      offset.stopAnimation();
      start.current = current.current;
    };
    const move = (_: GestureResponderEvent, gesture: PanResponderGestureState) => {
      offset.setValue(Math.min(rangeRef.current, Math.max(0, start.current + gesture.dy)));
    };
    const release = (_: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const top = rangeRef.current;
      if (Math.abs(gesture.dy) < 6 && Math.abs(gesture.dx) < 6) {
        snap(open.current ? top : 0);
        return;
      }
      const goUp = gesture.vy < -0.4 || (Math.abs(gesture.vy) <= 0.4 && current.current < top / 2);
      snap(goUp ? 0 : top);
    };
    return {
      // Collapsed: any vertical drag on the sheet.
      sheet: PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) => !open.current && moved(gesture),
        onPanResponderGrant: grant,
        onPanResponderMove: move,
        onPanResponderRelease: release,
        onPanResponderTerminationRequest: () => false,
      }),
      // The handle: always, and a tap on it toggles.
      handle: PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: grant,
        onPanResponderMove: move,
        onPanResponderRelease: release,
      }),
    };
  }, [offset, snap]);

  const fade = offset.interpolate({
    inputRange: [0, range * 0.5, range],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      {...handlers.sheet.panHandlers}
      style={[styles.sheet, { height: expandedHeight, transform: [{ translateY: offset }] }]}
    >
      <Animated.View
        pointerEvents={expanded ? 'none' : 'box-none'}
        style={[styles.floating, { top: -floatingRise, opacity: fade }]}
      >
        {floating}
      </Animated.View>
      <View
        {...handlers.handle.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={handleLabel}
        style={styles.handleZone}
      >
        <View style={styles.handle} />
      </View>
      <ScrollView
        scrollEnabled={expanded}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: floatingRise > 0 ? 0 : spacing.sm,
            paddingBottom: bottomInset + spacing.xl,
          },
        ]}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    boxShadow: shadows.floating,
  },
  floating: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  handleZone: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.dotIdle },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
});
