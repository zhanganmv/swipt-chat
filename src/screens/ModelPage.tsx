import { useState } from "react";
import {
  Form,
  Picker,
  Section,
  Slider,
  Text,
  TextField,
  Toggle,
  Toolbar,
  VStack,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  keyboardType,
  navigationBarTitleDisplayMode,
  navigationTitle,
  tag,
} from "@expo/ui/swift-ui/modifiers";

import {
  PROTOCOL_LABEL,
  thinkingError,
  type Instance,
  type ModelConfig,
  type ThinkingEffort,
} from "../domain/service.ts";
import { useTheme } from "../theme/index.tsx";
import { FieldError, Footer, Muted } from "./parts.tsx";

const EFFORTS: ThinkingEffort[] = ["low", "medium", "high"];

/**
 * 模型详情. Every edit saves immediately, like the rest of settings; there is no
 * 保存 button and no "unsaved changes" prompt to dismiss.
 *
 * The fields shown depend on the instance protocol: budget tokens only exist
 * for Anthropic, and temperature is capped at 1 there.
 */
export function ModelPage({
  instance,
  model,
  onChange,
}: {
  instance: Instance;
  model: ModelConfig;
  onChange: (model: ModelConfig) => void;
}) {
  const { colors } = useTheme();
  const anthropic = instance.protocol === "anthropic-messages";

  const [displayName, setDisplayName] = useState(model.displayName);
  const [note, setNote] = useState(model.note);
  const [budget, setBudget] = useState(model.thinking.budget === null ? "" : String(model.thinking.budget));
  const [maxOutput, setMaxOutput] = useState(
    model.maxOutputTokens === null ? "" : String(model.maxOutputTokens),
  );
  const [contextWindow, setContextWindow] = useState(
    model.contextWindow === null ? "" : String(model.contextWindow),
  );

  const nameText = useNativeState(model.displayName);
  const noteText = useNativeState(model.note);
  const budgetText = useNativeState(budget);
  const maxOutputText = useNativeState(maxOutput);
  const contextText = useNativeState(contextWindow);

  const patch = (next: Partial<ModelConfig>) => onChange({ ...model, ...next });
  const budgetError = thinkingError(
    instance.protocol,
    model.thinking,
    model.maxOutputTokens,
  );

  return (
    <Toolbar>
      <Form
        modifiers={[
          navigationTitle(model.displayName),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section
          title="基础"
          footer={<Footer text="如需更换模型 ID，请删除后重新添加。" />}
        >
          <Text
            modifiers={[font({ size: 15 }), foregroundStyle(colors["muted-foreground"])]}
          >
            {model.id}
          </Text>
          <TextField text={nameText} placeholder="显示名称" onTextChange={setDisplayName} />
          <TextField text={noteText} placeholder="备注（可选）" onTextChange={setNote} />
          <Text modifiers={[font({ size: 12 }), foregroundStyle("#8a8a8e")]}>
            协议：{PROTOCOL_LABEL[instance.protocol]}
          </Text>
        </Section>

        <Section
          title="容量"
          footer={<Footer text="空值表示使用提供商默认值。" />}
        >
          <TextField
            text={maxOutputText}
            placeholder={anthropic ? "最大输出 token（Anthropic 必填）" : "最大输出 token"}
            onTextChange={(next) => {
              setMaxOutput(next);
              patch({ maxOutputTokens: positive(next) });
            }}
            modifiers={[keyboardType("numeric")]}
          />
          <TextField
            text={contextText}
            placeholder="上下文窗口（本地提示用）"
            onTextChange={(next) => {
              setContextWindow(next);
              patch({ contextWindow: positive(next) });
            }}
            modifiers={[keyboardType("numeric")]}
          />
        </Section>

        <Section
          title="思考 / 推理"
          footer={
            <Footer
              text={
                anthropic
                  ? "扩展思考要求 budget_tokens ≥ 1024 且小于最大输出 token；开启时 temperature 将被强制为 1，top_p 不生效。"
                  : "具体支持的档位以提供商与模型为准；不支持时请求可能被拒绝或忽略。"
              }
            />
          }
        >
          <Toggle
            label="思考"
            isOn={model.thinking.enabled}
            onIsOnChange={(enabled) =>
              patch({ thinking: { ...model.thinking, enabled } })
            }
          />
          {model.thinking.enabled ? (
            anthropic ? (
              <TextField
                text={budgetText}
                placeholder="思考预算 budget_tokens"
                onTextChange={(next) => {
                  setBudget(next);
                  patch({
                    thinking: { ...model.thinking, budget: positive(next) },
                  });
                }}
                modifiers={[keyboardType("numeric")]}
              />
            ) : (
              <Picker
                label="推理强度"
                selection={model.thinking.effort}
                onSelectionChange={(next) =>
                  patch({ thinking: { ...model.thinking, effort: next as ThinkingEffort } })
                }
              >
                {EFFORTS.map((value) => (
                  <Text key={value} modifiers={[tag(value)]}>
                    {value}
                  </Text>
                ))}
              </Picker>
            )
          ) : null}
          {model.thinking.enabled && anthropic && budgetError !== null ? (
            <FieldError text={budgetError} />
          ) : null}
        </Section>

        <Section
          title="采样"
          footer={
            <Footer
              text={
                model.thinking.enabled
                  ? "推理模型通常要求 temperature=1；这里保留你的值，仅提示。"
                  : anthropic
                    ? "Anthropic 的 temperature 上限为 1，通常与 Top P 二选一。"
                    : "通常与 Temperature 二选一；空值表示不发送该参数。"
              }
            />
          }
        >
          <SamplingRow
            title="Temperature"
            value={model.temperature}
            min={0}
            max={anthropic ? 1 : 2}
            disabled={false}
            onChange={(temperature) => patch({ temperature })}
          />
          <SamplingRow
            title="Top P"
            value={model.topP}
            min={0}
            max={1}
            disabled={anthropic && model.thinking.enabled}
            onChange={(topP) => patch({ topP })}
          />
        </Section>

        <Section title="输入模态">
          <Muted text="文本（始终启用）" />
          <Toggle
            label="图像"
            isOn={model.image}
            onIsOnChange={(image) => patch({ image })}
          />
          <Text modifiers={[font({ size: 12 }), foregroundStyle("#8a8a8e")]}>
            ID: {model.id}
          </Text>
        </Section>
      </Form>
    </Toolbar>
  );
}

function SamplingRow({
  title,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  title: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <VStack alignment="leading" spacing={4}>
      <Toggle
        label={title}
        isOn={value !== null}
        onIsOnChange={(on) => onChange(on ? Math.min(1, max) : null)}
      />
      {value === null ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(colors["muted-foreground"])]}>
          使用默认
        </Text>
      ) : (
        <>
          <Slider
            value={disabled ? 0 : value}
            min={min}
            max={max}
            step={0.1}
            onValueChange={(next) => {
              if (!disabled) {
                onChange(Math.round(next * 10) / 10);
              }
            }}
          />
          <Text modifiers={[font({ size: 13 }), foregroundStyle(colors["muted-foreground"])]}>
            {value.toFixed(1)}
            {disabled ? "（思考开启时按协议不发送）" : ""}
          </Text>
        </>
      )}
    </VStack>
  );
}

/** "" → null, otherwise the integer if it is positive. */
function positive(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
