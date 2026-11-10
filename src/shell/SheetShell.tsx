import type { ReactNode } from "react";
import { View } from "react-native";
import { BottomSheet, Host, NavigationStack } from "@expo/ui/swift-ui";
import {
  presentationCornerRadius,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";

import { useSheetLifecycle } from "./useSheetLifecycle.ts";

/**
 * The one way this app presents a sheet.
 *
 * A SwiftUI `BottomSheet` can only be presented from a `Host` that is already
 * mounted, so the anchor is a 1×1 host pinned to the corner — it occupies no
 * layout and swallows no touches (`pointerEvents="box-none"`).
 *
 * Detents are what give the sheet a grabber and drag-to-dismiss; without them
 * the native sheet is full-height and has no handle at all.
 */
export function SheetShell({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { mounted, finish } = useSheetLifecycle(visible);

  if (!mounted) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <Host style={styles.host}>
        <BottomSheet
          isPresented={visible}
          onIsPresentedChange={(next) => {
            if (!next) {
              finish();
              onClose();
            }
          }}
        >
          <NavigationStack
            modifiers={[
              presentationDetents([{ fraction: 0.62 }, "large"]),
              presentationDragIndicator("visible"),
              presentationCornerRadius(28),
            ]}
          >
            {children}
          </NavigationStack>
        </BottomSheet>
      </Host>
    </View>
  );
}

const styles = {
  anchor: {
    position: "absolute" as const,
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
  },
  host: { width: 1, height: 1 },
};