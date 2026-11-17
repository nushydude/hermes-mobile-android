import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme";

export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export const ui = StyleSheet.create({
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.raised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondary: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 0,
    borderRadius: 22,
    padding: 15,
    gap: 9,
  },
});
