import { memo, useState } from "react";
import { Alert } from "react-native";
import {
  Button,
  ContextMenu,
  HStack,
  Image,
  Label,
  List,
  NavigationDestination,
  NavigationLink,
  Section,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
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

/**
 * Settings, all native — the settings half of the app's single `NavigationStack`.
 *
 * These are `NavigationDestination`s, not a stack of their own: the shell owns
 * one `NavigationStack` whose root is the chat (`App.tsx`), so pushing settings
 * gives the host's swipe-to-dismiss rule the depth it looks for and the system
 * interactive pop returns to the chat (`docs/ui-spec.md` §12).
 *
 * Shape of every capability page (v17, from the "设置界面混乱" report): one
 * `List` of rows, 添加 in the top-right corner of the navigation bar, and the
 * form itself in a sheet — never a second full page with its own save button.
 * 模型服务 and 智能体 are backed by `providers.json` / `agents.json`; 工具 / MCP /
 * 技能 render the same structure with an empty state until P3–P5 land.
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
  sessionCount,
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
  sessionCount: number;
  actions: ChatActions;
  onCreateProvider: (templateId: string) => void;
  onDeleteProvider: (provider: ModelProvider) => void;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onSelfTest: () => Promise<string>;
}) {
  const { colors } = useTheme();

  return (
    <>
      <NavigationDestination value={SETTINGS_ROUTE}>
        <Toolbar>
            <List
              modifiers={[
                listStyle("insetGrouped"),
                navigationTitle("设置"),
                navigationBarTitleDisplayMode("inline"),
              ]}
            >
              <Section title="对话">
                <Row
                  value={PROVIDERS_ROUTE}
                  title="模型服务"
                  icon="server.rack"
                  trailing={`${providers.length}`}
                />
                <Row
                  value={AGENTS_ROUTE}
                  title="智能体"
                  icon="person.crop.circle"
                  trailing={`${agents.length}`}
                />
              </Section>

              <Section
                title="能力"
                footer={<Footer text={`共 ${sessionCount} 个会话`} />}
              >
                <Row value={TOOLS_ROUTE} title="工具" icon="wrench.and.screwdriver" />
                <Row value={MCP_ROUTE} title="MCP 服务" icon="shippingbox" />
                <Row value={SKILLS_ROUTE} title="技能" icon="sparkles" />
                <Row
                  value={DIAGNOSTICS_ROUTE}
                  title="诊断日志"
                  icon="doc.text.magnifyingglass"
                />
              </Section>
            </List>
          </Toolbar>
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
            <Toolbar>
              <List
                modifiers={[
                  listStyle("insetGrouped"),
                  navigationTitle("智能体"),
                  navigationBarTitleDisplayMode("inline"),
                ]}
              >
                <Section footer={<Footer text="轻点切换当前智能体，长按可删除" />}>
                  {agents.map((agent) => (
                    <ContextMenu key={agent.id}>
                      <ContextMenu.Trigger>
                        <Button
                          onPress={() => onSelectAgent(agent.id)}
                          modifiers={[
                            buttonStyle("plain"),
                            contentShape(shapes.rectangle()),
                          ]}
                        >
                          <HStack
                            spacing={12}
                            modifiers={[
                              frame({ maxWidth: 10000, alignment: "leading" }),
                            ]}
                          >
                            <Text modifiers={[font({ size: 16 })]}>
                              {agent.title}
                            </Text>
                            <Spacer />
                            {agent.id === agentId ? (
                              <Image
                                systemName="checkmark"
                                size={15}
                                color={colors.primary}
                              />
                            ) : null}
                          </HStack>
                        </Button>
                      </ContextMenu.Trigger>
                      <ContextMenu.Items>
                        <Button
                          label="删除"
                          systemImage="trash"
                          role="destructive"
                          onPress={() => onDeleteAgent(agent.id)}
                        />
                      </ContextMenu.Items>
                    </ContextMenu>
                  ))}
                </Section>
              </List>
              <Toolbar.Content>
                <ToolbarItem placement="topBarTrailing">
                  <Button
                    label="添加"
                    onPress={onAddAgent}
                    modifiers={[buttonStyle("plain")]}
                  />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
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
 * Same structure as the real pages — list plus a 添加 in the toolbar — so the
 * shape of settings does not change when the data arrives. The tap is honest
 * about why nothing can be added yet instead of opening an empty form.
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
  return (
    <Toolbar>
      <List
        modifiers={[
          listStyle("insetGrouped"),
          navigationTitle(title),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section footer={<Footer text={note} />}>
          <Empty text={`${batch} 批次接入后可在此管理`} />
        </Section>
      </List>
      <Toolbar.Content>
        <ToolbarItem placement="topBarTrailing">
          <Button
            label="添加"
            onPress={() => Alert.alert(title, `${note}。`)}
            modifiers={[buttonStyle("plain")]}
          />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}

function Empty({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}
    >
      {text}
    </Text>
  );
}

function Row({
  value,
  title,
  icon,
  trailing,
}: {
  value?: string;
  title: string;
  icon?: string;
  trailing?: string;
}) {
  const { colors } = useTheme();
  const row = (
    <HStack spacing={12}>
      <Label title={title} systemImage={(icon ?? "circle") as never} />
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

  if (value === undefined) {
    return row;
  }

  return <NavigationLink value={value}>{row}</NavigationLink>;
}

function Footer({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      modifiers={[font({ size: 13 }), foregroundStyle(colors["muted-foreground"])]}
    >
      {text}
    </Text>
  );
}