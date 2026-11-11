import { useState } from "react";
import {
  Button,
  Form,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  keyboardType,
  navigationBarTitleDisplayMode,
  navigationTitle,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";

import {
  PROTOCOL_LABEL,
  baseURLError,
  protocolFooter,
  protocolPlaceholder,
  type ModelProvider,
  type ModelProviderTemplate,
  type Protocol,
} from "../domain/provider.ts";
import { SheetShell } from "./SheetShell.tsx";

/**
 * The one creation flow: pick a template, then fill this form. Built-in
 * templates lock the protocol and require a key; 自定义 exposes the protocol
 * picker and lets the key stay empty.
 */
export function ProviderSheet({
  visible,
  template,
  onClose,
  onCreate,
}: {
  visible: boolean;
  template: ModelProviderTemplate | null;
  onClose: () => void;
  onCreate: (draft: Omit<ModelProvider, "id">) => void;
}) {
  return (
    <SheetShell visible={visible} onClose={onClose}>
      {template === null ? null : (
        <CreateForm
          key={template.id}
          template={template}
          onCancel={onClose}
          onCreate={onCreate}
        />
      )}
    </SheetShell>
  );
}

function CreateForm({
  template,
  onCancel,
  onCreate,
}: {
  template: ModelProviderTemplate;
  onCancel: () => void;
  onCreate: (draft: Omit<ModelProvider, "id">) => void;
}) {
  const custom = template.custom;

  const [name, setName] = useState(template.defaultName);
  const [key, setKey] = useState("");
  const [baseURL, setBaseURL] = useState(template.baseURL);
  const [protocol, setProtocol] = useState<Protocol>(template.protocol);

  const nameText = useNativeState(template.defaultName);
  const keyText = useNativeState("");
  const baseText = useNativeState(template.baseURL);

  const urlError = baseURLError(baseURL);
  const ready =
    name.trim() !== "" &&
    urlError === null &&
    (custom || key.trim() !== "");

  return (
    <Toolbar>
      <Form
        modifiers={[
          navigationTitle(custom ? "新建自定义连接" : `新建 ${template.name} 连接`),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section>
          <TextField
            text={nameText}
            placeholder={custom ? "例如：我的中转站" : template.name}
            onTextChange={setName}
          />
          <SecureField
            text={keyText}
            placeholder={custom ? "API Key（可稍后填写）" : "API Key"}
            onTextChange={setKey}
            modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
          />
          {custom ? (
            <Picker
              label="协议"
              selection={protocol}
              onSelectionChange={(next) => setProtocol(next as Protocol)}
            >
              {template.protocols.map((value) => (
                <Text key={value} modifiers={[tag(value)]}>
                  {PROTOCOL_LABEL[value]}
                </Text>
              ))}
            </Picker>
          ) : null}
          <TextField
            text={baseText}
            placeholder={protocolPlaceholder(protocol)}
            onTextChange={setBaseURL}
            modifiers={[
              keyboardType("url"),
              textInputAutocapitalization("never"),
              autocorrectionDisabled(),
            ]}
          />
        </Section>
        <Section
          footer={
            <Text modifiers={[font({ size: 12 }), foregroundStyle("#8a8a8e")]}>
              {urlError ??
                (custom
                  ? protocolFooter(protocol)
                  : `仅用于 ${template.name} 官方 API Key，可修改 Base URL 走代理。`)}
            </Text>
          }
        >
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#8a8a8e")]}>
            {custom ? "第三方兼容端点一律建在自定义组。" : "创建后可在详情页补模型。"}
          </Text>
        </Section>
      </Form>
      <Toolbar.Content>
        <ToolbarItem placement="topBarLeading">
          <Button label="取消" onPress={onCancel} modifiers={[buttonStyle("plain")]} />
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing">
          <Button
            label="创建"
            modifiers={[buttonStyle("plain"), disabled(!ready)]}
            onPress={() => {
              if (!ready) {
                return;
              }
              onCreate({
                templateId: template.id,
                name: name.trim(),
                protocol,
                baseURL: baseURL.trim(),
                apiKey: key.trim(),
                stream: true,
                headers: [],
              });
            }}
          />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}