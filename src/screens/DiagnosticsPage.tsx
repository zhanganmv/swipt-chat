import { memo, useState } from "react";
import {
  Button,
  List,
  Section,
  Text,
  Toolbar,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
} from "@expo/ui/swift-ui/modifiers";

import { logLines } from "../log.ts";
import { useTheme } from "../theme/index.tsx";
import { Footer, Muted } from "./parts.tsx";

/**
 * A read-only window onto the in-memory log.
 *
 * This exists because the debug file needs the file-system bridge, and a build
 * that breaks networking may break that too; the buffer cannot be lost that
 * way. It also carries a network self-test so "no network at all" and "wrong
 * Base URL" can be told apart in one tap.
 */
export const DiagnosticsPage = memo(function DiagnosticsPage({
  onSelfTest,
}: {
  onSelfTest: () => Promise<string>;
}) {
  const { colors } = useTheme();
  const [lines, setLines] = useState<readonly string[]>(() => logLines());
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      setResult(await onSelfTest());
    } finally {
      setBusy(false);
      setLines(logLines());
    }
  };

  return (
    <Toolbar>
      <List
        modifiers={[
          listStyle("insetGrouped"),
          navigationTitle("诊断日志"),
          navigationBarTitleDisplayMode("inline"),
        ]}
      >
        <Section
          title="网络自检"
          footer={
            <Footer text="向 api.openai.com 发一个不带有效 Key 的请求：只要拿到 HTTP 状态码，就说明宿主的网络通道是通的。" />
          }
        >
          <Button
            label={busy ? "测试中…" : "测试网络"}
            modifiers={[buttonStyle("plain"), disabled(busy)]}
            onPress={test}
          />
          {result === null ? null : (
            <Text modifiers={[font({ size: 13 })]}>{result}</Text>
          )}
        </Section>

        <Section
          title="最近日志"
          footer={<Footer text={`共 ${lines.length} 行，内存里最多保留 200 行`} />}
        >
          <Button
            label="刷新"
            modifiers={[buttonStyle("plain")]}
            onPress={() => setLines(logLines())}
          />
          {lines.length === 0 ? (
            <Muted text="还没有日志" />
          ) : (
            lines
              .slice(-80)
              .reverse()
              .map((line, index) => (
                <Text
                  key={`${String(index)}-${line}`}
                  modifiers={[
                    font({ size: 12 }),
                    foregroundStyle(colors["muted-foreground"]),
                  ]}
                >
                  {line}
                </Text>
              ))
          )}
        </Section>
      </List>
    </Toolbar>
  );
});
