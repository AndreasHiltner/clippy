import clippy as clippy_mod


class FakeState:
    def __init__(self):
        self.data = {}

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value


class FakeLlm:
    def __init__(self):
        self.calls = []

    def complete(self, messages, **kw):
        self.calls.append(messages)
        return type("R", (), {"text": "Test answer"})()


class FakeCtx:
    def __init__(self):
        self.state = FakeState()
        self.llm = FakeLlm()
        self.injected = []

    def inject_message(self, content, **kw):
        self.injected.append(content)


def _post_payload(tool_name, status="error", error_type="exit_code"):
    return {
        "tool_name": tool_name,
        "status": status,
        "error_type": error_type,
        "error_message": "boom",
        "result": "",
        "duration_ms": 10,
        "session_id": "s1",
        "task_id": "t1",
        "tool_call_id": "c1",
        "turn_id": "u1",
        "api_request_id": "a1",
        "telemetry_schema_version": "hermes.observer.v1",
    }


def test_new_pattern_reports_immediately():
    clippy_mod._CTX = FakeCtx()
    clippy_mod._on_post_tool_call(**_post_payload("terminal"))
    assert len(clippy_mod._CTX.injected) == 1  # first sighting → inject


def test_repeat_below_threshold_is_suppressed():
    clippy_mod._CTX = FakeCtx()
    clippy_mod._on_post_tool_call(**_post_payload("terminal"))  # report 1 (count→1)
    clippy_mod._on_post_tool_call(**_post_payload("terminal"))  # count 2 (< N=3)
    assert len(clippy_mod._CTX.injected) == 1  # second suppressed


def test_escalation_point_reports_again():
    clippy_mod._CTX = FakeCtx()
    for _ in range(4):  # injects on call 1 (new) and call 4 (count hits 3)
        clippy_mod._on_post_tool_call(**_post_payload("terminal"))
    assert len(clippy_mod._CTX.injected) == 2  # new + escalation point only


def test_ok_status_never_reports():
    clippy_mod._CTX = FakeCtx()
    clippy_mod._on_post_tool_call(**_post_payload("terminal", status="ok"))
    assert clippy_mod._CTX.injected == []
    assert clippy_mod._CTX.state.data.get("session_quota", 0) == 0
