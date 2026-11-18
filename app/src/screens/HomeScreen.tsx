import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  FlatList,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { appManager, useAppStore, type SessionRow } from "../state";
import { colors } from "../theme";
import { Button, Card, ui } from "../components/UI";
import {
  setShowActivity,
  useShowActivity,
  setMonitorMode,
  useMonitorMode,
  useSpeakReplies,
  setSpeakReplies,
} from "../preferences";
import {
  requestNotificationPermission,
  getNotificationPermission,
  openNotificationSettings,
  getMonitorStatus,
  subscribeMonitorStatus,
} from "../notifications";
import {
  notificationPermissionState,
  type PermissionState,
} from "../components/notificationPermission";
import { Sheet } from "../components/Sheet";
import { VoiceEntryTransaction } from "../components/voiceEntryTransaction";
import { actionHaptic } from "../components/haptics";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { conversationDiagnostics } from "../state/conversationDiagnostics";
import { ModelPicker, type LoadState } from "../components/ModelPicker";
import { monitorStatusText } from "../components/monitorStatus";
import {
  mobileModelChoices,
  recentWorkspaces,
  filterWorkspaces,
  workspaceName,
  type ModelChoice,
} from "../components/selections";
import {
  chatAttentionKey,
  chatDraftKey,
  filterSessions,
  sessionFlags,
  type SessionFilter,
} from "../components/sessionFilters";
import { useConnectionGrace } from "../components/useConnectionGrace";
import Ionicons from "@expo/vector-icons/Ionicons";
import { connectionMessage, showHomeError } from "../components/status";

function age(value: unknown) {
  if (!value) return "";
  const date = new Date(
    typeof value === "number" && value < 1e12 ? value * 1000 : (value as string | number),
  );
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}
export function HomeScreen({ onSetup }: { onSetup: () => void }) {
  const state = useAppStore((s) => ({
    sessions: s.sessions,
    drafts: s.drafts,
    outbox: s.outbox,
    queuedEdits: s.queuedEdits,
    connection: s.connection,
    error: s.error,
    historyTruncated: s.historyTruncated,
  }));
  const attentionKey = useAppStore((s) => chatAttentionKey(s.chats));
  const draftImageKey = useAppStore((s) => chatDraftKey(s.chats));
  const connectionGrace = useConnectionGrace();
  const showActivity = useShowActivity();
  const speakReplies = useSpeakReplies();
  const [timingEnabled, setTimingEnabled] = useState(() => conversationDiagnostics.isEnabled());
  const monitorMode = useMonitorMode();
  const monitorState = useSyncExternalStore(
    subscribeMonitorStatus,
    getMonitorStatus,
    getMonitorStatus,
  );
  const [settings, setSettings] = useState(false);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  useEffect(() => {
    if (!settings) return;
    setTimingEnabled(conversationDiagnostics.isEnabled());
    let live = true;
    const refresh = () => {
      void getNotificationPermission()
        .then((result) => {
          if (live) setPermission(notificationPermissionState(result.authorizationStatus));
        })
        .catch(() => {
          if (live) setPermission(null);
        });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, [settings]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [found, setFound] = useState<SessionRow[] | null>(null);
  const lookupGeneration = useRef(0);
  const foundEpoch = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createPanel, setCreatePanel] = useState<"main" | "workspace" | "model">("main");
  const [workspace, setWorkspace] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelChoice[]>([]);
  const [modelDefault, setModelDefault] = useState("");
  const [modelLoad, setModelLoad] = useState<LoadState>("loading");
  const [modelRetry, setModelRetry] = useState(0);
  const [createBusy, setCreateBusy] = useState(false);
  const createFlight = useRef<object | null>(null);
  const createUncertain = useRef(false);
  const createScope = useRef<number | null>(null);
  const endpointEpoch = appManager.getEndpointEpoch();
  const navigationRevision = appManager.getNavigationRevision();
  useEffect(() => {
    lookupGeneration.current++;
    foundEpoch.current = null;
    setFound(null);
  }, [endpointEpoch]);
  const workspaces = useMemo(() => recentWorkspaces(state.sessions), [state.sessions]);
  useEffect(() => {
    if (!creating) return;
    let live = true;
    setModelLoad("loading");
    setModelOptions([]);
    setModel(null);
    setModelDefault("");
    void appManager
      .modelOptions()
      .then((result) => {
        if (!live || appManager.getEndpointEpoch() !== endpointEpoch) return;
        setModelOptions(mobileModelChoices(result));
        const info = result as { model?: unknown; provider?: unknown };
        setModelDefault(
          typeof info.model === "string"
            ? `${info.model}${typeof info.provider === "string" ? ` · ${info.provider}` : ""}`
            : "",
        );
        setModelLoad("ready");
      })
      .catch(() => {
        if (live && appManager.getEndpointEpoch() === endpointEpoch) setModelLoad("error");
      });
    return () => {
      live = false;
    };
  }, [creating, endpointEpoch, modelRetry]);
  function openCreate() {
    if (createFlight.current) return;
    createScope.current = appManager.getEndpointEpoch();
    setCreatePanel("main");
    setWorkspace("");
    setWorkspaceSearch("");
    setModel(null);
    setModelDefault("");
    setModelSearch("");
    setCreating(true);
  }
  function startCreate(voice: boolean) {
    if (
      createFlight.current ||
      createUncertain.current ||
      createScope.current !== appManager.getEndpointEpoch() ||
      appManager.getNavigationRevision() !== navigationRevision ||
      appManager.getState().activeSessionId !== null
    )
      return;
    actionHaptic();
    const flight = {};
    createFlight.current = flight;
    setCreateBusy(true);
    const epoch = createScope.current!,
      origin = appManager.getConfiguredOrigin();
    let knownId: string | null = null;
    const transaction = new VoiceEntryTransaction(epoch, origin, () => ({
      epoch: appManager.getEndpointEpoch(),
      origin: appManager.getConfiguredOrigin(),
      revision: appManager.getNavigationRevision(),
      session: appManager.getState().activeSessionId,
    }));
    const valid = () => transaction.owns() && appManager.getState().activeSessionId === null;
    void appManager
      .createSession(
        {
          ...(workspace ? { cwd: workspace } : {}),
          ...(model ? { model: model.model, provider: model.provider } : {}),
        },
        {
          valid,
          onCreated: (id) => {
            knownId = id;
          },
          onActivated: transaction.activated,
        },
      )
      .then((id) => {
        if (voice) transaction.publish(id);
        else transaction.cancel();
        if (transaction.owns()) setCreating(false);
      })
      .catch(() => {
        transaction.cancel();
        if (!transaction.owns()) return;
        if (knownId) {
          const target = knownId;
          Alert.alert("Chat created", "The chat was created but could not be opened.", [
            { text: "Later", style: "cancel" },
            {
              text: voice ? "Open voice" : "Open chat",
              onPress: () => {
                if (
                  !transaction.owns() ||
                  ![null, target].includes(appManager.getState().activeSessionId)
                )
                  return;
                const retry = new VoiceEntryTransaction(epoch, origin, () => ({
                  epoch: appManager.getEndpointEpoch(),
                  origin: appManager.getConfiguredOrigin(),
                  revision: appManager.getNavigationRevision(),
                  session: appManager.getState().activeSessionId,
                }));
                void appManager
                  .openSession(target, { valid: retry.owns, onActivated: retry.activated })
                  .then((resolved) => {
                    if (voice) retry.publish(resolved ?? target);
                    else retry.cancel();
                  })
                  .catch(() => {
                    const owns = retry.owns();
                    retry.cancel();
                    if (owns)
                      Alert.alert("Could not open chat", "Find the created chat in the chat list.");
                  });
              },
            },
          ]);
          void appManager.refreshSessions().catch(() => {});
        } else {
          createUncertain.current = true;
          Alert.alert(
            "Creation status unknown",
            "Review the refreshed chat list before starting another conversation. A chat may already have been created.",
          );
          void appManager.refreshSessions().catch(() => {});
        }
      })
      .finally(() => {
        if (createFlight.current === flight) {
          createFlight.current = null;
          setCreateBusy(false);
        }
      });
  }
  function closeCreate() {
    if (!createFlight.current) {
      createScope.current = null;
      setCreating(false);
    }
  }
  useEffect(() => {
    if (creating && createScope.current !== endpointEpoch) {
      createScope.current = null;
      setCreating(false);
    }
  }, [creating, endpointEpoch]);

  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const selectionGeneration = useRef(0);
  selectedRef.current = selected;
  const [rename, setRename] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const inventory = useMemo(
    () =>
      sessionFlags(
        state.sessions,
        state.drafts,
        attentionKey,
        state.outbox,
        state.queuedEdits,
        state.connection === "ready",
        draftImageKey,
      ),
    [
      state.sessions,
      state.drafts,
      attentionKey,
      state.outbox,
      state.queuedEdits,
      state.connection,
      draftImageKey,
    ],
  );
  const rows = useMemo(
    () => filterSessions(state.sessions, inventory.flags, filter, search),
    [state.sessions, inventory.flags, filter, search],
  );
  const selectedRow = state.sessions.find((s) => s.id === selected);
  const workingCount = state.sessions.filter(
    (s) => inventory.flags[s.id]?.running && !inventory.flags[s.id]?.attention,
  ).length;
  const attentionCount = inventory.counts.attention;
  async function action(operation: string, payload: Record<string, unknown>) {
    if (!selected) return;
    const target = selected,
      epoch = endpointEpoch;
    if (appManager.getEndpointEpoch() !== epoch || selectedRef.current !== target) return;
    try {
      await appManager.mutate(target, operation, payload);
      if (appManager.getEndpointEpoch() === epoch && selectedRef.current === target)
        setSelected(null);
    } catch (e) {
      if (appManager.getEndpointEpoch() !== epoch || selectedRef.current !== target) return;
      Alert.alert("Could not update session", e instanceof Error ? e.message : "Please try again.");
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 }}>
      <View style={{ paddingTop: 18, paddingBottom: 16, gap: 14 }}>
        <View style={[ui.row, { gap: 12 }]}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 15,
              backgroundColor: colors.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="sparkles" size={23} color={colors.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[ui.heading, { fontSize: 31 }]}>
              Hermes
            </Text>
            {(workingCount > 0 || attentionCount > 0) && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {workingCount > 0 ? `${workingCount} working` : ""}
                {workingCount > 0 && attentionCount > 0 ? "  ·  " : ""}
                {attentionCount > 0 ? `${attentionCount} needs you` : ""}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => setSettings(true)}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="settings-outline" size={22} color={colors.muted} />
          </Pressable>
        </View>
        {state.connection !== "ready" && !connectionGrace && (
          <Text style={{ color: colors.warning, fontSize: 13 }}>
            {connectionMessage(state.connection)}
          </Text>
        )}
        {state.historyTruncated && (
          <Text style={ui.muted}>
            Showing the most recent 200 stored sessions. Search covers these sessions.
          </Text>
        )}
        {showHomeError(state.error, state.connection, connectionGrace) ? (
          <Text style={{ color: colors.warning }}>{state.error}</Text>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: 18,
            paddingLeft: 15,
            minHeight: 50,
          }}
        >
          <Ionicons name="search-outline" size={20} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={(value) => {
              lookupGeneration.current++;
              foundEpoch.current = null;
              setFound(null);
              setSearch(value);
            }}
            placeholder="Find a chat"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Search sessions"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 50,
              paddingHorizontal: 12,
              color: colors.text,
              fontSize: 16,
            }}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {(
            [
              ["all", "All"],
              ["running", "Running"],
              ["attention", "Needs you"],
              ["unread", "Unread"],
              ["drafts", "Drafts"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: filter === value }}
              accessibilityLabel={
                value === "running" && state.connection !== "ready"
                  ? "Running, connect to check"
                  : `${label}, ${inventory.counts[value]} sessions`
              }
              onPress={() => {
                actionHaptic();
                lookupGeneration.current++;
                foundEpoch.current = null;
                setFound(null);
                setFilter(value);
              }}
              style={{
                minHeight: 44,
                paddingHorizontal: 15,
                borderRadius: 22,
                justifyContent: "center",
                backgroundColor: filter === value ? colors.accent : colors.surface,
              }}
            >
              <Text
                style={{
                  color: filter === value ? colors.ink : colors.text,
                  fontWeight: filter === value ? "700" : "500",
                }}
              >
                {label}{" "}
                {value === "running" && state.connection !== "ready"
                  ? "—"
                  : inventory.counts[value]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {state.historyTruncated && (
          <Button
            label="Look up exact title"
            secondary
            disabled={!search.trim()}
            onPress={() => {
              const query = search.trim(),
                epoch = endpointEpoch,
                generation = ++lookupGeneration.current;
              void appManager
                .findByTitle(query)
                .then((results) => {
                  if (
                    generation === lookupGeneration.current &&
                    epoch === appManager.getEndpointEpoch()
                  ) {
                    foundEpoch.current = epoch;
                    setFound(results);
                  }
                })
                .catch((e) => {
                  if (
                    generation === lookupGeneration.current &&
                    epoch === appManager.getEndpointEpoch()
                  )
                    Alert.alert("Lookup failed", String(e));
                });
            }}
          />
        )}
        {found && (
          <Card>
            <Text style={ui.text}>
              {found.length
                ? filter === "all"
                  ? "Exact title results"
                  : "Exact title results · all sessions"
                : "No session found with that exact title."}
            </Text>
            {found.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (foundEpoch.current !== appManager.getEndpointEpoch()) return;
                  lookupGeneration.current++;
                  foundEpoch.current = null;
                  setFound(null);
                  void appManager
                    .openSession(item.id)
                    .catch((e) => Alert.alert("Could not open session", String(e)));
                }}
              >
                <Text style={{ color: colors.accent, paddingVertical: 6 }}>
                  {item.title || item.id}
                </Text>
              </Pressable>
            ))}
            <Button
              label="Close results"
              secondary
              onPress={() => {
                lookupGeneration.current++;
                foundEpoch.current = null;
                setFound(null);
              }}
            />
          </Card>
        )}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={() => {
              setRefreshing(true);
              void appManager
                .refreshSessions()
                .catch((e) => Alert.alert("Refresh failed", String(e)))
                .finally(() => setRefreshing(false));
            }}
          />
        }
        contentContainerStyle={{ paddingBottom: 105, gap: 10 }}
        ListEmptyComponent={
          <Text style={[ui.muted, { paddingVertical: 30, textAlign: "center" }]}>
            {filter === "running" && state.connection !== "ready"
              ? "Connect to see which sessions are running."
              : search || filter !== "all"
                ? "No chats match this filter."
                : "No sessions yet. Start a new chat."}
          </Text>
        }
        renderItem={({ item }) => {
          const flags = inventory.flags[item.id];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title || "Untitled session"}${flags?.attention ? ", needs you" : ""}${flags?.draft ? ", draft saved" : ""}${flags?.unread ? ", unread" : ""}`}
              onPress={() =>
                void appManager
                  .openSession(item.id)
                  .catch((e) => Alert.alert("Could not open session", String(e)))
              }
              onLongPress={() => {
                actionHaptic();
                selectionGeneration.current++;
                setSelected(item.id);
                setRename(item.title || "");
                setRenaming(false);
                setRenameError("");
              }}
            >
              <View
                style={{
                  backgroundColor: flags?.attention
                    ? colors.warningSurface
                    : flags?.running
                      ? "#20392E"
                      : colors.surface,
                  borderRadius: 22,
                  padding: 15,
                  gap: 8,
                  minHeight: 108,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      backgroundColor: flags?.attention ? "#594A37" : colors.raised,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={
                        flags?.attention
                          ? "alert-circle-outline"
                          : flags?.running
                            ? "sparkles-outline"
                            : "chatbubble-ellipses-outline"
                      }
                      size={20}
                      color={flags?.attention ? colors.warning : colors.accent}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        numberOfLines={2}
                        style={[ui.text, { flex: 1, fontSize: 16, fontWeight: "700" }]}
                      >
                        {item.title || "Untitled session"}
                      </Text>
                      <Text style={[ui.muted, { fontSize: 12 }]}>{age(item.last_active_at)}</Text>
                    </View>
                    <Text numberOfLines={2} style={[ui.muted, { fontSize: 14, lineHeight: 20 }]}>
                      {flags?.draft ? (
                        <>
                          <Text style={{ color: colors.accent, fontWeight: "700" }}>Draft: </Text>
                          {flags.draft.replace(/\s+/g, " ")}
                        </>
                      ) : (
                        item.preview || "Open conversation"
                      )}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                        flexWrap: "wrap",
                      }}
                    >
                      {flags?.attention ? (
                        <Text style={{ color: colors.warning, fontSize: 12, fontWeight: "700" }}>
                          ● Needs you
                        </Text>
                      ) : flags?.running ? (
                        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>
                          ● Working
                        </Text>
                      ) : null}
                      {!!flags?.draft && (
                        <View
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: 8,
                            backgroundColor: colors.raised,
                          }}
                        >
                          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>
                            Draft
                          </Text>
                        </View>
                      )}
                      {!!item.session_unavailable && (
                        <Text style={{ color: colors.warning, fontSize: 12 }}>
                          Saved on this phone
                        </Text>
                      )}
                      {flags?.unread && (
                        <Text style={{ color: colors.accent, fontSize: 12 }}>● Unread</Text>
                      )}
                      {!!item.pinned && (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Pinned</Text>
                      )}
                      <Text numberOfLines={1} style={[ui.muted, { flexShrink: 1, fontSize: 12 }]}>
                        {[workspaceName(item.cwd || item.workspace), item.model]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        onPress={openCreate}
        style={{
          position: "absolute",
          right: 24,
          bottom: 20,
          minHeight: 56,
          borderRadius: 20,
          paddingHorizontal: 20,
          backgroundColor: colors.accent,
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          elevation: 4,
        }}
      >
        <Ionicons name="add" size={22} color={colors.ink} />
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>New chat</Text>
      </Pressable>
      <Sheet visible={settings} title="Settings" onClose={() => setSettings(false)}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 14 }}
        >
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={[ui.text, { flex: 1 }]}>Show reasoning and tool activity</Text>
            <Switch
              accessibilityLabel="Show reasoning and tool activity"
              value={showActivity}
              onValueChange={(value) => {
                try {
                  setShowActivity(value);
                } catch (e) {
                  Alert.alert("Could not save setting", String(e));
                }
              }}
            />
          </View>
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={[ui.text, { flex: 1 }]}>Read typed replies aloud</Text>
            <Switch
              accessibilityLabel="Read typed replies aloud"
              value={speakReplies === true}
              onValueChange={(value) => {
                try {
                  setSpeakReplies(value);
                } catch (e) {
                  Alert.alert("Could not save setting", String(e));
                }
              }}
            />
          </View>
          <Text style={ui.muted}>
            Voice conversations speak replies independently of this setting.
          </Text>
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={[ui.text, { flex: 1 }]}>Collect response timings</Text>
            <Switch
              accessibilityLabel="Collect response timings"
              value={timingEnabled}
              onValueChange={(value) => {
                conversationDiagnostics.setEnabled(value);
                setTimingEnabled(value);
              }}
            />
          </View>
          <Text style={ui.muted}>
            Timings are stored only in memory and contain elapsed stages, durations, save sizes and
            render counts, not conversation text. Turning this off clears them.
          </Text>
          {timingEnabled && (
            <Button
              secondary
              label="Copy response timings"
              onPress={() => {
                void Clipboard.setStringAsync(
                  JSON.stringify(conversationDiagnostics.report()),
                ).catch(() => Alert.alert("Could not copy timings"));
              }}
            />
          )}
          <Text style={ui.text}>
            Background connection monitor:{" "}
            {monitorMode === "whileturnruns" ? "while a turn runs" : monitorMode}
          </Text>
          <Text accessibilityLiveRegion="polite" style={ui.muted}>
            {monitorStatusText[monitorState]}
            {monitorState === "running" || monitorState === "finishing"
              ? ` · ${state.connection === "ready" ? "Connected" : connectionMessage(state.connection)}`
              : ""}
          </Text>
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {(["off", "whileturnruns", "always"] as const).map((mode) => (
              <Button
                key={mode}
                label={
                  mode === "whileturnruns" ? "While running" : mode === "off" ? "Off" : "Always"
                }
                secondary={monitorMode !== mode}
                onPress={() => {
                  try {
                    setMonitorMode(mode);
                  } catch {
                    Alert.alert("Could not save setting");
                  }
                }}
              />
            ))}
          </View>
          <Text style={ui.text}>
            {permission === "enabled"
              ? "Notifications enabled"
              : permission === "blocked"
                ? "Notifications blocked"
                : permission === "request"
                  ? "Notifications not enabled"
                  : "Checking notification status…"}
          </Text>
          {permission && (
            <Button
              label={permission === "request" ? "Enable notifications" : "Manage notifications"}
              secondary
              onPress={() => {
                actionHaptic();
                void (
                  permission === "request"
                    ? requestNotificationPermission().then((result) =>
                        setPermission(notificationPermissionState(result.authorizationStatus)),
                      )
                    : openNotificationSettings()
                ).catch(() => Alert.alert("Could not open notification settings"));
              }}
            />
          )}
          <Text style={ui.muted}>
            Installed version {Application.nativeApplicationVersion ?? "unknown"}
            {Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ""}
          </Text>
          <Button
            label="Connection setup"
            secondary
            onPress={() => {
              setSettings(false);
              onSetup();
            }}
          />
        </ScrollView>
      </Sheet>
      <Sheet
        visible={creating}
        title={
          createPanel === "workspace"
            ? "Choose workspace"
            : createPanel === "model"
              ? "Choose model"
              : "New chat"
        }
        onClose={closeCreate}
        closeDisabled={createBusy}
      >
        {createPanel === "main" ? (
          <View style={{ padding: 24, gap: 14 }}>
            <Text style={ui.muted}>Choose a workspace and model, or use the gateway defaults.</Text>
            <ChoiceCard
              disabled={createBusy}
              label="Workspace"
              value={workspace || "Gateway default workspace"}
              onPress={() => {
                actionHaptic();
                setCreatePanel("workspace");
              }}
            />
            <ChoiceCard
              disabled={createBusy}
              label="Model"
              value={
                model
                  ? `${model.model} · ${model.providerName}`
                  : modelDefault
                    ? `Gateway default · ${modelDefault}`
                    : "Gateway default model"
              }
              onPress={() => {
                actionHaptic();
                setCreatePanel("model");
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={createBusy ? "Starting…" : "Start chat"}
                  disabled={createBusy || createUncertain.current}
                  onPress={() => startCreate(false)}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start voice conversation"
                accessibilityState={{ disabled: createBusy || createUncertain.current }}
                disabled={createBusy || createUncertain.current}
                onPress={() => startCreate(true)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.raised,
                  opacity: createBusy || createUncertain.current ? 0.5 : 1,
                }}
              >
                <Ionicons name="pulse-outline" size={23} color={colors.accent} />
              </Pressable>
            </View>
            {createUncertain.current && (
              <Button
                secondary
                label="Review chat list"
                onPress={() => {
                  createUncertain.current = false;
                  setCreating(false);
                }}
              />
            )}
          </View>
        ) : createPanel === "workspace" ? (
          <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12, flexShrink: 1 }}>
            <TextInput
              accessibilityLabel="Search recent workspaces"
              autoCapitalize="none"
              autoCorrect={false}
              value={workspaceSearch}
              onChangeText={setWorkspaceSearch}
              placeholder="Search recent workspaces"
              placeholderTextColor={colors.muted}
              style={ui.input}
            />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
              <ChoiceOption
                label="Gateway default workspace"
                checked={!workspace}
                onPress={() => {
                  actionHaptic();
                  setWorkspace("");
                  setCreatePanel("main");
                }}
              />
              {filterWorkspaces(workspaces, workspaceSearch).map((cwd) => (
                <ChoiceOption
                  key={cwd}
                  label={cwd}
                  checked={workspace === cwd}
                  onPress={() => {
                    actionHaptic();
                    setWorkspace(cwd);
                    setCreatePanel("main");
                  }}
                />
              ))}
              {!filterWorkspaces(workspaces, workspaceSearch).length && (
                <Text style={ui.muted}>
                  {workspaces.length
                    ? "No workspaces match your search."
                    : "No recent workspaces yet."}
                </Text>
              )}
            </ScrollView>
            <Button label="Back" secondary onPress={() => setCreatePanel("main")} />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12, flexShrink: 1 }}>
            <ModelPicker
              options={modelOptions}
              selected={model}
              onSelect={(value) => {
                actionHaptic();
                setModel(value);
                setCreatePanel("main");
              }}
              query={modelSearch}
              onQuery={setModelSearch}
              state={modelLoad}
              retry={() => setModelRetry((n) => n + 1)}
              defaultLabel={
                modelDefault ? `Gateway default · ${modelDefault}` : "Gateway default model"
              }
              allowDefault
              maxHeight={360}
            />
            <Button label="Back" secondary onPress={() => setCreatePanel("main")} />
          </View>
        )}
      </Sheet>
      <Sheet
        visible={!!selected}
        title={renaming ? "Rename session" : "Session options"}
        closeDisabled={renameBusy}
        onClose={() => {
          selectionGeneration.current++;
          setSelected(null);
          setRenaming(false);
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 10 }}
        >
          {renaming ? (
            <>
              <TextInput
                accessibilityLabel="Session title"
                autoFocus
                value={rename}
                onChangeText={(value) => {
                  setRename(value);
                  setRenameError("");
                }}
                style={ui.input}
              />
              {!!renameError && <Text style={{ color: colors.warning }}>{renameError}</Text>}
              <Button
                label={renameBusy ? "Saving…" : "Save"}
                disabled={renameBusy || !rename.trim()}
                onPress={() => {
                  if (!selected || !rename.trim() || renameBusy) return;
                  actionHaptic();
                  const target = selected,
                    epoch = endpointEpoch;
                  if (appManager.getEndpointEpoch() !== epoch) return;
                  setRenameBusy(true);
                  setRenameError("");
                  void appManager
                    .mutate(target, "rename", { title: rename.trim() })
                    .then(() => {
                      if (appManager.getEndpointEpoch() !== epoch || selectedRef.current !== target)
                        return;
                      setSelected(null);
                      setRenaming(false);
                    })
                    .catch((e) => {
                      if (appManager.getEndpointEpoch() !== epoch || selectedRef.current !== target)
                        return;
                      setRenameError(
                        e instanceof Error
                          ? e.message
                          : "Could not rename session. Please try again.",
                      );
                    })
                    .finally(() => setRenameBusy(false));
                }}
              />
              <Button
                label="Cancel"
                secondary
                disabled={renameBusy}
                onPress={() => {
                  setRenaming(false);
                  setRenameError("");
                }}
              />
            </>
          ) : (
            <>
              <Action
                label="Rename"
                icon="pencil"
                tone="#AFD9F5"
                onPress={() => {
                  setRename(selectedRow?.title || "");
                  setRenameError("");
                  setRenaming(true);
                }}
              />
              <Action
                label={selectedRow?.pinned ? "Unpin" : "Pin"}
                icon="pin"
                tone="#B5E6CB"
                onPress={() => void action("sidebar", { pinned: !selectedRow?.pinned })}
              />
              <Action
                label="Archive"
                icon="archive"
                tone="#F2C477"
                onPress={() => void action("archive", { archived: true })}
              />
              <Action
                label="Delete"
                icon="trash"
                tone="#F59C95"
                onPress={() => {
                  const generation = selectionGeneration.current,
                    epoch = endpointEpoch;
                  Alert.alert("Delete session?", "This permanently deletes the session.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => {
                        if (
                          generation === selectionGeneration.current &&
                          appManager.getEndpointEpoch() === epoch &&
                          selectedRef.current === selected
                        ) {
                          actionHaptic();
                          void action("delete", {});
                        }
                      },
                    },
                  ]);
                }}
              />
            </>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function Action({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: "pencil" | "pin" | "archive" | "trash";
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        actionHaptic();
        onPress();
      }}
      style={{
        minHeight: 56,
        backgroundColor: colors.raised,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
      }}
    >
      <Ionicons name={icon} size={21} color={tone} />
      <Text style={{ color: tone, fontSize: 16, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function ChoiceCard({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: colors.raised,
        borderRadius: 16,
        padding: 16,
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={ui.label}>{label}</Text>
        <Text numberOfLines={2} style={ui.text}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}
function ChoiceOption({
  label,
  detail,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: checked ? colors.accent : colors.text }}>
        {checked ? "✓ " : ""}
        {label}
      </Text>
      {!!detail && <Text style={ui.muted}>{detail}</Text>}
    </Pressable>
  );
}
