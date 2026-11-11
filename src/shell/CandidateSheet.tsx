import { useEffect, useState } from "react";
import {
  Button,
  Form,
  Section,
  TextField,
  Text,
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
  navigationBarTitleDisplayMode,
  navigationTitle,
  textInputAutocapitalization,
  autocorrectionDisabled,
} from "@expo/ui/swift-ui/modifiers";

import { SheetShell } from "./SheetShell.tsx";
import { Footer, Muted } from "../screens/parts.tsx";

/**
 * The candidate panel: a fetched catalogue is only ever a *selection*. Nothing
 * is added until 添加所选, and models already configured are shown as 已添加 so
 * the list and the instance still agree.
 */
export function CandidateSheet({
  visible,
  candidates,
  existing,
  onClose,
  onAdd,
}: {
  visible: boolean;
  candidates: readonly string[];
  existing: readonly string[];
  onClose: () => void;
  onAdd: (ids: readonly string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const queryText = useNativeState("");

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelected([]);
      // `useNativeState` exposes only `value` / `get` / `set` / `onChange`;
      // a `clear()` here throws inside the sheet's mount effect and the host
      // tears the whole screen down with "undefined is not a function".
      queryText.set("");
    }
  }, [visible]);

  const have = new Set(existing);
  const needle = query.trim().toLowerCase();
  const rows = candidates.filter(
    (id) => !have.has(id) && (needle === "" || id.toLowerCase().includes(needle)),
  );
  const allSelected = rows.length > 0 && rows.every((id) => selected.includes(id));

  return (
    <SheetShell visible={visible} onClose={onClose}>
      <Toolbar>
        <Form
          modifiers={[
            navigationTitle("选择模型"),
            navigationBarTitleDisplayMode("inline"),
          ]}
        >
          <Section
            footer={
              <Footer text="拉取结果只作为候选，不会自动新增、删除或重排已有模型。" />
            }
          >
            <TextField
              text={queryText}
              placeholder="搜索模型 ID"
              onTextChange={setQuery}
              modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
            />
          </Section>
          <Section
            header={
              <Button
                label={allSelected ? "取消全选" : "全选"}
                modifiers={[buttonStyle("plain")]}
                onPress={() =>
                  setSelected(allSelected ? [] : rows.map((id) => id))
                }
              />
            }
          >
            {rows.length === 0 ? (
              <Muted text={candidates.length === 0 ? "该地址未返回可用模型。" : "没有匹配的模型。"} />
            ) : (
              rows.map((id) => (
                <Toggle
                  key={id}
                  label={id}
                  isOn={selected.includes(id)}
                  onIsOnChange={(on) =>
                    setSelected(
                      on
                        ? [...selected, id]
                        : selected.filter((item) => item !== id),
                    )
                  }
                />
              ))
            )}
          </Section>
          {existing.length === 0 ? null : (
            <Section>
              <Text
                modifiers={[
                  font({ size: 13 }),
                  foregroundStyle("#8a8a8e"),
                ]}
              >
                已添加 {existing.length} 个模型（不在此列表中重复显示）
              </Text>
            </Section>
          )}
        </Form>
        <Toolbar.Content>
          <ToolbarItem placement="topBarLeading">
            <Button label="取消" onPress={onClose} modifiers={[buttonStyle("plain")]} />
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button
              label="添加所选"
              modifiers={[buttonStyle("plain"), disabled(selected.length === 0)]}
              onPress={() => {
                onAdd(selected);
                onClose();
              }}
            />
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </SheetShell>
  );
}