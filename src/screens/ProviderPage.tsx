import { useState, type ReactNode } from "react";
import { Alert } from "react-native";
import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  Picker,
  Section,
  SecureField,
  Spacer,
  SwipeActions,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  Toggle,
  VStack,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  listStyle,
  multilineTextAlignment,
  navigationBarTitleDisplayMode,
  navigationTitle,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";

import { describeFailure, normalizeFailure, technicalOf } from "../api/errors.ts";
import {
  PROTOCOL_LABEL,
  PROTOCOLS,
  baseURLError,
  duplicateHeader,
  isValidURL,
  modelCountLabel,
  protocolEditable,
  type RequestHeader,
  type ModelProvider,
  type ModelProviderTemplate,
  templateOf,
  type ProviderModel,
  type Protocol,
} from "../domain/provider.ts";
import { useTheme } from "../theme/index.tsx";
import { CandidateSheet } from "../shell/CandidateSheet.tsx";
import { ModelSheet } from "../shell/ModelSheet.tsx";
import { FieldError, Footer, Muted } from "./parts.tsx";
import { providerModelRoute } from "../routes.ts";

/**
 * 连接详情: connection fields, model list, custom headers, delete.
 *
 * No global 保存 button — every edit lands in the state immediately and the
 * chat hook's 300ms debounce writes it to SQLite. 获取模型 and 手动添加模型 are
 * explicit actions, and a fetched catalogue only ever becomes *candidates*:
 * it never adds, removes or reorders what the user already configured.
 */
export function ProviderPage({
  templates,
  provider,
  models,
  onUpdate,
  onDelete,
  onFetchModels,
  onAddModels,
  onAddModel,
  onDeleteModel,
}: {
  templates: readonly ModelProviderTemplate[];
  provider: ModelProvider;
  models: readonly ProviderModel[];
  onUpdate: (provider: ModelProvider) => void;
  onDelete: (provider: ModelProvider) => void;
  onFetchModels: (provider: ModelProvider) => Promise<string[]>;
  onAddModels: (providerId: string, ids: readonly string[]) => void;
  onAddModel: (providerId: string, model: ProviderModel) => void;
  onDeleteModel: (providerId: string, modelId: string) => void;
}) {
  const { colors } = useTheme();
  const template = templateOf(templates, provider.templateId);
  const custom = template?.custom ?? false;

  const [name, setName] = useState(provider.name);
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [fetching, setFetching] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const nameText = useNativeState(provider.name);
  const baseText = useNativeState(provider.baseURL);
  const keyText = useNativeState("");

  const urlError = baseURLError(baseURL);

  const patch = (next: Partial<ModelProvider>) => onUpdate({ ...provider, ...next });

  const changeProtocol = (protocol: Protocol) => {
    if (protocol === provider.protocol) {
      return;
    }
    if (models.length === 0) {
      patch({ protocol });
      return;
    }
    Alert.alert(
      "切换协议？",
      custom
        ? "切换协议可能使已有模型的参数失效。模型不会被删除，但需要重新检查思考与采样配置。"
        : "切换后已有模型的请求格式将改变，确认切换？",
      [
        { text: "取消", style: "cancel" },
        { text: "切换", onPress: () => patch({ protocol }) },
      ],
    );
  };

  const fetchModels = async () => {
    if (fetching) {
      return;
    }
    setFetching(true);
    try {
      const ids = await onFetchModels(provider);
      setCandidates(ids);
      setCandidateOpen(true);
    } catch (error) {
      Alert.alert("获取模型失败", `${fetchErrorText(error)}\n\n${technicalOf(error)}`);
    } finally {
      setFetching(false);
    }
  };

  const keyReady = provider.apiKey.trim() !== "";

  return (
    <>
      <Toolbar>
        <List
          modifiers={[
            listStyle("insetGrouped"),
            navigationTitle(provider.name),
            navigationBarTitleDisplayMode("inline"),
          ]}
        >
          <Section
            footer={
              <Footer
                text={
                  custom
                    ? "协议可改；Base URL 按协议规则拼接路径。"
                    : "仅用于该厂商官方 API Key，可修改 Base URL 走代理。"
                }
              />
            }
          >
            <LabeledField label="名称">
              <TextField
                text={nameText}
                placeholder="未命名"
                onTextChange={(next) => {
                  setName(next);
                  patch({ name: next });
                }}
                modifiers={[multilineTextAlignment("trailing")]}
              />
            </LabeledField>
            <LabeledField label="Base URL">
              <TextField
                text={baseText}
                placeholder="https://…"
                onTextChange={(next) => {
                  setBaseURL(next);
                  patch({ baseURL: next });
                }}
                modifiers={[
                  keyboardType("url"),
                  textInputAutocapitalization("never"),
                  autocorrectionDisabled(),
                  multilineTextAlignment("trailing"),
                ]}
              />
            </LabeledField>
            <LabeledField label="API Key">
              <SecureField
                text={keyText}
                placeholder={keyReady ? "已保存" : "未填写"}
                onTextChange={(next) => patch({ apiKey: next })}
                modifiers={[
                  textInputAutocapitalization("never"),
                  autocorrectionDisabled(),
                  multilineTextAlignment("trailing"),
                ]}
              />
            </LabeledField>
            {urlError === null ? null : <FieldError text={urlError} />}
            <Toggle
              label="流式输出"
              isOn={provider.stream}
              onIsOnChange={(stream) => patch({ stream })}
            />
          </Section>

          {/* 标识：模板 / 协议 / ID 都是只读信息，单独成段，不混在可编辑字段里。 */}
          <Section title="标识">
            <InfoRow label="模板" value={template?.name ?? "未知模板"} />
            {protocolEditable(templates, provider) ? (
              <Picker
                label="协议"
                selection={provider.protocol}
                onSelectionChange={(next) => changeProtocol(next as Protocol)}
              >
                {(template?.protocols ?? PROTOCOLS).map((value) => (
                  <Text key={value} modifiers={[tag(value)]}>
                    {PROTOCOL_LABEL[value]}
                  </Text>
                ))}
              </Picker>
            ) : (
              <InfoRow label="协议" value={PROTOCOL_LABEL[provider.protocol]} />
            )}
            <InfoRow label="ID" value={provider.id} />
            {!custom &&
            template !== undefined &&
            provider.baseURL !== template.baseURL &&
            isValidURL(provider.baseURL) ? (
              <Button
                label="恢复默认地址"
                modifiers={[buttonStyle("plain")]}
                onPress={() =>
                  Alert.alert("恢复默认地址？", template.baseURL, [
                    { text: "取消", style: "cancel" },
                    {
                      text: "恢复",
                      onPress: () => {
                        baseText.set(template.baseURL);
                        setBaseURL(template.baseURL);
                        patch({ baseURL: template.baseURL });
                      },
                    },
                  ])
                }
              />
            ) : null}
          </Section>

          <Section
            title="模型"
            footer={
              models.length === 0 ? (
                <Footer text="还没有模型。可从目录拉取，或手动添加。" />
              ) : (
                <Footer text={modelCountLabel(models.length)} />
              )
            }
          >
            {models.length === 0 ? (
              <Text modifiers={[font({ size: 17 }), foregroundStyle(colors["muted-foreground"])]}>
                未添加模型
              </Text>
            ) : (
              models.map((model) => (
                <SwipeActions key={model.id}>
                  <NavigationLink value={providerModelRoute(provider.id, model.id)}>
                    <HStack spacing={12}>
                      <Text modifiers={[font({ size: 17 })]}>{model.displayName}</Text>
                      <Spacer />
                      <Text
                        modifiers={[
                          font({ size: 15 }),
                          foregroundStyle(colors["muted-foreground"]),
                        ]}
                      >
                        {model.id}
                      </Text>
                    </HStack>
                  </NavigationLink>
                  <SwipeActions.Actions edge="trailing">
                    <Button
                      label="删除"
                      role="destructive"
                      onPress={() =>
                        Alert.alert(
                          `删除模型「${model.displayName}」？`,
                          "此操作不可恢复。",
                          [
                            { text: "取消", style: "cancel" },
                            {
                              text: "删除",
                              style: "destructive",
                              onPress: () => onDeleteModel(provider.id, model.id),
                            },
                          ],
                        )
                      }
                    />
                  </SwipeActions.Actions>
                </SwipeActions>
              ))
            )}
          </Section>

          {/* 操作独立成段：系统设置里「添加/获取」这类动作从不夹在内容行之间。 */}
          <Section>
            {custom
              ? null
              : fetchRow(fetching, keyReady, urlError, fetchModels, () =>
                  Alert.alert("请先填写 API Key", "获取模型目录需要有效的 Key。"),
                )}
            <Button
              label="手动添加模型"
              modifiers={[buttonStyle("plain")]}
              onPress={() => setModelOpen(true)}
            />
          </Section>

          <HeaderSection provider={provider} onUpdate={onUpdate} />

          <Section>
            <Button
              label="删除此连接"
              role="destructive"
              modifiers={[buttonStyle("plain"), frame({ maxWidth: 10000 })]}
              onPress={() =>
                Alert.alert(
                  `删除「${provider.name}」？`,
                  `此连接下的 ${models.length} 个模型配置将一并移除，且不可恢复。`,
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () => onDelete(provider),
                    },
                  ],
                )
              }
            />
          </Section>
        </List>
      </Toolbar>

      <CandidateSheet
        visible={candidateOpen}
        candidates={candidates ?? []}
        existing={models.map((model) => model.id)}
        onClose={() => setCandidateOpen(false)}
        onAdd={(ids) => onAddModels(provider.id, ids)}
      />
      <ModelSheet
        visible={modelOpen}
        onClose={() => setModelOpen(false)}
        onCreate={(id, displayName) => {
          onAddModel(provider.id, {
            id,
            displayName,
            note: "",
            maxOutputTokens: null,
            contextWindow: null,
            thinking: { enabled: false, effort: "medium", budget: null },
            temperature: null,
            topP: null,
            image: false,
          });
        }}
      />
    </>
  );
}

function fetchRow(
  fetching: boolean,
  keyReady: boolean,
  urlError: string | null,
  run: () => void,
  block: () => void,
) {
  if (fetching) {
    // Deliberately a plain Text: the loading row must not depend on a native
    // component the installed @expo/ui may not have.
    return <Muted text="正在拉取模型目录…" />;
  }
  return (
    <Button
      label="获取模型"
      modifiers={[buttonStyle("plain"), disabled(!keyReady || urlError !== null)]}
      onPress={() => {
        if (!keyReady || urlError !== null) {
          block();
          return;
        }
        run();
      }}
    />
  );
}

function HeaderSection({
  provider,
  onUpdate,
}: {
  provider: ModelProvider;
  onUpdate: (provider: ModelProvider) => void;
}) {
  const { colors } = useTheme();
  const patchHeaders = (headers: RequestHeader[]) => onUpdate({ ...provider, headers });

  return (
    <Section
      title="高级"
      footer={
        <Footer
          text={
            provider.protocol === "anthropic-messages"
              ? "anthropic-version 由协议自动注入，可用同名请求头覆盖。"
              : "请求头按原样发送；同名时自定义值覆盖自动注入值。"
          }
        />
      }
    >
      {provider.protocol === "anthropic-messages" ? (
        <Text
          modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}
        >
          anthropic-version: 2023-06-01（自动）
        </Text>
      ) : null}
      {provider.headers.map((header, index) => (
        <RequestHeaderRow
          key={index}
          header={header}
          onChange={(next) => {
            const headers = provider.headers.map((item, at) =>
              at === index ? next : item,
            );
            patchHeaders(headers);
          }}
          onRemove={() =>
            patchHeaders(provider.headers.filter((_, at) => at !== index))
          }
        />
      ))}
      <AddHeaderRow
        onAdd={(next) => {
          const trimmed = next.name.trim();
          if (trimmed === "") {
            return;
          }
          const duplicate = provider.headers.some(
            (item) => item.name.toLowerCase() === trimmed.toLowerCase(),
          );
          if (duplicate) {
            Alert.alert("请求头名称重复", "同一个请求头只保留一条。");
            return;
          }
          patchHeaders([...provider.headers, { name: trimmed, value: next.value.trim() }]);
        }}
      />
      {provider.headers.some((header, at) =>
        duplicateHeader(provider.headers.slice(0, at), header.name),
      ) ? (
        <FieldError text="请求头名称重复" />
      ) : null}
    </Section>
  );
}

function RequestHeaderRow({
  header,
  onChange,
  onRemove,
}: {
  header: RequestHeader;
  onChange: (header: RequestHeader) => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const nameText = useNativeState(header.name);
  const valueText = useNativeState(header.value);

  return (
    <HStack spacing={8}>
      <TextField
        text={nameText}
        placeholder="RequestHeader"
        onTextChange={(next) => onChange({ ...header, name: next })}
        modifiers={[autocorrectionDisabled()]}
      />
      <TextField
        text={valueText}
        placeholder="值"
        onTextChange={(next) => onChange({ ...header, value: next })}
        modifiers={[autocorrectionDisabled()]}
      />
      <Button onPress={onRemove} modifiers={[buttonStyle("plain")]}>
        <Image systemName="minus.circle" size={17} color={colors.destructive} />
      </Button>
    </HStack>
  );
}

function AddHeaderRow({ onAdd }: { onAdd: (header: RequestHeader) => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const nameText = useNativeState("");
  const valueText = useNativeState("");

  return (
    <HStack spacing={8}>
      <TextField text={nameText} placeholder="RequestHeader 名" onTextChange={setName} />
      <TextField text={valueText} placeholder="值" onTextChange={setValue} />
      <Button
        modifiers={[buttonStyle("plain")]}
        onPress={() => {
          onAdd({ name, value });
          nameText.set("");
          valueText.set("");
          setName("");
          setValue("");
        }}
      >
        <Image systemName="plus.circle" size={17} color={colors.info} />
      </Button>
    </HStack>
  );
}

/** 标签左、值右对齐的一行 —— iOS 设置里文本字段的标准形态。 */
function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <HStack spacing={12}>
      <Text modifiers={[font({ size: 17 }), frame({ maxWidth: 10000, alignment: "leading" })]}>
        {label}
      </Text>
      <Spacer />
      {children}
    </HStack>
  );
}

/** 只读键值行：没有 chevron，值用灰色。 */
function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <HStack spacing={12}>
      <Text modifiers={[font({ size: 17 })]}>{label}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}>
        {value}
      </Text>
    </HStack>
  );
}

function fetchErrorText(error: unknown): string {
  const failure = normalizeFailure(error);
  if (failure.kind === "timeout") {
    return "拉取超时，可稍后重试或手动添加模型。";
  }
  if (failure.kind === "http") {
    if (failure.status === 401 || failure.status === 403) {
      return "API Key 无效或权限不足。";
    }
    if (failure.status === 404) {
      return "该地址未提供模型目录接口，可手动添加模型。";
    }
  }
  return describeFailure(failure);
}