# Clippy — Hermes Plugin (Phase 1: The Brain)

**Date:** 2026-09-18
**Status:** Approved (Spec v2 — cross-LLM review, API verified against source)
**Track:** A (personal use)

## Purpose

Revive Clippit (Clippy), the paperclip from MS Office 97–2003, as a personal assistant for Hermes. Two jobs:

1. **Proactive observer** — hooks into Hermes' internals (tool calls), recognizes patterns and interjects with tips — like the original ("It looks like you're writing a letter"), but without its historical flaw: Clippy *remembers* what it has already seen.
2. **Hermes helpdesk** — answers questions about Hermes itself and Hermes Desktop from its own knowledge base, with fallback to the living docs.

## The Lesson from History (Design Principle)

Clippy failed because it was "optimized for first use" — it never learned who the user was, and asked the same question for the 50th time. Clifford Nass' diagnosis: people treat Clippy like a person, so it is held to the same social expectations.

**Consequence:** Clippy must never be repetitively annoying. It needs a memory (dedupe), a mood system (repetition → ironic instead of helpful), and a throttle (quota). That is the difference between "charming assistant" and "TFC — That Fucking Clown" (Microsoft's internal codename).

## Architecture

```
Clippy (Plugin, ~/.hermes/plugins/clippy/)
├── plugin.yaml        # Manifest (name, description, version)
├── __init__.py        # register(ctx): commands + hooks
├── mood.py            # Mood system (escalation on repetition)
├── memory.py          # Dedupe memory + throttle (on ctx.state)
├── knowledge_lookup.py# Deterministic knowledge-base search
├── knowledge/         # Own knowledge base (Markdown)
│   ├── hermes.md      # Hermes core knowledge (commands, config, error patterns)
│   └── desktop.md     # Hermes Desktop knowledge
```

**Persistence:** `ctx.state` (PluginState) — atomic, quota-bounded JSON key/value store under `~/.hermes/plugin-data/clippy/state.json`. **Do NOT** write your own `data/state.json` inside the plugin folder (overwritten on update, wrong namespace).

## Verified Plugin API (against `hermes_cli/plugins.py`, `observer-hooks.md`, `plugin_llm.py`)

The current plugin API — **not** the legacy `skill_factory.py` form:

```python
def register(ctx):                      # ctx = PluginContext
    # Command: handler(raw_args: str) -> str | None (sync or async)
    ctx.register_command("clippy", handler, description="...", args_hint="<frage>")
    # Hooks: VALID_HOOKS only, no "tool_call"
    ctx.register_hook("post_tool_call", on_post_tool_call)
    # LLM (host-owned, fail-closed, trust-gated)
    ctx.llm.complete(messages)          # -> PluginLlmCompleteResult(.text)
    await ctx.llm.acomplete(messages)   # async sibling
    # Proactive output: inject into CLI/Gateway conversation
    ctx.inject_message(content, role="user", session_key=...)  # -> bool
    # Async work off the agent loop
    ctx.spawn_task(coro, name=...)      # supervised asyncio task
    # Persistence
    ctx.state.get("key") / ctx.state.set("key", value)
```

**Critical differences from Spec v1 (all verified):**

| v1 assumption | Reality |
|---|---|
| `register(hermes)` vs `register(ctx)` = two objects | **Same object** (`PluginContext`). Docs use `register(ctx)`. |
| `@hermes.command()` / `@hermes.on("tool_call")` | **Does not exist** in the current class. Real: `ctx.register_command()` / `ctx.register_hook()`. `skill_factory.py` is legacy. |
| Hook `"tool_call"` | **Not a valid hook.** Real: `pre_tool_call`, `post_tool_call`, `transform_tool_result`. |
| "No `exit_code`" | `post_tool_call` provides `status` (`ok`/`error`/`blocked`/`cancelled`), `error_type`, `error_message`, `result`, `duration_ms`. |
| "No LLM API proven" | **`ctx.llm.complete()` / `complete_structured()` exist** — host-owned, routes through the active model, overrides fail-closed. |
| "Proactive reply unproven" | **`ctx.inject_message()` exists** — injects a new turn (idle) or interrupts (running). |
| Persistence in plugin folder | **`ctx.state`** = canonical, atomic, profile-scoped store. |

## Data Model (via `ctx.state`)

Keys (JSON, written atomically by PluginState):

```json
{
  "mood": 0.0,                // -1..1; negative = ironic, positive = helpful
  "reported": {               // Dedupe memory: key -> {count, last_at}
    "tool_error:terminal": {"count": 3, "last_at": "2026-09-18T10:00:00Z"}
  },
  "last_message_at": "...",   // Throttle: min. interval between messages
  "session_quota": 0          // Messages in the current session (reset on_session_start)
}
```

- **Pattern recognition is deterministic** (no LLM): `post_tool_call` provides `status`/`error_type`/`error_message` → classification via tool name + status. **No** exit-code parsing needed.
- **Wording via LLM:** only when a pattern is reported, `ctx.llm.complete()` phrases the message in Clippy's voice (mood feeds into the prompt).
- **Throttle reset:** `session_quota` is reset in the `on_session_start` hook; `reported` survives sessions (the "it remembers" part).

## Components

| File | Responsibility | Interface |
|------|----------------|-----------|
| `plugin.yaml` | Manifest | `name: clippy` |
| `__init__.py` | `register(ctx)`: `/clippy` command + `post_tool_call` hook + `on_session_start` hook | `register(ctx)` |
| `mood.py` | Read/set mood, escalation (repetition → ironic) | `get_mood(state)`, `note_repeat(state, key)`, `tone_for(state)` |
| `memory.py` | Dedupe + throttle + quota over `ctx.state` | `should_report(state, key)`, `mark_reported(state, key)` |
| `knowledge_lookup.py` | Deterministic search over `knowledge/*.md` | `search(query) -> str \| None` |
| `knowledge/*.md` | Knowledge base for Q&A | static, curated by the agent |

## Reporting Semantics (the anti-annoyance rule)

The single rule that makes Clippy "helpful early, cheeky on repetition, never annoying":

| Pattern state | Behavior |
|---|---|
| New (never seen) | Report immediately (helpful tone) |
| Seen 1..N-1 times | Silent (no nagging) |
| Seen exactly N times (escalation point) | Report once more (sarcastic — mood has escalated) |
| Beyond N | Silent (throttle + quota hold) |

## User Interaction

- **`/clippy <frage>`** — handler reads the question, searches `knowledge/*.md`; on hit it answers with the text. No hit → `ctx.llm.complete()` with the knowledge base as context + pointer to the `hermes-capability-reference` skill.
- **Proactive message** — `post_tool_call` hook: on `status == "error"`, classify pattern (tool + error_type) and apply the reporting-semantics table above. Wording runs async via `ctx.spawn_task`, never in the hook itself.

## Edge Cases & Errors

- **Spam prevention:** cooldown (time interval) + dedupe (`reported`) + quota (`session_quota`). Clippy must never become "That Fucking Clown".
- **Hook raises:** hooks are fail-open (Hermes catches exceptions). Still, try/except in every callback — the plugin must never disturb the agent loop.
- **Broken state:** PluginState raises `RuntimeError` on unparseable JSON. Catch → fresh values, never crash.
- **`inject_message` fails** (e.g. no gateway context): ignore the `False` return, log quietly — no error.
- **No LLM reachable:** fall back to a deterministic message so the user never gets nothing.
- **No desktop context:** Phase 1 is chat-only. Animated paperclip = Phase 2.

## Testing Strategy

- **Unit:** `mood.py` (escalation), `memory.py` (dedupe/throttle/report semantics) — pure functions with a mocked `ctx.state` dict.
- **Integration:** `/clippy` Q&A returns the correct answer from the knowledge base; LLM fallback kicks in.
- **Hook fixture:** tests build the real `post_tool_call` payload (`tool_name`, `status`, `error_type`, `error_message`) — not the v1-assumed signature.

## Phase 2 (later, NOT in this version)

Animated Clippy SVG as a desktop overlay (`desktop/plugin.js`), Python→JS event bridge, speech bubble. Only once the brain works.

## Monetization

— (Track A, personal use)
