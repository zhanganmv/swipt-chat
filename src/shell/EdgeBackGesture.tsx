import { useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

/**
 * Swipe-from-the-left-edge to leave the settings root and return to the chat.
 *
 * Only mounted at the settings *root* (navigation depth 0) and only while
 * settings is on top: deeper pages belong to SwiftUI's own `NavigationStack`,
 * which already has the system interactive pop gesture, and on the chat page the
 * Swipt host's own swipe-to-dismiss must win (see `SwipeGuard` for why that
 * gesture is disabled here).
 *
 * The strip starts below the navigation bar so the (glass) back button in the
 * top-left corner stays tappable — a touch target that covers it would swallow
 * the tap.
 */
const STRIP_WIDTH = 24;
const TOP_INSET = 104;
const START_THRESHOLD = 24;

export function EdgeBackGesture({
  onBack,
  enabled = true,
}: {
  onBack: () => void;
  enabled?: boolean;
}) {
  // Keep the latest callback without rebuilding the responder (a new responder
  // mid-gesture would drop the drag).
  const back = useRef(onBack);
  back.current = onBack;

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > START_THRESHOLD && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > 60) {
          back.current();
        }
      },
    }),
  ).current;

  if (!enabled) {
    return null;
  }
  return <View {...responder.panHandlers} style={styles.strip} />;
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    top: TOP_INSET,
    bottom: 0,
    width: STRIP_WIDTH,
  },
});