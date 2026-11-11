import { useEffect, useState } from "react";
import {
  Button,
  Form,
  Section,
  TextField,
  Toolbar,
  ToolbarItem,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  disabled,
  navigationBarTitleDisplayMode,
  navigationTitle,
} from "@expo/ui/swift-ui/modifiers";

import { SheetShell } from "./SheetShell.tsx";

/** 手动添加模型: only the id and the display name; parameters live on the detail page. */
export function ModelSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (id: string, displayName: string) => void;
}) {
  return (
    <SheetShell visible={visible} onClose={onClose}>
      <CreateModelForm visible={visible} onCancel={onClose} onCreate={onCreate} />
    </SheetShell>
  );
}

function CreateModelForm({
  visible,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  onCancel: () => void;
  onCreate: (id: string, displayName: string) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const idText = useNativeState("");
  const nameText = useNativeState("");

  useEffect(() => {
    if (!visible) {
      return;
    }
    setId("");
    setName("");
    idText.set("");
    nameText.set("");
  }, [visible, idText, nameText]);

  const ready = id.trim() !== "";

  return (
    <Toolbar>
      <Form
        modifiers={[
          navigationTitle("新建模型"),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section footer="模型 ID 创建后不可变；需要更换请删除后重新添加。">
          <TextField
            text={idText}
            placeholder="模型 ID，例如 gpt-4o-mini"
            onTextChange={(next) => {
              setId(next);
              if (name === "") {
                setName(next);
                nameText.set(next);
              }
            }}
            modifiers={[autocorrectionDisabled()]}
          />
          <TextField
            text={nameText}
            placeholder="显示名称"
            onTextChange={setName}
          />
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
              onCreate(id.trim(), name.trim() === "" ? id.trim() : name.trim());
              onCancel();
            }}
          />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}