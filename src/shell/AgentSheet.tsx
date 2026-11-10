import { useState } from "react";
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
  buttonStyle,
  disabled,
  navigationBarTitleDisplayMode,
  navigationTitle,
} from "@expo/ui/swift-ui/modifiers";

import { SheetShell } from "./SheetShell.tsx";

/** 智能体 form; a name is the whole record for now (P1 adds prompt/tools). */
export function AgentSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  return (
    <SheetShell visible={visible} onClose={onClose}>
      <AgentForm onCancel={onClose} onSave={onSave} />
    </SheetShell>
  );
}

function AgentForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const titleText = useNativeState("");

  return (
    <Toolbar>
      <Form
        modifiers={[
          navigationTitle("新建智能体"),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section>
          <TextField
            text={titleText}
            placeholder="名称"
            onTextChange={setTitle}
          />
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
            onPress={() => onSave(title.trim())}
            modifiers={[buttonStyle("plain"), disabled(title.trim() === "")]}
          />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}