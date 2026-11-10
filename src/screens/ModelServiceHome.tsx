import { Alert } from "react-native";
import {
  Button,
  HStack,
  List,
  Menu,
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
  buttonStyle,
  font,
  foregroundStyle,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
} from "@expo/ui/swift-ui/modifiers";

import {
  GROUP_ORDER,
  templateOf,
  modelCountLabel,
  proxyHostOf,
  type Instance,
  type ModelConfig,
  type TemplateId,
} from "../domain/service.ts";
import { useTheme } from "../theme/index.tsx";
import { Footer, Muted } from "./parts.tsx";

/**
 * 模型服务首页: instances grouped by template, never by protocol.
 *
 * Empty groups are omitted rather than shown as empty sections — a settings
 * page must not look like a checklist of everything you have not configured.
 */
export function ModelServiceHome({
  instances,
  models,
  onCreate,
  onDelete,
}: {
  instances: readonly Instance[];
  models: Record<string, ModelConfig[]>;
  onCreate: (templateId: TemplateId) => void;
  onDelete: (instance: Instance) => void;
}) {
  const { colors } = useTheme();

  const groups = GROUP_ORDER.map((templateId) => ({
    templateId,
    template: templateOf(templateId),
    rows: instances.filter((instance) => instance.templateId === templateId),
  })).filter((group) => group.rows.length > 0);

  return (
    <Toolbar>
      <List
        modifiers={[
          listStyle("insetGrouped"),
          navigationTitle("模型服务"),
          navigationBarTitleDisplayMode("large"),
        ]}
      >
        {groups.length === 0 ? (
          <Section
            footer={
              <Footer text="内置组只服务厂商官方 API Key；第三方中转、网关与本地模型请建在「自定义」。" />
            }
          >
            <VStack alignment="leading" spacing={10}>
              <Muted text="尚未配置模型服务。" />
              <Muted text="点击右上角 + 从模板创建连接。" />
              <Menu label={<Text modifiers={[font({ size: 16 })]}>从模板创建</Text>}>
                {templateButtons(onCreate)}
              </Menu>
            </VStack>
          </Section>
        ) : (
          groups.map((group) => (
            <Section
              key={group.templateId}
              title={group.template.vendor}
              footer={
                <Footer
                  text={
                    group.templateId === "custom"
                      ? "用于中转站、网关、本地模型等第三方兼容端点。"
                      : `仅用于 ${group.template.vendor} 官方 API Key，可修改 Base URL 走代理。第三方兼容服务请使用「自定义」创建。`
                  }
                />
              }
            >
              {group.rows.map((instance) => {
                const proxy = proxyHostOf(instance);
                const count = modelCountLabel(models[instance.id]?.length ?? 0);
                return (
                  <SwipeActions key={instance.id}>
                    <NavigationLink value={`instance/${instance.id}`}>
                      <HStack spacing={12}>
                        <VStack alignment="leading" spacing={2}>
                          <Text modifiers={[font({ size: 16 })]}>{instance.name}</Text>
                          {proxy === null ? null : (
                            <Text
                              modifiers={[
                                font({ size: 13 }),
                                foregroundStyle(colors["muted-foreground"]),
                              ]}
                            >
                              {proxy}
                            </Text>
                          )}
                        </VStack>
                        <Spacer />
                        <Text
                          modifiers={[
                            font({ size: 13 }),
                            foregroundStyle(colors["muted-foreground"]),
                          ]}
                        >
                          {count}
                        </Text>
                      </HStack>
                    </NavigationLink>
                    <SwipeActions.Actions edge="trailing">
                      <Button
                        label="删除"
                        role="destructive"
                        onPress={() =>
                          confirmDeleteInstance(instance, () => onDelete(instance))
                        }
                      />
                    </SwipeActions.Actions>
                  </SwipeActions>
                );
              })}
            </Section>
          ))
        )}
      </List>
      <Toolbar.Content>
        <ToolbarItem placement="topBarTrailing">
          <Menu label="" systemImage="plus">
            {templateButtons(onCreate)}
          </Menu>
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}

/** Shared by the toolbar + and the empty-state button. */
function templateButtons(onCreate: (templateId: TemplateId) => void) {
  return [
    <Button
      key="openai"
      label="OpenAI"
      onPress={() => onCreate("openai")}
    />,
    <Button
      key="anthropic"
      label="Anthropic"
      onPress={() => onCreate("anthropic")}
    />,
    <Button
      key="deepseek"
      label="DeepSeek"
      onPress={() => onCreate("deepseek")}
    />,
    <Button
      key="custom"
      label="自定义…"
      onPress={() => onCreate("custom")}
    />,
  ];
}

function confirmDeleteInstance(instance: Instance, remove: () => void) {
  Alert.alert(
    `删除「${instance.name}」？`,
    "此连接下的所有模型配置将一并移除，且不可恢复。",
    [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: remove },
    ],
  );
}

export { confirmDeleteInstance, templateButtons };