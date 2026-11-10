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

import { useTheme } from "../theme/index.tsx";

/**
 * The controls the glass toolbar is built from.
 *
 * Two rules, both learned the hard way:
 *
 * Sizing — the *label* carries the frame, the `contentShape` and the glass.
 * SwiftUI puts the tap gesture on the label view, so a frame and content shape
 * applied outside it only enlarged what was drawn while the only tappable part
 * stayed the 17pt glyph ("轻点没反应、要长按", v17). Keeping the glass on the
 * label also means every control's drawn bounds *are* its layout bounds, so a
 * 40pt circle and a 40pt capsule line up on the same centre line (v18: the chip
 * was aligned by the Menu, whose own metrics differ from a Button's).
 *
 * Glass — `interactive: true` is what gives a control the liquid press effect,
 * and it must sit on the label for the same reason as the frame: on the label it
 * merges with the button's own gesture, while on the button it installed a
 * second one and delayed the action (v14). v20 turned it back on after the
 * sizing fix moved the glass inward — the user asked for the press animation.
 */
export const GLASS_CONTROL_SIZE = 40;
/** Copy the chat toolbar's glyph size so a nav-bar arrow matches it exactly. */
export const GLASS_ICON_SIZE = 17;
/** Wide enough for a readable name, narrow enough to leave room for the icons. */
export const AGENT_CHIP_MAX_WIDTH = 150;

const glassCircle = glassEffect({
  glass: { variant: "regular", interactive: true },
  shape: "circle",
});
const glassCapsule = glassEffect({
  glass: { variant: "regular", interactive: true },
  shape: "capsule",
});

export function GlassButton({
  systemImage,
  label,
  onPress,
  disabled: isDisabled,
  tint,
  plain = false,
  compact = false,
}: {
  systemImage: SFSymbol;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  /** Draw no glass: use inside `GlassButtonGroup`, which owns the capsule. */
  plain?: boolean;
  /** 36×40 instead of 40×40, for two icons side by side in one capsule. */
  compact?: boolean;
}) {
  const width = compact ? 36 : GLASS_CONTROL_SIZE;
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        disabled(isDisabled ?? false),
        accessibilityLabel(label),
      ]}
    >
      <Image
        systemName={systemImage}
        size={GLASS_ICON_SIZE}
        color={tint}
        modifiers={[
          frame({ width, height: GLASS_CONTROL_SIZE }),
          contentShape(shapes.circle()),
          ...(plain ? [] : [glassCircle]),
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
  plain = false,
  compact = false,
}: {
  systemImage: SFSymbol;
  label: string;
  children: ReactNode;
  plain?: boolean;
  compact?: boolean;
}) {
  const width = compact ? 36 : GLASS_CONTROL_SIZE;
  return (
    <Menu
      label={
        <Image
          systemName={systemImage}
          size={GLASS_ICON_SIZE}
          modifiers={[
            frame({ width, height: GLASS_CONTROL_SIZE }),
            contentShape(shapes.circle()),
            ...(plain ? [] : [glassCircle]),
          ]}
        />
      }
      modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}
    >
      {children}
    </Menu>
  );
}

/**
 * Two icons share one capsule ("新建会话和更多应放在一个按钮组").
 *
 * The capsule is drawn by this `HStack`, which is not a button, so it installs
 * no gesture; each child keeps its own 36×40 hit area.
 */
export function GlassButtonGroup({ children }: { children: ReactNode }) {
  return (
    <HStack
      spacing={2}
      alignment="center"
      modifiers={[
        padding({ horizontal: 4 }),
        frame({ height: GLASS_CONTROL_SIZE }),
        contentShape(shapes.capsule()),
        glassCapsule,
      ]}
    >
      {children}
    </HStack>
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
  const { colors } = useTheme();
  return (
    <Menu
      label={
        <HStack
          spacing={6}
          alignment="center"
          modifiers={[
            padding({ horizontal: 12 }),
            frame({ height: GLASS_CONTROL_SIZE }),
            contentShape(shapes.capsule()),
            glassCapsule,
          ]}
        >
          <Image
            systemName={systemImage}
            size={13}
            color={colors["muted-foreground"]}
            modifiers={[frame({ width: 20, height: 20 })]}
          />
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
      modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}
    >
      {children}
    </Menu>
  );
}

/**
 * A navigation-bar back button: same glyph size as the chat toolbar, no glass
 * of its own — the navigation bar already provides the liquid-glass layer, and
 * stacking a second one is what made the settings back button look doubled (v13).
 * Text was dropped in v18 ("去掉设置返回按钮的文字"): an arrow carries the meaning.
 */
export function NavBackButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}
    >
      <Image
        systemName="chevron.left"
        size={GLASS_ICON_SIZE}
        modifiers={[
          frame({ width: 36, height: 36 }),
          contentShape(shapes.circle()),
        ]}
      />
    </Button>
  );
}