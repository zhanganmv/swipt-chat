import { memo } from "react";
import type { SFSymbol } from "sf-symbols-typescript";
import { View } from "react-native";
import { Button, HStack, Host, Image, Spacer, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  padding,
  shapes,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

/**
 * The composer's bottom row, drawn by SwiftUI.
 *
 * Why native: the glyphs here used to be View-drawn line shapes (`src/ui/Icon.tsx`)
 * because P0 assumed SF Symbols needed a `Host` per glyph. v8 proved that wrong —
 * the glass toolbar renders `Image(systemName:)` from inside a `Host` fine — so
 * the whole row moved into one `Host`: real SF Symbols, native hit testing, and
 * the same press feel as the top bar.
 *
 * Two rules inherited from the toolbar fix (see `docs/ui-spec.md` §4):
 * - `buttonStyle("plain")` + an explicit frame + `contentShape`, because a plain
 *   button otherwise only hit-tests its glyph, not the painted circle.
 * - glass is *not* interactive: interactive glass installs its own press gesture
 *   that fought the button's, which is what made taps feel like long presses.
 *
 * The component is memoized on value props only. `ChatScreen` re-renders on every
 * keystroke and every streamed token; without memo the `Host` tree would rebuild
 * mid-tap and cancel the press.
 */
const ACTION = 32;
const PILL_HEIGHT = 24;
const PILL_MAX_WIDTH = 160;

/**
 * SwiftUI's colour parser takes hex, while several tokens are written as
 * `rgba(...)` for React Native. Composite one over a hex base so the native
 * painter gets a solid colour instead of silently falling back.
 */
function solidOver(color: string, base: string): string {
  const match = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (match === null) {
    return color;
  }
  const parts = match[1].split(",").map((part) => part.trim());
  const alpha = parts.length > 3 ? Number(parts[3]) : 1;
  const channel = (index: number): number => {
    const value = Number(parts[index]);
    const under = parseInt(base.slice(1 + index * 2, 3 + index * 2), 16);
    return Math.round(value * alpha + under * (1 - alpha));
  };
  return `#${[0, 1, 2]
    .map((index) => channel(index).toString(16).padStart(2, "0"))
    .join("")}`;
}

function CircleButton({
  systemImage,
  label,
  onPress,
  fill,
  tint,
  glyphSize,
  isDisabled,
}: {
  systemImage: SFSymbol;
  label: string;
  onPress: () => void;
  fill: string;
  tint: string;
  glyphSize: number;
  isDisabled?: boolean;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        disabled(isDisabled ?? false),
        accessibilityLabel(label),
      ]}
    >
      {/* Size, hit area and fill live on the label: SwiftUI hit-tests the label,
          so a frame applied to the Button only enlarged the painted circle and
          left the 17pt glyph as the only tappable spot. */}
      <Image
        systemName={systemImage}
        size={glyphSize}
        color={tint}
        modifiers={[
          frame({ width: ACTION, height: ACTION }),
          contentShape(shapes.circle()),
          background(fill, shapes.circle()),
        ]}
      />
    </Button>
  );
}

export const ComposerToolbar = memo(function ComposerToolbar({
  modelLabel,
  streaming,
  canSend,
  onAttach,
  onOpenModelSettings,
  onStop,
  onSend,
}: {
  modelLabel: string;
  streaming: boolean;
  canSend: boolean;
  onAttach: () => void;
  onOpenModelSettings: () => void;
  onStop: () => void;
  onSend: () => void;
}) {
  const { colors } = useTheme();
  const chip = solidOver(colors.secondary, colors.card);
  const onCard = colors.card;
  const muted = colors["muted-foreground"];

  return (
    <View style={{ height: ACTION, marginTop: 12 }}>
      <Host style={{ flex: 1 }}>
        <HStack spacing={8}>
          <CircleButton
            systemImage="plus"
            label="附件"
            onPress={onAttach}
            fill={chip}
            tint={muted}
            glyphSize={18}
          />

          <Button
            onPress={onOpenModelSettings}
            modifiers={[
              buttonStyle("plain"),
              accessibilityLabel(`模型：${modelLabel}`),
            ]}
          >
            <HStack
              spacing={6}
              modifiers={[
                padding({ horizontal: 10 }),
                frame({ height: PILL_HEIGHT }),
                contentShape(shapes.capsule()),
                background(chip, shapes.capsule()),
              ]}
            >
              <Text
                modifiers={[
                  font({ size: 13 }),
                  foregroundStyle(muted),
                  lineLimit(1),
                  truncationMode("tail"),
                  frame({ maxWidth: PILL_MAX_WIDTH }),
                ]}
              >
                {modelLabel}
              </Text>
              <Image systemName="chevron.down" size={11} color={muted} />
            </HStack>
          </Button>

          <Spacer />

          {streaming ? (
            <CircleButton
              systemImage="stop.fill"
              label="停止生成"
              onPress={onStop}
              fill={colors.foreground}
              tint={onCard}
              glyphSize={13}
            />
          ) : (
            <CircleButton
              systemImage="arrow.up"
              label="发送"
              onPress={onSend}
              fill={canSend ? colors.primary : chip}
              tint={canSend ? colors["primary-foreground"] : muted}
              glyphSize={17}
              isDisabled={!canSend}
            />
          )}
        </HStack>
      </Host>
    </View>
  );
});

/**
 * "Jump to latest" bubble that floats over the transcript. Same native recipe so
 * the chevron is a real symbol rather than a pair of drawn bars.
 */
export function JumpToBottom({
  bottom,
  hidden = false,
  onPress,
}: {
  /** Distance from the bottom edge of the transcript area. */
  bottom: number;
  /** Fade out instead of unmounting: see the note in `ChatScreen`. */
  hidden?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        position: "absolute",
        alignSelf: "center",
        bottom,
        width: 36,
        height: 36,
        opacity: hidden ? 0 : 1,
      }}
    >
      <Host style={{ flex: 1 }}>
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle("plain"),
            glassEffect({ glass: { variant: "regular" }, shape: "circle" }),
            accessibilityLabel("回到底部"),
          ]}
        >
          <Image
            systemName="chevron.down"
            size={15}
            color={colors.foreground}
            modifiers={[
              frame({ width: 36, height: 36 }),
              contentShape(shapes.circle()),
            ]}
          />
        </Button>
      </Host>
    </View>
  );
}
