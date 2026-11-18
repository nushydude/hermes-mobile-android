import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, Pressable, ScrollView, Text, TextInput } from "react-native";
import { File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { appManager, useAppStore } from "../state";
import { Sheet } from "../components/Sheet";
import { Button, ui } from "../components/UI";
import { colors } from "../theme";
import {
  discardShare,
  getPendingShares,
  subscribeIncomingShares,
  type IncomingShare,
} from "./nativeSharing";

export function IncomingShareSheet({ enabled }: { enabled: boolean }) {
  const state = useAppStore((s) => ({ sessions: s.sessions, connection: s.connection }));
  const epoch = appManager.getEndpointEpoch();
  const [items, setItems] = useState<IncomingShare[]>([]),
    [text, setText] = useState(""),
    [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const flight = useRef<object | null>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      flight.current = null;
    },
    [],
  );
  const cancel = () => {
    abort.current?.abort();
    flight.current = null;
    setBusy(false);
  };
  const item = items[0];
  useEffect(() => {
    setText(item?.text ?? "");
    setTarget(null);
    setQuery("");
    setError("");
  }, [item?.id, epoch]);
  useEffect(() => {
    if (!enabled) return;
    let live = true,
      reading = false,
      again = false,
      notified = false;
    const refresh = async () => {
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        do {
          again = false;
          const pending = await getPendingShares();
          if (!live || appManager.getEndpointEpoch() !== epoch) return;
          const remaining: IncomingShare[] = [];
          for (const share of pending) {
            const prior = Object.entries(appManager.getState().chats).find(([, chat]) =>
              chat.importedShareIds?.includes(share.id),
            );
            if (prior) {
              // Re-checkpoint before deleting the inbox source, including after an earlier save failed.
              await appManager.importSharedDraft(prior[0], share.id, "", []);
              if (!live || appManager.getEndpointEpoch() !== epoch) return;
              await discardShare(share.id);
            } else remaining.push(share);
          }
          if (live) setItems(remaining);
        } while (again && live);
      } catch {
        if (live) {
          setError("Could not open shared items. Reopen the app to try again.");
          if (!notified) {
            notified = true;
            Alert.alert(
              "Shared items unavailable",
              "Could not open the share inbox. Reopen the app to try again.",
            );
          }
        }
      } finally {
        reading = false;
      }
    };
    void refresh();
    const retry = setTimeout(() => void refresh(), 1000);
    const listener = subscribeIncomingShares((event) => {
      if (event?.error) Alert.alert("Shared item", event.error);
      void refresh();
    });
    const lifecycle = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      live = false;
      clearTimeout(retry);
      listener.remove();
      lifecycle.remove();
    };
  }, [enabled, epoch]);
  async function add() {
    if (!item || target === null || flight.current) return;
    const work = {};
    flight.current = work;
    const request = new AbortController();
    abort.current = request;
    const copyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setBusy(true);
    setError("");
    const origin = appManager.getConfiguredOrigin();
    let destination = "";
    let committed = false;
    const copies: File[] = [];
    const check = () => {
      if (
        flight.current !== work ||
        appManager.getEndpointEpoch() !== epoch ||
        appManager.getConfiguredOrigin() !== origin ||
        AppState.currentState !== "active"
      )
        throw Error("The chat changed. Your share is still in the inbox.");
    };
    try {
      check();
      if (target === "new") destination = await appManager.createSession();
      else {
        destination = (await appManager.openSession(target)) ?? "";
      }
      check();
      if (!destination || appManager.getState().activeSessionId !== destination)
        throw Error("The chat changed. Choose where to add the share again.");
      const images: Array<{ uri: string; path: string; mime: string }> = [];
      const prior = Object.entries(appManager.getState().chats).find(([, chat]) =>
        chat.importedShareIds?.includes(item.id),
      );
      if (prior && prior[0] !== destination) throw Error("This share is already in another chat.");
      if (!prior) {
        if (
          (appManager.getState().chats[destination]?.draftAttachments?.length ?? 0) +
            item.images.length >
          10
        )
          throw Error(
            "This draft can include up to 10 images. Remove an image or choose another chat.",
          );
        for (const source of item.images) {
          check();
          if (appManager.getState().activeSessionId !== destination)
            throw Error("The chat changed. Choose where to add the share again.");
          let uri = source.uri,
            mime = source.mime;
          if (/hei[cf]/i.test(mime)) {
            const converted = await ImageManipulator.manipulateAsync(uri, [], {
              compress: 0.9,
              format: ImageManipulator.SaveFormat.JPEG,
            });
            check();
            uri = converted.uri;
            mime = "image/jpeg";
          }
          const extension =
            mime === "image/png"
              ? "png"
              : mime === "image/gif"
                ? "gif"
                : mime === "image/webp"
                  ? "webp"
                  : "jpg";
          const copy = new File(
            Paths.cache,
            `hermes-share-${item.id}-${copyKey}-${images.length}.${extension}`,
          );
          new File(uri).copy(copy);
          copies.push(copy);
          if (copy.size > 25 * 1024 * 1024) throw Error("An image exceeds 25 MiB.");
          const base64 = await copy.base64();
          check();
          const uploaded = await appManager.uploadImage(
            `data:${mime};base64,${base64}`,
            source.name,
            request.signal,
          );
          check();
          images.push({ uri: copy.uri, path: uploaded.path, mime: uploaded.mime });
        }
      }
      check();
      if (appManager.getState().activeSessionId !== destination)
        throw Error("The chat changed. Choose where to add the share again.");
      await appManager.importSharedDraft(
        destination,
        item.id,
        text,
        images,
        () =>
          flight.current === work &&
          AppState.currentState === "active" &&
          appManager.getState().activeSessionId === destination,
      );
      committed = true;
      check();
      // The draft checkpoint owns independent preview copies now. It is safe to release the source.
      await discardShare(item.id);
      setItems((current) => current.filter((s) => s.id !== item.id));
    } catch (e) {
      if (!committed) {
        const referenced = Object.values(appManager.getState().chats).some((chat) =>
          chat.importedShareIds?.includes(item.id),
        );
        if (!referenced)
          for (const copy of copies)
            try {
              if (copy.exists) copy.delete();
            } catch {}
      }
      if (flight.current !== work) return;
      setError(
        committed
          ? "Added to your draft. The source inbox will be cleaned up when the app reopens."
          : e instanceof Error
            ? e.message
            : "Could not add this share. It remains in your inbox.",
      );
      if (committed) setItems((current) => current.filter((s) => s.id !== item.id));
    } finally {
      if (abort.current === request) abort.current = null;
      if (flight.current === work) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  function discard() {
    if (!item || busy) return;
    Alert.alert("Discard shared item?", "This removes the shared copy from Hermes Mobile.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void discardShare(item.id)
            .then(() => setItems((current) => current.filter((s) => s.id !== item.id)))
            .catch(() => setError("Could not discard this item. Try again."));
        },
      },
    ]);
  }
  const [hidden, setHidden] = useState<string | null>(null);
  return (
    <>
      {enabled && item && hidden === item.id && (
        <Pressable
          onPress={() => setHidden(null)}
          style={{ padding: 12, backgroundColor: colors.raised }}
        >
          <Text style={{ color: colors.accent }}>
            Review shared item{items.length > 1 ? ` (${items.length})` : ""}
          </Text>
        </Pressable>
      )}
      <Sheet
        visible={enabled && !!item && hidden !== item.id}
        title={`Shared with Hermes${items.length > 1 ? ` (${items.length})` : ""}`}
        onClose={() => {
          cancel();
          setHidden(item?.id ?? null);
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 12 }}
          style={{ maxHeight: 520 }}
        >
          <Text style={ui.muted}>
            Choose a chat to add this to its draft. You can edit it before sending.
          </Text>
          {!!item?.error && <Text style={{ color: colors.warning }}>{item.error}</Text>}
          <TextInput
            accessibilityLabel="Shared text"
            multiline
            maxLength={100000}
            value={text}
            onChangeText={setText}
            editable={!busy}
            style={[ui.input, { minHeight: 64, maxHeight: 140, textAlignVertical: "top" }]}
            placeholder="Add a note…"
            placeholderTextColor={colors.muted}
          />
          {!!item?.images.length && (
            <ScrollView horizontal>
              {item.images.map((image) => (
                <Image
                  key={image.uri}
                  source={{ uri: image.uri }}
                  style={{ width: 64, height: 64, borderRadius: 12, marginRight: 8 }}
                  accessibilityLabel={image.name}
                />
              ))}
            </ScrollView>
          )}
          <TextInput
            accessibilityLabel="Find a destination chat"
            value={query}
            onChangeText={setQuery}
            editable={!busy}
            placeholder="Find a chat"
            placeholderTextColor={colors.muted}
            style={ui.input}
          />
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 160 }}
          >
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                checked: target === "new",
                disabled: busy || state.connection !== "ready",
              }}
              disabled={busy || state.connection !== "ready"}
              onPress={() => setTarget("new")}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.accent }}>
                {target === "new" ? "✓ " : ""}New chat · gateway defaults
              </Text>
            </Pressable>
            {state.sessions
              .filter(
                (row) =>
                  !row.session_unavailable &&
                  `${row.title ?? ""} ${row.cwd ?? ""}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
              )
              .map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: target === row.id, disabled: busy }}
                  disabled={busy}
                  onPress={() => setTarget(row.id)}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={ui.text}>
                    {target === row.id ? "✓ " : ""}
                    {row.title || "Untitled chat"}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
          {!!error && <Text style={{ color: colors.warning }}>{error}</Text>}
          <Button
            label={busy ? "Adding to draft…" : "Add to draft"}
            disabled={busy || target === null || (!text.trim() && !item?.images.length)}
            onPress={() => void add()}
          />
          {busy && <Button label="Cancel preparation" secondary onPress={cancel} />}
          <Button label="Discard shared item" secondary disabled={busy} onPress={discard} />
        </ScrollView>
      </Sheet>
    </>
  );
}
