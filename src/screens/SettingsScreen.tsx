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
  type Instance,
  type ModelConfig,
  type TemplateId,
} from "../domain/service.ts";
import type { Agent } from "../domain/types.ts";
import type { ChatActions } from "../state/useChat.ts";
import { useTheme } from "../theme/index.tsx";
import { InstancePage } from "./InstancePage.tsx";
import { ModelPage } from "./ModelPage.tsx";
import { DiagnosticsPage } from "./DiagnosticsPage.tsx";
import { ModelServiceHome } from "./ModelServiceHome.tsx";

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
  instances,
  models,
  agents,
  agentId,
  sessionCount,
  actions,
  onCreateInstance,
  onDeleteInstance,
  onAddAgent,
  onDeleteAgent,
  onSelectAgent,
  onSelfTest,
}: {
  instances: readonly Instance[];
  models: Record<string, ModelConfig[]>;
  agents: readonly Agent[];
  agentId: string | null;
  sessionCount: number;
  actions: ChatActions;
  onCreateInstance: (templateId: TemplateId) => void;
  onDeleteInstance: (instance: Instance) => void;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onSelfTest: () => Promise<string>;
}) {
  const { colors } = useTheme();

  return (
    <>
      <NavigationDestination value="settings">
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
                  value="modelService"
                  title="模型服务"
                  icon="server.rack"
                  trailing={`${instances.length}`}
                />
                <Row
                  value="agents"
                  title="智能体"
                  icon="person.crop.circle"
                  trailing={`${agents.length}`}
                />
              </Section>

              <Section
                title="能力"
                footer={<Footer text={`共 ${sessionCount} 个会话`} />}
              >
                <Row value="tools" title="工具" icon="wrench.and.screwdriver" />
                <Row value="mcp" title="MCP 服务" icon="shippingbox" />
                <Row value="skills" title="技能" icon="sparkles" />
                <Row
                  value="diagnostics"
                  title="诊断日志"
                  icon="doc.text.magnifyingglass"
                />
              </Section>
            </List>
          </Toolbar>
      </NavigationDestination>

      <NavigationDestination value="modelService">
        <ModelServiceHome
          instances={instances}
          models={models}
          onCreate={onCreateInstance}
          onDelete={onDeleteInstance}
        />
      </NavigationDestination>

      {instances.map((instance) => (
        <NavigationDestination key={instance.id} value={`instance/${instance.id}`}>
          <InstancePage
            instance={instance}
            models={models[instance.id] ?? []}
            onUpdate={actions.updateInstance}
            onDelete={onDeleteInstance}
            onFetchModels={actions.fetchModels}
            onAddModels={(instanceId, ids) => {
              for (const id of ids) {
                actions.addModel(instanceId, newModel(id));
              }
            }}
            onAddModel={actions.addModel}
            onDeleteModel={actions.removeModel}
          />
        </NavigationDestination>
      ))}

      {instances.flatMap((instance) =>
        (models[instance.id] ?? []).map((model) => (
          <NavigationDestination
            key={`${instance.id}/${model.id}`}
            value={`model/${instance.id}/${model.id}`}
          >
            <ModelPage
              instance={instance}
              model={model}
              onChange={(next) => actions.updateModel(instance.id, next)}
            />
          </NavigationDestination>
        )),
      )}

          <NavigationDestination value="agents">
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

          <NavigationDestination value="tools">
            <Placeholder
              title="工具"
              note="内置工具走 Swipt 的设备能力（截图、点击、前台应用），随 P3 批次接入"
              batch="P3"
            />
          </NavigationDestination>

          <NavigationDestination value="mcp">
            <Placeholder
              title="MCP 服务"
              note="MCP 客户端按 JSON-RPC 手写实现，一期不做 OAuth，随 P4 批次接入"
              batch="P4"
            />
          </NavigationDestination>

          <NavigationDestination value="skills">
            <Placeholder
              title="技能"
              note="技能是带 SKILL.md 的目录，支持 URL 导入与粘贴导入，随 P5 批次接入"
              batch="P5"
            />
          </NavigationDestination>

          <NavigationDestination value="diagnostics">
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