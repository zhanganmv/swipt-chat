import { memo } from "react";
import { View } from "react-native";
import { Host, NavigationDestination, NavigationStack, Rectangle } from "@expo/ui/swift-ui";
import { frame } from "@expo/ui/swift-ui/modifiers";

/**
 * Keeps the Swipt host's swipe-to-dismiss gesture from reaching the settings page.
 *
 * The host adds its own `UIScreenEdgePanGestureRecognizer` to the full-screen
 * presentation (`Swipt/Automation/SwipletPresentation.swift:51`) and lets the
 * gesture begin only when *no* navigation bar in the hierarchy belongs to a
 * `UINavigationController` with more than one view controller
 * (`SwipletPresentation.swift:70`). That is how a plugin can keep the standard
 * "swipe back" for its own native stack instead of being thrown out to Swipt.
 *
 * Our settings page is one native `NavigationStack`, so at its *root* the depth
 * is 1 and the host would dismiss the whole plugin. This mounts an invisible
 * 1×1 `NavigationStack` pushed to depth 2: the host's check then fails and the
 * swipe is left to us (`EdgeBackGesture` pops settings → chat; deeper settings
 * pages keep SwiftUI's own interactive pop).
 *
 * Verified in a simulator probe before shipping: a 1×1 clipped stack with a
 * pushed destination makes `bars(with delegate.vcCount > 1)` true, so
 * `gestureRecognizerShouldBegin` returns false. It is only mounted while
 * settings is open — on the chat page the host's swipe must still dismiss to
 * Swipt.
 */
export const SwipeGuard = memo(function SwipeGuard() {
  return (
    <View pointerEvents="none" style={styles.anchor}>
      <Host style={styles.host}>
        <NavigationStack path={["guard"]}>
          <Rectangle modifiers={[frame({ width: 1, height: 1 })]} />
          <NavigationDestination value="guard">
            <Rectangle modifiers={[frame({ width: 1, height: 1 })]} />
          </NavigationDestination>
        </NavigationStack>
      </Host>
    </View>
  );
});

const styles = {
  anchor: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    overflow: "hidden" as const,
  },
  host: { flex: 1 },
};