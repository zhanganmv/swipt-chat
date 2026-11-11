import { HStack, Image, Spacer, Text } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
} from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

/**
 * Shared typography for every settings page.
 *
 * Sizes are the iOS ones — 17 for row labels, 15 for the trailing value, 13 for
 * section footers — instead of the per-file 12/15/16 guesses this file replaces
 * (v31). Footer/error colours come from the theme so dark mode keeps contrast.
 */

/** Row label: 17pt, the size a `List` row title is drawn at on iOS. */
export function RowLabel({ title }: { title: string }) {
  return <Text modifiers={[font({ size: 17 })]}>{title}</Text>;
}

/** Secondary text: the trailing value of a row, a helper line, an empty state. */
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

/** Section footer: 13pt secondary, never smaller (iOS floors body text at 13). */
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
  const { colors } = useTheme();
  return (
    <Text
      modifiers={[
        font({ size: 13 }),
        foregroundStyle(tone === "error" ? colors.destructive : colors["muted-foreground"]),
      ]}
    >
      {text}
    </Text>
  );
}

/**
 * A settings icon: 29×29 rounded square filled with the destination's own
 * colour, white glyph on top.
 *
 * This is what makes a `List` read as *the* iOS Settings app — a bare
 * `Label(systemImage:)` draws an untinted line-art glyph, which is the single
 * biggest tell that a screen only borrowed `List` instead of the whole idiom.
 */
export function TintedIcon({
  systemImage,
  tint,
}: {
  systemImage: string;
  tint: string;
}) {
  return (
    <Image
      systemName={systemImage as never}
      size={15}
      color="#ffffff"
      modifiers={[
        frame({ width: 29, height: 29 }),
        background(tint),
        clipShape("roundedRectangle", 7),
      ]}
    />
  );
}

/**
 * One settings row: tinted icon, 17pt title, optional grey trailing value.
 *
 * The chevron comes from `NavigationLink`, so a row without `value` is a plain
 * (read-only) row — that is how `关于` shows a version number.
 */
export function SettingsRow({
  title,
  icon,
  tint,
  trailing,
}: {
  title: string;
  icon?: string;
  tint?: string;
  trailing?: string;
}) {
  const { colors } = useTheme();
  return (
    <HStack spacing={12}>
      {icon === undefined ? null : (
        <TintedIcon systemImage={icon} tint={tint ?? colors.primary} />
      )}
      <RowLabel title={title} />
      <Spacer />
      {trailing === undefined ? null : (
        <Text
          modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}
        >
          {trailing}
        </Text>
      )}
    </HStack>
  );
}

/** System colour for each settings destination (iOS palette, not brand). */
export const SETTINGS_TINT = {
  providers: "#0a84ff",
  agents: "#34c759",
  tools: "#8e8e93",
  mcp: "#ff9500",
  skills: "#af52de",
  diagnostics: "#ff3b30",
} as const;
