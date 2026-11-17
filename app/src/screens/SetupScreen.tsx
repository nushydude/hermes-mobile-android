import { useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { appManager } from "../state";
import { colors } from "../theme";
import { Button, Card, ui } from "../components/UI";

export function SetupScreen({
  onDone,
  onCancel,
}: {
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const scanLocked = useRef(false);
  const busyRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  async function configure(url: string, secret: string) {
    if (busyRef.current) return;
    if (!url.startsWith("https://") || !secret) {
      Alert.alert(
        "Check connection details",
        "Enter an HTTPS address and a token, or scan the setup QR code.",
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await appManager.configure({ baseUrl: url.trim(), token: secret });
      setToken("");
      onDone?.();
    } catch (e) {
      Alert.alert(
        "Connection failed",
        e instanceof Error
          ? e.message
          : "Check Tailscale and that the PC is awake.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function scan() {
    if (busyRef.current) return;
    const result = permission?.granted ? permission : await requestPermission();
    if (result?.granted) {
      scanLocked.current = false;
      setScanning(true);
    } else
      Alert.alert(
        "Camera permission needed",
        "Allow camera access to scan the setup code.",
      );
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          gap: 20,
          flexGrow: 1,
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.label}>HERMES MOBILE</Text>
        <Text style={ui.heading}>Bring your sessions with you.</Text>
        <Text style={[ui.text, { color: colors.muted, lineHeight: 23 }]}>
          Connect securely to your Hermes gateway over Tailscale. Scan the setup
          code from your PC to get started.
        </Text>
        {scanning ? (
          <Card>
            <CameraView
              style={{ height: 270, borderRadius: 12, overflow: "hidden" }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scanLocked.current) return;
                scanLocked.current = true;
                setScanning(false);
                try {
                  const value = JSON.parse(data);
                  if (
                    value.version !== 1 ||
                    typeof value.baseUrl !== "string" ||
                    typeof value.token !== "string"
                  )
                    throw new Error();
                  void configure(value.baseUrl, value.token);
                } catch {
                  Alert.alert(
                    "Invalid setup code",
                    "Scan a Hermes Mobile version 1 setup code.",
                  );
                }
              }}
            />
            <Button
              label="Cancel scan"
              secondary
              onPress={() => setScanning(false)}
            />
          </Card>
        ) : (
          <Button
            label={busy ? "Connecting…" : "Scan setup QR code"}
            disabled={busy}
            onPress={() => void scan()}
          />
        )}
        <Card>
          <Text style={[ui.text, { fontWeight: "700" }]}>
            Or enter details manually
          </Text>
          <TextInput
            editable={!busy}
            accessibilityLabel="Gateway HTTPS address"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://your-pc:9120"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={ui.input}
          />
          <TextInput
            editable={!busy}
            accessibilityLabel="Gateway token"
            value={token}
            onChangeText={setToken}
            placeholder="Token"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={ui.input}
          />
          <Button
            label="Test connection"
            secondary
            disabled={busy}
            onPress={() => void configure(baseUrl, token)}
          />
        </Card>
        {onCancel && (
          <Button label="Back to sessions" secondary disabled={busy} onPress={onCancel} />
        )}
        <Text style={ui.muted}>
          Your token is stored securely on this device.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
