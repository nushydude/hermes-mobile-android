import importlib.util
import json
import pathlib
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).parents[1] / "plugin" / "phone-notify" / "__init__.py"
spec = importlib.util.spec_from_file_location("phone_notify", path)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class Tests(unittest.TestCase):
    def test_registration(self):
        class Context:
            def __init__(self): self.hooks = {}
            def register_hook(self, name, callback): self.hooks[name] = callback
        ctx = Context()
        plugin.register(ctx)
        self.addCleanup(plugin._notifier.close)
        self.assertEqual(set(ctx.hooks), {"on_human_input_request", "on_human_input_resolved", "post_llm_call", "on_session_end"})

    def test_bounded_nonblocking_and_dedup(self):
        n = plugin.Notifier(capacity=1, start=False)
        started = time.monotonic()
        for _ in range(5000): n.human_request(session_id="s", request_id="r", kind="approval", prompt="secret")
        self.assertLess(time.monotonic() - started, 1)
        self.assertEqual(n.queue.qsize(), 1)
        self.assertNotIn("secret", repr(n.queue.get_nowait()))
        n.human_request(session_id="s", request_id="r", kind="approval")
        self.assertTrue(n.queue.empty())
        n.human_resolved(session_id="s", request_id="r")
        self.assertEqual(n.queue.get_nowait()[0], "clear")
        n.human_resolved(session_id="s", request_id="r")
        self.assertTrue(n.queue.empty())

    def test_final_turn_filter_and_dedup(self):
        n = plugin.Notifier(start=False)
        n.session_end(session_id="s", turn_id="t", completed=True)
        self.assertTrue(n.queue.empty())
        n.post_llm(session_id="s", turn_id="t", user_message="/loop hello", assistant_response="secret")
        n.session_end(session_id="s", turn_id="t", completed=True)
        self.assertTrue(n.queue.empty())
        n.post_llm(session_id="s", turn_id="x", user_message="hello", assistant_response="secret")
        n.session_end(session_id="s", turn_id="x", completed=True)
        n.post_llm(session_id="s", turn_id="x", user_message="hello")
        n.session_end(session_id="s", turn_id="x", completed=True)
        self.assertEqual(n.queue.qsize(), 1)
        self.assertNotIn("secret", repr(n.queue.get_nowait()))
        for i in range(600): n.post_llm(session_id="s", turn_id=str(i), user_message="hello")
        self.assertLessEqual(len(n.pending), plugin._LIMIT)
        self.assertLessEqual(len(n.seen), plugin._LIMIT)

    def test_validation_and_encoded_link(self):
        self.assertIsNone(plugin._valid_config({"publish_url":"http://evil.test", "topic":"a"}))
        self.assertIsNone(plugin._valid_config({"publish_url":"https://evil.test", "topic":"a"}))
        self.assertIsNone(plugin._valid_config({"publish_url":"http://127.0.0.1:9130/other", "topic":"a"}))
        self.assertIsNotNone(plugin._valid_config({"publish_url":"https://pc.tail.ts.net:9121", "topic":"a"}))
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d)/"config.json"
            p.write_text(json.dumps({"publish_url":"http://127.0.0.1:9130", "topic":"a", "token":"secret"}))
            n = plugin.Notifier(p, start=False)
            class Response:
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def read(self, n): return b""
            class Opener:
                def open(self, req, timeout):
                    self.req = req
                    return Response()
            opener = Opener()
            with patch.object(plugin, "build_opener", return_value=opener):
                n._send(("publish", "a/b ?", "123", "Hermes needs your input"))
            self.assertEqual(opener.req.get_header("Click"), "hermesmobile://session/a%2Fb%20%3F")
            self.assertEqual(opener.req.get_header("X-sequence-id"), "123")
            self.assertEqual(opener.req.data, b"Hermes needs your input")

    def test_failed_or_interrupted_without_post_and_automatic_suppression(self):
        n = plugin.Notifier(start=False)
        n.session_end(session_id="s", turn_id="failed", failed=True, completed=False)
        n.session_end(session_id="s", turn_id="failed", failed=True, completed=False)
        n.session_end(session_id="s", turn_id="interrupted", interrupted=True, completed=False)
        n.session_end(session_id="s", turn_id="unknown", completed=False)
        n.post_llm(session_id="s", turn_id="auto", user_message="/heartbeat run")
        n.session_end(session_id="s", turn_id="auto", failed=True)
        self.assertEqual(n.queue.qsize(), 2)
        self.assertEqual(n.queue.get_nowait()[-1], "Hermes turn ended")
        self.assertEqual(n.queue.get_nowait()[-1], "Hermes turn ended")

    def test_failure_one_attempt_and_close_nonblocking(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def sender(item):
            calls.append(item)
            entered.set()
            release.wait(2)
            raise OSError("secret")
        n = plugin.Notifier(sender=sender)
        n.human_request(session_id="s", request_id="r", kind="approval")
        self.assertTrue(entered.wait(1))
        before = time.monotonic()
        n.close()
        self.assertLess(time.monotonic() - before, .2)
        release.set()
        n.thread.join(1)
        self.assertEqual(len(calls), 1)
        self.assertFalse(n.thread.is_alive())

if __name__ == "__main__": unittest.main()
