# Clippy Phase 1 (The Brain) — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Clippy as a Hermes plugin — proactive error observer with a mood system + `/clippy` helpdesk.

**Architecture:** One plugin package `~/.hermes/plugins/clippy/` with `register(ctx)`. The `post_tool_call` hook classifies tool errors deterministically (no LLM in the agent loop); when a report-worthy pattern fires, LLM wording is outsourced asynchronously via `ctx.spawn_task` and injected with `ctx.inject_message`. Mood + memory + throttle are pure functions over `ctx.state`.

**Tech Stack:** Python 3 (stdlib + `pytest` only), Hermes Plugin API (`hermes_cli.plugins.PluginContext`, `hermes_cli.plugins_state.PluginState`, `agent.plugin_llm.PluginLlm`).

**Verified API (against source, NOT guessed):**
- `register(ctx)` — `ctx` is `PluginContext`
- `ctx.register_command(name, handler, description="", args_hint="", argument_mode=None)` — handler `fn(raw_args: str) -> str | None` (sync or async)
- `ctx.register_hook(hook_name, callback)` — callback receives **kwargs; `post_tool_call` provides `tool_name`, `args`, `status`, `error_type`, `error_message`, `result`, `duration_ms`, `session_id`, `task_id`, `tool_call_id`, `turn_id`, `api_request_id`, `telemetry_schema_version`
- `ctx.state.get(key, default=None)` / `ctx.state.set(key, value)` — PluginState, atomic, quota-bounded
- `ctx.llm.complete(messages)` / `await ctx.llm.acomplete(messages)` → `.text` (host-owned, fail-closed)
- `ctx.inject_message(content, role="user", session_key=None)` → bool (new turn if idle, interrupt if running)
- `ctx.spawn_task(coro, name=None)` — supervised asyncio task
- `plugin.yaml` manifest + `__init__.py` exposing `register(ctx)`

### Reporting Semantics (single rule, used consistently everywhere)

`should_report` returns `True` when: **count == 0** (new → helpful) OR **count == repeat_threshold** (escalation point → sarcastic). `False` otherwise (1..N-1 = nagging-suppressed; > N = already escalated, stay silent).

---

## Task 1: Plugin Skeleton + Manifest

**Depends on:** —
**Parallel with:** —
**Blocks:** Task 2, Task 3, Task 4

**Objective:** Project structure + `plugin.yaml` + empty `register(ctx)`.

**Files:**
- Create: `plugin.yaml`
- Create: `__init__.py`
- Create: `mood.py` (empty)
- Create: `memory.py` (empty)
- Create: `knowledge_lookup.py` (empty)
- Create: `knowledge/` (directory)

**Step 1: Write the manifest**

```yaml
# plugin.yaml
name: clippy
version: 0.1.0
description: "Clippy — the proactive assistant: detects repeated tool errors and helps with Hermes questions. Mood system, memory, throttle."
author: andreas
kind: standalone
requires_hermes: ">=0.19"
platforms: []
```

**Step 2: `__init__.py` with minimal `register`**

```python
"""Clippy — proactive assistant for Hermes (Phase 1: The Brain)."""


def register(ctx) -> None:
    """Registers the /clippy command + post_tool_call/on_session_start hooks."""
    pass
```

**Step 3: Create empty modules**

```python
# mood.py
"""Mood system for Clippy (pure functions over ctx.state)."""
```

```python
# memory.py
"""Memory + throttle + quota for Clippy (pure functions over ctx.state)."""
```

```python
# knowledge_lookup.py
"""Deterministic knowledge-base search for the /clippy helpdesk."""
```

**Step 4: Verify**

```bash
python3 -c "import clippy; clippy.register(type('C',(),{'register_command':lambda *a,**k:None,'register_hook':lambda *a,**k:None})())"
# Expected: no output, exit 0
```

**Step 5: Commit**

```bash
git add plugin.yaml __init__.py mood.py memory.py knowledge_lookup.py
git commit -m "chore: clippy plugin skeleton + manifest"
```

---

## Task 2: `mood.py` — Mood System (TDD)

**Depends on:** Task 1
**Parallel with:** Task 3, Task 4
**Blocks:** Task 7

**Objective:** Escalation logic: repetition of the same pattern lowers the mood toward ironic.

**Files:**
- Modify: `mood.py`
- Create: `tests/test_mood.py`

**Step 1: Failing test**

```python
# tests/test_mood.py
from clippy import mood


def test_get_mood_defaults_to_zero():
    assert mood.get_mood({}) == 0.0


def test_note_repeat_escalates_toward_sarcasm():
    state = {}
    for _ in range(3):
        mood.note_repeat(state, "tool_error:terminal")
    assert mood.get_mood(state) < 0.0  # ironic


def test_tone_is_sarcastic_when_negative():
    assert mood.tone_for({"mood": -0.5}) == "sarcastic"
    assert mood.tone_for({"mood": 0.3}) == "helpful"


def test_mood_clamped_at_minus_one():
    state = {}
    for _ in range(20):
        mood.note_repeat(state, "tool_error:x")
    assert mood.get_mood(state) == -1.0
```

**Step 2: Run → FAIL** (`mood` has no functions)

**Step 3: Implementation**

```python
"""Mood system for Clippy (pure functions over ctx.state)."""

MOOD_KEY = "mood"
SARCASM_THRESHOLD = -0.2  # below this: ironic instead of helpful


def get_mood(state: dict) -> float:
    return float(state.get(MOOD_KEY, 0.0))


def _set_mood(state: dict, value: float) -> None:
    state[MOOD_KEY] = max(-1.0, min(1.0, value))


def note_repeat(state: dict, pattern_key: str, step: float = 0.25) -> float:
    """Registers a repetition and lowers the mood toward ironic.

    Returns the new mood. Caller persists via ctx.state.set()."""
    new = get_mood(state) - step
    _set_mood(state, new)
    return new


def tone_for(state: dict) -> str:
    return "sarcastic" if get_mood(state) < SARCASM_THRESHOLD else "helpful"
```

**Step 4: Run → PASS**

```bash
pytest tests/test_mood.py -v
# Expected: 4 passed
```

**Step 5: Commit**

```bash
git add mood.py tests/test_mood.py
git commit -m "feat: mood escalation system"
```

---

## Task 3: `memory.py` — Memory + Throttle + Quota (TDD)

**Depends on:** Task 1
**Parallel with:** Task 2, Task 4
**Blocks:** Task 7

**Objective:** Dedupe (`reported`), time cooldown (`last_message_at`), session quota (`session_quota`), with the single reporting-semantics rule.

**Files:**
- Modify: `memory.py`
- Create: `tests/test_memory.py`

**Step 1: Failing test**

```python
# tests/test_memory.py
from clippy import memory


def test_new_pattern_reports_immediately():
    assert memory.should_report({}, "tool_error:git", 0, quota=5) is True


def test_repeat_below_threshold_is_suppressed():
    # count 1..N-1: no nagging
    state = {"reported": {"tool_error:git": {"count": 1, "last_at": ""}}}
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is False


def test_escalation_point_reports_once():
    # count == N: report once more (sarcastic)
    state = {"reported": {"tool_error:git": {"count": 3, "last_at": ""}}}
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is True


def test_beyond_escalation_is_silent():
    state = {"reported": {"tool_error:git": {"count": 7, "last_at": ""}}}
    assert memory.should_report(state, "tool_error:git", 0, quota=5, repeat_threshold=3) is False


def test_quota_exhausted_blocks():
    state = {"session_quota": 5}
    assert memory.should_report(state, "tool_error:x", 0, quota=5) is False


def test_mark_reported_increments_count():
    state = {}
    memory.mark_reported(state, "tool_error:git", now=1000)
    assert state["reported"]["tool_error:git"]["count"] == 1
    memory.mark_reported(state, "tool_error:git", now=2000)
    assert state["reported"]["tool_error:git"]["count"] == 2
    assert state["session_quota"] == 2
```

**Step 2: Run → FAIL**

**Step 3: Implementation**

```python
"""Memory + throttle + quota for Clippy (pure functions over ctx.state)."""

import time

REPORTED_KEY = "reported"
LAST_MSG_KEY = "last_message_at"
QUOTA_KEY = "session_quota"

DEFAULT_COOLDOWN_S = 60.0     # min. interval between proactive messages
DEFAULT_REPEAT_THRESHOLD = 3  # escalation point (report on new + on count == N)
DEFAULT_QUOTA = 5            # max messages per session


def should_report(
    state: dict,
    pattern_key: str,
    now: float | None = None,
    *,
    quota: int = DEFAULT_QUOTA,
    cooldown_s: float = DEFAULT_COOLDOWN_S,
    repeat_threshold: int = DEFAULT_REPEAT_THRESHOLD,
) -> bool:
    """True if Clippy may report this pattern right now.

    Rule: report on new (count 0) and at the escalation point (count == N);
    silent for 1..N-1 and beyond N."""
    now = now if now is not None else time.time()

    # 1. Quota
    if state.get(QUOTA_KEY, 0) >= quota:
        return False

    # 2. Cooldown (time interval)
    last = state.get(LAST_MSG_KEY)
    if last is not None and now - float(last) < cooldown_s:
        return False

    # 3. Dedupe / escalation
    entry = state.get(REPORTED_KEY, {}).get(pattern_key)
    count = entry.get("count", 0) if entry else 0
    if count == 0:
        return True                # new → helpful
    if count == repeat_threshold:
        return True                # escalation point → sarcastic
    return False                   # 1..N-1 or >N → silent


def mark_reported(state: dict, pattern_key: str, now: float | None = None) -> None:
    """Persists a report: increments count, sets timestamp, bumps quota."""
    now = now if now is not None else time.time()
    reported = state.setdefault(REPORTED_KEY, {})
    entry = reported.setdefault(pattern_key, {"count": 0})
    entry["count"] = entry["count"] + 1
    entry["last_at"] = str(now)
    state[LAST_MSG_KEY] = str(now)
    state[QUOTA_KEY] = state.get(QUOTA_KEY, 0) + 1


def reset_session_quota(state: dict) -> None:
    """Called on_session_start; dedupe memory survives sessions."""
    state[QUOTA_KEY] = 0
    state.pop(LAST_MSG_KEY, None)
```

**Step 4: Run → PASS**

```bash
pytest tests/test_memory.py -v
# Expected: 6 passed
```

**Step 5: Commit**

```bash
git add memory.py tests/test_memory.py
git commit -m "feat: dedupe + throttle + quota memory"
```

---

## Task 4: Knowledge Base (`knowledge/*.md`)

**Depends on:** Task 1
**Parallel with:** Task 2, Task 3
**Blocks:** Task 5, Task 6

**Objective:** Curated Markdown knowledge base for the `/clippy` helpdesk.

**Files:**
- Create: `knowledge/hermes.md`
- Create: `knowledge/desktop.md`

**Step 1: `knowledge/hermes.md`** — core Hermes knowledge (commands, config, common error patterns):

```markdown
# Hermes Core Knowledge

## Core Commands
- `/new` — start a new session
- `/stop` — abort a running turn
- `/loop` — repeated execution (see below)
- `/clippy <question>` — this helpdesk

## Error Patterns
- **Cron not delivering:** execute_code is blocked in cron — write to /tmp and use terminal instead.
- **Gateway won't start:** see the `gateway-troubleshooting` skill.
- **Plugin won't load:** check `plugin.yaml` + `__init__.py` with `register(ctx)`.
```

**Step 2: `knowledge/desktop.md`** — Hermes Desktop knowledge:

```markdown
# Hermes Desktop Knowledge

## General
- The desktop app renders Markdown with full GitHub flavor.
- Plugins: desktop renderer in `desktop/plugin.js`, Python backend optional.

## Error Patterns
- **Empty preview pane:** write the widget file as HTML and use `::preview{file="..."}`.
```

**Step 3: Verify**

```bash
ls knowledge/
# Expected: desktop.md  hermes.md
```

**Step 4: Commit**

```bash
git add knowledge/
git commit -m "docs: clippy knowledge base"
```

---

## Task 5: Knowledge-Lookup Helper (TDD)

**Depends on:** Task 4
**Parallel with:** —
**Blocks:** Task 6

**Objective:** Deterministic full-text search over `knowledge/*.md`.

**Files:**
- Modify: `knowledge_lookup.py`
- Create: `tests/test_knowledge_lookup.py`

**Step 1: Failing test**

```python
# tests/test_knowledge_lookup.py
from clippy import knowledge_lookup


def test_finds_matching_section():
    hit = knowledge_lookup.search("gateway won't start")
    assert hit is not None
    assert "gateway" in hit.lower()


def test_no_match_returns_none():
    assert knowledge_lookup.search("xyzzy nonexistent topic") is None


def test_empty_query_returns_none():
    assert knowledge_lookup.search("") is None
```

**Step 2: Run → FAIL**

**Step 3: Implementation**

```python
"""Deterministic knowledge-base search for the /clippy helpdesk."""

from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"


def search(query: str) -> str | None:
    """Returns the most relevant section as text, or None."""
    terms = {t.lower() for t in query.split() if len(t) > 2}
    if not terms:
        return None
    best, best_score = None, 0
    for md in sorted(KNOWLEDGE_DIR.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        for section in text.split("\n## "):
            low = section.lower()
            score = sum(1 for t in terms if t in low)
            if score > best_score:
                best, best_score = section, score
    return best if best_score > 0 else None
```

**Step 4: Run → PASS**

```bash
pytest tests/test_knowledge_lookup.py -v
# Expected: 3 passed
```

**Step 5: Commit**

```bash
git add knowledge_lookup.py tests/test_knowledge_lookup.py
git commit -m "feat: deterministic knowledge-base search"
```

---

## Task 6: `/clippy` Helpdesk Command

**Depends on:** Task 2, Task 4, Task 5
**Parallel with:** —
**Blocks:** Task 9

**Objective:** `register_command("clippy", ...)` — knowledge base first, then LLM fallback.

**Files:**
- Modify: `__init__.py`

**Step 1: Handler implementation**

```python
"""Clippy — proactive assistant for Hermes (Phase 1: The Brain)."""

from . import knowledge_lookup

SYSTEM_PROMPT = (
    "You are Clippy, the paperclip from MS Office. Answer briefly, with charm, "
    "a touch of irony, but always helpful — in the user's language. No filler, "
    "no bullet-list spam. If you are not sure, say so honestly."
)


def register(ctx) -> None:
    ctx.register_command(
        "clippy",
        _clippy_command,
        description="Ask Clippy about Hermes / Hermes Desktop",
        args_hint="<question>",
    )


async def _clippy_command(raw_args: str) -> str | None:
    question = raw_args.strip()
    if not question:
        return "What do you want to know? Ask me about Hermes. 📎"

    # 1. Knowledge base (deterministic, free)
    hit = knowledge_lookup.search(question)
    if hit:
        return f"📎 {hit.strip()}"

    # 2. LLM fallback (wired to ctx.llm in Task 7)
    raise NotImplementedError("LLM fallback wired in Task 7")
```

**Step 2: Verify — knowledge hit without LLM**

```bash
python3 - <<'PY'
import asyncio, clippy
async def main():
    r = await clippy._clippy_command("gateway won't start")
    print(r[:60])
asyncio.run(main())
PY
# Expected: "📎 ## Error Patterns..." (knowledge hit, no LLM)
```

**Step 3: Commit**

```bash
git add __init__.py
git commit -m "feat: /clippy helpdesk command (knowledge first)"
```

---

## Task 7: `post_tool_call` Hook — Pattern Detection + Async Wording

**Depends on:** Task 2, Task 3, Task 6
**Parallel with:** —
**Blocks:** Task 8, Task 9

**Objective:** Hook classifies errors deterministically; on a report-worthy pattern, wording runs async via `ctx.spawn_task`.

**Files:**
- Modify: `__init__.py`

**Step 1: Refactor — `register` binds `ctx` via closures**

```python
"""Clippy — proactive assistant for Hermes (Phase 1: The Brain)."""

from . import knowledge_lookup, mood, memory

SYSTEM_PROMPT = (
    "You are Clippy, the paperclip from MS Office. Answer briefly, with charm, "
    "a touch of irony, but always helpful — in the user's language. No filler, "
    "no bullet-list spam. If you are not sure, say so honestly."
)


def register(ctx) -> None:
    ctx.register_command(
        "clippy", _clippy_command, description="Ask Clippy about Hermes / Hermes Desktop",
        args_hint="<question>",
    )
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("on_session_start", _on_session_start)


def _load_state(ctx) -> dict:
    """Loads state from ctx.state (individual keys) into a plain dict."""
    return {
        "mood": ctx.state.get("mood", 0.0),
        "reported": ctx.state.get("reported", {}),
        "last_message_at": ctx.state.get("last_message_at"),
        "session_quota": ctx.state.get("session_quota", 0),
    }


def _save_state(ctx, state: dict) -> None:
    for key in ("mood", "reported", "last_message_at", "session_quota"):
        if key in state and state[key] is not None:
            ctx.state.set(key, state[key])


def _pattern_key(tool_name: str, error_type: str | None) -> str:
    return f"tool_error:{tool_name}:{error_type or 'unknown'}"


def _on_post_tool_call(ctx, **kwargs) -> None:
    """Deterministic classification — NO LLM in the agent loop."""
    try:
        status = kwargs.get("status")
        if status != "error":
            return
        tool_name = kwargs.get("tool_name", "unknown")
        error_type = kwargs.get("error_type")
        key = _pattern_key(tool_name, error_type)

        state = _load_state(ctx)
        if not memory.should_report(state, key):
            return
        memory.mark_reported(state, key)
        mood.note_repeat(state, key)
        _save_state(ctx, state)

        # Wording outsourced async — never blocks the loop.
        ctx.spawn_task(
            _formulate_and_inject(ctx, tool_name, error_type, state["mood"]),
            name="clippy-inject",
        )
    except Exception:
        # Fail-open: Clippy must never disturb the agent loop.
        pass


async def _formulate_and_inject(ctx, tool_name: str, error_type: str | None, current_mood: float) -> None:
    tone = mood.tone_for({"mood": current_mood})
    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"Tone: {tone}.\n"
        f"The user keeps hitting errors on tool '{tool_name}' "
        f"(error type: {error_type or 'unknown'}). "
        f"Give a short, pointed tip in the user's language (max 2 sentences)."
    )
    try:
        result = await ctx.llm.acomplete(
            [{"role": "system", "content": prompt}],
            max_tokens=120,
        )
        text = (result.text or "").strip()
        if text:
            ctx.inject_message(f"📎 {text}")
    except Exception:
        # LLM fallback: deterministic message so the user never gets nothing.
        ctx.inject_message(f"📎 Tool '{tool_name}' is acting up again. Want me to take a look?")


async def _clippy_command(ctx, raw_args: str) -> str | None:
    question = raw_args.strip()
    if not question:
        return "What do you want to know? Ask me about Hermes. 📎"
    hit = knowledge_lookup.search(question)
    if hit:
        return f"📎 {hit.strip()}"
    try:
        result = await ctx.llm.acomplete([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ], max_tokens=300)
        text = (result.text or "").strip()
        return f"📎 {text}" if text else None
    except Exception:
        return "📎 I'm stumped. Check the Hermes docs: https://hermes-agent.nousresearch.com/docs"


def _on_session_start(ctx, **kwargs) -> None:
    """Quota reset on new session; dedupe memory survives."""
    try:
        ctx.state.set("session_quota", 0)
        ctx.state.set("last_message_at", None)
    except Exception:
        pass
```

**Step 2: Verify — deterministic paths import**

```bash
python3 -c "import clippy; print('ok')"
# Expected: ok
```

**Step 3: Commit**

```bash
git add __init__.py
git commit -m "feat: post_tool_call observer hook + async LLM wording"
```

---

## Task 8: Integration Test with Real Hook Payload

**Depends on:** Task 7
**Parallel with:** —
**Blocks:** Task 9

**Objective:** Tests build the real `post_tool_call` payload (not the v1 assumption) and verify deterministic classification end-to-end, including the reporting-semantics rule.

**Files:**
- Create: `tests/test_hook.py`

**Step 1: Failing test (fixture = real kwargs)**

```python
# tests/test_hook.py
from clippy import __init__ as clippy_mod


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

    async def acomplete(self, messages, **kw):
        self.calls.append(messages)
        return type("R", (), {"text": "Test tip"})()


class FakeCtx:
    def __init__(self):
        self.state = FakeState()
        self.llm = FakeLlm()
        self.injected = []
        self.tasks = []

    def spawn_task(self, coro, name=None):
        self.tasks.append(coro)

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
    ctx = FakeCtx()
    clippy_mod._on_post_tool_call(ctx, **_post_payload("terminal"))
    assert len(ctx.tasks) == 1  # first sighting → spawn wording


def test_repeat_below_threshold_is_suppressed():
    ctx = FakeCtx()
    clippy_mod._on_post_tool_call(ctx, **_post_payload("terminal"))  # report 1 (count→1)
    ctx.tasks.clear()
    clippy_mod._on_post_tool_call(ctx, **_post_payload("terminal"))  # count 2 (< N=3)
    assert ctx.tasks == []  # suppressed


def test_escalation_point_reports_again():
    ctx = FakeCtx()
    for _ in range(4):  # reports on call 1 (new) and call 4 (count hits 3)
        clippy_mod._on_post_tool_call(ctx, **_post_payload("terminal"))
    assert len(ctx.tasks) == 2  # new + escalation point only


def test_ok_status_never_reports():
    ctx = FakeCtx()
    clippy_mod._on_post_tool_call(ctx, **_post_payload("terminal", status="ok"))
    assert ctx.tasks == []
    assert ctx.state.data.get("session_quota", 0) == 0
```

**Step 2: Run → FAIL** (`_on_post_tool_call` currently always reports)

**Step 3: Run → PASS** (Task 7 already implements the correct semantics)

```bash
pytest tests/ -v
# Expected: all green (mood, memory, knowledge_lookup, hook)
```

**Step 4: Commit**

```bash
git add tests/test_hook.py
git commit -m "test: hook integration with real payload + report semantics"
```

---

## Task 9: README + Config Docs

**Depends on:** Task 6, Task 7, Task 8
**Parallel with:** —
**Blocks:** —

**Objective:** README with install/config notes (gateway injection, LLM trust flags).

**Files:**
- Create: `README.md`

**Step 1: README**

```markdown
# Clippy — Hermes Plugin

Clippit (the MS Office paperclip) as a proactive assistant for Hermes.
Phase 1: the brain (observer + helpdesk). Phase 2 (animated paperclip): later.

## Installation

1. Put the repo at `~/.hermes/plugins/clippy/` (or `git clone` it there).
2. Restart Hermes. The plugin is auto-discovered.

## Usage

- `/clippy <question>` — helpdesk for Hermes / Hermes Desktop
- Proactive: on repeated tool errors, Clippy interjects with a tip.

## Config (optional)

```yaml
# ~/.hermes/config.yaml
plugins:
  entries:
    clippy:
      allow_gateway_injection: true   # required for proactive messages in the gateway (Telegram/Discord)
      llm:
        allowed_models: []            # optionally restrict
```

## Behavior

- **Mood:** helpful → ironic on repetition.
- **Memory:** Clippy remembers reported patterns (survives sessions).
- **Throttle:** max 5 messages/session, min 60s cooldown.
- **Fail-open:** Clippy can never block the agent loop.
```

**Step 2: Verify**

```bash
wc -l README.md
# Expected: ~40 lines
```

**Step 3: Commit + Push**

```bash
git add README.md
git commit -m "docs: README with install + config"
git push -u origin main
```

---

## Execution Order (Waves)

```
Wave 1 (parallel): Task 1
Wave 2 (parallel): Task 2 ∥ Task 3 ∥ Task 4
Wave 3 (parallel): Task 5
Wave 4 (parallel): Task 6
Wave 5 (parallel): Task 7
Wave 6 (parallel): Task 8
Wave 7 (parallel): Task 9
```

**Critical path:** Task 1 → (2/3/4) → 5 → 6 → 7 → 8 → 9 (7 waves)
**Parallelizable:** Task 2 ∥ Task 3 ∥ Task 4

---

## Notes for the Implementer

1. **NEVER copy the legacy `skill_factory.py` API** — `@hermes.command()` / `@hermes.on()` no longer exist. Only `ctx.register_command()` / `ctx.register_hook()`.
2. **Hook callback signature:** `register_hook` invokes the callback with kwargs; always accept `**kwargs` (additive fields stay backward-compatible).
3. **No LLM in the hook:** `_on_post_tool_call` stays deterministic; `ctx.spawn_task` outsources the async wording.
4. **`ctx.llm.acomplete`** is the async variant (hooks/commands are async-capable). Trust gates are fail-closed — without `plugins.entries.clippy.llm.*` config only the default path runs (no model override), which is correct for Phase 1.
5. **`ctx.state`** is `get`/`set` only (no bulk). `_load_state`/`_save_state` encapsulate that.
6. **Reporting semantics are fixed** (see table at top) — do NOT re-derive them per task; they are already baked into `should_report` and `test_memory.py`/`test_hook.py`.
