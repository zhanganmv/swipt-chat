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
  modelCountLabel,
  proxyHostOf,
  type ModelProvider,
  type ModelProviderTemplate,
  type ProviderModel,
} from "../domain/provider.ts";
import { useTheme } from "../theme/index.tsx";
import { Footer, Muted } from "./parts.tsx";

interface Group {
  key: string;
  title: string;
  footer: string;
  rows: ModelProvider[];
}

/**
 * 模型服务首页: providers grouped by template, never by protocol.
 *
 * Groups come from the `model_provider_template` rows (seed order), so adding
 * a provider family is a seed change, not a page change. Empty groups are
 * omitted rather than shown as empty sections — a settings page must not look
 * like a checklist of everything you have not configured.
 */
export function ProviderListPage({
  templates,
  providers,
  models,
  onCreate,
  onDelete,
}: {
  templates: readonly ModelProviderTemplate[];
  providers: readonly ModelProvider[];
  models: Record<string, ProviderModel[]>;
  onCreate: (templateId: string) => void;
  onDelete: (provider: ModelProvider) => void;
}) {
  const { colors } = useTheme();

  const groups: Group[] = templates.map((template) => ({
    key: template.id,
    title: template.name,
    footer: template.custom
      ? "用于中转站、网关、本地模型等第三方兼容端点。"
      : `仅用于 ${template.name} 官方 API Key，可修改 Base URL 走代理。第三方兼容服务请使用「自定义」创建。`,
    rows: providers.filter((provider) => provider.templateId === template.id),
  }));

  // A provider whose template row is gone would otherwise vanish silently.
  const orphans = providers.filter(
    (provider) =>
      !templates.some((template) => template.id === provider.templateId),
  );
  if (orphans.length > 0) {
    groups.push({
      key: "",
      title: "其他",
      footer: "模板已不存在，删除后重新创建。",
      rows: orphans,
    });
  }

  const shown = groups.filter((group) => group.rows.length > 0);

  return (
    <Toolbar>
      <List
        modifiers={[
          listStyle("insetGrouped"),
          navigationTitle("模型服务"),
          navigationBarTitleDisplayMode("large"),
        ]}
      >
        {shown.length === 0 ? (
          <Section
            footer={
              <Footer text="内置组只服务厂商官方 API Key；第三方中转、网关与本地模型请建在「自定义」。" />
            }
          >
            <VStack alignment="leading" spacing={10}>
              <Muted text="尚未配置模型服务。" />
              <Muted text="点击右上角 + 从模板创建连接。" />
              <Menu label={<Text modifiers={[font({ size: 16 })]}>从模板创建</Text>}>
                {templateButtons(templates, onCreate)}
              </Menu>
            </VStack>
          </Section>
        ) : (
          shown.map((group) => (
            <Section
              key={group.key}
              title={group.title}
              footer={<Footer text={group.footer} />}
            >
              {group.rows.map((provider) => {
                const proxy = proxyHostOf(templates, provider);
                const count = modelCountLabel(models[provider.id]?.length ?? 0);
                return (
                  <SwipeActions key={provider.id}>
                    <NavigationLink value={`provider/${provider.id}`}>
                      <HStack spacing={12}>
                        <VStack alignment="leading" spacing={2}>
                          <Text modifiers={[font({ size: 16 })]}>{provider.name}</Text>
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
                          confirmDeleteProvider(
                            provider,
                            models[provider.id]?.length ?? 0,
                            () => onDelete(provider),
                          )
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
            {templateButtons(templates, onCreate)}
          </Menu>
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}

/** Shared by the toolbar + and the empty-state button. */
function templateButtons(
  templates: readonly ModelProviderTemplate[],
  onCreate: (templateId: string) => void,
) {
  return templates.map((template) => (
    <Button
      key={template.id}
      label={template.custom ? `${template.name}…` : template.name}
      onPress={() => onCreate(template.id)}
    />
  ));
}

function confirmDeleteProvider(
  provider: ModelProvider,
  modelCount: number,
  remove: () => void,
) {
  Alert.alert(
    `删除「${provider.name}」？`,
    `此连接下的 ${modelCount} 个模型配置将一并移除，且不可恢复。`,
    [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: remove },
    ],
  );
}

export { confirmDeleteProvider, templateButtons };