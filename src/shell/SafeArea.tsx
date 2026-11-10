import { useCallback, useRef, useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";

export type Insets = { top: number; bottom: number };

const NO_INSETS: Insets = { top: 0, bottom: 0 };

/**
 * The slice of a native view we need: `measureInWindow` is on the host instance
 * at runtime, but React Native's public `View` ref type no longer carries it, so
 * the two refs below are typed by hand rather than by `View`.
 */
type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

/**
 * Safe-area insets for the chat surface.
 *
 * The chat page is hosted full-bleed inside the native navigation stack (that
 * page ignores the container safe area), so the status bar and home indicator
 * strips are painted by React Native and share the transcript's background —
 * which is what finally made the safe areas stop looking like a different
 * colour. The cost is that UIKit no longer insets the content for us.
 *
 * The insets are measured rather than assumed: a `SafeAreaView` fills the
 * surface and its first child lands exactly below the top inset. Both boxes are
 * measured in window coordinates and subtracted, so the numbers stay right even
 * if the surface itself is not flush with the window.
 */
export function useSafeAreaInsets() {
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const surface = useRef<Measurable | null>(null);
  const probe = useRef<Measurable | null>(null);

  const measure = useCallback(() => {
    surface.current?.measureInWindow((_x, surfaceY, _width, surfaceHeight) => {
      probe.current?.measureInWindow((_px, probeY, _pw, probeHeight) => {
        if (!(surfaceHeight > 0) || !(probeHeight > 0)) {
          return;
        }
        const next: Insets = {
          top: Math.max(0, Math.round(probeY - surfaceY)),
          bottom: Math.max(
            0,
            Math.round(surfaceY + surfaceHeight - probeY - probeHeight),
          ),
        };
        setInsets((current) =>
          current.top === next.top && current.bottom === next.bottom
            ? current
            : next,
        );
      });
    });
  }, []);

  const setSurface = useCallback((node: unknown) => {
    surface.current = (node as Measurable | null) ?? null;
  }, []);

  const setProbe = useCallback((node: unknown) => {
    probe.current = (node as Measurable | null) ?? null;
  }, []);

  const overlay = (
    <SafeAreaView pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View ref={setProbe} onLayout={measure} style={styles.fill} />
    </SafeAreaView>
  );

  return { insets, setSurface, overlay, measure };
}

const styles = {
  fill: { flex: 1 },
};