import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { Host, NavigationStack, RNHostView } from "@expo/ui/swift-ui";
import { background, ignoreSafeArea } from "@expo/ui/swift-ui/modifiers";

import type { Provider } from "./domain/types.ts";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { SettingsPages } from "./screens/SettingsScreen.tsx";
import { AgentPickerSheet } from "./shell/AgentPickerSheet.tsx";
import { AgentSheet } from "./shell/AgentSheet.tsx";
import { ProviderSheet } from "./shell/ProviderSheet.tsx";
import { SessionListSheet, type SessionRow } from "./shell/SessionListSheet.tsx";
import { useChat } from "./state/useChat.ts";
import { ThemeProvider, useTheme } from "./theme/index.tsx";

/**
 * `RNHostView` does not declare `modifiers`, but it forwards them to the native
 * view like any other host component, and the chat needs `ignoreSafeArea`: the
 * transcript must run edge to edge so React Native paints the status-bar and
 * home-indicator strips in the chat's own colour. Only the *container* safe area
 * is ignored — the keyboard safe area stays on, which is what keeps the composer
 * sitting on top of the keyboard (v23).
 */
const HostedChat = RNHostView as unknown as (props: {
  children: ReactElement;
  modifiers?: unknown[];
}) => ReactElement;

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

  // `null` = closed; `provider: null` = adding a new service.
  const [providerForm, setProviderForm] = useState<{ provider: Provider | null } | null>(
    null,
  );
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

  const addProvider = useCallback(() => setProviderForm({ provider: null }), []);
  const editProvider = useCallback(
    (provider: Provider) => setProviderForm({ provider }),
    [],
  );
  const closeProviderForm = useCallback(() => setProviderForm(null), []);
  const saveProvider = useCallback(
    (next: Provider) => {
      actions.saveProvider(next);
      setProviderForm(null);
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
          <HostedChat modifiers={[ignoreSafeArea({ regions: "container" })]}>
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
          </HostedChat>

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
          stack: a sheet on top of the chat is not a page. */}
      {state.sheetOpen ? (
        <SessionListSheet
          visible
          sessions={sessionRows}
          currentId={state.currentId}
          onClose={closeSessions}
          onOpen={actions.openSession}
          onRename={actions.renameSession}
          onDelete={actions.deleteSession}
        />
      ) : null}

      {providerForm !== null ? (
        <ProviderSheet
          visible
          provider={providerForm.provider}
          onClose={closeProviderForm}
          onSave={saveProvider}
        />
      ) : null}

      {agentForm ? (
        <AgentSheet visible onClose={closeAgentForm} onSave={saveAgent} />
      ) : null}

      {agentPicker ? (
        <AgentPickerSheet
          visible
          agents={state.agents}
          currentId={state.agentId}
          onClose={closeAgents}
          onSelect={pickAgent}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  host: { flex: 1 },
});