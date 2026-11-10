import { View } from "react-native";
import {
  BottomSheet,
  Button,
  HStack,
  Host,
  Image,
  List,
  NavigationStack,
  Rectangle,
  Section,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationCornerRadius,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  shapes,
} from "@expo/ui/swift-ui/modifiers";

import { useTheme } from "../theme/index.tsx";

export type AgentRow = { id: string; title: string };

/**
 * The agent selector, as a real iOS sheet.
 *
 * v24 replaced the popover `Menu` with this: the menu was the only "dropdown"
 * left in the app after the session list became a bottom sheet, and its capsule
 * anchor also made the toolbar hard to align. Tapping a row selects that agent
 * and dismisses, so there is no second confirm step.
 *
 * "新建智能体" is deliberately absent — agents are managed in 设置 → 智能体. The
 * chat header is for choosing, not for editing.
 */
export function AgentPickerSheet({
  visible,
  agents,
  currentId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  agents: AgentRow[];
  currentId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();

  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <Host style={styles.host}>
        <BottomSheet
          isPresented={visible}
          onIsPresentedChange={(next) => {
            if (!next) {
              onClose();
            }
          }}
          presentationBackground={
            <Rectangle
              modifiers={[
                background({ type: "material", material: "ultraThin" }),
                foregroundStyle("#FFFFFF66"),
              ]}
            />
          }
        >
          <NavigationStack
            modifiers={[
              presentationDetents([{ fraction: 0.5 }, "large"]),
              presentationDragIndicator("visible"),
              presentationCornerRadius(28),
            ]}
          >
            <List
              modifiers={[
                listStyle("plain"),
                scrollContentBackground("hidden"),
                navigationTitle("智能体"),
                navigationBarTitleDisplayMode("inline"),
              ]}
            >
              <Section>
                {agents.map((agent) => (
                  <Button
                    key={agent.id}
                    onPress={() => onSelect(agent.id)}
                    modifiers={[
                      buttonStyle("plain"),
                      contentShape(shapes.rectangle()),
                    ]}
                  >
                    <HStack spacing={10}>
                      <Image
                        systemName="person.crop.circle.fill"
                        size={18}
                        color={colors["muted-foreground"]}
                      />
                      <Text
                        modifiers={[
                          font({
                            size: 16,
                            weight:
                              agent.id === currentId ? "semibold" : "regular",
                          }),
                          frame({ maxWidth: 10000, alignment: "leading" }),
                        ]}
                      >
                        {agent.title}
                      </Text>
                      <Spacer />
                      {agent.id === currentId ? (
                        <Image
                          systemName="checkmark"
                          size={15}
                          color={colors.primary}
                        />
                      ) : null}
                    </HStack>
                  </Button>
                ))}
              </Section>
            </List>
          </NavigationStack>
        </BottomSheet>
      </Host>
    </View>
  );
}

const styles = {
  anchor: {
    position: "absolute" as const,
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
  },
  host: { width: 1, height: 1 },
};