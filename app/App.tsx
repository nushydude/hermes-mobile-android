import { useEffect, useState } from "react";
import { Modal, Text, TextInput, View } from "react-native";
import { Button, Card, ui } from "./src/components/UI";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { appManager, useAppStore } from "./src/state";
import { colors } from "./src/theme";
import { SetupScreen } from "./src/screens/SetupScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { setupNotifications } from "./src/notifications";
import { startConnectionGrace } from "./src/components/useConnectionGrace";
import { ChatScreen } from "./src/screens/ChatScreen";
import { IncomingShareSheet } from "./src/sharing/IncomingShareSheet";
export default function App() {
  const state = useAppStore(s => ({credentialsConfigured:s.credentialsConfigured,activeSessionId:s.activeSessionId,secureRequest:s.secureRequest}));
  const [secure, setSecure] = useState<{request: typeof state.secureRequest; value: string}>({request:null, value:""});
  const [setup, setSetup] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  useEffect(() => { startConnectionGrace(); }, []);
  useEffect(() => setupNotifications(), []);
  useEffect(() => {
    setSecure(current => current.request === state.secureRequest ? current : {request:state.secureRequest, value:""});
  }, [state.secureRequest]);
  useEffect(() => {
    void appManager
      .initialize()
      .catch(() =>
        setInitError(
          "Unable to open local storage. Restart the app and try again.",
        ),
      );
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {initError ? (
          <View style={{ padding: 24, gap: 12 }}>
            <Text style={ui.heading}>Could not start</Text>
            <Text style={ui.text}>{initError}</Text>
          </View>
        ) : !state.credentialsConfigured || setup ? (
          <SetupScreen
            onDone={() => setSetup(false)}
            onCancel={
              state.credentialsConfigured ? () => setSetup(false) : undefined
            }
          />
        ) : state.activeSessionId ? (
          <ChatScreen />
        ) : (
          <HomeScreen onSetup={() => setSetup(true)} />
        )}
        <IncomingShareSheet enabled={state.credentialsConfigured && !setup && !state.secureRequest} />
        <Modal
          visible={!!state.secureRequest}
          transparent
          animationType="slide"
          onRequestClose={() => { if (state.secureRequest) appManager.cancelSecret(state.secureRequest); }}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 24,
              backgroundColor: "#000b",
            }}
          >
            <Card>
              <Text style={[ui.text, { fontWeight: "700" }]}>
                {state.secureRequest?.method === "sudo"
                  ? "Password required"
                  : "Secret required"}
              </Text>
              <Text style={ui.muted}>Enter the requested value securely.</Text>
              <TextInput
                accessibilityLabel="Secure value"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                value={secure.request === state.secureRequest ? secure.value : ""}
                onChangeText={(value) => { if (state.secureRequest && appManager.getState().secureRequest === state.secureRequest) setSecure({request:state.secureRequest, value}); }}
                style={ui.input}
              />
              <Button label="Cancel" onPress={() => { if (state.secureRequest) appManager.cancelSecret(state.secureRequest); }} />
              <Button
                label="Submit"
                onPress={() => {
                  if (state.secureRequest) appManager.answerSecret(state.secureRequest, secure.request === state.secureRequest ? secure.value : "");
                }}
              />
            </Card>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
