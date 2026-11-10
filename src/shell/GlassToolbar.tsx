import type { ReactNode } from "react";
import { View } from "react-native";
import { HStack, Host, Spacer, Text } from "@expo/ui/swift-ui";
import { controlSize, font, padding } from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

/**
 * The glass strip every screen's top bar is made of.
 *
 * One component for both the chat header and the settings header, so the two
 * cannot drift apart: same 48pt height, same 12pt side padding, same 10pt gap,
 * same `controlSize("large")` for the glass buttons. The caller only supplies
 * the SwiftUI items — every one of them must be a `Button` (a `Menu` renders
 * at a different height, which is what made 更多 look taller than its
 * neighbours).
 */
export function GlassToolbar({
  leading,
  title,
  trailing,
}: {
  leading: ReactNode[];
  title?: string;
  trailing: ReactNode[];
}) {
  const { colors } = useTheme();

  return (
    <View style={{ height: 48, backgroundColor: colors.background }}>
      <Host style={{ flex: 1 }} matchContents={{ vertical: true }}>
        <HStack
          spacing={10}
          modifiers={[padding({ horizontal: 12, vertical: 4 }), controlSize("large")]}
        >
          {leading}
          {title === undefined ? null : (
            <Text modifiers={[font({ size: 17, weight: "semibold" })]}>{title}</Text>
          )}
          <Spacer />
          {trailing}
        </HStack>
      </Host>
    </View>
  );
}
