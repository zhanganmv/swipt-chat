import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";

import { useTheme } from "../theme/index.tsx";

/** Only two screens exist: the chat and the settings stack. */
export type RouteName = "chat" | "settings";

export type Route = { key: number; name: RouteName };

let keyCounter = 0;

/**
 * A minimal page stack.
 *
 * Cherry uses expo-router; a swiplet cannot (no react-native-screens, no
 * gesture-handler), so pushes are the one navigation model left that still
 * feels native: a page slides in from the right and slides back out on pop.
 * Settings itself uses a SwiftUI `NavigationStack`, so this stack is only ever
 * one level deep.
 */
export function usePageStack(initial: RouteName) {
  const [routes, setRoutes] = useState<Route[]>([
    { key: keyCounter++, name: initial },
  ]);
  const [leaving, setLeaving] = useState<Route | null>(null);

  const push = useCallback((name: RouteName) => {
    setRoutes((list) =>
      list[list.length - 1]?.name === name
        ? list
        : [...list, { key: keyCounter++, name }],
    );
  }, []);

  const pop = useCallback(() => {
    setRoutes((list) => {
      if (list.length <= 1) {
        return list;
      }
      setLeaving(list[list.length - 1]);
      return list.slice(0, -1);
    });
  }, []);

  const reset = useCallback((name: RouteName) => {
    setLeaving(null);
    setRoutes([{ key: keyCounter++, name }]);
  }, []);

  const clearLeaving = useCallback(() => setLeaving(null), []);

  return { routes, leaving, clearLeaving, push, pop, reset };
}

/** Wraps a freshly pushed page: it slides in from the right. */
function EnteringPage({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    Animated.timing(x, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [x]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** The page being popped: slides back to the right, then unmounts. */
function LeavingPage({
  children,
  onDone,
}: {
  children: React.ReactNode;
  onDone: () => void;
}) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(x, {
      toValue: width,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDone();
      }
    });
  }, [onDone, width, x]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The stack container: every route is a full-screen absolutely positioned page.
 *
 * `render` is called on every host render. The screens it returns are memoized
 * components, so a streamed token re-renders the chat page only and leaves the
 * hidden settings `Host` tree untouched.
 */
export function StackView({
  routes,
  leaving,
  onLeavingDone,
  render,
}: {
  routes: Route[];
  leaving: Route | null;
  onLeavingDone: () => void;
  render: (route: Route) => React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {routes.map((route, index) => {
        const content = render(route);
        if (index === 0) {
          return (
            <View key={route.key} style={styles.page}>
              {content}
            </View>
          );
        }
        const pageStyle: ViewStyle = { backgroundColor: colors.background };
        return (
          <EnteringPage key={route.key}>
            <View style={[styles.page, pageStyle]}>{content}</View>
          </EnteringPage>
        );
      })}

      {leaving === null ? null : (
        <LeavingPage key={leaving.key} onDone={onLeavingDone}>
          <View style={[styles.page, { backgroundColor: colors.background }]}>
            {render(leaving)}
          </View>
        </LeavingPage>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
});