import { Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

/** Shared small typography for the settings pages. */
export function Muted({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}
    >
      {text}
    </Text>
  );
}

export function Footer({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      modifiers={[font({ size: 13 }), foregroundStyle(colors["muted-foreground"])]}
    >
      {text}
    </Text>
  );
}

/** An inline validation/error line; red when `tone` is "error". */
export function FieldError({ text, tone = "error" }: { text: string; tone?: "error" | "muted" }) {
  return (
    <Text
      modifiers={[
        font({ size: 13 }),
        foregroundStyle(tone === "error" ? "#ff453a" : "#8a8a8e"),
      ]}
    >
      {text}
    </Text>
  );
}