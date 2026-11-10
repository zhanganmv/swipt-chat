import { useState } from "react";
import {
  Button,
  Form,
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
  onClose,
  onSave,
}: {
  visible: boolean;
  provider: Provider | null;
  onClose: () => void;
  onSave: (next: Provider) => void;
}) {
  return (
    <SheetShell visible={visible} onClose={onClose}>
      <ProviderForm
        key={provider?.id ?? "new"}
        provider={provider}
        onCancel={onClose}
        onSave={onSave}
      />
    </SheetShell>
  );
}

function ProviderForm({
  provider,
  onCancel,
  onSave,
}: {
  provider: Provider | null;
  onCancel: () => void;
  onSave: (next: Provider) => void;
}) {
  const { colors } = useTheme();

  const [name, setName] = useState(provider?.name ?? "");
  const [baseURL, setBaseURL] = useState(provider?.baseURL ?? "");
  const [model, setModel] = useState(provider?.model ?? "");
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? "");
  const [stream, setStream] = useState(provider?.stream !== false);

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
            text={modelText}
            placeholder="模型名"
            onTextChange={setModel}
          />
          <TextField
            text={apiKeyText}
            placeholder="API Key"
            onTextChange={setApiKey}
          />
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