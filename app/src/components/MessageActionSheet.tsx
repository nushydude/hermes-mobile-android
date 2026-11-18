import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Alert, Pressable, Share, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Sheet } from "./Sheet";
import { colors } from "../theme";
import { ui } from "./UI";
import { actionHaptic } from "./haptics";

export type MessageActionTarget = { content: string; canRead: boolean };
export function MessageActionSheet({
  target,
  onClose,
  onQuote,
  onRead,
  isCurrent,
}: {
  target: MessageActionTarget | null;
  onClose: () => void;
  onQuote: (content: string, start: number, end: number) => void;
  onRead: (content: string) => void;
  isCurrent: () => boolean;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    setSelecting(false);
    setSelection({ start: 0, end: 0 });
  }, [target]);
  const content = target?.content ?? "";
  const selected = content.slice(
    Math.min(selection.start, selection.end),
    Math.max(selection.start, selection.end),
  );
  const current = () => !!target && targetRef.current === target && isCurrent();
  const quote = (start: number, end: number) => {
    if (!current()) return;
    onQuote(content, start, end);
    onClose();
  };
  const copy = (value: string) => {
    if (!current() || !value) return;
    void Clipboard.setStringAsync(value)
      .then(() => {
        if (current()) onClose();
      })
      .catch(() => {
        if (current()) Alert.alert("Could not copy", "Please try again.");
      });
  };
  const share = (value: string) => {
    if (!current() || !value) return;
    void Share.share({ message: value })
      .then(() => {
        if (current()) onClose();
      })
      .catch(() => {
        if (current()) Alert.alert("Could not share", "Please try again.");
      });
  };
  const action = (
    label: string,
    icon: ComponentProps<typeof Ionicons>["name"],
    run: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        actionHaptic();
        run();
      }}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={21} color={colors.accent} />
      <Text style={ui.text}>{label}</Text>
    </Pressable>
  );
  return (
    <Sheet visible={!!target} title={selecting ? "Select text" : "Message"} onClose={onClose}>
      {selecting ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}>
          <Text style={ui.muted}>Touch and hold to select the part you want to use.</Text>
          {/* Android disables selection for editable=false; a controlled value keeps the source unchanged. */}
          <TextInput
            accessibilityLabel="Message text to select"
            multiline
            value={content}
            showSoftInputOnFocus={false}
            onChangeText={() => {}}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            style={[ui.input, { minHeight: 100, maxHeight: 280, textAlignVertical: "top" }]}
          />
          {action(
            "Reply about selection",
            "chatbubble-ellipses-outline",
            () => quote(selection.start, selection.end),
            !selected.trim(),
          )}
          {action("Copy selection", "copy-outline", () => copy(selected), !selected.trim())}
          {action(
            "Share selection",
            "share-social-outline",
            () => share(selected),
            !selected.trim(),
          )}
        </View>
      ) : (
        <View style={{ paddingBottom: 20 }}>
          {action(
            "Reply about this",
            "chatbubble-ellipses-outline",
            () => quote(0, content.length),
            !content.trim(),
          )}
          {action("Select text", "text-outline", () => setSelecting(true), !content.trim())}
          {action("Copy", "copy-outline", () => copy(content), !content.trim())}
          {action("Share", "share-social-outline", () => share(content), !content.trim())}
          {target?.canRead &&
            action("Read aloud", "volume-medium-outline", () => {
              if (current()) {
                onClose();
                onRead(content);
              }
            })}
        </View>
      )}
    </Sheet>
  );
}
