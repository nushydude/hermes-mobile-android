import { ReasoningPicker } from "../components/ReasoningPicker";
import {
  conversationModes,
  currentConversationMode,
  modeAvailable,
  ModeConfirmationOwner,
  type ConversationMode,
} from "../components/conversationModes";
import { Sheet } from "../components/Sheet";
import { MessageInput } from "../components/MessageInput";
import { composerActions } from "../components/composerActions";
import { MessageActionSheet, type MessageActionTarget } from "../components/MessageActionSheet";
import {
  appendQuote,
  findLoadedMessages,
  highlightParts,
  measuredSearchHop,
  nextMatchKey,
} from "../components/chatActions";
import { actionHaptic } from "../components/haptics";
import { FollowLatest, isNearBottom } from "../components/followLatest";
import { waitingPrompts, unknownPrompts } from "../components/pendingQueue";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  AppState,
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import Markdown from "react-native-markdown-display";
import { appManager, useAppStore } from "../state";
import { colors } from "../theme";
import { Button, Card, ui } from "../components/UI";
import { parseSlash, modelPayload } from "../components/slash";
import { extractImages } from "../components/images";
import {
  setShowActivity,
  useShowActivity,
  getSpeakReplies,
  subscribeSpeakReplies,
} from "../preferences";
import {
  showActivityEvent,
  showHistoryMessage,
  historyMessageContent,
} from "../components/activityVisibility";
import { ModelPicker, type LoadState } from "../components/ModelPicker";
import { mobileModelChoices, type ModelChoice } from "../components/selections";
import { SpeechOwner, type SpeechLease } from "../components/speechOwner";
import { VoicePlayback } from "../components/voicePlayback";
import { nativeVoicePlayback } from "../components/voicePlaybackNative";
import { speechParts, speechText } from "../components/voiceText";
import { TypedSpeechWatcher } from "../components/typedSpeechWatcher";
import { conversationDiagnostics, useRenderCounter } from "../state/conversationDiagnostics";
import { VoiceSheet } from "../components/VoiceSheet";
import { consumeVoiceEntry, subscribeVoiceEntry } from "../components/newSessionIntent";
import { VoiceEntryTransaction } from "../components/voiceEntryTransaction";
import { VoiceCreateFlights } from "../components/voiceCreateFlights";
import { addRoomImages, visibleRoomImages, type RoomImages } from "../components/roomImages";
import { TaskTray } from "../components/TaskTray";
import { TaskRequestFences } from "../components/taskRequestFence";
import { taskStore } from "../state/taskStore";
import { useConnectionGrace } from "../components/useConnectionGrace";
import Ionicons from "@expo/vector-icons/Ionicons";
import { chatStatus, formatUsage, localMessageStatusLabel } from "../components/status";
type Obj = Record<string, any>;
type TimelineItem = { key: string; kind: string; value: unknown };
const timelineKey = (item: TimelineItem) => item.key;
const timelineStyle = { padding: 18, gap: 14, paddingBottom: 24, flexGrow: 1 };
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const text = (x: unknown): string =>
  typeof x === "string"
    ? x
    : Array.isArray(x)
      ? x.map(text).filter(Boolean).join("\n")
      : x && typeof x === "object"
        ? text(obj(x).text ?? obj(x).content ?? obj(x).message ?? "")
        : "";
const pretty = (x: unknown) => (typeof x === "string" ? x : (JSON.stringify(x, null, 2) ?? ""));
function Code({ value, light = false }: { value: string; light?: boolean }) {
  const tokens = value.split(
    /(\b(?:const|let|var|function|return|if|else|class|import|from|def|for|while|true|false|null|None)\b|"[^"\n]*"|'[^'\n]*'|\b\d+\b)/g,
  );
  return (
    <View
      style={{ backgroundColor: light ? "#B8D7C2" : colors.raised, padding: 12, borderRadius: 10 }}
    >
      <Text selectable style={{ fontFamily: "monospace", color: light ? colors.ink : colors.text }}>
        {tokens.map((t, i) => (
          <Text
            key={i}
            style={{
              color: light
                ? colors.ink
                : /^(const|let|var|function|return|if|else|class|import|from|def|for|while|true|false|null|None)$/.test(
                      t,
                    )
                  ? "#c9a7ec"
                  : /^['"]/.test(t)
                    ? colors.accent
                    : /^\d/.test(t)
                      ? colors.warning
                      : colors.text,
            }}
          >
            {t}
          </Text>
        ))}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy code"
        onPress={() => void Clipboard.setStringAsync(value)}
      >
        <Text style={light ? { color: colors.ink } : ui.muted}>Copy code</Text>
      </Pressable>
    </View>
  );
}
const Message = memo(function Message({
  value,
  sessionId,
  showActivity,
  onReadReply,
  onActions,
  searchQuery,
  focused,
}: {
  value: unknown;
  sessionId: string;
  showActivity: boolean;
  onReadReply: (text: string) => void;
  onActions: (target: MessageActionTarget) => void;
  searchQuery: string;
  focused: boolean;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const m = obj(value),
    extracted = extractImages(historyMessageContent(m, showActivity)),
    content = extracted.text,
    user = m.role === "user";
  if (!content && !extracted.images.length && !m.reasoning) return null;
  return (
    <Pressable
      onLongPress={() => {
        if (content) {
          actionHaptic();
          onActions({ content, canRead: !user && m.role === "assistant" && m.row_id != null });
        }
      }}
    >
      <View
        style={{
          alignSelf: user ? "flex-end" : "stretch",
          maxWidth: user ? "88%" : "100%",
          backgroundColor: user ? colors.userBubble : colors.surface,
          padding: 16,
          borderRadius: 23,
          ...(focused ? { borderColor: colors.accent, borderWidth: 2 } : {}),
          ...(user ? { borderTopRightRadius: 7 } : { borderTopLeftRadius: 7 }),
        }}
      >
        {!user && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="sparkles" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 12 }}>
              {m.row_kind === "compaction"
                ? "Compaction"
                : m.role === "tool"
                  ? `Tool · ${m.name ?? "Result"}`
                  : m.role === "system"
                    ? "Notice"
                    : "Hermes"}
            </Text>
          </View>
        )}
        {showActivity && !!m.reasoning && (
          <View>
            <Pressable onPress={() => setShowReasoning(!showReasoning)}>
              <Text style={{ color: user ? colors.ink : colors.accent }}>
                {showReasoning ? "▾" : "▸"} Reasoning
              </Text>
            </Pressable>
            {showReasoning && (
              <Text selectable style={user ? { color: colors.ink } : ui.muted}>
                {String(m.reasoning)}
              </Text>
            )}
          </View>
        )}
        {extracted.images.map((image, i) =>
          image.startsWith("data:image/") ? (
            <Image
              key={i}
              source={{ uri: image }}
              accessibilityLabel="Attached image"
              resizeMode="contain"
              style={{ width: 220, height: 220 }}
            />
          ) : (
            <ToolImage key={i} sessionId={sessionId} path={image} light={user} />
          ),
        )}
        {!!content && (
          <Markdown
            rules={{
              text: (
                node: any,
                _children: any,
                _parent: any,
                styles: any,
                inheritedStyles: any = {},
              ) => (
                <Text key={node.key} style={[inheritedStyles, styles.text]}>
                  {highlightParts(node.content, searchQuery).map((part, index) => (
                    <Text
                      key={index}
                      style={
                        part.match
                          ? { backgroundColor: colors.warning, color: colors.ink }
                          : undefined
                      }
                    >
                      {part.text}
                    </Text>
                  ))}
                </Text>
              ),
              fence: (node: any) => <Code key={node.key} value={node.content} light={user} />,
              code_block: (node: any) => <Code key={node.key} value={node.content} light={user} />,
            }}
            style={{
              body: { color: user ? colors.ink : colors.text, fontSize: 16, lineHeight: 24 },
              text: { color: user ? colors.ink : colors.text },
              link: { color: user ? "#245743" : colors.accent },
              code_inline: {
                color: user ? colors.ink : colors.accent,
                backgroundColor: user ? "#B8D7C2" : colors.raised,
              },
            }}
          >
            {content}
          </Markdown>
        )}
        <View
          style={{
            flexDirection: "row",
            alignSelf: "flex-end",
            marginBottom: -12,
            marginRight: -8,
          }}
        >
          {!user && m.role === "assistant" && m.row_id != null && !!content && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Read this reply aloud"
              onPress={() => onReadReply(content)}
              style={{
                alignSelf: "flex-end",
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="volume-medium-outline" size={19} color={colors.muted} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy message"
            onPress={() => void Clipboard.setStringAsync(content)}
            style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="copy-outline" size={17} color={user ? colors.ink : colors.muted} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});
const ToolImage = memo(function ToolImage({
  sessionId,
  path,
  light = false,
}: {
  sessionId: string;
  path: string;
  light?: boolean;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setUri(null);
    setFailed(false);
    void appManager
      .readImage(sessionId, path, controller.signal)
      .then((result: string) => {
        if (live) setUri(result);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [sessionId, path]);
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel="Tool image"
      resizeMode="contain"
      style={{ width: "100%", height: 220 }}
    />
  ) : (
    <Text style={light ? { color: colors.ink, fontSize: 13 } : ui.muted}>
      {failed ? "Image unavailable" : "Loading image…"}
    </Text>
  );
});
function Activity({ value, sessionId }: { value: unknown; sessionId: string }) {
  const event = obj(value),
    payload = obj(event.payload),
    [open, setOpen] = useState(false),
    type = String(event.type ?? "");
  if (!/reasoning|thinking|tool\.|todo|subagent|status|error|notice|interim/.test(type))
    return null;
  const isTool = type.startsWith("tool.");
  return (
    <Card>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <Text
          style={{
            color: type === "error" ? colors.danger : colors.accent,
            fontWeight: "700",
          }}
        >
          {open ? "▾" : "▸"}{" "}
          {isTool ? `Tool · ${payload.name ?? "Working"}` : type.replace(/\./g, " · ")}
        </Text>
      </Pressable>
      {isTool && payload.message && <Text style={ui.muted}>{String(payload.message)}</Text>}
      {isTool && typeof payload.percent === "number" && (
        <Text style={ui.muted}>{payload.percent}%</Text>
      )}
      {open && (
        <>
          <Text selectable style={ui.muted}>
            {isTool
              ? [
                  payload.args ? `Arguments: ${pretty(payload.args)}` : payload.args_text,
                  payload.summary,
                  payload.result_text ?? (payload.result ? pretty(payload.result) : ""),
                ]
                  .filter(Boolean)
                  .join("\n\n")
              : text(payload) || pretty(payload)}
          </Text>
          {!!payload.inline_diff && <Code value={String(payload.inline_diff)} />}
          {!!payload.image_path && (
            <ToolImage sessionId={sessionId} path={String(payload.image_path)} />
          )}
        </>
      )}
    </Card>
  );
}
function LocalMessage({
  value,
  sessionId,
  onActions,
  searchQuery = "",
  focused = false,
}: {
  value: unknown;
  sessionId: string;
  onActions?: (target: MessageActionTarget) => void;
  searchQuery?: string;
  focused?: boolean;
}) {
  const item = obj(value);
  return (
    <Pressable
      onLongPress={() => {
        if (onActions && item.text) {
          actionHaptic();
          onActions({ content: String(item.text), canRead: false });
        }
      }}
      style={{
        alignSelf: "flex-end",
        maxWidth: "88%",
        backgroundColor: colors.userBubble,
        borderRadius: 23,
        borderTopRightRadius: 7,
        padding: 16,
        gap: 6,
        ...(focused ? { borderColor: colors.accent, borderWidth: 2 } : {}),
      }}
    >
      <Text style={{ color: colors.ink, fontSize: 12, fontWeight: "700" }}>
        {localMessageStatusLabel(String(item.status))}
      </Text>
      {!!item.text && (
        <Text selectable={!onActions} style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>
          {highlightParts(String(item.text), searchQuery).map((part, index) => (
            <Text
              key={index}
              style={
                part.match ? { backgroundColor: colors.warning, color: colors.ink } : undefined
              }
            >
              {part.text}
            </Text>
          ))}
        </Text>
      )}
      {(item.attachments ?? []).map((attachment: any, i: number) => (
        <ToolImage key={i} sessionId={sessionId} path={attachment.path} light />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy sent text"
        onPress={() => void Clipboard.setStringAsync(String(item.text ?? ""))}
        style={{
          alignSelf: "flex-end",
          width: 48,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: -12,
          marginRight: -8,
        }}
      >
        <Ionicons name="copy-outline" size={17} color={colors.ink} />
      </Pressable>
    </Pressable>
  );
}
function Prompt({ value, id }: { value: unknown; id: string }) {
  const p = obj(value),
    [answer, setAnswer] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    promptId = String(p.prompt_id ?? p.id ?? ""),
    clarify = !!p.question || String(p.kind ?? p.type).includes("clarify");
  const choices = Array.isArray(p.choices) ? p.choices : [];
  return (
    <Card
      style={{
        borderColor: colors.warning,
        borderWidth: 1,
        backgroundColor: colors.warningSurface,
      }}
    >
      <Text style={{ color: colors.warning, fontWeight: "700" }}>
        {clarify ? "Question from Hermes" : "Approval needed"}
      </Text>
      <Text selectable style={ui.text}>
        {text(p.question ?? p.description ?? p.command) || "Action requires your response."}
      </Text>
      {!!p.command && !!p.description && (
        <Text selectable style={ui.muted}>
          {String(p.command)}
        </Text>
      )}
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        {choices.map((choice: any, i: number) => {
          const v =
            typeof choice === "string"
              ? choice
              : String(choice.value ?? choice.id ?? choice.label ?? "");
          return (
            <Button
              key={i}
              label={`${selected.includes(v) ? "✓ " : ""}${typeof choice === "string" ? choice : String(choice.label ?? v)}`}
              secondary
              onPress={() => {
                if (clarify && p.multi_select) {
                  setSelected((old) =>
                    old.includes(v) ? old.filter((x) => x !== v) : [...old, v],
                  );
                  return;
                }
                void (
                  clarify
                    ? appManager.respondClarify(id, promptId, v)
                    : appManager.respondApproval(id, promptId, v)
                ).catch((e) => Alert.alert("Could not respond", String(e)));
              }}
            />
          );
        })}
      </View>
      {clarify && (
        <>
          <TextInput
            accessibilityLabel="Your answer"
            value={answer}
            onChangeText={setAnswer}
            placeholder="Your answer"
            placeholderTextColor={colors.muted}
            style={ui.input}
          />
          <Button
            label="Answer"
            onPress={() =>
              void appManager
                .respondClarify(id, promptId, p.multi_select ? selected.join(", ") : answer)
                .catch((e) => Alert.alert("Could not respond", String(e)))
            }
          />
        </>
      )}
    </Card>
  );
}
type Attachment = { uri: string; path: string; mime: string };
export function ChatScreen() {
  useRenderCounter("chat_screen");
  const endpointEpoch = appManager.getEndpointEpoch();
  const navigationRevision = appManager.getNavigationRevision();
  const connectionGrace = useConnectionGrace();
  const showActivity = useShowActivity();
  const state = useAppStore((s) => ({
      activeSessionId: s.activeSessionId,
      chat: s.chats[s.activeSessionId!],
      sessions: s.sessions,
      drafts: s.drafts,
      outbox: s.outbox,
      queuedEdits: s.queuedEdits,
      connection: s.connection,
      error: s.error,
    })),
    id = state.activeSessionId!,
    chat = state.chat,
    row = state.sessions.find((s) => s.id === id),
    draft = state.drafts[id] ?? "";
  const attachments = chat?.draftAttachments ?? [];
  const setAttachments = (value: Attachment[] | ((current: Attachment[]) => Attachment[])) => {
    assertEndpoint();
    const previous = appManager.getState().chats[id]?.draftAttachments ?? [];
    void appManager
      .setDraftAttachments(id, typeof value === "function" ? value(previous) : value)
      .catch(() => Alert.alert("Could not save draft images", "Keep the app open and try again."));
  };
  const [voiceImages, setVoiceImages] = useState<RoomImages | null>(null);
  const [uploading, setUploading] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [bottom, setBottom] = useState(true),
    [settings, setSettings] = useState(false),
    [voice, setVoice] = useState<{
      reply?: string;
      lease: SpeechLease;
      sessionId: string;
      origin: string;
      epoch: number;
      revision: number;
      owner: SpeechOwner;
    } | null>(null),
    [showSavedText, setShowSavedText] = useState(false),
    [title, setTitle] = useState(""),
    [model, setModel] = useState<ModelChoice | null>(null),
    [modelSearch, setModelSearch] = useState(""),
    [modelLoad, setModelLoad] = useState<LoadState>("loading"),
    [modelRetry, setModelRetry] = useState(0),
    [currentModel, setCurrentModel] = useState(""),
    [modelBusy, setModelBusy] = useState(false),
    [options, setOptions] = useState<ModelChoice[]>([]),
    [suggestions, setSuggestions] = useState<string[]>([]);
  const playbackTrace = useRef<number | null>(null);
  const origin = appManager.getConfiguredOrigin();
  useEffect(() => {
    taskStore.activate(origin);
  }, [origin, endpointEpoch]);
  const tasks = useSyncExternalStore(
    taskStore.subscribe,
    () => taskStore.get(origin, id),
    () => taskStore.get(origin, id),
  );
  const [taskOpen, setTaskOpen] = useState(false),
    [taskRefreshing, setTaskRefreshing] = useState(false),
    [taskError, setTaskError] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<{
    id: string;
    text: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const taskRequests = useRef(new TaskRequestFences()),
    taskRefreshRequest = useRef(taskRequests.current.refresh),
    taskResultRequest = useRef(taskRequests.current.result);
  const taskCurrent = () =>
    appManager.getEndpointEpoch() === endpointEpoch &&
    appManager.getConfiguredOrigin() === origin &&
    appManager.getState().activeSessionId === id;
  const refreshTasks = () => {
    if (!taskCurrent()) return;
    const token = taskRefreshRequest.current.begin();
    setTaskRefreshing(true);
    setTaskError(null);
    void taskStore
      .refresh(origin, id, endpointEpoch)
      .catch(() => {
        if (taskCurrent() && taskRefreshRequest.current.valid(token))
          setTaskError("Could not refresh tasks. Check the connection and try again.");
      })
      .finally(() => {
        if (taskCurrent() && taskRefreshRequest.current.valid(token)) setTaskRefreshing(false);
      });
  };
  const selectTask = (child: string) => {
    if (!taskCurrent()) return;
    const token = taskResultRequest.current.begin();
    setTaskResult({ id: child, text: "", loading: true, error: null });
    void appManager
      .request<{ available?: boolean; rows?: unknown[] }>("session.transcript", {
        session_id: id,
        subagent_id: child,
        order: "latest",
        limit: 50,
      })
      .then((result) => {
        if (!taskCurrent() || !taskResultRequest.current.valid(token)) return;
        setTaskResult({
          id: child,
          text:
            result.available === true && Array.isArray(result.rows)
              ? result.rows
                  .map((row) => text(obj(row).text ?? obj(row).content))
                  .filter(Boolean)
                  .join("\n\n")
              : "",
          loading: false,
          error: result.available === true ? null : "Transcript is unavailable.",
        });
      })
      .catch(() => {
        if (taskCurrent() && taskResultRequest.current.valid(token))
          setTaskResult({
            id: child,
            text: "",
            loading: false,
            error: "Could not load this transcript.",
          });
      });
  };
  const interruptTask = (child: string) => {
    if (!taskCurrent()) return;
    setTaskError(null);
    void taskStore.interrupt(origin, id, child, endpointEpoch).catch(() => {
      if (taskCurrent()) setTaskError("Could not request stop. Refresh to check the task.");
    });
  };
  useEffect(() => {
    taskRefreshRequest.current.invalidate();
    taskResultRequest.current.invalidate();
    setTaskOpen(false);
    setTaskRefreshing(false);
    setTaskError(null);
    setTaskResult(null);
  }, [origin, id, endpointEpoch]);
  const speechOwner = useMemo(
    () =>
      new SpeechOwner(
        new VoicePlayback(
          nativeVoicePlayback(
            (text, signal) => {
              // Only the first section's request and readiness are kept per trace.
              const trace = playbackTrace.current;
              conversationDiagnostics.mark(trace, "tts_request_start");
              return appManager.speakAudio(text, signal, endpointEpoch).then((audio) => {
                conversationDiagnostics.mark(trace, "tts_ready");
                return audio;
              });
            },
            () =>
              AppState.currentState === "active" &&
              appManager.getEndpointEpoch() === endpointEpoch &&
              appManager.getNavigationRevision() === navigationRevision &&
              appManager.getConfiguredOrigin() === origin &&
              appManager.getState().activeSessionId === id,
            () => conversationDiagnostics.mark(playbackTrace.current, "playback_start"),
          ),
        ),
      ),
    [id, endpointEpoch, origin, navigationRevision],
  );
  const speechState = useSyncExternalStore(
    speechOwner.playback.subscribe,
    speechOwner.playback.getState,
    speechOwner.playback.getState,
  );
  const typedLease = useRef<SpeechLease | null>(null),
    voiceLease = useRef<SpeechLease | null>(null);
  const speechWatches = useRef(new Set<() => void>());
  useEffect(
    () => () => {
      for (const close of speechWatches.current) close();
      speechWatches.current.clear();
      speechOwner.dispose();
      typedLease.current = null;
      voiceLease.current = null;
    },
    [speechOwner],
  );
  useEffect(() => {
    const stop = () => {
      for (const close of speechWatches.current) close();
      typedLease.current?.release();
      typedLease.current = null;
    };
    const lifecycle = AppState.addEventListener("change", (next) => {
      if (next !== "active") stop();
    });
    const unsubscribe = appManager.subscribe(() => {
      if (
        appManager.getEndpointEpoch() !== endpointEpoch ||
        appManager.getConfiguredOrigin() !== origin ||
        appManager.getState().activeSessionId !== id
      )
        stop();
    });
    return () => {
      lifecycle.remove();
      unsubscribe();
    };
  }, [speechOwner]);
  useEffect(
    () =>
      subscribeSpeakReplies(() => {
        if (getSpeakReplies() === false) {
          for (const close of speechWatches.current) close();
          typedLease.current?.release();
          typedLease.current = null;
        }
      }),
    [speechOwner],
  );
  const openVoice = (reply?: string) => {
    typedLease.current?.release();
    typedLease.current = null;
    voiceLease.current?.release();
    const lease = speechOwner.acquire();
    voiceLease.current = lease;
    setVoiceImages({ owner: lease, images: [] });
    setVoice({
      reply,
      lease,
      sessionId: id,
      origin,
      epoch: endpointEpoch,
      revision: navigationRevision,
      owner: speechOwner,
    });
  };
  const closeVoice = (lease: SpeechLease) => {
    lease.release();
    if (voiceLease.current === lease) {
      voiceLease.current = null;
      setVoice((current) => (current?.lease === lease ? null : current));
    }
  };
  function watchTypedSend() {
    if (getSpeakReplies() !== true) return null;
    const valid = () =>
      getSpeakReplies() === true &&
      !voiceLease.current &&
      AppState.currentState === "active" &&
      appManager.getEndpointEpoch() === endpointEpoch &&
      appManager.getConfiguredOrigin() === origin &&
      appManager.getState().activeSessionId === id;
    let unsubEvent = () => {},
      unsubState = () => {},
      timer: ReturnType<typeof setTimeout> | undefined,
      closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      watcher.close();
      unsubEvent();
      unsubState();
      if (timer) clearTimeout(timer);
      speechWatches.current.delete(close);
    };
    const watcher = new TypedSpeechWatcher(
      id,
      (submission) =>
        appManager.getState().chats[id]?.localMessages.find((x) => x.submission_id === submission)
          ?.admission_id,
      valid,
      (text) => {
        close();
        if (!valid()) return;
        const parts = speechParts(speechText(text));
        if (!parts.length) return;
        playbackTrace.current = null;
        const lease = speechOwner.acquire();
        typedLease.current = lease;
        void lease.play(parts, new AbortController().signal).catch(() => {});
      },
    );
    unsubEvent = appManager.subscribeVoiceEvents(watcher.event);
    unsubState = appManager.subscribe(watcher.refresh);
    speechWatches.current.add(close);
    if (speechWatches.current.size > 100) speechWatches.current.values().next().value?.();
    timer = setTimeout(close, 120000);
    return { bind: watcher.bind, close };
  }
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const [findOpen, setFindOpen] = useState(false),
    [findQuery, setFindQuery] = useState(""),
    [findKey, setFindKey] = useState<string | null>(null),
    [findError, setFindError] = useState("");
  const list = useRef<FlatList>(null);
  const follow = useMemo(
    () =>
      new FollowLatest(requestAnimationFrame, cancelAnimationFrame, () =>
        list.current?.scrollToEnd({ animated: false }),
      ),
    [id, endpointEpoch],
  );
  useEffect(() => {
    setBottom(true);
    return () => follow.dispose();
  }, [follow]);
  const newVoiceFlights = useRef(new VoiceCreateFlights());
  const submitFlight = useRef<object | null>(null);
  const modeConfirmation = useRef(new ModeConfirmationOwner());
  const reasoningBusy = useRef(false);
  const settingsScope = useRef(0);
  useEffect(() => {
    setUploading(false);
    setVoiceImages(null);
    submitFlight.current = null;
    setSubmitting(false);
    modeConfirmation.current.reset();
    reasoningBusy.current = false;
    setModelBusy(false);
    setShowSavedText(false);
    setBottom(true);
    setVoice(null);
    closeSettings();
    setSuggestions([]);
    setActionTarget(null);
    setFindOpen(false);
    setFindQuery("");
    setFindKey(null);
    setFindError("");
  }, [id, endpointEpoch, navigationRevision]);
  useEffect(() => {
    const check = () => {
      if (
        appManager.getNavigationRevision() === navigationRevision &&
        consumeVoiceEntry(endpointEpoch, origin, id, navigationRevision)
      )
        openVoice();
    };
    const unsub = subscribeVoiceEntry(check);
    check();
    return unsub;
  }, [id, endpointEpoch, origin, navigationRevision, speechOwner]);
  useEffect(() => {
    if (!settings) return;
    let live = true;
    setModelLoad("loading");
    setOptions([]);
    setModel(null);
    setCurrentModel("");
    void appManager
      .modelOptions(id)
      .then((result) => {
        if (
          !live ||
          appManager.getEndpointEpoch() !== endpointEpoch ||
          appManager.getState().activeSessionId !== id
        )
          return;
        const values = mobileModelChoices(result),
          info = result as { model?: unknown; provider?: unknown };
        setOptions(values);
        const current =
          values.find(
            (value) =>
              !value.disabled && value.model === info.model && value.provider === info.provider,
          ) ?? null;
        setModel(current);
        setCurrentModel(
          typeof info.model === "string"
            ? `${info.model}${typeof info.provider === "string" ? ` · ${info.provider}` : ""}`
            : row?.model || "Gateway default",
        );
        setModelLoad("ready");
      })
      .catch(() => {
        if (
          live &&
          appManager.getEndpointEpoch() === endpointEpoch &&
          appManager.getState().activeSessionId === id
        )
          setModelLoad("error");
      });
    return () => {
      live = false;
    };
  }, [settings, id, endpointEpoch, modelRetry]);
  function closeSettings() {
    settingsScope.current++;
    modeConfirmation.current.invalidate();
    setSettings(false);
  }
  function openSettings() {
    settingsScope.current++;
    setModelSearch("");
    setTitle(row?.title ?? "");
    setSettings(true);
  }
  function assertEndpoint() {
    appManager.assertEndpointEpoch(endpointEpoch);
  }
  function assertAttachmentScope() {
    assertEndpoint();
    if (
      appManager.getNavigationRevision() !== navigationRevision ||
      appManager.getState().activeSessionId !== id
    )
      throw new Error("Chat changed. Select the image again in the current chat.");
  }
  useEffect(() => {
    if (!draft.startsWith("/")) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void appManager
        .request("complete.slash", { text: draft, session_id: id })
        .then((r: any) => {
          const entries = Array.isArray(r) ? r : (r?.items ?? r?.matches ?? r?.commands ?? []);
          if (live && Array.isArray(entries))
            setSuggestions(
              entries
                .map((x: any) => (typeof x === "string" ? x : (x.name ?? x.text ?? "")))
                .filter(Boolean)
                .slice(0, 6),
            );
        })
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, id]);
  async function attach(camera: boolean) {
    assertAttachmentScope();
    if (attachments.length >= 10) {
      Alert.alert("Attachment limit", "A prompt can include up to 10 images.");
      return;
    }
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    assertAttachmentScope();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow access to attach an image.");
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          base64: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          base64: true,
          allowsMultipleSelection: true,
          selectionLimit: 10 - attachments.length,
        });
    assertAttachmentScope();
    if (result.canceled) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const asset of result.assets.slice(0, 10 - attachments.length)) {
        if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024)
          throw new Error("Image exceeds 25 MiB.");
        let uri = asset.uri,
          base64 = asset.base64,
          mime = asset.mimeType ?? "image/jpeg";
        if (/hei[cf]/i.test(mime) || /\.hei[cf]$/i.test(uri) || !base64) {
          const converted = await ImageManipulator.manipulateAsync(uri, [], {
            compress: 0.9,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          });
          assertAttachmentScope();
          uri = converted.uri;
          base64 = converted.base64;
          mime = "image/jpeg";
        }
        if (!base64 || base64.length * 0.75 > 25 * 1024 * 1024)
          throw new Error("Image could not be read or exceeds 25 MiB.");
        assertAttachmentScope();
        const uploaded = await appManager.uploadImage(
          `data:${mime};base64,${base64}`,
          asset.fileName ?? "image.jpg",
        );
        assertAttachmentScope();
        added.push({ uri, path: uploaded.path, mime: uploaded.mime });
      }
      setAttachments((old) => [...old, ...added]);
      return added;
    } catch (e) {
      Alert.alert("Image upload failed", String(e));
      return [];
    } finally {
      if (
        appManager.getEndpointEpoch() === endpointEpoch &&
        appManager.getState().activeSessionId === id
      )
        setUploading(false);
    }
  }
  const status = chatStatus({
    connection: state.connection,
    connectionGrace,
    submitting,
    uploading,
    unavailable: !!chat?.sessionUnavailable,
    running: !!chat?.running,
    streaming: !!chat?.liveText,
    promptCount: chat?.prompts.length ?? 0,
    queuedCount: waitingPrompts(chat?.pending ?? []).length,
    unknownCount: (chat?.pending ?? []).filter((item) => obj(item).status === "unknown").length,
    unsentCount: state.outbox.filter((item) => item.session_id === id && !item.error).length,
    failedCount:
      state.outbox.filter((item) => item.session_id === id && !!item.error).length +
      state.queuedEdits.filter((item) => item.session_id === id && !!item.error).length,
    acceptedCount: (chat?.localMessages ?? []).filter((item) => item.status === "accepted").length,
  });
  function startSubmit() {
    if (
      submitFlight.current ||
      uploading ||
      chat?.sessionUnavailable ||
      (!draft.trim() && !attachments.length)
    )
      return;
    const flight = {};
    submitFlight.current = flight;
    setSubmitting(true);
    void submit()
      .catch((e) => Alert.alert("Could not send", String(e)))
      .finally(() => {
        if (submitFlight.current === flight) {
          submitFlight.current = null;
          setSubmitting(false);
        }
      });
  }
  const objectIds = useRef(new WeakMap<object, number>());
  const nextObjectId = useRef(0);
  const stableObjectId = (value: unknown) => {
    if (!value || typeof value !== "object") return String(value);
    const object = value as object;
    let key = objectIds.current.get(object);
    if (key === undefined) {
      key = ++nextObjectId.current;
      objectIds.current.set(object, key);
    }
    return String(key);
  };
  const historyItems = useMemo(
    () =>
      (chat?.messages ?? [])
        .filter((value) => showHistoryMessage(value, showActivity))
        .map((value) => ({
          key:
            obj(value).row_id != null
              ? `row:${obj(value).row_id}`
              : `m:${obj(value).turn_id ?? obj(value).message_id ?? stableObjectId(value)}`,
          kind: "message",
          value,
        })),
    [chat?.messages, showActivity],
  );
  const localItems = useMemo(
    () =>
      (chat?.localMessages ?? [])
        .filter(
          (message) =>
            message.status !== "completed" &&
            !state.outbox.some(
              (item) => item.submission_id === message.submission_id && item.error,
            ),
        )
        .map((value) => ({
          key: `local-${value.submission_id}`,
          kind: "local",
          value,
        })),
    [chat?.localMessages, state.outbox],
  );
  const activityItems = useMemo(
    () =>
      (chat?.blocks ?? [])
        .filter((value) => showActivityEvent(value, showActivity))
        .map((value) => {
          const event = obj(value),
            payload = obj(event.payload);
          return {
            key: `b:${payload.turn_id ?? event.admission_id ?? event.execution_generation ?? ""}:${payload.tool_call_id ?? payload.tool_id ?? payload.id ?? (/^(reasoning|thinking)\./.test(String(event.type)) ? "reasoning" : (event.seq ?? stableObjectId(value)))}`,
            kind: "activity",
            value,
          };
        }),
    [chat?.blocks, showActivity],
  );
  const items = useMemo(
    () => [
      ...historyItems,
      ...localItems,
      ...(chat?.liveText
        ? [
            {
              key: "live",
              kind: "message",
              value: { role: "assistant", text: chat.liveText },
            },
          ]
        : []),
      ...activityItems,
      ...(chat?.prompts ?? []).map((value, i) => ({
        key: `p:${obj(value).prompt_id ?? i}`,
        kind: "prompt",
        value,
      })),
    ],
    [historyItems, localItems, activityItems, chat?.liveText, chat?.prompts],
  );
  const shouldIndexMessages = findOpen && !!findQuery.trim();
  const historySearchText = useMemo(
    () =>
      new Map(
        shouldIndexMessages
          ? historyItems.map(
              (item) =>
                [
                  item.key,
                  extractImages(historyMessageContent(obj(item.value), showActivity)).text,
                ] as const,
            )
          : [],
      ),
    [historyItems, showActivity, shouldIndexMessages],
  );
  const loadedSearchRows = useMemo(
    () =>
      !shouldIndexMessages
        ? []
        : items.flatMap((item, index) => {
            if (item.kind === "local")
              return [{ key: item.key, index, text: String(obj(item.value).text ?? "") }];
            if (item.kind !== "message") return [];
            return [
              {
                key: item.key,
                index,
                text:
                  historySearchText.get(item.key) ??
                  extractImages(historyMessageContent(obj(item.value), showActivity)).text,
              },
            ];
          }),
    [items, showActivity, shouldIndexMessages, historySearchText],
  );
  const matches = useMemo(
    () => findLoadedMessages(loadedSearchRows, findQuery),
    [loadedSearchRows, findQuery],
  );
  const selectedMatch = matches.findIndex((match) => match.key === findKey);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  const jumpRequest = useRef<{
    key: string;
    attempts: number;
    lastMeasured: number;
    stagnant: number;
    repositioning: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const cancelFindJump = useCallback(() => {
    const request = jumpRequest.current;
    if (request?.timer) clearTimeout(request.timer);
    jumpRequest.current = null;
  }, []);
  useEffect(() => cancelFindJump, [cancelFindJump, id, endpointEpoch]);
  const isCurrentChat = useCallback(
    () =>
      appManager.getEndpointEpoch() === endpointEpoch &&
      appManager.getState().activeSessionId === id,
    [id, endpointEpoch],
  );
  const moveToMatch = useCallback(
    (key: string) => {
      cancelFindJump();
      const index = itemsRef.current.findIndex((item) => item.key === key);
      if (index < 0 || !findOpenRef.current || !isCurrentChat()) return;
      setFindKey(key);
      setFindError("");
      follow.dragStart();
      follow.dragEnd(false);
      jumpRequest.current = {
        key,
        attempts: 0,
        lastMeasured: -1,
        stagnant: 0,
        repositioning: false,
        timer: null,
      };
      try {
        list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.25 });
      } catch {
        cancelFindJump();
        setFindError("Scroll closer to the result, then try again.");
      }
    },
    [cancelFindJump, follow, isCurrentChat],
  );
  const onSearchJumpFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number }) => {
      const request = jumpRequest.current;
      if (!request || !findOpenRef.current || !isCurrentChat()) return;
      const fail = () => {
        cancelFindJump();
        setFindError("Scroll closer to the result, then try again.");
      };
      const hop = measuredSearchHop(request, info);
      if (request.repositioning || !hop) return fail();
      request.attempts = hop.attempts;
      request.lastMeasured = hop.lastMeasured;
      request.stagnant = hop.stagnant;
      // Move only to a frame the list has measured; never guess offsets for variable-height messages.
      request.timer = setTimeout(() => {
        if (jumpRequest.current !== request || !findOpenRef.current || !isCurrentChat()) return;
        try {
          request.repositioning = true;
          list.current?.scrollToIndex({ index: hop.frame, animated: false });
          request.repositioning = false;
          if (jumpRequest.current !== request) return;
          request.timer = setTimeout(() => {
            if (jumpRequest.current !== request || !findOpenRef.current || !isCurrentChat()) return;
            const index = itemsRef.current.findIndex((item) => item.key === request.key);
            if (index < 0) return fail();
            try {
              list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.25 });
            } catch {
              fail();
            }
          }, 180);
        } catch {
          fail();
        }
      }, 0);
    },
    [cancelFindJump, isCurrentChat],
  );
  const moveFind = (direction: 1 | -1) => {
    const key = nextMatchKey(matches, findKey, direction);
    if (key) moveToMatch(key);
  };
  const onActions = useCallback(
    (target: MessageActionTarget) => {
      if (isCurrentChat()) setActionTarget(target);
    },
    [isCurrentChat],
  );
  const onQuote = useCallback(
    (content: string, start: number, end: number) => {
      if (!isCurrentChat()) return;
      const next = appendQuote(appManager.getState().drafts[id] ?? "", content, start, end);
      if (next !== null) appManager.setDraft(id, next);
    },
    [id, isCurrentChat],
  );
  const onReadReply = useCallback((reply: string) => openVoice(reply), [speechOwner]);
  const renderTimelineItem = useCallback(
    ({ item }: { item: TimelineItem }) => {
      if (conversationDiagnostics.isEnabled()) {
        conversationDiagnostics.countRender("timeline_item");
        if (item.key === "live") conversationDiagnostics.countRender("live_message");
      }
      return item.kind === "message" ? (
        <Message
          value={item.value}
          sessionId={id}
          showActivity={showActivity}
          onReadReply={onReadReply}
          onActions={onActions}
          searchQuery={findOpen ? findQuery : ""}
          focused={findOpen && !!findQuery.trim() && item.key === findKey}
        />
      ) : item.kind === "local" ? (
        <LocalMessage
          value={item.value}
          sessionId={id}
          onActions={onActions}
          searchQuery={findOpen ? findQuery : ""}
          focused={findOpen && !!findQuery.trim() && item.key === findKey}
        />
      ) : item.kind === "prompt" ? (
        <Prompt value={item.value} id={id} />
      ) : (
        <Activity value={item.value} sessionId={id} />
      );
    },
    [id, showActivity, onReadReply, onActions, findOpen, findQuery, findKey],
  );
  const onListSize = useCallback(() => {
    if (!findOpenRef.current) follow.changed();
  }, [follow]);
  const onListScroll = useCallback(
    (event: any) => {
      const near = isNearBottom(event.nativeEvent);
      if (!findOpenRef.current) follow.position(near);
      setBottom(near);
    },
    [follow],
  );
  const historyHeader = useMemo(
    () => (
      <View style={{ gap: 8 }}>
        {!!chat?.messages.length && (
          <Button
            label="Load earlier"
            secondary
            disabled={!!chat?.sessionUnavailable || state.connection !== "ready"}
            onPress={() => {
              try {
                assertEndpoint();
                follow.prependStart();
                void appManager
                  .loadEarlier(id)
                  .catch((e) => Alert.alert("Could not load history", String(e)))
                  .finally(() => requestAnimationFrame(() => follow.prependEnd()));
              } catch (e) {
                Alert.alert("Could not load history", String(e));
              }
            }}
          />
        )}
        {chat?.partialUnavailable && (
          <Text style={{ color: colors.warning }}>
            Some live text is unavailable after reconnecting.
          </Text>
        )}
      </View>
    ),
    [
      id,
      chat?.messages.length,
      chat?.sessionUnavailable,
      chat?.partialUnavailable,
      state.connection,
      endpointEpoch,
      follow,
    ],
  );
  async function submit() {
    assertEndpoint();
    if (chat?.sessionUnavailable)
      throw new Error("Copy your saved text into an available session to send it.");
    if (!draft.trim() && !attachments.length) return;
    const parsed = !attachments.length ? parseSlash(draft) : null;
    if (parsed && parsed.name) {
      const { name: rawName, arg } = parsed;
      if (rawName === "model" && !arg) {
        openSettings();
        return;
      }
      const payload = rawName === "model" ? modelPayload(arg) : null;
      if (rawName === "model" && payload) {
        await changeModel(payload);
      } else if (rawName === "model") {
        const result: any = await appManager.request("slash.exec", {
          session_id: id,
          command: draft,
        });
        assertEndpoint();
        Alert.alert("Command", result.output ?? result.warning ?? "Done");
      } else if (rawName === "branch" || rawName === "compress") {
        const result: any = await appManager.mutate(
          id,
          rawName,
          arg ? { [rawName === "branch" ? "title" : "focus"]: arg } : {},
        );
        assertEndpoint();
        if (result.branched_session_id) await appManager.openSession(result.branched_session_id);
        if (rawName === "compress" && result.lines)
          Alert.alert(
            "Compression preview",
            Array.isArray(result.lines) ? result.lines.join("\n") : String(result.lines),
          );
      } else {
        const directive: any = await appManager.command(id, rawName, arg);
        assertEndpoint();
        if (directive.type === "send" || directive.type === "skill") {
          const watch = watchTypedSend();
          try {
            const submission = await appManager.send(id, directive.message ?? draft);
            if (submission) watch?.bind(submission);
            else watch?.close();
          } catch (error) {
            watch?.close();
            throw error;
          }
        } else if (directive.type === "prefill") {
          appManager.replaceDraftIfUnchanged(id, draft, directive.message ?? "");
          return;
        } else if (directive.type === "exec" || directive.type === "plugin")
          Alert.alert("Command", directive.output ?? directive.notice ?? "Done");
        else if (directive.type === "alias") {
          appManager.replaceDraftIfUnchanged(id, draft, `/${directive.target ?? ""} ${arg}`.trim());
          return;
        }
      }
      assertEndpoint();
      appManager.replaceDraftIfUnchanged(id, draft, "");
      return;
    }
    const watch = watchTypedSend();
    try {
      const submission = await appManager.send(
        id,
        draft,
        attachments.map(({ path, mime }) => ({ path, mime })),
      );
      if (submission) watch?.bind(submission);
      else watch?.close();
    } catch (error) {
      watch?.close();
      throw error;
    }
    assertEndpoint();
    if (appManager.getState().activeSessionId === id)
      setAttachments((current) =>
        current.filter((item) => !attachments.some((sent) => sent.path === item.path)),
      );
  }
  async function changeModel(
    payload: { model: string; provider?: string },
    confirm?: string,
  ): Promise<void> {
    const scope = settingsScope.current;
    assertAttachmentScope();
    const result: any = await appManager.mutate(id, "model", {
      ...payload,
      ...(confirm ? { confirm } : {}),
    });
    assertAttachmentScope();
    if (settingsScope.current !== scope) return;
    if (result?.status === "confirmation_required" && typeof result.confirm === "string") {
      const ticket = modeConfirmation.current.issue();
      Alert.alert("Confirm model change", result.message ?? "Apply this model?", [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            modeConfirmation.current.consume(ticket);
          },
        },
        {
          text: "Confirm",
          onPress: () => {
            if (!modeConfirmation.current.consume(ticket)) return;
            if (
              settingsScope.current !== scope ||
              appManager.getEndpointEpoch() !== endpointEpoch ||
              appManager.getState().activeSessionId !== id ||
              reasoningBusy.current
            )
              return;
            const flight = modeConfirmation.current.begin();
            if (!flight) return;
            setModelBusy(true);
            void changeModel(payload, result.confirm)
              .catch(() => {
                if (
                  settingsScope.current === scope &&
                  appManager.getEndpointEpoch() === endpointEpoch &&
                  appManager.getState().activeSessionId === id
                )
                  Alert.alert("Could not change model", "Please try again.");
              })
              .finally(() => {
                if (modeConfirmation.current.finish(flight)) setModelBusy(false);
              });
          },
        },
      ]);
    } else {
      closeSettings();
      if (result?.status === "deferred")
        Alert.alert("Model change queued", "The model will change on the next turn.");
    }
  }
  async function applyConversationMode(mode: ConversationMode, confirm?: string): Promise<void> {
    const scope = settingsScope.current;
    assertAttachmentScope();
    if (modelLoad !== "ready" || !modeAvailable(mode, options))
      throw new Error("This mode is unavailable.");
    const result = await appManager.setConversationMode(id, {
      model: mode.model,
      provider: mode.provider,
      reasoning: mode.reasoning,
      ...(confirm ? { confirm } : {}),
    });
    assertAttachmentScope();
    if (settingsScope.current !== scope) return;
    if (result?.status === "confirmation_required") {
      if (typeof result.confirm !== "string") throw new Error("Model confirmation unavailable.");
      const ticket = modeConfirmation.current.issue();
      Alert.alert(
        "Confirm mode change",
        typeof result.confirm_message === "string" ? result.confirm_message : "Apply this mode?",
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              modeConfirmation.current.consume(ticket);
            },
          },
          {
            text: "Confirm",
            onPress: () => {
              if (!modeConfirmation.current.consume(ticket)) return;
              if (
                settingsScope.current !== scope ||
                appManager.getEndpointEpoch() !== endpointEpoch ||
                appManager.getState().activeSessionId !== id ||
                reasoningBusy.current
              )
                return;
              const flight = modeConfirmation.current.begin();
              if (!flight) return;
              setModelBusy(true);
              void applyConversationMode(mode, result.confirm as string)
                .catch(() => {
                  if (
                    settingsScope.current === scope &&
                    appManager.getEndpointEpoch() === endpointEpoch &&
                    appManager.getState().activeSessionId === id
                  )
                    Alert.alert(
                      "Could not change mode",
                      "Please check pending messages and try again.",
                    );
                })
                .finally(() => {
                  if (modeConfirmation.current.finish(flight)) setModelBusy(false);
                });
            },
          },
        ],
      );
    } else if (result?.status === "deferred")
      Alert.alert("Mode change queued", `${mode.label} will apply after the current turn.`);
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <View style={ui.row}>
          <Pressable
            accessibilityLabel="Back to sessions"
            accessibilityRole="button"
            onPress={() => appManager.goHome()}
            hitSlop={6}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.accent} />
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={openSettings}>
            <Text numberOfLines={1} style={[ui.text, { fontWeight: "700", fontSize: 18 }]}>
              {row?.title || "Chat"}
            </Text>
            <Text numberOfLines={1} style={ui.muted}>
              {currentConversationMode(chat?.snapshot?.info)} · {row?.model || "Default model"}
              {chat?.running && state.connection === "ready" ? " · Running" : ""} ▾
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Find in chat"
            onPress={() => {
              cancelFindJump();
              findOpenRef.current = true;
              follow.dragStart();
              follow.dragEnd(false);
              setFindOpen(true);
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Ionicons name="search" size={21} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Background tasks, ${tasks.length} observed`}
            onPress={() => {
              setTaskOpen(true);
              refreshTasks();
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Ionicons name="layers-outline" size={20} color={colors.accent} />
            {tasks.length > 0 && (
              <Text style={{ color: colors.accent, fontSize: 10 }}>{tasks.length}</Text>
            )}
          </Pressable>
          {chat?.running && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop turn"
              onPress={() =>
                void appManager.stop(id).catch((e) => Alert.alert("Could not stop", String(e)))
              }
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="stop-outline" size={21} color={colors.accent} />
            </Pressable>
          )}
        </View>
      </View>
      {findOpen && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <TextInput
              autoFocus
              accessibilityLabel="Find in loaded messages"
              value={findQuery}
              maxLength={120}
              onChangeText={(value) => {
                cancelFindJump();
                setFindQuery(value);
                setFindKey(null);
                setFindError("");
              }}
              placeholder="Find in chat"
              placeholderTextColor={colors.muted}
              style={[ui.input, { flex: 1, minWidth: 0 }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous search result"
              disabled={!matches.length}
              onPress={() => moveFind(-1)}
              style={{
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: matches.length ? 1 : 0.4,
              }}
            >
              <Ionicons name="chevron-up" size={23} color={colors.accent} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next search result"
              disabled={!matches.length}
              onPress={() => moveFind(1)}
              style={{
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: matches.length ? 1 : 0.4,
              }}
            >
              <Ionicons name="chevron-down" size={23} color={colors.accent} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close search"
              onPress={() => {
                cancelFindJump();
                findOpenRef.current = false;
                setFindOpen(false);
                setFindQuery("");
                setFindKey(null);
                setFindError("");
                follow.position(bottom);
              }}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="close" size={23} color={colors.muted} />
            </Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={[ui.muted, { paddingHorizontal: 4 }]}>
            {findError ||
              (!findQuery.trim()
                ? "Searches messages loaded in this chat."
                : matches.length
                  ? `${selectedMatch >= 0 ? `${selectedMatch + 1} of ` : ""}${matches.length} matching ${matches.length === 1 ? "message" : "messages"} · loaded messages only`
                  : "No matches in loaded messages.")}
          </Text>
        </View>
      )}
      {!!chat?.prompts.length && (
        <Pressable
          onPress={() => {
            follow.jump();
            setBottom(true);
          }}
          style={{ backgroundColor: colors.warningSurface, padding: 12 }}
        >
          <Text style={{ color: colors.warning, textAlign: "center" }}>
            Needs your response · View request ↓
          </Text>
        </Pressable>
      )}
      {state.error && (
        <Card style={{ borderColor: colors.warning, borderWidth: 1 }}>
          <Text style={{ color: colors.warning }}>{state.error}</Text>
        </Card>
      )}
      {chat?.sessionUnavailable && (
        <Card style={{ borderColor: colors.warning, borderWidth: 1 }}>
          <Text style={{ color: colors.warning }}>
            This session is no longer available on the gateway. Your saved text is kept on this
            phone.
          </Text>
          <Button
            label="Copy draft"
            secondary
            onPress={() => void Clipboard.setStringAsync(draft)}
          />
        </Card>
      )}
      {!chat?.sessionUnavailable &&
        !chat?.snapshot &&
        !chat?.messages.length &&
        state.connection !== "ready" &&
        !connectionGrace && (
          <Card>
            <Text style={ui.muted}>
              This session's history isn't cached on this phone. Reconnect to Hermes to load it.
            </Text>
          </Card>
        )}
      <View style={{ flex: 1 }}>
        <FlatList
          key={`${endpointEpoch}:${id}`}
          ref={list}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScrollBeginDrag={() => {
            cancelFindJump();
            follow.dragStart();
            setBottom(false);
          }}
          onScrollEndDrag={(event) => {
            const near = isNearBottom(event.nativeEvent);
            setBottom(near);
            follow.dragEnd(findOpenRef.current ? false : near);
          }}
          onMomentumScrollBegin={() => follow.momentumStart()}
          onMomentumScrollEnd={(event) => {
            const near = isNearBottom(event.nativeEvent);
            setBottom(near);
            follow.momentumEnd(findOpenRef.current ? false : near);
          }}
          onScrollToIndexFailed={onSearchJumpFailed}
          data={items}
          keyExtractor={timelineKey}
          contentContainerStyle={timelineStyle}
          keyboardShouldPersistTaps="handled"
          onLayout={onListSize}
          onContentSizeChange={onListSize}
          onScroll={onListScroll}
          scrollEventThrottle={100}
          ListHeaderComponent={historyHeader}
          renderItem={renderTimelineItem}
        />
        {!items.length && !!chat?.snapshot && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              gap: 8,
            }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.accent} />
            <Text style={[ui.heading, { fontSize: 22, textAlign: "center" }]}>
              What shall we work on?
            </Text>
            <Text style={[ui.muted, { textAlign: "center" }]}>
              Send a message to start the conversation.
            </Text>
          </View>
        )}
        {!bottom && !findOpen && (
          <Pressable
            onPress={() => {
              setBottom(true);
              follow.jump();
            }}
            style={{
              position: "absolute",
              bottom: 12,
              alignSelf: "center",
              padding: 9,
              backgroundColor: colors.raised,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: colors.accent }}>↓ Jump to latest</Text>
          </Pressable>
        )}
      </View>
      <View
        style={{
          padding: 12,
          gap: 8,
        }}
      >
        {(status || chat?.running) && (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 8,
              paddingVertical: 5,
            }}
          >
            {status &&
              (status.spinning ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons
                  name="sparkles"
                  size={17}
                  color={status.tone === "warning" ? colors.warning : colors.accent}
                />
              ))}
            <View style={{ flex: 1 }}>
              {status && (
                <>
                  <Text
                    style={{
                      color: status.tone === "warning" ? colors.warning : colors.accent,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {status.label}
                  </Text>
                  {!!status.detail && (
                    <Text style={[ui.muted, { fontSize: 12 }]}>{status.detail}</Text>
                  )}
                </>
              )}
            </View>
            {chat?.running && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Steer current turn"
                onPress={() =>
                  void appManager
                    .steer(id, draft)
                    .then(() => {
                      assertEndpoint();
                      appManager.replaceDraftIfUnchanged(id, draft, "");
                    })
                    .catch((e) => Alert.alert("Could not steer", String(e)))
                }
                style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 10 }}
              >
                <Text style={{ color: colors.accent }}>↗ Steer</Text>
              </Pressable>
            )}
          </View>
        )}

        {state.outbox
          .filter((item) => item.session_id === id && item.error)
          .map((item) => (
            <Card key={item.submission_id} style={{ borderColor: colors.warning, borderWidth: 1 }}>
              <Text style={{ color: colors.warning }}>Message not sent: {item.error}</Text>
              <Text numberOfLines={2} style={ui.muted}>
                {item.text || "(Image message)"}
              </Text>
              {!!item.attachments?.length && (
                <Text style={ui.muted}>{item.attachments.length} image attachment(s)</Text>
              )}
              <View style={[ui.row, { flexWrap: "wrap" }]}>
                <Button
                  label="Copy message"
                  secondary
                  onPress={() => void Clipboard.setStringAsync(item.text)}
                />
                <Button
                  label="Retry"
                  secondary
                  disabled={!!chat?.sessionUnavailable}
                  onPress={() =>
                    void appManager
                      .retryOutbox(item.submission_id)
                      .catch((e) => Alert.alert("Retry failed", String(e)))
                  }
                />
                <Button
                  label="Discard"
                  secondary
                  onPress={() =>
                    void appManager
                      .discardOutbox(item.submission_id)
                      .catch((e) => Alert.alert("Discard failed", String(e)))
                  }
                />
              </View>
            </Card>
          ))}
        {state.queuedEdits
          .filter((edit) => edit.session_id === id && edit.error)
          .map((edit) => (
            <Card key={edit.submission_id} style={{ borderColor: colors.warning, borderWidth: 1 }}>
              <Text style={{ color: colors.warning }}>Queued edit failed: {edit.error}</Text>
              <Text numberOfLines={2} style={ui.muted}>
                {edit.text}
              </Text>
              <View style={ui.row}>
                <Button
                  label="Copy edit"
                  secondary
                  onPress={() => void Clipboard.setStringAsync(edit.text)}
                />
                <Button
                  label="Retry"
                  secondary
                  disabled={!!chat?.sessionUnavailable}
                  onPress={() =>
                    void appManager
                      .retryQueuedEdit(edit.submission_id)
                      .catch((e) => Alert.alert("Retry failed", String(e)))
                  }
                />
                <Button
                  label="Discard"
                  secondary
                  onPress={() =>
                    void appManager
                      .discardQueuedEdit(edit.submission_id)
                      .catch((e) => Alert.alert("Discard failed", String(e)))
                  }
                />
              </View>
            </Card>
          ))}
        {[...waitingPrompts(chat?.pending ?? []), ...unknownPrompts(chat?.pending ?? [])].map(
          (p, i) => {
            const q = obj(p),
              admission = String(q.admission_id ?? "");
            return (
              <View key={i} style={[ui.row, { flexWrap: "wrap" }]}>
                <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>
                  {q.status === "unknown" ? "Delivery uncertain" : "Queued"}: {text(q)}
                </Text>
                {q.status === "unknown" && (
                  <Pressable
                    onPress={() =>
                      void appManager
                        .request("prompt.resolve_unknown", {
                          session_id: id,
                          admission_id: admission,
                          execution_generation:
                            q.execution_generation ?? chat?.snapshot?.execution_generation,
                        })
                        .catch((e) => Alert.alert("Could not resolve prompt", String(e)))
                    }
                  >
                    <Text style={{ color: colors.warning }}>Discard unknown</Text>
                  </Pressable>
                )}
                {q.status === "queued" && (
                  <>
                    <Pressable
                      onPress={() => {
                        const captured = appManager.captureDraft(id),
                          replacement = text(q);
                        const apply = () =>
                          appManager.replaceCapturedDraft(id, captured, replacement);
                        if (captured.text.length && captured.text !== replacement)
                          Alert.alert(
                            "Replace your draft?",
                            "Opening this queued message will replace your current draft.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Replace draft", onPress: apply },
                            ],
                          );
                        else apply();
                      }}
                    >
                      <Text style={{ color: colors.accent }}>Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void appManager
                          .replaceQueued(id, admission, draft)
                          .then(() => {
                            assertEndpoint();
                            appManager.replaceDraftIfUnchanged(id, draft, "");
                          })
                          .catch((e) => Alert.alert("Could not replace", String(e)))
                      }
                    >
                      <Text style={{ color: colors.accent }}>Replace</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void appManager
                          .steerQueued(id, admission)
                          .catch((e) => Alert.alert("Could not steer", String(e)))
                      }
                    >
                      <Text style={{ color: colors.accent }}>Steer</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void appManager
                          .cancelQueued(id, admission)
                          .catch((e) => Alert.alert("Could not cancel", String(e)))
                      }
                    >
                      <Text style={{ color: colors.warning }}>Cancel</Text>
                    </Pressable>
                  </>
                )}
              </View>
            );
          },
        )}
        {!!attachments.length && (
          <ScrollView horizontal>
            {attachments.map((a, i) => (
              <Pressable
                key={a.path}
                accessibilityLabel="Remove attachment"
                onPress={() => setAttachments((old) => old.filter((_, n) => n !== i))}
              >
                <Image
                  source={{ uri: a.uri }}
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    marginRight: 8,
                  }}
                />
                <Text style={ui.muted}>Remove</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!!suggestions.length && (
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => appManager.setDraft(id, s.startsWith("/") ? `${s} ` : `/${s} `)}
              >
                <Text style={{ color: colors.accent }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            backgroundColor: colors.surface,
            borderRadius: 28,
            minHeight: 58,
            paddingHorizontal: 4,
            paddingVertical: 5,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add image"
            disabled={uploading || !!chat?.sessionUnavailable}
            onPress={() =>
              Alert.alert("Add image", "Choose a source", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Camera",
                  onPress: () =>
                    void attach(true).catch((e) =>
                      Alert.alert("Could not attach image", String(e)),
                    ),
                },
                {
                  text: "Photos",
                  onPress: () =>
                    void attach(false).catch((e) =>
                      Alert.alert("Could not attach image", String(e)),
                    ),
                },
              ])
            }
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              opacity: uploading || chat?.sessionUnavailable ? 0.4 : 1,
            }}
          >
            <Ionicons name="add" size={26} color={colors.accent} />
          </Pressable>
          <MessageInput
            key={`${endpointEpoch}:${id}`}
            value={draft}
            onChangeText={(t) => appManager.setDraft(id, t)}
          />
          {composerActions(draft, attachments.length).showVoice && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk in this chat"
              disabled={!!chat?.sessionUnavailable}
              onPress={() => openVoice()}
              style={{
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: chat?.sessionUnavailable ? 0.4 : 1,
              }}
            >
              <Ionicons name="pulse-outline" size={22} color={colors.accent} />
            </Pressable>
          )}
          {composerActions(draft, attachments.length).showSend && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={chat?.running ? "Queue message" : "Send message"}
              disabled={
                uploading ||
                submitting ||
                !!chat?.sessionUnavailable ||
                (!draft.trim() && !attachments.length)
              }
              onPress={startSubmit}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accent,
                opacity:
                  uploading ||
                  submitting ||
                  chat?.sessionUnavailable ||
                  (!draft.trim() && !attachments.length)
                    ? 0.4
                    : 1,
              }}
            >
              <Ionicons name="send" size={21} color={colors.ink} />
            </Pressable>
          )}
        </View>
      </View>
      <MessageActionSheet
        key={`${endpointEpoch}:${id}`}
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onQuote={onQuote}
        onRead={onReadReply}
        isCurrent={isCurrentChat}
      />
      <TaskTray
        key={`${origin}:${endpointEpoch}:${id}`}
        visible={taskOpen}
        scope={JSON.stringify([origin, endpointEpoch, id])}
        tasks={tasks}
        refreshing={taskRefreshing}
        error={taskError}
        result={taskResult}
        onClose={() => {
          taskRefreshRequest.current.invalidate();
          taskResultRequest.current.invalidate();
          setTaskOpen(false);
          setTaskRefreshing(false);
          setTaskResult(null);
        }}
        onRefresh={refreshTasks}
        onSelect={selectTask}
        onInterrupt={interruptTask}
      />
      {typedLease.current?.owns() && speechState.phase !== "idle" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Text style={ui.muted}>Speaking reply</Text>
          <Button
            secondary
            label={speechState.phase === "paused" ? "Resume" : "Pause"}
            onPress={() => typedLease.current?.toggle()}
          />
          <Button
            secondary
            label="Stop"
            onPress={() => {
              typedLease.current?.release();
              typedLease.current = null;
            }}
          />
        </View>
      )}
      {voice &&
        voice.sessionId === id &&
        voice.origin === origin &&
        voice.epoch === endpointEpoch &&
        voice.revision === navigationRevision &&
        voice.owner === speechOwner && (
          <VoiceSheet
            sessionId={id}
            origin={appManager.getConfiguredOrigin()}
            endpointEpoch={endpointEpoch}
            navigationRevision={navigationRevision}
            title={row?.title || "Chat"}
            model={String(obj(chat?.snapshot?.info).model ?? row?.model ?? "Default model")}
            reasoning={String(obj(chat?.snapshot?.info).reasoning_effort ?? "Default reasoning")}
            reply={voice.reply}
            owner={speechOwner}
            lease={voice.lease}
            setPlaybackTrace={(trace) => {
              playbackTrace.current = trace;
            }}
            onNewConversation={async () => {
              if (
                appManager.getEndpointEpoch() !== endpointEpoch ||
                appManager.getConfiguredOrigin() !== origin ||
                appManager.getNavigationRevision() !== navigationRevision ||
                appManager.getState().activeSessionId !== id
              )
                return;
              const scope = JSON.stringify([endpointEpoch, origin, id, navigationRevision]);
              let transaction: VoiceEntryTransaction;
              const flight = newVoiceFlights.current.begin(
                scope,
                () => transaction?.owns() ?? false,
              );
              if (!flight) return;
              transaction = new VoiceEntryTransaction(endpointEpoch, origin, () => ({
                epoch: appManager.getEndpointEpoch(),
                origin: appManager.getConfiguredOrigin(),
                revision: appManager.getNavigationRevision(),
                session: appManager.getState().activeSessionId,
              }));
              let known: string | null = null;
              const valid = () =>
                transaction.owns() && appManager.getState().activeSessionId === id;
              const info = obj(chat?.snapshot?.info);
              try {
                const target = await appManager.createSession(
                  {
                    ...(row?.cwd ? { cwd: row.cwd } : {}),
                    ...(typeof info.model === "string" ? { model: info.model } : {}),
                    ...(typeof info.provider === "string" ? { provider: info.provider } : {}),
                  },
                  {
                    valid,
                    onCreated: (value) => {
                      known = value;
                    },
                    onActivated: transaction.activated,
                  },
                );
                transaction.publish(target);
              } catch {
                const owns = newVoiceFlights.current.current(flight);
                transaction.cancel();
                if (!owns) return;
                if (known) {
                  const target = known;
                  Alert.alert("Chat created", "The new chat could not be opened.", [
                    { text: "Later", style: "cancel" },
                    {
                      text: "Open voice",
                      onPress: () => {
                        if (
                          !transaction.owns() ||
                          ![id, target].includes(appManager.getState().activeSessionId ?? "")
                        )
                          return;
                        const retry = new VoiceEntryTransaction(endpointEpoch, origin, () => ({
                          epoch: appManager.getEndpointEpoch(),
                          origin: appManager.getConfiguredOrigin(),
                          revision: appManager.getNavigationRevision(),
                          session: appManager.getState().activeSessionId,
                        }));
                        void appManager
                          .openSession(target, { valid: retry.owns, onActivated: retry.activated })
                          .then((resolved) => {
                            retry.publish(resolved ?? target);
                          })
                          .catch(() => {
                            const current = retry.owns();
                            retry.cancel();
                            if (current)
                              Alert.alert(
                                "Could not open chat",
                                "Find the created chat in the chat list.",
                              );
                          });
                      },
                    },
                  ]);
                } else {
                  newVoiceFlights.current.markUnknown(flight);
                  Alert.alert(
                    "Creation status unknown",
                    "Review the chat list before starting another conversation. A chat may already have been created.",
                  );
                  void appManager.refreshSessions().catch(() => {});
                }
              } finally {
                newVoiceFlights.current.finish(flight);
              }
            }}
            images={visibleRoomImages(voiceImages, voice.lease, attachments)}
            onAttach={async (camera) => {
              const owner = voice.lease;
              const added = await attach(camera);
              if (added?.length)
                setVoiceImages((old) =>
                  addRoomImages(
                    old,
                    owner,
                    added,
                    voiceLease.current === owner &&
                      appManager.getEndpointEpoch() === endpointEpoch &&
                      appManager.getNavigationRevision() === navigationRevision &&
                      appManager.getState().activeSessionId === id,
                  ),
                );
            }}
            onRemoveImage={(image) => {
              if (
                voiceLease.current !== voice.lease ||
                appManager.getNavigationRevision() !== navigationRevision
              )
                return;
              setVoiceImages((old) =>
                old?.owner === voice.lease
                  ? { ...old, images: old.images.filter((x) => x.path !== image.path) }
                  : old,
              );
              setAttachments((old) => old.filter((x) => x.path !== image.path));
            }}
            onImagesSent={(selected) => {
              if (
                voiceLease.current === voice.lease &&
                appManager.getEndpointEpoch() === endpointEpoch &&
                appManager.getNavigationRevision() === navigationRevision &&
                appManager.getState().activeSessionId === id
              )
                setVoiceImages((old) =>
                  old?.owner === voice.lease
                    ? {
                        ...old,
                        images: old.images.filter(
                          (image) => !selected.some((sent) => sent.path === image.path),
                        ),
                      }
                    : old,
                );
            }}
            onClose={() => closeVoice(voice.lease)}
          />
        )}
      <Sheet
        visible={settings}
        title="Chat settings"
        onClose={closeSettings}
        closeDisabled={modelBusy}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 22, gap: 12 }}
        >
          {!!chat?.usage && !!formatUsage(chat.usage) && (
            <Text style={ui.muted}>{formatUsage(chat.usage)}</Text>
          )}
          {(chat?.localMessages ?? []).some((message) => message.status === "completed") && (
            <>
              <Button
                label={`${showSavedText ? "Hide" : "Show"} saved sent text`}
                secondary
                onPress={() => setShowSavedText((value) => !value)}
              />
              {showSavedText && (
                <ScrollView style={{ maxHeight: 180 }}>
                  {(chat?.localMessages ?? [])
                    .filter((message) => message.status === "completed")
                    .map((message) => (
                      <LocalMessage key={message.submission_id} value={message} sessionId={id} />
                    ))}
                </ScrollView>
              )}
            </>
          )}
          {(chat?.draftAlternatives ?? []).map((aliasId) => (
            <Card key={aliasId}>
              <Text style={ui.text}>Another saved draft for this session</Text>
              <Text selectable style={ui.muted}>
                {state.drafts[aliasId] ?? ""}
              </Text>
              <Button
                label="Swap with current draft"
                secondary
                onPress={() => {
                  try {
                    assertEndpoint();
                    appManager.swapAliasDraft(id, aliasId);
                  } catch (e) {
                    Alert.alert("Could not restore draft", String(e));
                  }
                }}
              />
              <Button
                label="Copy saved draft"
                secondary
                onPress={() => void Clipboard.setStringAsync(state.drafts[aliasId] ?? "")}
              />
            </Card>
          ))}
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
          <TextInput
            accessibilityLabel="Session title"
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={colors.muted}
            style={ui.input}
          />
          <Button
            label="Rename"
            secondary
            onPress={() => {
              const scope = settingsScope.current;
              void appManager
                .mutate(id, "rename", { title: title.trim() })
                .then(() => {
                  if (
                    settingsScope.current === scope &&
                    appManager.getEndpointEpoch() === endpointEpoch &&
                    appManager.getState().activeSessionId === id
                  )
                    closeSettings();
                })
                .catch(() => {
                  if (settingsScope.current === scope)
                    Alert.alert("Could not rename", "Please try again.");
                });
            }}
          />
          <Text style={ui.label}>Conversation mode</Text>
          <Text style={ui.muted}>
            Current: {currentConversationMode(chat?.snapshot?.info)}. Modes apply to this shared
            chat.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {conversationModes.map((mode) => (
              <Button
                key={mode.label}
                secondary
                label={mode.label}
                disabled={modelBusy || modelLoad !== "ready" || !modeAvailable(mode, options)}
                onPress={() => {
                  if (reasoningBusy.current || modeConfirmation.current.busy()) return;
                  modeConfirmation.current.invalidate();
                  const flight = modeConfirmation.current.begin(),
                    scope = settingsScope.current;
                  if (!flight) return;
                  setModelBusy(true);
                  void applyConversationMode(mode)
                    .catch(() => {
                      if (
                        settingsScope.current === scope &&
                        appManager.getEndpointEpoch() === endpointEpoch &&
                        appManager.getState().activeSessionId === id
                      )
                        Alert.alert(
                          "Could not change mode",
                          appManager.getState().outbox.some((item) => item.session_id === id)
                            ? "Wait for pending messages to be admitted before changing mode."
                            : "Please check the connection and try again.",
                        );
                    })
                    .finally(() => {
                      if (modeConfirmation.current.finish(flight)) setModelBusy(false);
                    });
                }}
              />
            ))}
          </View>
          <Text style={ui.muted}>
            Unavailable modes need an available model in your existing Codex access. Advanced
            choices remain below.
          </Text>
          <Text style={ui.muted}>Current: {currentModel || row?.model || "Gateway default"}</Text>
          <ModelPicker
            options={options}
            selected={model}
            onSelect={setModel}
            query={modelSearch}
            onQuery={setModelSearch}
            state={modelLoad}
            retry={() => setModelRetry((n) => n + 1)}
            defaultLabel="Current model"
          />
          <Button
            label={modelBusy ? "Changing model…" : "Set model"}
            secondary
            disabled={!model || model.disabled || modelBusy || modelLoad !== "ready"}
            onPress={() => {
              if (
                !model ||
                model.disabled ||
                reasoningBusy.current ||
                modeConfirmation.current.busy()
              )
                return;
              modeConfirmation.current.invalidate();
              const flight = modeConfirmation.current.begin(),
                scope = settingsScope.current;
              if (!flight) return;
              setModelBusy(true);
              void changeModel({ model: model.model, provider: model.provider })
                .catch(() => {
                  if (
                    settingsScope.current === scope &&
                    appManager.getEndpointEpoch() === endpointEpoch &&
                    appManager.getState().activeSessionId === id
                  )
                    Alert.alert(
                      "Could not change model",
                      "Please check the connection and try again.",
                    );
                })
                .finally(() => {
                  if (modeConfirmation.current.finish(flight)) setModelBusy(false);
                });
            }}
          />
          <ReasoningPicker
            key={`${endpointEpoch}:${id}`}
            sessionId={id}
            endpointEpoch={endpointEpoch}
            disabled={modelBusy}
            onBusyChange={(busy) => {
              if (
                appManager.getEndpointEpoch() === endpointEpoch &&
                appManager.getState().activeSessionId === id
              ) {
                reasoningBusy.current = busy;
                if (busy) modeConfirmation.current.invalidate();
                setModelBusy(busy);
              }
            }}
          />
        </ScrollView>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
