import { useCallback, useMemo, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import {
  Host,
  NavigationStack,
  Rectangle,
  RNHostView,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  background,
  foregroundStyle,
  ignoreSafeArea,
} from "@expo/ui/swift-ui/modifiers";

import type { Provider } from "./domain/types.ts";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { SettingsPages } from "./screens/SettingsScreen.tsx";
import { AgentPickerSheet } from "./shell/AgentPickerSheet.tsx";
import { AgentSheet } from "./shell/AgentSheet.tsx";
import { ProviderSheet } from "./shell/ProviderSheet.tsx";
import { SessionListSheet, type SessionRow } from "./shell/SessionListSheet.tsx";
import { useChat } from "./state/useChat.ts";
import { ThemeProvider, useTheme } from "./theme/index.tsx";

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

/**
 * Composition root: wires the chat store to navigation and to the two drawers
 * that edit records (model services, agents). It holds no chat state of its own
 * — everything comes from `useChat`, whose actions are stable.
 *
 * Navigation is one native `NavigationStack` whose root is the chat
 * (`docs/ui-spec.md` §13): the depth alone decides what a left-edge swipe does,
 * because Swipt hands the swipe to the plugin only while the tree holds a
 * navigation bar backed by more than one controller
 * (`Swipt/Automation/SwipletPresentation.swift:70`). With the chat as the root,
 * the chat sits at depth 1 (the host dismisses the plugin) and settings at
 * depth 2 (the system interactively pops back to the chat).
 */
function Shell() {
  const { colors } = useTheme();
  const { state, messages, streaming, modelLabel, actions } = useChat();

  // The settings navigation path: `[]` is the chat, `["settings"]` the settings
  // list, and one more entry for each capability page below it.
  const [path, setPath] = useState<string[]>([]);

  // `providerForm` is what the sheet is editing; `providerOpen` is whether it is
  // on screen. They are separate on purpose: clearing the record on close would
  // re-key the form to "new" and blank every field while the sheet is still
  // sliding away.
  const [providerForm, setProviderForm] = useState<{ provider: Provider | null } | null>(
    null,
  );
  const [providerOpen, setProviderOpen] = useState(false);
  const [agentForm, setAgentForm] = useState(false);
  const [agentPicker, setAgentPicker] = useState(false);

  const openSessions = useCallback(() => {
    Keyboard.dismiss();
    actions.setSheetOpen(true);
  }, [actions]);
  const closeSessions = useCallback(() => actions.setSheetOpen(false), [actions]);
  // Navigating away while the composer is focused used to leave the keyboard up
  // over a chat whose input had already slid back down (v24 first report). The
  // keyboard belongs to a field on the page we are leaving, so drop it here
  // rather than letting the next page inherit it.
  const openSettings = useCallback(() => {
    Keyboard.dismiss();
    setPath(["settings"]);
  }, []);
  const openAgents = useCallback(() => {
    Keyboard.dismiss();
    setAgentPicker(true);
  }, []);
  const closeAgents = useCallback(() => setAgentPicker(false), []);
  const pickAgent = useCallback(
    (id: string) => {
      actions.selectAgent(id);
      setAgentPicker(false);
    },
    [actions],
  );
  const newChat = useCallback(() => {
    actions.newChat();
    setPath([]);
  }, [actions]);

  const addProvider = useCallback(() => {
    setProviderForm({ provider: null });
    setProviderOpen(true);
  }, []);
  const editProvider = useCallback((provider: Provider) => {
    setProviderForm({ provider });
    setProviderOpen(true);
  }, []);
  const closeProviderForm = useCallback(() => setProviderOpen(false), []);
  const saveProvider = useCallback(
    (next: Provider) => {
      actions.saveProvider(next);
      setProviderOpen(false);
    },
    [actions],
  );

  const addAgent = useCallback(() => setAgentForm(true), []);
  const closeAgentForm = useCallback(() => setAgentForm(false), []);
  const saveAgent = useCallback(
    (title: string) => {
      actions.addAgent(title);
      setAgentForm(false);
    },
    [actions],
  );

  // Only built while the sheet is actually open: the sheet is a native
  // `BottomSheet` mounted through a host, and rebuilding it per token would
  // cancel the drag it is in the middle of.
  const sessionRows = useMemo<SessionRow[]>(
    () =>
      state.conversations.map((item) => ({
        id: item.id,
        title: item.title,
        messageCount: item.messages.length,
        updatedAt: item.updatedAt,
      })),
    [state.conversations],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* The host fills the window, so painting it too keeps the status-bar and
          home-indicator strips the same colour as the chat. */}
      <Host style={styles.host} modifiers={[background(colors.background)]}>
        <NavigationStack
          path={path}
          onPathChange={setPath}
          modifiers={[background(colors.background)]}
        >
          {/* Root page. The chat stays React Native; everything the stack draws
              around it (bars, the interactive pop, the tint) is native. */}
          {/* SwiftUI owns the keyboard: it shrinks this hosted view when the
              keyboard appears, so the chat lays out against the new bottom edge
              and its composer ends up on the keyboard. The chat does no keyboard
              math of its own (v23 — the two together threw the input to the
              top). */}
          {/* A page-sized stack whose first layer is a theme-coloured rectangle
              that bleeds into the safe areas. React Native never owns those two
              strips, and until v25 nothing painted them with our own colour, so
              they showed the system background and read as a different shade
              from the transcript. */}
          <ZStack>
            <Rectangle
              modifiers={[
                foregroundStyle(colors.background),
                ignoreSafeArea({ regions: "container" }),
              ]}
            />
            <RNHostView>
              <ChatScreen
              agentId={state.agentId}
              agents={state.agents}
              modelLabel={modelLabel}
              messages={messages}
              draft={state.draft}
              onChangeDraft={actions.setDraft}
              streaming={streaming}
              onSend={actions.send}
              onStop={actions.stop}
              onOpenAgents={openAgents}
              onNewChat={newChat}
              onOpenSessions={openSessions}
              onOpenSettings={openSettings}
              onOpenModelSettings={openSettings}
            />
            </RNHostView>
          </ZStack>

          <SettingsPages
            providers={state.providers}
            agents={state.agents}
            providerId={state.providerId}
            agentId={state.agentId}
            sessionCount={state.conversations.length}
            onAddProvider={addProvider}
            onEditProvider={editProvider}
            onDeleteProvider={actions.removeProvider}
            onSelectProvider={actions.selectProvider}
            onAddAgent={addAgent}
            onDeleteAgent={actions.removeAgent}
            onSelectAgent={actions.selectAgent}
          />
        </NavigationStack>
      </Host>

      {/* The drawers present themselves, so they stay outside the navigation
          stack: a sheet on top of the chat is not a page. They are mounted
          unconditionally and decide that themselves — a sheet has to stay
          mounted while it slides away, which is why closing used to look like it
          vanished (`useSheetLifecycle`). */}
      <SessionListSheet
        visible={state.sheetOpen}
        sessions={sessionRows}
        currentId={state.currentId}
        onClose={closeSessions}
        onOpen={actions.openSession}
        onRename={actions.renameSession}
        onDelete={actions.deleteSession}
      />

      <ProviderSheet
        visible={providerOpen}
        provider={providerForm?.provider ?? null}
        models={
          providerForm?.provider == null
            ? []
            : (state.models[providerForm.provider.id] ?? [])
        }
        onClose={closeProviderForm}
        onSave={saveProvider}
        onFetchModels={actions.fetchModels}
      />

      <AgentSheet
        visible={agentForm}
        onClose={closeAgentForm}
        onSave={saveAgent}
      />

      <AgentPickerSheet
        visible={agentPicker}
        agents={state.agents}
        currentId={state.agentId}
        onClose={closeAgents}
        onSelect={pickAgent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  host: { flex: 1 },
});