import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { Message } from "../domain/types.ts";
import { useTheme } from "../theme/index.tsx";
import { messageMetrics, radius } from "../theme/tokens.ts";
import { ChatHeader } from "../shell/ChatHeader.tsx";
import { ComposerToolbar, JumpToBottom } from "../shell/ComposerToolbar.tsx";
import { useSafeAreaInsets } from "../shell/SafeArea.tsx";

const STICK_THRESHOLD = 80;
/** Height of the floating glass toolbar; the transcript starts below it. */
const HEADER_HEIGHT = 48;

/**
 * The chat screen: Cherry's header, transcript and composer.
 *
 * Measurements come from `ui-spec.md` §4 — 88%/18/16×10 bubbles, a 32-radius
 * composer with 12pt padding and 32pt actions, 12pt list top padding.
 */
export const ChatScreen = memo(function ChatScreen({
  agentId,
  agents,
  modelLabel,
  messages,
  draft,
  onChangeDraft,
  streaming,
  onSend,
  onStop,
  onOpenAgents,
  onNewChat,
  onOpenSessions,
  onOpenSettings,
  onOpenModelSettings,
}: {
  agentId: string;
  agents: { id: string; title: string }[];
  modelLabel: string;
  messages: readonly Message[];
  draft: string;
  onChangeDraft: (next: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onOpenAgents: () => void;
  onNewChat: () => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  onOpenModelSettings: () => void;
}) {
  const { colors, type } = useTheme();
  const list = useRef<FlatList<Message>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [composerHeight, setComposerHeight] = useState(0);
  const [surfaceHeight, setSurfaceHeight] = useState(0);
  const windowHeight = useWindowDimensions().height;
  const { insets, setSurface, overlay, measure } = useSafeAreaInsets();

  // The native stack shrinks this surface when the keyboard opens, so a
  // shorter-than-window surface means the keyboard (which already covers the
  // home indicator) is up; the bottom inset must then be dropped.
  const keyboardUp = surfaceHeight > 0 && surfaceHeight < windowHeight - 40;
  const bottomInset = keyboardUp ? 0 : insets.bottom;
  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() =>
      list.current?.scrollToEnd({ animated }),
    );
  }, []);

  useEffect(() => {
    if (atBottom) {
      scrollToEnd();
    }
  }, [atBottom, messages, scrollToEnd]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distance < STICK_THRESHOLD);
  }, []);

  return (
    <View
      ref={setSurface}
      onLayout={(event) => {
        setSurfaceHeight(event.nativeEvent.layout.height);
        measure();
      }}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <FlatList
        ref={list}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          {
            // The transcript runs the full height of the screen; the toolbar and
            // the composer are painted on top of it, so the scroll area only
            // reserves room for them instead of being boxed in by them.
            paddingTop: insets.top + HEADER_HEIGHT + 8,
            paddingBottom: composerHeight + bottomInset + 12,
          },
          messages.length === 0 ? styles.listContentEmpty : null,
        ]}
          data={messages}
          keyExtractor={(item) => item.id}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          renderItem={({ item }) => <MessageRow message={item} />}
          ListEmptyComponent={
            <EmptyState modelLabel={modelLabel} onPick={onOpenModelSettings} />
          }
      />

      <View
        pointerEvents="box-none"
        style={[styles.headerWrap, { paddingTop: insets.top }]}
      >
        <ChatHeader
          agentId={agentId}
          agents={agents}
          onOpenAgents={onOpenAgents}
          onNewChat={onNewChat}
          onOpenSessions={onOpenSessions}
          onOpenSettings={onOpenSettings}
        />
      </View>

      {atBottom ? null : (
        <JumpToBottom
          bottom={composerHeight + bottomInset + 12}
          onPress={() => scrollToEnd()}
        />
      )}

      <View
        style={[styles.composerWrap, { paddingBottom: bottomInset + 8 }]}
        onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
      >
        <View
          style={[
            styles.composer,
            styles.shadow,
            {
              backgroundColor: colors.card,
              shadowColor: colors.foreground,
            },
          ]}
        >
          <TextInput
            style={[
              type("base"),
              styles.input,
              { color: colors.foreground },
            ]}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="给 Swipt Chat 发消息"
            placeholderTextColor={colors["muted-foreground"]}
            multiline
            scrollEnabled
          />

          <ComposerToolbar
            modelLabel={modelLabel}
            streaming={streaming}
            canSend={draft.trim() !== ""}
            onAttach={onOpenModelSettings}
            onOpenModelSettings={onOpenModelSettings}
            onStop={onStop}
            onSend={onSend}
          />
        </View>
      </View>

      {overlay}
    </View>
  );
});

function MessageRow({ message }: { message: Message }) {
  const { colors, type } = useTheme();

  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View
          style={[
            styles.userBubble,
            { backgroundColor: colors["chat-user"] },
          ]}
        >
          <Text style={[type("base"), { color: colors.foreground }]} selectable>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      {message.content === "" && message.status === "streaming" ? <TypingDots /> : null}
      {message.content === "" ? null : (
        <Text style={[type("base"), { color: colors.foreground }]} selectable>
          {message.content}
        </Text>
      )}
      {message.status === "error" ? (
        <Text style={[type("sm"), { color: colors.error }]} numberOfLines={3}>
          {message.error ?? "生成失败"}
        </Text>
      ) : null}
    </View>
  );
}

function TypingDots() {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 520,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      <ActivityIndicator size="small" color={colors["muted-foreground"]} />
    </Animated.View>
  );
}

function EmptyState({
  modelLabel,
  onPick,
}: {
  modelLabel: string;
  onPick: () => void;
}) {
  const { colors, type } = useTheme();
  const suggestions = [
    { title: "截个图看看", body: "描述当前屏幕，再决定下一步操作" },
    { title: "打开某个 App", body: "让它启动应用并完成一次点击" },
    { title: "写一段脚本", body: "用 JS 直接操作设备能力" },
    { title: "配好模型", body: `当前：${modelLabel}` },
  ];

  return (
    <View style={styles.empty}>
      <Text
        style={[
          type("2xl"),
          { color: colors.foreground, fontWeight: "600", textAlign: "center" },
        ]}
      >
        Swipt Chat
      </Text>
      <Text
        style={[
          type("sm"),
          { color: colors["muted-foreground"], textAlign: "center", marginTop: 8 },
        ]}
      >
        一个跑在 Swipt 里的 agent。它能看到屏幕、点按钮，也能调用你接上的 MCP 工具。
      </Text>

      <View style={styles.suggestions}>
        {suggestions.map((item) => (
          <Pressable
            key={item.title}
            onPress={onPick}
            style={({ pressed }) => [
              styles.suggestion,
              { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text
              style={[
                { fontSize: 16, fontWeight: "500", color: colors.foreground },
              ]}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                type("sm"),
                { color: colors["muted-foreground"], marginTop: 4 },
              ]}
            >
              {item.body}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerWrap: { position: "absolute", left: 0, right: 0, top: 0 },
  list: { flex: 1 },
  listContent: {
    paddingTop: messageMetrics.listTopPadding,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  listContentEmpty: { flexGrow: 1, justifyContent: "center" },
  userRow: { alignItems: "flex-end" },
  userBubble: {
    maxWidth: messageMetrics.userBubbleMaxWidth,
    paddingHorizontal: messageMetrics.userBubblePaddingX,
    paddingVertical: messageMetrics.userBubblePaddingY,
    borderRadius: radius.bubble,
  },
  assistantRow: { width: "100%", gap: 8 },
  composerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
  },
  composer: {
    borderRadius: 32,
    padding: 12,
  },
  shadow: {
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  input: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingVertical: 4,
    maxHeight: 132,
    minHeight: 28,
  },
  empty: { paddingHorizontal: 8, paddingBottom: 40 },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 24,
  },
  suggestion: {
    width: "48%",
    flexGrow: 1,
    borderRadius: radius["2xl"],
    padding: 16,
  },
});