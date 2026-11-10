import { useCallback, useMemo, useState } from "react";
import { SafeAreaView, StyleSheet } from "react-native";

import type { Provider } from "./domain/types.ts";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { AgentSheet } from "./shell/AgentSheet.tsx";
import { ProviderSheet } from "./shell/ProviderSheet.tsx";
import { SessionListSheet, type SessionRow } from "./shell/SessionListSheet.tsx";
import { StackView, usePageStack, type Route } from "./shell/PageStack.tsx";
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
 */
function Shell() {
  const { colors } = useTheme();
  const { routes, leaving, clearLeaving, push, pop, reset } = usePageStack("chat");
  const { state, messages, streaming, modelLabel, actions } = useChat();

  // `null` = closed; `provider: null` = adding a new service.
  const [providerForm, setProviderForm] = useState<{ provider: Provider | null } | null>(
    null,
  );
  const [agentForm, setAgentForm] = useState(false);

  const openSessions = useCallback(() => actions.setSheetOpen(true), [actions]);
  const closeSessions = useCallback(() => actions.setSheetOpen(false), [actions]);
  const openSettings = useCallback(() => push("settings"), [push]);
  const newChat = useCallback(() => {
    actions.newChat();
    reset("chat");
  }, [actions, reset]);

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

  const renderRoute = (route: Route) => {
    if (route.name === "chat") {
      return (
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
          onSelectAgent={actions.selectAgent}
          onNewAgent={addAgent}
          onNewChat={newChat}
          onOpenSessions={openSessions}
          onOpenSettings={openSettings}
          onOpenModelSettings={openSettings}
        />
      );
    }
    return (
      <SettingsScreen
        providers={state.providers}
        agents={state.agents}
        providerId={state.providerId}
        agentId={state.agentId}
        sessionCount={state.conversations.length}
        onBack={pop}
        onAddProvider={addProvider}
        onEditProvider={editProvider}
        onDeleteProvider={actions.removeProvider}
        onSelectProvider={actions.selectProvider}
        onAddAgent={addAgent}
        onDeleteAgent={actions.removeAgent}
        onSelectAgent={actions.selectAgent}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StackView
        routes={routes}
        leaving={leaving}
        onLeavingDone={clearLeaving}
        render={renderRoute}
      />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});