import { useMemo, useState } from "react";
import {
  Button,
  Form,
  Menu,
  Section,
  Text,
  TextField,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  keyboardType,
  navigationBarTitleDisplayMode,
  navigationTitle,
} from "@expo/ui/swift-ui/modifiers";

import { describeFailure, normalizeFailure } from "../api/errors.ts";
import { suggestedModels, uniqueModels } from "../domain/catalog.ts";
import type { Provider } from "../domain/types.ts";
import { useTheme } from "../theme/index.tsx";
import { SheetShell } from "./SheetShell.tsx";

/**
 * 模型服务 form, presented as a drawer.
 *
 * Two sources of truth are impossible here: the native text states are seeded
 * once when the form mounts (the sheet unmounts on dismiss, and `key` forces a
 * re-seed when the edited record changes), and the `useState` copies below are
 * what 保存 reads. There is no effect writing back into the fields.
 */
export function ProviderSheet({
  visible,
  provider,
  models,
  onClose,
  onSave,
  onFetchModels,
}: {
  visible: boolean;
  provider: Provider | null;
  /** Ids cached for this service; empty for a service that was never probed. */
  models: readonly string[];
  onClose: () => void;
  onSave: (next: Provider) => void;
  onFetchModels: (provider: Provider) => Promise<string[]>;
}) {
  return (
    <SheetShell visible={visible} onClose={onClose}>
      <ProviderForm
        key={provider?.id ?? "new"}
        provider={provider}
        models={models}
        onCancel={onClose}
        onSave={onSave}
        onFetchModels={onFetchModels}
      />
    </SheetShell>
  );
}

function ProviderForm({
  provider,
  models,
  onCancel,
  onSave,
  onFetchModels,
}: {
  provider: Provider | null;
  models: readonly string[];
  onCancel: () => void;
  onSave: (next: Provider) => void;
  onFetchModels: (provider: Provider) => Promise<string[]>;
}) {
  const { colors } = useTheme();

  const [name, setName] = useState(provider?.name ?? "");
  const [baseURL, setBaseURL] = useState(provider?.baseURL ?? "");
  const [model, setModel] = useState(provider?.model ?? "");
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? "");
  const [stream, setStream] = useState(provider?.stream !== false);
  /** What the probe returned this session; an unsaved service cannot be cached. */
  const [fetched, setFetched] = useState<readonly string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);

  const nameText = useNativeState(provider?.name ?? "");
  const baseURLText = useNativeState(provider?.baseURL ?? "");
  const modelText = useNativeState(provider?.model ?? "");
  const apiKeyText = useNativeState(provider?.apiKey ?? "");

  const next: Provider = {
    id: provider?.id ?? "",
    name: name.trim() === "" ? model.trim() : name.trim(),
    baseURL: baseURL.trim(),
    model: model.trim(),
    apiKey: apiKey.trim(),
    stream,
  };
  const canSave = next.baseURL !== "" && next.model !== "";

  // Presets first: they are the ids a user recognises, while a fetched list can
  // run to hundreds of internal names.
  const options = useMemo(
    () => uniqueModels([suggestedModels(baseURL), models, fetched]),
    [baseURL, models, fetched],
  );

  const pick = (id: string) => {
    modelText.set(id);
    setModel(id);
  };

  const runProbe = async () => {
    if (fetching || next.baseURL === "") {
      return;
    }
    setFetching(true);
    setProbe(null);
    try {
      const ids = await onFetchModels(next);
      setFetched(ids);
      setProbeFailed(false);
      setProbe(
        ids.length === 0
          ? "连接正常，但服务没有返回模型"
          : `连接正常 · ${ids.length} 个模型`,
      );
    } catch (thrown) {
      setProbeFailed(true);
      setProbe(describeFailure(normalizeFailure(thrown)));
    } finally {
      setFetching(false);
    }
  };

  return (
    <Toolbar>
      <Form
        modifiers={[
          navigationTitle(provider === null ? "添加服务" : "编辑服务"),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section
          footer={
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(colors["muted-foreground"]),
              ]}
            >
              兼容 OpenAI 的 /chat/completions 接口；名称留空时用模型名
            </Text>
          }
        >
          <TextField
            text={nameText}
            placeholder="名称（可选）"
            onTextChange={setName}
          />
          <TextField
            text={baseURLText}
            placeholder="接口地址"
            onTextChange={setBaseURL}
            modifiers={[keyboardType("url")]}
          />
          <TextField
            text={apiKeyText}
            placeholder="API Key"
            onTextChange={setApiKey}
          />
        </Section>

        <Section
          footer={
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(colors["muted-foreground"]),
              ]}
            >
              「测试连接」会请求 /models：既确认地址和 Key 可用，也把模型列表存下来
            </Text>
          }
        >
          <TextField
            text={modelText}
            placeholder="模型名"
            onTextChange={setModel}
          />
          <Menu label="选择模型" systemImage="cpu">
            {options.length === 0 ? (
              <Button label="还没有可选的模型" onPress={() => {}} />
            ) : (
              options.map((id) => (
                <Button key={id} label={id} onPress={() => pick(id)} />
              ))
            )}
          </Menu>
          <Button
            label={fetching ? "正在连接…" : "测试连接并拉取模型"}
            onPress={() => void runProbe()}
            modifiers={[
              buttonStyle("plain"),
              disabled(fetching || next.baseURL === ""),
            ]}
          />
          {probe !== null && (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(probeFailed ? "#ff453a" : colors["muted-foreground"]),
              ]}
            >
              {probe}
            </Text>
          )}
        </Section>

        <Section>
          <Toggle label="流式输出" isOn={stream} onIsOnChange={setStream} />
        </Section>
      </Form>
      <Toolbar.Content>
        <ToolbarItem placement="topBarLeading">
          <Button
            label="取消"
            onPress={onCancel}
            modifiers={[buttonStyle("plain")]}
          />
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing">
          <Button
            label="保存"
            onPress={() => onSave(next)}
            modifiers={[buttonStyle("plain"), disabled(!canSave)]}
          />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}