import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import {
  BottomSheet,
  Button,
  ContextMenu,
  HStack,
  Host,
  List,
  NavigationStack,
  Rectangle,
  Section,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { useNativeState } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationCornerRadius,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  searchable,
  shapes,
} from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

export type SessionRow = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: number;
};

/**
 * Session list as a real iOS sheet.
 *
 * v13 hand-built the panel in React Native (translateY + PanResponder) because a
 * SwiftUI `BottomSheet` only presents from a permanently mounted `Host`. That
 * hand-built panel is what read as "质感不对": it had no system material, and
 * its drag handle sat on top of the native navigation bar, which swallowed the
 * gesture — so it could not be swiped down.
 *
 * v14 mounts a 1×1 `Host` at the root instead, so the sheet can be presented by
 * the system: real sheet material (a `material` view stays translucent on iOS 26,
 * unlike the `presentationBackground` modifier), system detent, system
 * drag-to-dismiss with velocity, and the usual dimmed backdrop.
 *
 * The list itself still mirrors the official simulate-location plugin's search
 * screen: `NavigationStack` + `List`, title and search field on the navigation
 * bar, rows opening on tap with 重命名 / 删除 behind a long press.
 */
export function SessionListSheet({
  visible,
  sessions,
  currentId,
  onClose,
  onOpen,
  onRename,
  onDelete,
}: {
  visible: boolean;
  sessions: SessionRow[];
  currentId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const { colors } = useTheme();

  // The search field binds to a native observable; `onChange` mirrors what was
  // typed into RN state so the rows we hand to the list can be filtered.
  const query = useNativeState("");
  const [text, setText] = useState("");

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (needle === "") {
      return sessions;
    }
    return sessions.filter((item) => item.title.toLowerCase().includes(needle));
  }, [sessions, text]);

  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <Host style={styles.host}>
        <BottomSheet
          isPresented={visible}
          onIsPresentedChange={(next) => {
            if (!next) {
              onClose();
            }
          }}
          presentationBackground={
            // `thin` instead of `regular`: regular read as an opaque grey panel
            // over a dark chat, which is what "背景是黑灰色的" was describing.
            <Rectangle
              modifiers={[background({ type: "material", material: "thin" })]}
            />
          }
        >
          <NavigationStack
            modifiers={[
              // A half-height detent gives the system's own grabber and
              // drag-to-dismiss; the native sheet only grows a handle when it
              // has detents.
              presentationDetents([{ fraction: 0.72 }, "large"]),
              presentationDragIndicator("visible"),
              presentationCornerRadius(28),
            ]}
          >
            <List
              modifiers={[
                listStyle("plain"),
                scrollContentBackground("hidden"),
                navigationTitle("会话列表"),
                navigationBarTitleDisplayMode("inline"),
                searchable(query, {
                  placement: "navigationBarDrawer",
                  prompt: "搜索会话",
                  onChange: setText,
                }),
              ]}
            >
              <Section>
                {rows.map((session) => (
                  <ContextMenu key={session.id}>
                    <ContextMenu.Trigger>
                      <Button
                        onPress={() => onOpen(session.id)}
                        modifiers={[
                          buttonStyle("plain"),
                          contentShape(shapes.rectangle()),
                        ]}
                      >
                        <HStack spacing={0}>
                          <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}>
                            <Text
                              modifiers={[
                                font({
                                  size: 16,
                                  weight: session.id === currentId ? "semibold" : "regular",
                                }),
                              ]}
                            >
                              {session.title}
                            </Text>
                            <Text
                              modifiers={[
                                font({ size: 13 }),
                                foregroundStyle(colors["muted-foreground"]),
                              ]}
                            >
                              {`${session.messageCount} 条消息`}
                            </Text>
                          </VStack>
                          <Spacer />
                        </HStack>
                      </Button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Items>
                      <Button
                        label="重命名"
                        systemImage="pencil"
                        onPress={() =>
                          Alert.prompt(
                            "重命名会话",
                            "",
                            (value) => {
                              const next = (value ?? "").trim();
                              if (next !== "") {
                                onRename(session.id, next);
                              }
                            },
                            "plain-text",
                            session.title,
                          )
                        }
                      />
                      <Button
                        label="删除"
                        systemImage="trash"
                        role="destructive"
                        onPress={() => onDelete(session.id)}
                      />
                    </ContextMenu.Items>
                  </ContextMenu>
                ))}
              </Section>
            </List>
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