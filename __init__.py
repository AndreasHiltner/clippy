"""Clippy — proactive assistant for Hermes (Phase 1: The Brain)."""

from . import knowledge_lookup, memory, mood

SYSTEM_PROMPT = (
    "You are Clippy, the paperclip from MS Office. Answer briefly, with charm, "
    "a touch of irony, but always helpful — in the user's language. No filler, "
    "no bullet-list spam. If you are not sure, say so honestly."
)

_CTX = None  # set by register()


def register(ctx) -> None:
    global _CTX
    _CTX = ctx
    ctx.register_command(
        "clippy", _clippy_command,
        description="Ask Clippy about Hermes / Hermes Desktop",
        args_hint="<question>",
    )
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("on_session_start", _on_session_start)


def _load_state() -> dict:
    """Loads state from _CTX.state (individual keys) into a plain dict."""
    return {
        "mood": _CTX.state.get("mood", 0.0),
        "reported": _CTX.state.get("reported", {}),
        "last_message_at": _CTX.state.get("last_message_at"),
        "session_quota": _CTX.state.get("session_quota", 0),
    }


def _save_state(state: dict) -> None:
    for key in ("mood", "reported", "last_message_at", "session_quota"):
        if key in state and state[key] is not None:
            _CTX.state.set(key, state[key])


def _pattern_key(tool_name: str, error_type: str | None) -> str:
    return f"tool_error:{tool_name}:{error_type or 'unknown'}"


def _on_post_tool_call(**kwargs) -> None:
    """Hook callback: called as callback(**payload) — NO ctx, NO spawn_task.

    Deterministic classification + template wording. Synchronous inject_message
    is thread-safe (queue put). Fail-open."""
    try:
        status = kwargs.get("status")
        if status != "error":
            return
        tool_name = kwargs.get("tool_name", "unknown")
        error_type = kwargs.get("error_type")
        key = _pattern_key(tool_name, error_type)

        state = _load_state()
        memory.note_seen(state, key)          # always count the sighting
        if not memory.should_report(state, key):
            _save_state(state)                # persist seen count even when silent
            return
        memory.mark_reported(state, key)
        mood.note_repeat(state, key)
        _save_state(state)

        text = _template_wording(tool_name, error_type, mood.tone_for(state))
        _CTX.inject_message(text)
    except Exception:
        pass  # fail-open


def _template_wording(tool_name: str, error_type: str | None, tone: str) -> str:
    """Deterministic message — no LLM in the hook."""
    if tone == "sarcastic":
        return (f"📎 Again with '{tool_name}'? ({error_type or 'error'}). "
                f"Want me to take a look, or should we just stare at it together?")
    return (f"📎 Looks like '{tool_name}' hit a snag ({error_type or 'error'}). "
            f"Want a hint on fixing it?")


def _clippy_command(raw_args: str) -> str | None:
    question = raw_args.strip()
    if not question:
        return "What do you want to know? Ask me about Hermes. 📎"
    hit = knowledge_lookup.search(question)
    if hit:
        return f"📎 {hit.strip()}"
    try:
        result = _CTX.llm.complete(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": question},
            ],
            max_tokens=300,
        )
        text = (result.text or "").strip()
        return f"📎 {text}" if text else None
    except Exception:
        return "📎 I'm stumped. Check the Hermes docs: https://hermes-agent.nousresearch.com/docs"


def _on_session_start(**kwargs) -> None:
    """Quota reset on new session; dedupe memory survives."""
    try:
        _CTX.state.set("session_quota", 0)
        _CTX.state.set("last_message_at", None)
    except Exception:
        pass
