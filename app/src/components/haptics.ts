import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
export function actionHaptic() {
  try {
    const result =
      Platform.OS === "android"
        ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
        : Haptics.selectionAsync();
    void result.catch(() => {});
  } catch {
    /* Haptics must never prevent an action. */
  }
}
