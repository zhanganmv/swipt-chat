import type { ReactNode } from "react";
import { View } from "react-native";
import { HStack, Host, Spacer, Text } from "@expo/ui/swift-ui";
import {
  background,
  controlSize,
  font,
  padding,
} from "@expo/ui/swift-ui/modifiers";

/**
 * The glass strip every screen's top bar is made of.
 *
 * One component for both the chat header and the settings header, so the two
 * cannot drift apart: same 48pt height, same 12pt side padding, same 10pt gap,
 * same `controlSize("large")` for the glass buttons, and the same `center`
 * alignment. The caller only supplies the SwiftUI items, and every one of them
 * pins its own size on its label (see `GlassControls`), so a 40pt circle and a
 * 40pt capsule share one centre line.
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
  return (
    <View style={{ height: 48 }}>
      <Host style={{ flex: 1 }} matchContents={{ vertical: true }}>
        <HStack
          spacing={10}
          alignment="center"
          modifiers={[
            padding({ horizontal: 12, vertical: 4 }),
            controlSize("large"),
            // The bar floats over the transcript now, so it needs the system's
            // own blur rather than an opaque fill: coloured content scrolling
            // underneath stays visible as a soft tint.
            background({ type: "material", material: "regular" }),
          ]}
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
