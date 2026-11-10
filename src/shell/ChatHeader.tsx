import { memo } from "react";
import { Button } from "@expo/ui/swift-ui";
import { exit } from "@swipt/api/swiplet";

import { GlassButton, GlassChipMenu, GlassMenu } from "./GlassControls.tsx";
import { GlassToolbar } from "./GlassToolbar.tsx";

/**
 * Chat toolbar: 返回 Swipt, 智能体 chip, 新增会话, 更多.
 *
 * Every icon control comes from `GlassControls`, so all of them are the same
 * 40pt circle — the size is pinned there, not derived from the SF Symbol, which
 * is what made 更多 (`ellipsis`, wide) look bigger than its neighbours before.
 *
 * 更多 is a real SwiftUI `Menu`: iOS presents it as its own liquid-glass
 * popover with the system's animation, not the React Native dropdown.
 *
 * `memo` is load-bearing. The chat screen re-renders on every streamed token;
 * before this, the header's props were recreated each time, so the `Host`
 * rebuilt its SwiftUI tree dozens of times a second and any tap that started
 * between two rebuilds was cancelled — which is why buttons felt like they
 * needed a long press. With stable props the native subtree is left alone.
 */
export const ChatHeader = memo(function ChatHeader({
  agentId,
  agents,
  onSelectAgent,
  onNewAgent,
  onNewChat,
  onOpenSessions,
  onOpenSettings,
}: {
  agentId: string;
  agents: { id: string; title: string }[];
  onSelectAgent: (id: string) => void;
  onNewAgent: () => void;
  onNewChat: () => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
}) {
  const agentName = agents.find((agent) => agent.id === agentId)?.title ?? "智能体";

  return (
    <GlassToolbar
      leading={[
        <GlassButton
          key="back"
          systemImage="chevron.left"
          label="返回 Swipt"
          onPress={() => exit()}
        />,
        <GlassChipMenu key="agent" label={agentName} systemImage="person.crop.circle.fill">
          {agents.map((agent) => (
            <Button
              key={agent.id}
              label={agent.title}
              systemImage={agent.id === agentId ? "checkmark" : undefined}
              onPress={() => onSelectAgent(agent.id)}
            />
          ))}
          <Button label="新建智能体" systemImage="plus" onPress={onNewAgent} />
        </GlassChipMenu>,
      ]}
      trailing={[
        <GlassButton
          key="new"
          systemImage="square.and.pencil"
          label="新增会话"
          onPress={onNewChat}
        />,
        <GlassMenu key="more" systemImage="ellipsis" label="更多">
          <Button label="会话列表" systemImage="list.bullet" onPress={onOpenSessions} />
          <Button label="设置" systemImage="gearshape" onPress={onOpenSettings} />
        </GlassMenu>,
      ]}
    />
  );
});