import { memo, useState } from "react";
import { Alert, View } from "react-native";
import {
  Button,
  ContextMenu,
  Host,
  HStack,
  Image,
  Label,
  List,
  NavigationDestination,
  NavigationLink,
  NavigationStack,
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

import { providerNameOf } from "../domain/provider.ts";
import { NavBackButton } from "../shell/GlassControls.tsx";
import type { Agent, Provider } from "../domain/types.ts";
import { useTheme } from "../theme/index.tsx";

/**
 * Settings, all native.
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
export const SettingsScreen = memo(function SettingsScreen({
  providers,
  agents,
  providerId,
  agentId,
  sessionCount,
  onBack,
  onAddProvider,
  onEditProvider,
  onDeleteProvider,
  onSelectProvider,
  onAddAgent,
  onDeleteAgent,
  onSelectAgent,
  path,
  onPathChange,
}: {
  providers: Provider[];
  agents: Agent[];
  providerId: string | null;
  agentId: string | null;
  sessionCount: number;
  onBack: () => void;
  onAddProvider: () => void;
  onEditProvider: (provider: Provider) => void;
  onDeleteProvider: (id: string) => void;
  onSelectProvider: (id: string) => void;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onSelectAgent: (id: string) => void;
  /** Native navigation path, owned by the shell so it knows the depth. */
  path: string[];
  onPathChange: (next: string[]) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Host style={{ flex: 1 }}>
        <NavigationStack path={path} onPathChange={onPathChange}>
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
                  value="providers"
                  title="模型服务"
                  icon="server.rack"
                  trailing={`${providers.length}`}
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
              </Section>
            </List>
            <Toolbar.Content>
              <ToolbarItem placement="topBarLeading">
                <NavBackButton label="返回聊天" onPress={onBack} />
              </ToolbarItem>
            </Toolbar.Content>
          </Toolbar>

          <NavigationDestination value="providers">
            <Toolbar>
              <List
                modifiers={[
                  listStyle("insetGrouped"),
                  navigationTitle("模型服务"),
                  navigationBarTitleDisplayMode("inline"),
                ]}
              >
                {providers.length === 0 ? (
                  <Section
                    footer={
                      <Footer text="点右上角「添加」，填入接口地址与模型名即可开始对话" />
                    }
                  >
                    <Empty text="还没有模型服务" />
                  </Section>
                ) : (
                  <Section footer={<Footer text="长按可设为当前或删除" />}>
                    {providers.map((provider) => (
                      <ContextMenu key={provider.id}>
                        <ContextMenu.Trigger>
                          <Button
                            onPress={() => onEditProvider(provider)}
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
                              <VStack alignment="leading" spacing={2}>
                                <Text
                                  modifiers={[font({ size: 16, weight: "semibold" })]}
                                >
                                  {providerNameOf(provider)}
                                </Text>
                                <Text
                                  modifiers={[
                                    font({ size: 13 }),
                                    foregroundStyle(colors["muted-foreground"]),
                                  ]}
                                >
                                  {provider.model}
                                </Text>
                              </VStack>
                              <Spacer />
                              {provider.id === providerId ? (
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
                            label="设为当前"
                            systemImage="checkmark.circle"
                            onPress={() => onSelectProvider(provider.id)}
                          />
                          <Button
                            label="删除"
                            systemImage="trash"
                            role="destructive"
                            onPress={() => onDeleteProvider(provider.id)}
                          />
                        </ContextMenu.Items>
                      </ContextMenu>
                    ))}
                  </Section>
                )}
              </List>
              <Toolbar.Content>
                <ToolbarItem placement="topBarTrailing">
                  <Button
                    label="添加"
                    onPress={onAddProvider}
                    modifiers={[buttonStyle("plain")]}
                  />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationDestination>

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
        </NavigationStack>
      </Host>
    </View>
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