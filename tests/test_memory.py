from dash import memory


def _seen(state, key, n):
    for _ in range(n):
        memory.note_seen(state, key)


def test_first_sight_reports():
    state = {}
    memory.note_seen(state, "tool_error:git")
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is True


def test_second_and_third_sight_are_suppressed():
    state = {}
    _seen(state, "tool_error:git", 2)
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is False
    memory.note_seen(state, "tool_error:git")  # 3rd sighting, still < escalation
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is False


def test_escalation_sight_reports():
    state = {}
    _seen(state, "tool_error:git", 4)  # 4th sight = threshold+1
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is True


def test_beyond_escalation_is_silent():
    state = {}
    _seen(state, "tool_error:git", 5)
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is False


def test_quota_exhausted_blocks():
    state = {"session_quota": 5}
    memory.note_seen(state, "tool_error:x")
    assert memory.should_report(state, "tool_error:x", 0, quota=5) is False


def test_mark_reported_sets_timestamp_and_bumps_quota():
    state = {}
    memory.mark_reported(state, "tool_error:git", now=1000)
    assert state["session_quota"] == 1
    assert state["last_message_at"] == "1000"
