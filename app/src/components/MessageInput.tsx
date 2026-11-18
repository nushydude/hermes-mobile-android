import { useState } from "react";
import { TextInput, useWindowDimensions } from "react-native";
import { colors } from "../theme";
import { useRenderCounter } from "../state/conversationDiagnostics";

/** A compact draft that grows with its contents, then scrolls for longer edits. */
export function MessageInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  useRenderCounter("message_input");
  const [contentHeight, setContentHeight] = useState(48);
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const lineHeight = 22 * fontScale;
  const maxHeight = Math.max(48, Math.min(lineHeight * 6 + 20, windowHeight * 0.3));
  const height = value ? Math.max(48, Math.min(contentHeight, maxHeight)) : 48;

  return (
    <TextInput
      accessibilityLabel="Message"
      multiline
      submitBehavior="newline"
      value={value}
      onChangeText={onChangeText}
      onContentSizeChange={({ nativeEvent }) =>
        setContentHeight(Math.ceil(nativeEvent.contentSize.height))
      }
      placeholder="Message Hermes…"
      placeholderTextColor={colors.muted}
      underlineColorAndroid="transparent"
      style={{
        flex: 1,
        minWidth: 0,
        height,
        paddingHorizontal: 4,
        paddingVertical: 12,
        color: colors.text,
        fontSize: 16,
        lineHeight: 22,
        textAlignVertical: "top",
      }}
    />
  );
}
