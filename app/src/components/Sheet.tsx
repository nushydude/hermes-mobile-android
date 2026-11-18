import React from "react";
import { KeyboardAvoidingView, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../theme";
import { ui } from "./UI";

export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = "Close",
  closeDisabled = false,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const close = () => {
    if (!closeDisabled) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: closeDisabled }}
          disabled={closeDisabled}
          onPress={close}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "#0009",
          }}
        />
        <KeyboardAvoidingView behavior="padding" style={{ maxHeight: "90%" }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: insets.bottom,
              overflow: "hidden",
              flexShrink: 1,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 24,
                paddingRight: 12,
                paddingTop: 8,
              }}
            >
              <Text accessibilityRole="header" style={[ui.heading, { flex: 1, fontSize: 22 }]}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                accessibilityState={{ disabled: closeDisabled }}
                disabled={closeDisabled}
                onPress={close}
                style={{
                  width: 48,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: closeDisabled ? 0.4 : 1,
                }}
              >
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
