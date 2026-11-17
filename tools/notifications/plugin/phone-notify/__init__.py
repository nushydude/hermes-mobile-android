"""Best-effort, privacy-preserving Hermes notification observer."""
import hashlib
import json
import os
import queue
import re
import threading
from collections import OrderedDict
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

_DEFAULT_CONFIG = Path(os.environ.get("HERMES_HOME") or (Path(os.environ["LOCALAPPDATA"]) / "hermes" if os.environ.get("LOCALAPPDATA") else Path.home() / ".hermes")) / "plugins" / "phone-notify" / "config.json"
_LIMIT = 256
_TOPIC = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _valid_config(raw):
    if not isinstance(raw, dict):
        return None
    base, topic, token = raw.get("publish_url"), raw.get("topic"), raw.get("token")
    if not isinstance(base, str) or not isinstance(topic, str) or not _TOPIC.fullmatch(topic):
        return None
    try:
        parts = urlsplit(base)
        # Accept the private PC listener or a Tailscale MagicDNS HTTPS host only.
        host = parts.hostname or ""
        good = (parts.scheme == "http" and host == "127.0.0.1") or (
            parts.scheme == "https" and host.endswith(".ts.net") and len(host) > len(".ts.net"))
        if not good or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
            return None
        _ = parts.port
        if token is not None and (not isinstance(token, str) or not token or "\n" in token or "\r" in token):
            return None
        return base.rstrip("/") + "/" + topic, token
    except (ValueError, TypeError):
        return None


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Notifier:
    def __init__(self, config_path=None, *, capacity=64, sender=None, start=True):
        self.path = Path(config_path or os.environ.get("HERMES_MOBILE_NOTIFY_CONFIG") or _DEFAULT_CONFIG)
        self.queue = queue.Queue(maxsize=capacity)
        self.sender = sender or self._send
        self.lock = threading.Lock()
        self.seen = OrderedDict()
        self.pending = OrderedDict()
        self.stopped = threading.Event()
        self.thread = None
        if start:
            self.thread = threading.Thread(target=self._run, name="phone-notify", daemon=True)
            self.thread.start()

    def _remember(self, store, key, value=True):
        store[key] = value
        store.move_to_end(key)
        while len(store) > _LIMIT:
            store.popitem(last=False)

    def _enqueue(self, item):
        if self.stopped.is_set():
            return False
        try:
            self.queue.put_nowait(item)
            return True
        except queue.Full:
            return False

    @staticmethod
    def _identity(value):
        return isinstance(value, str) and 0 < len(value) <= 512 and not any(ord(c) < 32 for c in value)

    def human_request(self, **kw):
        sid, rid, kind = kw.get("session_id"), kw.get("request_id"), kw.get("kind")
        if not self._identity(sid) or not self._identity(rid) or kind not in ("approval", "clarify", "sudo"):
            return
        seq = hashlib.sha256((sid + "\0" + rid).encode()).hexdigest()[:32]
        with self.lock:
            key = ("request", sid, rid)
            if key in self.seen:
                return
            if self._enqueue(("publish", sid, seq, "Hermes needs your input")):
                self._remember(self.seen, key)
                self._remember(self.pending, (sid, rid), seq)

    def human_resolved(self, **kw):
        sid, rid = kw.get("session_id"), kw.get("request_id")
        if not self._identity(sid) or not self._identity(rid):
            return
        with self.lock:
            seq = self.pending.get((sid, rid))
            if seq and self._enqueue(("clear", sid, seq, "")):
                self.pending.pop((sid, rid), None)

    def post_llm(self, **kw):
        sid, tid = kw.get("session_id"), kw.get("turn_id")
        if not self._identity(sid) or not self._identity(tid):
            return
        message = kw.get("user_message")
        # These explicit slash forms are the only origin signals present in this hook.
        auto = isinstance(message, str) and bool(re.match(r"^\s*/(?:loop|heartbeat)(?:\s|$)", message, re.I))
        with self.lock:
            self._remember(self.pending, ("turn", sid, tid), not auto)

    def session_end(self, **kw):
        sid, tid = kw.get("session_id"), kw.get("turn_id")
        if not self._identity(sid) or not self._identity(tid):
            return
        with self.lock:
            # None means post_llm_call was never fired (e.g. an interrupted turn).
            eligible = self.pending.pop(("turn", sid, tid), None)
            key = ("end", sid, tid)
            if eligible is False or key in self.seen:
                return
            if kw.get("failed") is True or kw.get("interrupted") is True:
                body = "Hermes turn ended"
            elif kw.get("completed") is True and eligible is True:
                body = "Hermes turn finished"
            else:
                return
            if self._enqueue(("publish", sid, None, body)):
                self._remember(self.seen, key)

    def _send(self, item):
        try:
            config = _valid_config(json.loads(self.path.read_text(encoding="utf-8-sig")))
            if not config:
                return
            url, token = config
            action, sid, seq, body = item
            headers = {"Title": "Hermes", "Click": "hermesmobile://session/" + quote(sid, safe="")}
            if token:
                headers["Authorization"] = "Bearer " + token
            if action == "clear":
                request = Request(url + "/" + seq + "/clear", method="PUT", headers=headers)
            else:
                if seq:
                    headers["X-Sequence-ID"] = seq
                request = Request(url, data=body.encode("utf-8"), method="POST", headers=headers)
            # Refuse redirects so an authentication header cannot leave the intended host.
            with build_opener(ProxyHandler({}), _NoRedirect()).open(request, timeout=3) as response:
                response.read(1024)
        except Exception:
            # Configuration, network failures and hook payloads must never enter logs.
            pass

    def _run(self):
        while not self.stopped.is_set():
            try:
                item = self.queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                self.sender(item)  # one attempt; no unbounded retry or backoff
            except Exception:
                pass
            finally:
                self.queue.task_done()

    def close(self):
        self.stopped.set()  # best effort, never joins a blocked network operation


_notifier = None


def register(ctx):
    global _notifier
    _notifier = Notifier()
    ctx.register_hook("on_human_input_request", _notifier.human_request)
    ctx.register_hook("on_human_input_resolved", _notifier.human_resolved)
    ctx.register_hook("post_llm_call", _notifier.post_llm)
    ctx.register_hook("on_session_end", _notifier.session_end)
