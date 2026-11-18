import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Clipboard from "expo-clipboard";
import { conversationDiagnostics } from "../state/conversationDiagnostics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { appManager, useAppStore } from "../state";
import { Button, Card, ui } from "./UI";
import { Sheet } from "./Sheet";
import { colors } from "../theme";
import { VoiceController, DefiniteVoiceSendError } from "./voiceController";
import { VoiceMeterBridge } from "./voiceMeterBridge";
import { voiceVisualLevel } from "./voiceVisual";
import { roomMotion, roomMotionSpec } from "./voiceRoomMotion";
import { VoiceCorrelation } from "./voiceCorrelation";
import { speechParts, speechText } from "./voiceText";
import { voiceLeaseValid, type SpeechOwner, type SpeechLease } from "./speechOwner";
import { randomUUID } from "@hermes-mobile/protocol";
import { TranscriptTransfer } from "./transcriptTransfer";
import { queueVoiceAudioMode, registerVoiceCleanup, waitVoiceCleanup } from "./voiceAudioMode";

type Props = {
  sessionId: string;
  origin: string;
  endpointEpoch: number;
  navigationRevision: number;
  title: string;
  model: string;
  reasoning: string;
  reply?: string;
  onClose: () => void;
  owner: SpeechOwner;
  lease: SpeechLease;
  setPlaybackTrace: (trace: number | null) => void;
  onNewConversation: () => Promise<void>;
  images: { uri: string; path: string; mime: string }[];
  onAttach: (camera: boolean) => Promise<void>;
  onRemoveImage: (image: { uri: string; path: string; mime: string }) => void;
  onImagesSent: (images: { uri: string; path: string; mime: string }[]) => void;
};
const remove = (uri: string | null | undefined) => {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {}
};
export function VoiceSheet({
  sessionId,
  origin,
  endpointEpoch,
  navigationRevision,
  title,
  model,
  reasoning,
  reply,
  onClose,
  owner,
  lease,
  setPlaybackTrace,
  onNewConversation,
  images,
  onAttach,
  onRemoveImage,
  onImagesSent,
}: Props) {
  const insets = useSafeAreaInsets();
  const traceRef = useRef<number | null>(null);
  const transfer = useRef(new TranscriptTransfer());
  const [transferState, setTransferState] = useState<"idle" | "saving" | "retry" | "recovering">(
    "idle",
  );
  const [priorTranscriptSaved, setPriorTranscriptSaved] = useState(false);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const promptCount = useAppStore((s) => s.chats[sessionId]?.prompts.length ?? 0);
  const recording = useAudioRecorderState(recorder, 100);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const meterBridge = useMemo(() => new VoiceMeterBridge(), [recorder]);
  const lastReply = useRef<string | undefined>(reply);
  const recordedFile = useRef<string | null>(null);
  const stopping = useRef<Promise<string | null> | null>(null),
    watch = useRef<(() => void) | null>(null);
  const identityValid = () =>
    voiceLeaseValid(
      lease,
      () =>
        appManager.getEndpointEpoch() === endpointEpoch &&
        appManager.getNavigationRevision() === navigationRevision &&
        appManager.getConfiguredOrigin() === origin &&
        appManager.getState().activeSessionId === sessionId,
    );
  const scopeValid = () => AppState.currentState === "active" && identityValid();
  const playback = owner.playback;
  useEffect(() => () => lease.release(), [lease]);
  const controller = useMemo(() => {
    const stopPlayback = lease.stop;
    const stopRecorder = () => {
      if (stopping.current) return stopping.current;
      const work = (async () => {
        try {
          if (recorder.isRecording) await recorder.stop();
        } catch {}
        try {
          const uri = recorder.uri;
          if (uri) recordedFile.current = uri;
          return uri;
        } catch {
          return null;
        }
      })();
      stopping.current = work;
      const clear = () => {
        if (stopping.current === work) stopping.current = null;
      };
      void work.then(clear, clear);
      return work;
    };
    const discard = async () => {
      const uri = await stopRecorder();
      remove(uri);
      if (recordedFile.current === uri) recordedFile.current = null;
    };
    let instance: VoiceController;
    instance = new VoiceController({
      valid: scopeValid,
      shouldSpeak: () => true,
      automaticReady: () => {
        const s = appManager.getState(),
          chat = s.chats[sessionId];
        return (
          s.connection === "ready" &&
          !!chat &&
          !chat.sessionUnavailable &&
          !chat.prompts.length &&
          !s.secureRequest
        );
      },
      captureReady: () => {
        const s = appManager.getState(),
          chat = s.chats[sessionId];
        return (
          !!chat &&
          !chat.running &&
          !chat.pending.length &&
          !s.outbox.some((item) => item.session_id === sessionId)
        );
      },
      cancelPendingReply: () => {
        watch.current?.();
        watch.current = null;
      },
      permission: async () => (await requestRecordingPermissionsAsync()).granted,
      prepare: async () => {
        await waitVoiceCleanup();
        await queueVoiceAudioMode(setAudioModeAsync, true, scopeValid);
        await recorder.prepareToRecordAsync();
      },
      start: () => {
        traceRef.current = conversationDiagnostics.begin();
        meterBridge.begin(recordingRef.current, performance.now());
        recorder.record({ forDuration: 60 });
      },
      stop: async () => {
        conversationDiagnostics.mark(traceRef.current, "capture_end");
        return stopRecorder();
      },
      discard,
      transcribe: async (uri, signal) => {
        const trace = traceRef.current;
        conversationDiagnostics.mark(trace, "transcription_start");
        const file = new File(uri);
        if (!file.exists || file.size < 128 || file.size > 5 * 1024 * 1024) throw new Error();
        const b64 = await file.base64();
        if (signal.aborted || !scopeValid()) throw new Error();
        const result = await appManager.transcribeAudio(
          "data:audio/mp4;base64," + b64,
          signal,
          endpointEpoch,
        );
        if (scopeValid() && !signal.aborted)
          conversationDiagnostics.mark(trace, "transcription_end");
        return result;
      },
      send: async (text, valid, images) => {
        const trace = traceRef.current;
        conversationDiagnostics.mark(trace, "submission_start");
        watch.current?.();
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let unsubEvent = () => {},
          unsubState = () => {},
          closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          correlation.close();
          unsubEvent();
          unsubState();
          if (timeout) clearTimeout(timeout);
          if (watch.current === close) watch.current = null;
        };
        const correlation = new VoiceCorrelation(
          sessionId,
          (submission) =>
            appManager
              .getState()
              .chats[sessionId]?.localMessages.find((x) => x.submission_id === submission)
              ?.admission_id,
          (event) => {
            if (!identityValid()) {
              close();
              return;
            }
            const spoken = typeof event.payload?.text === "string" ? event.payload.text : "";
            const status = event.payload?.status;
            conversationDiagnostics.mark(trace, "reply_complete");
            setPlaybackTrace(trace);
            close();
            if (status === "complete" && spoken.trim()) {
              lastReply.current = spoken;
              setTimeout(() => {
                if (identityValid() && (instance.isAutomatic() || valid()))
                  void instance.reply(spoken);
              }, 0);
            } else
              instance.settle(
                instance.isAutomatic() ? identityValid : valid,
                status === "complete"
                  ? "empty"
                  : status === "interrupted" || status === "cancelled"
                    ? "interrupted"
                    : "error",
              );
          },
        );
        unsubEvent = appManager.subscribeVoiceEvents((event) => {
          if (
            event.session_id === sessionId &&
            event.type === "session.replay_gap" &&
            instance.isAutomatic()
          )
            instance.pause("Conversation paused because chat events were missed.");
          correlation.event(event);
        });
        unsubState = appManager.subscribe(() => correlation.refresh());
        watch.current = close;
        let submission: string;
        try {
          const result = await appManager.send(sessionId, text, images, {
            preserveDraft: true,
            consumeAttachments: !!images,
            valid,
            diagnosticTrace: trace,
          });
          if (!result) throw new Error();
          submission = result;
          conversationDiagnostics.mark(trace, "submission_saved");
        } catch {
          close();
          throw new DefiniteVoiceSendError();
        }
        correlation.bind(submission);
        if (!closed && valid())
          timeout = setTimeout(
            () => {
              if (instance.isAutomatic()) instance.settle(scopeValid, "timeout");
              else instance.waitingLonger(valid);
            },
            instance.isAutomatic() ? 120000 : 30000,
          );
        else if (!identityValid()) close();
      },
      play: async (text, signal) => {
        lastReply.current = text;
        const parts = speechParts(speechText(text));
        if (!parts.length) throw new Error("No speakable text");
        return lease.play(parts, signal);
      },
      stopPlayback,
    });
    return instance;
  }, [sessionId, origin, endpointEpoch, recorder, lease]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaFlight = useRef(false);
  const [visualLevel, setVisualLevel] = useState(0);
  useEffect(() => {
    setVisualLevel((value) => voiceVisualLevel(value, state.activity));
  }, [state.activity]);
  const [reduceMotion, setReduceMotion] = useState(true);
  const pulse = useRef(new Animated.Value(0)).current;
  const levelAnimation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  const motion = roomMotion(state.phase, state.activity, reduceMotion),
    motionSpec = roomMotionSpec[motion];
  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);
    if (motion === "still") return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motionSpec.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: motionSpec.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, motion, motionSpec]);
  useEffect(() => {
    levelAnimation.stopAnimation();
    if (reduceMotion) {
      levelAnimation.setValue(0);
      return;
    }
    const animation = Animated.timing(levelAnimation, {
      toValue: visualLevel,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [levelAnimation, visualLevel, reduceMotion]);
  const [handsFree, setHandsFree] = useState(!reply);
  useEffect(() => {
    if (!reply) controller.startConversation();
  }, [controller, reply]);
  useEffect(() => {
    if (handsFree && state.phase === "recording") {
      const sample = meterBridge.sample(recording, performance.now());
      if (sample) controller.meter(sample.now, sample.level);
    }
  }, [controller, handsFree, state.phase, recording, meterBridge]);
  useEffect(() => {
    if (!handsFree || state.phase !== "recording") return;
    const timer = setInterval(() => {
      if (meterBridge.expired(performance.now()))
        controller.pause("Microphone metering is unavailable. Tap Resume to try again.");
    }, 250);
    return () => clearInterval(timer);
  }, [controller, handsFree, state.phase, meterBridge]);
  useEffect(() => {
    const unsubscribe = appManager.subscribe(() => {
      const s = appManager.getState(),
        chat = s.chats[sessionId];
      if (
        controller.isAutomatic() &&
        controller.getState().phase !== "paused" &&
        (s.connection !== "ready" ||
          !chat ||
          chat.sessionUnavailable ||
          chat.prompts.length > 0 ||
          s.secureRequest)
      )
        controller.pause("Conversation paused because the chat needs attention.");
    });
    return () => {
      unsubscribe();
    };
  }, [controller, sessionId]);
  useEffect(() => {
    const unsubscribe = appManager.subscribeVoiceEvents((event) => {
      if (
        event.session_id === sessionId &&
        event.type === "session.replay_gap" &&
        controller.isAutomatic() &&
        controller.getState().phase !== "paused"
      )
        controller.pause("Conversation paused because chat events were missed.");
    });
    return () => {
      unsubscribe();
    };
  }, [controller, sessionId]);
  useLayoutEffect(() => {
    const closeForLease = onClose;
    const lifecycle = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (reply) {
          watch.current?.();
          controller.end();
          closeForLease();
        } else controller.pause("Conversation paused while the app was in the background.");
      }
    });
    const unsub = appManager.subscribe(() => {
      if (
        !lease.owns() ||
        appManager.getEndpointEpoch() !== endpointEpoch ||
        appManager.getNavigationRevision() !== navigationRevision ||
        appManager.getConfiguredOrigin() !== origin ||
        appManager.getState().activeSessionId !== sessionId
      ) {
        watch.current?.();
        controller.end();
        closeForLease();
      }
    });
    return () => {
      lifecycle.remove();
      unsub();
      watch.current?.();
      registerVoiceCleanup(controller.end());
      remove(recordedFile.current);
    };
  }, [controller]);
  const close = () => {
    if (!transfer.current.canLeave()) return;
    watch.current?.();
    registerVoiceCleanup(controller.end());
    onClose();
  };
  const audio = useSyncExternalStore(playback.subscribe, playback.getState, playback.getState);
  const replay = () => {
    const text = lastReply.current;
    setPlaybackTrace(null);
    if (text) void controller.replay(text);
  };
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    setWaitingSeconds(0);
    if (state.phase !== "sent") return;
    const timer = setInterval(() => setWaitingSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);
  const micLevel =
    state.activity?.level ?? (recording.isRecording ? recording.metering : undefined);
  const meter =
    typeof micLevel === "number" && Number.isFinite(micLevel)
      ? Math.max(0, Math.min(1, (micLevel + 65) / 55))
      : null;
  const clock = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const canRead = ["idle", "error", "sent"].includes(state.phase);
  const central =
    state.phase === "recording"
      ? {
          label: handsFree ? "Finish speaking" : "Stop recording",
          icon: "stop" as const,
          action: () => void controller.stop(),
        }
      : handsFree && state.phase !== "playing"
        ? null
        : state.phase === "playing"
          ? {
              label: audio.phase === "paused" ? "Resume speaking" : "Pause speaking",
              icon: audio.phase === "paused" ? ("play" as const) : ("pause" as const),
              action: lease.toggle,
            }
          : reply && canRead
            ? { label: "Read reply", icon: "play" as const, action: replay }
            : !reply && ["idle", "error", "sent", "review"].includes(state.phase)
              ? {
                  label: state.phase === "review" ? "Record again" : "Record",
                  icon: "mic" as const,
                  action: () => void controller.start(),
                }
              : null;
  const status =
    state.phase === "recording"
      ? handsFree && (!state.activity || state.activity.phase === "calibrating")
        ? "Getting the mic ready"
        : handsFree && state.activity?.phase === "pause"
          ? "Finishing your sentence"
          : handsFree && state.activity?.phase === "speaking"
            ? "I hear you"
            : "I'm listening"
      : state.phase === "transcribing"
        ? "Transcribing"
        : state.phase === "review"
          ? "Review your words"
          : state.phase === "sent"
            ? waitingSeconds >= 20
              ? "Still waiting for the reply"
              : "Waiting for Hermes"
            : state.phase === "playing"
              ? audio.phase === "preparing"
                ? "Preparing audio"
                : audio.phase === "paused"
                  ? "Paused"
                  : "Hermes is speaking"
              : state.phase === "permission"
                ? "Preparing microphone"
                : state.phase === "sending"
                  ? "Saving message"
                  : state.phase === "paused"
                    ? "Conversation paused"
                    : state.phase === "cooldown"
                      ? "Getting ready to listen"
                      : "Ready when you are";
  if (!reply) {
    const active = state.phase !== "paused" && state.phase !== "idle" && state.phase !== "error";
    const hearing =
      state.phase === "recording" &&
      (state.activity?.phase === "speaking" || state.activity?.phase === "pause");
    const processing = ["transcribing", "sending", "sent", "cooldown"].includes(state.phase);
    const orbColor =
      state.phase === "paused"
        ? "#60786a"
        : state.phase === "playing"
          ? "#d2f3df"
          : hearing
            ? "#c9f0d5"
            : processing
              ? "#81ac93"
              : colors.accent;
    const addMedia = () => {
      controller.pause();
      void controller.waitForCleanup().then(() => {
        if (!scopeValid()) return;
        Alert.alert("Add image", "Choose a source", [
          { text: "Cancel", style: "cancel" },
          { text: "Camera", onPress: () => void onAttach(true) },
          { text: "Photos", onPress: () => void onAttach(false) },
        ]);
      });
    };
    const requestEnd = () => {
      controller.pause();
      Alert.alert(
        "End voice conversation?",
        "Your chat and any ongoing work will remain available.",
        [
          { text: "Keep open", style: "cancel" },
          { text: "End voice", style: "destructive", onPress: close },
        ],
      );
    };
    return (
      <Modal visible animationType="slide" onRequestClose={requestEnd}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bg,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, letterSpacing: 2 }}>
                VOICE CONVERSATION
              </Text>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, marginTop: 4 }}>
                {title}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              onPress={() => {
                controller.pause();
                Alert.alert(
                  "Start a new conversation?",
                  "This chat and its work will remain available.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Start new",
                      onPress: () => {
                        controller.pause();
                        void controller.waitForCleanup().then(() => {
                          if (scopeValid()) return onNewConversation();
                        });
                      },
                    },
                  ],
                );
              }}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="End voice"
              onPress={requestEnd}
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.muted }}>End</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
              paddingVertical: 20,
            }}
          >
            <View
              style={{
                width: 230,
                height: 230,
                borderRadius: 115,
                backgroundColor: "#b7e8cb0d",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Animated.View
                style={{
                  transform: [
                    {
                      scale: Animated.add(
                        1,
                        Animated.add(
                          pulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, motionSpec.scale],
                          }),
                          levelAnimation.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 0.08],
                          }),
                        ),
                      ),
                    },
                    {
                      rotate: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [`${-motionSpec.rotation}deg`, `${motionSpec.rotation}deg`],
                      }),
                    },
                  ],
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={state.phase === "playing" ? "Interrupt and speak" : status}
                  disabled={state.phase !== "playing"}
                  onPress={() => controller.interruptAndSpeak()}
                  style={{
                    width: 142,
                    height: 142,
                    borderRadius: 71,
                    backgroundColor: orbColor,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: state.phase === "paused" ? 0.55 : 1,
                  }}
                >
                  <Ionicons
                    name={
                      state.phase === "paused"
                        ? "pause"
                        : state.phase === "playing"
                          ? "volume-high"
                          : processing
                            ? "ellipsis-horizontal"
                            : "mic"
                    }
                    size={36}
                    color={colors.ink}
                  />
                </Pressable>
              </Animated.View>
            </View>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.text, fontSize: 27, textAlign: "center" }}
              >
                {status}
              </Text>
              <Text style={{ color: colors.muted, textAlign: "center", maxWidth: 285 }}>
                {state.phase === "playing"
                  ? "Tap the orb to interrupt and speak."
                  : state.phase === "recording"
                    ? hearing
                      ? "I hear you. Keep talking."
                      : "Speak when you are ready."
                    : state.notice ||
                      state.error ||
                      (processing
                        ? "Hermes is working on your message."
                        : "Keep this screen open to talk.")}
              </Text>
            </View>
          </ScrollView>
          {!!images.length && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                maxHeight: 88,
              }}
            >
              <ScrollView
                horizontal
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: 8, alignItems: "center" }}
              >
                {images.map((image, index) => (
                  <View
                    key={image.path}
                    style={{ width: 96, height: 72, justifyContent: "center" }}
                  >
                    <Image
                      source={{ uri: image.uri }}
                      style={{ width: 56, height: 56, borderRadius: 8 }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove image ${index + 1}`}
                      disabled={mediaBusy}
                      onPress={() => onRemoveImage(image)}
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: colors.raised,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="close" size={18} color={colors.text} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Button
                label={mediaBusy ? "Sending…" : "Send"}
                disabled={mediaBusy}
                onPress={() => {
                  if (mediaFlight.current) return;
                  mediaFlight.current = true;
                  setMediaBusy(true);
                  const selected = images.slice();
                  void controller
                    .sendImages(selected.map(({ path, mime }) => ({ path, mime })))
                    .then((sent) => {
                      if (sent) onImagesSent(selected);
                      else
                        Alert.alert(
                          "Could not send images",
                          "Your images remain in the draft. Check the chat is ready.",
                        );
                    })
                    .finally(() => {
                      mediaFlight.current = false;
                      setMediaBusy(false);
                    });
                }}
              />
            </View>
          )}
          <View style={{ alignItems: "center", gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 24 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add image"
                onPress={addMedia}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="add" size={26} color={colors.text} />
              </Pressable>
              <Button
                label={active ? "Pause" : "Resume"}
                disabled={!active && (mediaBusy || !!images.length)}
                onPress={() => (active ? controller.pause() : controller.resume())}
              />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
              Voice is active only while this screen is open.
            </Text>
          </View>
        </View>
      </Modal>
    );
  }
  return (
    <Sheet
      visible
      closeDisabled={transferState !== "idle"}
      title={reply ? "Read this reply" : "Talk in this chat"}
      closeLabel="End voice"
      onClose={close}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 500 }}
        contentContainerStyle={{ gap: 12 }}
      >
        <Text style={ui.text}>{title}</Text>
        <Text style={ui.muted}>
          {model} · {reasoning}
        </Text>
        {promptCount > 0 && (
          <Card
            style={{
              backgroundColor: colors.warningSurface,
              borderColor: colors.warning,
              borderWidth: 1,
            }}
          >
            <Text style={{ color: colors.warning }}>
              Hermes needs your response. Return to chat to review it.
            </Text>
            <Button label="Return to chat" secondary onPress={close} />
          </Card>
        )}
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: 22,
            paddingVertical: 20,
            gap: 12,
          }}
        >
          <View
            style={{
              width: state.phase === "recording" ? 80 : 126,
              height: state.phase === "recording" ? 80 : 126,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={central?.label ?? status}
              accessibilityState={{
                disabled: !central || audio.phase === "preparing" || transferState !== "idle",
              }}
              disabled={!central || audio.phase === "preparing" || transferState !== "idle"}
              onPress={() => {
                if (transfer.current.canLeave()) central?.action();
              }}
              style={{
                width: state.phase === "recording" ? 72 : 104,
                height: state.phase === "recording" ? 72 : 104,
                borderRadius: 52,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accent,
                opacity: central ? 1 : 0.5,
              }}
            >
              <Ionicons
                name={central?.icon ?? "mic"}
                size={state.phase === "recording" ? 30 : 40}
                color={colors.ink}
              />
            </Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={[ui.heading, { fontSize: 22 }]}>
            {status}
          </Text>
          {state.phase === "recording" && (
            <Text style={ui.muted}>{clock(recording.durationMillis / 1000)} / 1:00</Text>
          )}
          {state.phase === "recording" && (
            <View style={{ width: "90%", gap: 10 }}>
              <View
                accessible
                accessibilityLabel={
                  meter === null ? "Waiting for microphone readings" : "Live microphone level"
                }
                style={{
                  flexDirection: "row",
                  gap: 4,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {Array.from({ length: 16 }, (_, index) => (
                  <View
                    key={index}
                    style={{
                      flex: 1,
                      height: 8 + 20 * (1 - Math.abs(index - 7.5) / 8),
                      borderRadius: 4,
                      backgroundColor:
                        meter !== null && index / 16 < meter ? colors.accent : colors.raised,
                    }}
                  />
                ))}
              </View>
              <Text accessibilityLiveRegion="polite" style={[ui.muted, { textAlign: "center" }]}>
                {handsFree
                  ? !state.activity || state.activity.phase === "calibrating"
                    ? "Stay quiet briefly while I adjust to the room."
                    : state.activity.phase === "speaking"
                      ? "Speech detected. Keep talking."
                      : state.activity.phase === "pause"
                        ? "Pause detected. Finishing your recording…"
                        : "Mic ready. Start speaking."
                  : meter === null
                    ? "Waiting for microphone readings…"
                    : "Live microphone level. Tap Stop when you finish."}
              </Text>
              {handsFree && state.activity?.phase === "pause" && (
                <View
                  accessible
                  accessibilityLabel="Pause before automatic transcription"
                  style={{ height: 5, borderRadius: 3, backgroundColor: colors.raised }}
                >
                  <View
                    style={{
                      height: 5,
                      borderRadius: 3,
                      width: `${state.activity.pauseProgress * 100}%`,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
              )}
              <Text style={[ui.muted, { textAlign: "center", fontSize: 13 }]}>
                Your words appear after recording stops.
              </Text>
            </View>
          )}
          {state.phase === "transcribing" && (
            <Text style={[ui.muted, { textAlign: "center" }]}>
              Turning your recording into words…
            </Text>
          )}
          {state.phase === "sent" && (
            <Text style={[ui.muted, { textAlign: "center", paddingHorizontal: 16 }]}>
              Waiting {clock(waitingSeconds)}. Audio starts after Hermes finishes the full reply.
              Longer tasks can take a while.
            </Text>
          )}
          {state.phase === "playing" && (
            <>
              <Text style={ui.muted}>
                Part {audio.part + 1} of {audio.count}
              </Text>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{ height: 4, width: "90%", backgroundColor: colors.raised, borderRadius: 2 }}
              >
                <View
                  style={{
                    height: 4,
                    width: `${audio.duration > 0 ? Math.max(0, Math.min(100, (audio.position / audio.duration) * 100)) : 0}%`,
                    backgroundColor: colors.accent,
                    borderRadius: 2,
                  }}
                />
              </View>
              <Text style={ui.muted}>
                {clock(audio.position)} / {audio.duration > 0 ? clock(audio.duration) : "—"}
              </Text>
            </>
          )}
        </View>
        {handsFree && state.phase === "recording" && (
          <Button label="Finish speaking" secondary onPress={() => void controller.stop()} />
        )}
        {!!state.sentText && ["sent", "playing", "paused", "cooldown"].includes(state.phase) && (
          <Card>
            <Text style={[ui.text, { fontWeight: "700" }]}>You sent</Text>
            <Text selectable style={ui.text}>
              {state.sentText}
            </Text>
          </Card>
        )}
        {state.phase === "sent" && <Button label="Continue in chat" secondary onPress={close} />}
        {reply && (
          <Text style={ui.muted} numberOfLines={4}>
            {reply}
          </Text>
        )}
        {!reply && (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button
                label="Review first"
                disabled={controller.hasPending() || transferState !== "idle"}
                secondary={handsFree}
                onPress={() => {
                  if (transfer.current.canLeave()) {
                    controller.end();
                    setHandsFree(false);
                  }
                }}
              />
              <Button
                label="Hands-free"
                disabled={controller.hasPending() || transferState !== "idle"}
                secondary={!handsFree}
                onPress={() => {
                  if (transfer.current.canLeave()) {
                    controller.end();
                    setHandsFree(true);
                  }
                }}
              />
            </View>
            {handsFree ? (
              <>
                <Text style={ui.muted}>
                  Stay quiet for a moment when the mic starts, then speak. Your words send after
                  about 1.3 seconds of quiet. Listening resumes after Hermes finishes speaking. Keep
                  this screen open.
                </Text>
                <Button
                  label={
                    state.phase === "paused"
                      ? "Resume conversation"
                      : state.phase === "idle"
                        ? "Start conversation"
                        : "Pause conversation"
                  }
                  onPress={() => {
                    if (!transfer.current.canLeave()) return;
                    if (state.phase === "paused") controller.resume();
                    else if (state.phase === "idle") controller.startConversation();
                    else controller.pause();
                  }}
                />
              </>
            ) : (
              <Text style={ui.muted}>
                Record, review the words, then send. Your typed draft stays in the chat.
              </Text>
            )}
          </>
        )}
        {state.phase === "review" && (
          <TextInput
            accessibilityLabel="Review transcript"
            multiline
            value={state.text}
            onChangeText={(text) => {
              transfer.current.edit(text, controller.edit);
            }}
            editable={transferState === "idle"}
            style={[ui.input, { minHeight: 80, maxHeight: 160 }]}
          />
        )}
        {state.phase === "review" && !priorTranscriptSaved && (
          <Button
            label={transferState === "retry" ? "Retry saving draft" : "Type instead"}
            disabled={transferState === "saving" || transferState === "recovering"}
            secondary
            onPress={() => {
              if (!scopeValid()) return;
              const text = controller.getState().text;
              if (text.length > 100000) {
                Alert.alert(
                  "Transcript is too long",
                  "Shorten the transcript to 100,000 characters before adding it to the draft.",
                );
                return;
              }
              if (appManager.getState().chats[sessionId]?.sessionUnavailable) {
                Alert.alert(
                  "Chat unavailable",
                  "Keep your transcript here or copy it into another chat.",
                );
                return;
              }
              const work = transfer.current.begin(text, randomUUID);
              if (!work) return;
              setTransferState("saving");
              void appManager
                .importSharedDraft(sessionId, work.id, work.text, [], scopeValid, "transcript")
                .then(() => {
                  if (!scopeValid()) return;
                  const result = transfer.current.finish(work.token, controller.getState().text);
                  if (result === "saved") {
                    controller.end();
                    onClose();
                  } else if (result === "changed") {
                    setPriorTranscriptSaved(true);
                    setTransferState("idle");
                    Alert.alert(
                      "Earlier transcript saved",
                      "The earlier transcript was added to your draft. Your newer words remain here; copy them and check the draft before pasting.",
                    );
                  }
                })
                .catch(() => {
                  if (scopeValid() && transfer.current.fail(work.token)) {
                    setTransferState("retry");
                    Alert.alert(
                      "Could not save draft",
                      "Your transcript is still here. Try again.",
                    );
                  }
                });
            }}
          />
        )}
        {state.phase === "review" && (transferState === "retry" || priorTranscriptSaved) && (
          <Button
            label="Copy transcript and return to chat"
            disabled={transferState === "recovering"}
            secondary
            onPress={() => {
              if (!scopeValid() || !transfer.current.canRecover()) return;
              const text = controller.getState().text;
              setTransferState("recovering");
              void transfer.current
                .recover(
                  text,
                  Clipboard.setStringAsync,
                  scopeValid,
                  () => controller.getState().text,
                )
                .then((copied) => {
                  if (!scopeValid()) return;
                  if (copied) {
                    controller.end();
                    onClose();
                    Alert.alert(
                      "Transcript copied",
                      "Check the draft before pasting. The earlier save may already have added words.",
                    );
                  } else {
                    setTransferState(priorTranscriptSaved ? "idle" : "retry");
                    Alert.alert(
                      "Could not copy transcript",
                      "Your transcript is still here. Try again.",
                    );
                  }
                });
            }}
          />
        )}
        {["permission", "recording", "transcribing"].includes(state.phase) && (
          <Button label="Type instead" secondary onPress={close} />
        )}
        {state.phase === "review" && (
          <Button
            label="Send message"
            disabled={!state.text.trim() || transferState !== "idle"}
            onPress={() => {
              if (transfer.current.canLeave()) void controller.send();
            }}
          />
        )}
        {!reply && lastReply.current && canRead && (
          <Button
            label={state.phase === "error" ? "Retry last reply" : "Replay last reply"}
            onPress={replay}
          />
        )}
        {state.phase === "playing" && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              {
                label: "Replay",
                accessibilityLabel: "Replay reply",
                action: replay,
                availableDuringPreparation: false,
              },
              {
                label: "Back 10s",
                accessibilityLabel: "Back 10 seconds",
                action: () => void lease.rewind(),
                availableDuringPreparation: false,
              },
              {
                label: `${audio.speed}×`,
                accessibilityLabel: `Playback speed ${audio.speed} times`,
                action: () => {
                  const speeds = [0.8, 1, 1.25, 1.5];
                  lease.speed(speeds[(speeds.indexOf(audio.speed) + 1) % speeds.length]);
                },
                availableDuringPreparation: false,
              },
              {
                label: "Stop",
                accessibilityLabel: "Stop speaking",
                action: controller.stopSpeaking,
                availableDuringPreparation: true,
              },
            ].map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={item.accessibilityLabel}
                accessibilityState={{
                  disabled: audio.phase === "preparing" && !item.availableDuringPreparation,
                }}
                disabled={audio.phase === "preparing" && !item.availableDuringPreparation}
                onPress={item.action}
                style={{
                  flexGrow: 1,
                  minWidth: 100,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 16,
                  backgroundColor: colors.raised,
                  opacity:
                    audio.phase === "preparing" && !item.availableDuringPreparation ? 0.5 : 1,
                }}
              >
                <Text style={{ color: colors.accent, fontWeight: "700" }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!state.error && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ color: colors.warning }}
          >
            {state.error}
          </Text>
        )}
        {!!state.notice && (
          <Text accessibilityLiveRegion="polite" style={ui.muted}>
            {state.notice}
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
