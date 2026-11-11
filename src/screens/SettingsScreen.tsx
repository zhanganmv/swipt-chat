import { memo } from "react";
import { Alert } from "react-native";
import {
  Button,
  HStack,
  Image,
  List,
  NavigationDestination,
  NavigationLink,
  Section,
  Spacer,
  SwipeActions,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  bold,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  shapes,
} from "@expo/ui/swift-ui/modifiers";

import {
  newModel,
  type ModelProvider,
  type ModelProviderTemplate,
  type ProviderModel,
} from "../domain/provider.ts";
import type { Agent } from "../domain/types.ts";
import type { ChatActions } from "../state/useChat.ts";
import { useTheme } from "../theme/index.tsx";
import {
  AGENTS_ROUTE,
  DIAGNOSTICS_ROUTE,
  MCP_ROUTE,
  PROVIDERS_ROUTE,
  SETTINGS_ROUTE,
  SKILLS_ROUTE,
  TOOLS_ROUTE,
  providerModelRoute,
  providerRoute,
} from "../routes.ts";
import { ProviderPage } from "./ProviderPage.tsx";
import { ModelPage } from "./ModelPage.tsx";
import { DiagnosticsPage } from "./DiagnosticsPage.tsx";
import { ProviderListPage } from "./ProviderListPage.tsx";
import { Footer, SETTINGS_TINT, SettingsRow } from "./parts.tsx";

/**
 * Settings, all native — the settings half of the app's single `NavigationStack`.
 *
 * These are `NavigationDestination`s, not a stack of their own: the shell owns
 * one `NavigationStack` whose root is the chat (`App.tsx`), so pushing settings
 * gives the host's swipe-to-dismiss rule the depth it looks for and the system
 * interactive pop returns to the chat (`docs/ui-spec.md` §12).
 *
 * iOS-Settings shape (v31): the root is a *large-title* `insetGrouped` list of
 * tinted rows grouped by intent (对话 / 能力 / 诊断与支持 / 关于), and every
 * capability page is one `List` + a `+` in the navigation bar. Nothing is
 * deletable by long-press — the OS reserves that gesture for previews, so
 * deletion lives in the row's own detail page (`docs/ui-spec.md` §设置).
 *
 * Memoized: a streamed chat token must not rebuild this `Host` tree while the
 * page is hidden behind the chat.
 */
export const SettingsPages = memo(function SettingsPages({
  templates,
  providers,
  models,
  agents,
  agentId,
  version,
  actions,
  onCreateProvider,
  onDeleteProvider,
  onAddAgent,
  onDeleteAgent,
  onSelectAgent,
  onSelfTest,
}: {
  templates: readonly ModelProviderTemplate[];
  providers: readonly ModelProvider[];
  models: Record<string, ProviderModel[]>;
  agents: readonly Agent[];
  agentId: string | null;
  version: string;
  actions: ChatActions;
  onCreateProvider: (templateId: string) => void;
  onDeleteProvider: (provider: ModelProvider) => void;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onSelfTest: () => Promise<string>;
}) {
  return (
    <>
      <NavigationDestination value={SETTINGS_ROUTE}>
        <List
          modifiers={[
            listStyle("insetGrouped"),
            navigationTitle("设置"),
            // The root of a settings stack is a large title on iOS; only the
            // pages below it use the inline bar.
            navigationBarTitleDisplayMode("inline"),
          ]}
        >
          <Section title="对话">
            <NavigationLink value={PROVIDERS_ROUTE}>
              <SettingsRow
                title="模型服务"
                icon="server.rack"
                tint={SETTINGS_TINT.providers}
                trailing={providers.length > 0 ? `${providers.length}` : undefined}
              />
            </NavigationLink>
            <NavigationLink value={AGENTS_ROUTE}>
              <SettingsRow
                title="智能体"
                icon="person.crop.circle"
                tint={SETTINGS_TINT.agents}
                trailing={agents.length > 0 ? `${agents.length}` : undefined}
              />
            </NavigationLink>
          </Section>

          <Section title="能力">
            <NavigationLink value={TOOLS_ROUTE}>
              <SettingsRow title="工具" icon="wrench.and.screwdriver" tint={SETTINGS_TINT.tools} />
            </NavigationLink>
            <NavigationLink value={MCP_ROUTE}>
              <SettingsRow title="MCP 服务" icon="shippingbox" tint={SETTINGS_TINT.mcp} />
            </NavigationLink>
            <NavigationLink value={SKILLS_ROUTE}>
              <SettingsRow title="技能" icon="sparkles" tint={SETTINGS_TINT.skills} />
            </NavigationLink>
          </Section>

          <Section title="诊断与支持">
            <NavigationLink value={DIAGNOSTICS_ROUTE}>
              <SettingsRow
                title="诊断日志"
                icon="doc.text.magnifyingglass"
                tint={SETTINGS_TINT.diagnostics}
              />
            </NavigationLink>
          </Section>

          {/* Read-only row: no `NavigationLink`, so no chevron — the version is
              information, not a destination. */}
          <Section title="关于">
            <SettingsRow title="版本" trailing={version} />
          </Section>
        </List>
      </NavigationDestination>

      <NavigationDestination value={PROVIDERS_ROUTE}>
        <ProviderListPage
          templates={templates}
          providers={providers}
          models={models}
          onCreate={onCreateProvider}
          onDelete={onDeleteProvider}
        />
      </NavigationDestination>

      {providers.map((provider) => (
        <NavigationDestination key={provider.id} value={providerRoute(provider.id)}>
          <ProviderPage
            templates={templates}
            provider={provider}
            models={models[provider.id] ?? []}
            onUpdate={actions.updateProvider}
            onDelete={onDeleteProvider}
            onFetchModels={actions.fetchModels}
            onAddModels={(providerId, ids) => {
              for (const id of ids) {
                actions.addModel(providerId, newModel(id));
              }
            }}
            onAddModel={actions.addModel}
            onDeleteModel={actions.removeModel}
          />
        </NavigationDestination>
      ))}

      {providers.flatMap((provider) =>
        (models[provider.id] ?? []).map((model) => (
          <NavigationDestination
            key={`${provider.id}/${model.id}`}
            value={providerModelRoute(provider.id, model.id)}
          >
            <ModelPage
              provider={provider}
              model={model}
              onChange={(next) => actions.updateModel(provider.id, next)}
            />
          </NavigationDestination>
        )),
      )}

      <NavigationDestination value={AGENTS_ROUTE}>
        <AgentsPage
          agents={agents}
          agentId={agentId}
          onAdd={onAddAgent}
          onDelete={onDeleteAgent}
          onSelect={onSelectAgent}
        />
      </NavigationDestination>

      <NavigationDestination value={TOOLS_ROUTE}>
        <Placeholder
          title="工具"
          note="内置工具走 Swipt 的设备能力（截图、点击、前台应用），随 P3 批次接入"
          batch="P3"
        />
      </NavigationDestination>

      <NavigationDestination value={MCP_ROUTE}>
        <Placeholder
          title="MCP 服务"
          note="MCP 客户端按 JSON-RPC 手写实现，一期不做 OAuth，随 P4 批次接入"
          batch="P4"
        />
      </NavigationDestination>

      <NavigationDestination value={SKILLS_ROUTE}>
        <Placeholder
          title="技能"
          note="技能是带 SKILL.md 的目录，支持 URL 导入与粘贴导入，随 P5 批次接入"
          batch="P5"
        />
      </NavigationDestination>

      <NavigationDestination value={DIAGNOSTICS_ROUTE}>
        <DiagnosticsPage onSelfTest={onSelfTest} />
      </NavigationDestination>
    </>
  );
});

/**
 * 智能体: tap a row to make it current, `+` to create, swipe left to delete.
 *
 * Long-press used to be the only way to delete an agent. iOS reserves that
 * gesture for context menus / previews, so a row whose *primary* destructive
 * action is invisible until you hold it reads as broken — it is a swipe action
 * now, which is both discoverable and reversible-looking (`listRowInsets`
 * keeps the row a plain row instead of a button that happens to be full-width).
 */
function AgentsPage({
  agents,
  agentId,
  onAdd,
  onDelete,
  onSelect,
}: {
  agents: readonly Agent[];
  agentId: string | null;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();

  const confirmDelete = (agent: Agent) => {
    if (agents.length <= 1) {
      Alert.alert("无法删除", "至少需要保留一个智能体。");
      return;
    }
    Alert.alert(`删除「${agent.title}」？`, "此操作不可恢复。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => onDelete(agent.id) },
    ]);
  };

  return (
    <Toolbar>
      <List
        modifiers={[
          listStyle("insetGrouped"),
          navigationTitle("智能体"),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        {agents.length === 0 ? (
          <Section footer={<Footer text="点击右上角 + 创建第一个智能体。" />}>
            <Text modifiers={[font({ size: 17 }), foregroundStyle(colors["muted-foreground"])]}>
              暂无智能体
            </Text>
          </Section>
        ) : (
          <Section footer={<Footer text="轻点切换当前智能体，向左轻扫可删除。" />}>
            {agents.map((agent) => {
              const current = agent.id === agentId;
              return (
                <SwipeRow
                  key={agent.id}
                  current={current}
                  title={agent.title}
                  onPress={() => onSelect(agent.id)}
                  onDelete={() => confirmDelete(agent)}
                />
              );
            })}
          </Section>
        )}
      </List>
      <Toolbar.Content>
        <ToolbarItem placement="topBarTrailing">
          <Button systemImage="plus" onPress={onAdd} modifiers={[buttonStyle("plain")]} />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}

function SwipeRow({
  current,
  title,
  onPress,
  onDelete,
}: {
  current: boolean;
  title: string;
  onPress: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  return (
    <SwipeActions>
      <Button onPress={onPress} modifiers={[buttonStyle("plain"), contentShape(shapes.rectangle())]}>
        <HStack spacing={12} modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}>
          <Text modifiers={current ? [bold()] : undefined}>{title}</Text>
          <Spacer />
          {current ? (
            <Image systemName="checkmark" size={15} color={colors.primary} />
          ) : null}
        </HStack>
      </Button>
      <SwipeActions.Actions edge="trailing">
        <Button label="删除" role="destructive" onPress={onDelete} />
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/**
 * A capability page whose data has not landed yet: one honest line in the list
 * and the reason in the footer.
 *
 * There used to be a 添加 button in the bar that only raised an alert — a
 * control that exists to say "not yet" is worse than no control, so the bar is
 * empty and the footer carries the whole message.
 */
function Placeholder({
  title,
  note,
  batch,
}: {
  title: string;
  note: string;
  batch: string;
}) {
  const { colors } = useTheme();
  return (
    <List
      modifiers={[
        listStyle("insetGrouped"),
        navigationTitle(title),
        navigationBarTitleDisplayMode("inline"),
      ]}
    >
      <Section footer={<Footer text={note} />}>
        <VStack alignment="leading" spacing={4}>
          <Text modifiers={[font({ size: 17 })]}>尚未接入</Text>
          <Text modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}>
            {batch} 批次接入后可在此管理
          </Text>
        </VStack>
      </Section>
    </List>
  );
}
