"""Mood system for Dash (pure functions over ctx.state)."""

MOOD_KEY = "mood"
SARCASM_THRESHOLD = -0.2  # below this: ironic instead of helpful


def get_mood(state: dict) -> float:
    return float(state.get(MOOD_KEY, 0.0))


def _set_mood(state: dict, value: float) -> None:
    state[MOOD_KEY] = max(-1.0, min(1.0, value))


def note_repeat(state: dict, pattern_key: str, step: float = 0.15) -> float:
    """Registers a repetition and lowers the mood toward ironic.

    Returns the new mood. Caller persists via ctx.state.set()."""
    new = get_mood(state) - step
    _set_mood(state, new)
    return new


def tone_for(state: dict) -> str:
    return "sarcastic" if get_mood(state) < SARCASM_THRESHOLD else "helpful"
