import type { ReactNode } from "react";
import type { SFSymbol } from "sf-symbols-typescript";
import { Button, HStack, Image, Menu, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  font,
  frame,
  glassEffect,
  lineLimit,
  padding,
  shapes,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";

/**
 * The controls the glass toolbar is built from.
 *
 * Sizing rule: the *label* carries the 40×40 frame and the `contentShape`, not
 * the outer `Button`/`Menu`. SwiftUI puts the tap gesture on the label view, so
 * a frame and content shape applied outside it only enlarged what was drawn —
 * the only tappable part stayed the 17pt glyph in the middle. That is exactly
 * the "轻点没反应、要长按" report (v17).
 *
 * Glass rule: `interactive: true` was removed back in v14 — interactive glass
 * installs its own press gesture on top of the button and delays the action.
 * The plain visual variant has no gesture, so the button keeps a normal tap.
 */
export const GLASS_CONTROL_SIZE = 40;
/** Wide enough for a readable name, narrow enough to leave room for the icons. */
export const AGENT_CHIP_MAX_WIDTH = 150;

type GlassShapeProps = {
  disabled?: boolean;
};

export function GlassButton({
  systemImage,
  label,
  onPress,
  disabled: isDisabled,
  tint,
}: GlassShapeProps & {
  systemImage: SFSymbol;
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        glassEffect({ glass: { variant: "regular" }, shape: "circle" }),
        disabled(isDisabled ?? false),
        accessibilityLabel(label),
      ]}
    >
      <Image
        systemName={systemImage}
        size={17}
        color={tint}
        modifiers={[
          frame({ width: GLASS_CONTROL_SIZE, height: GLASS_CONTROL_SIZE }),
          contentShape(shapes.circle()),
        ]}
      />
    </Button>
  );
}

/** An icon-only glass menu (更多): tapping the whole circle opens it. */
export function GlassMenu({
  systemImage,
  label,
  children,
}: GlassShapeProps & {
  systemImage: SFSymbol;
  label: string;
  children: ReactNode;
}) {
  return (
    <Menu
      label={
        <Image
          systemName={systemImage}
          size={17}
          modifiers={[
            frame({ width: GLASS_CONTROL_SIZE, height: GLASS_CONTROL_SIZE }),
            contentShape(shapes.circle()),
          ]}
        />
      }
      modifiers={[
        buttonStyle("plain"),
        glassEffect({ glass: { variant: "regular" }, shape: "circle" }),
        accessibilityLabel(label),
      ]}
    >
      {children}
    </Menu>
  );
}

/**
 * A labelled glass capsule (the agent selector).
 *
 * The label is a custom view, which is the only way to get both an icon and a
 * name inside the native menu's glass: `systemImage` + string `label` draws the
 * text flush against the capsule edge and clips a long name mid-glyph. Here the
 * capsule hugs its content (`padding` 12), the name truncates at 150pt, and the
 * whole capsule — not just the text — is the hit area.
 */
export function GlassChipMenu({
  label,
  systemImage,
  children,
  maxWidth = AGENT_CHIP_MAX_WIDTH,
}: {
  label: string;
  systemImage: SFSymbol;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <Menu
      label={
        <HStack
          spacing={6}
          modifiers={[
            padding({ horizontal: 12 }),
            frame({ height: GLASS_CONTROL_SIZE }),
            contentShape(shapes.capsule()),
          ]}
        >
          <Image systemName={systemImage} size={15} />
          <Text
            modifiers={[
              font({ size: 15 }),
              lineLimit(1),
              truncationMode("tail"),
              frame({ maxWidth }),
            ]}
          >
            {label}
          </Text>
        </HStack>
      }
      modifiers={[
        buttonStyle("plain"),
        glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        accessibilityLabel(label),
      ]}
    >
      {children}
    </Menu>
  );
}