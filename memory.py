"""Memory + throttle + quota for Clippy (pure functions over ctx.state)."""

import time

REPORTED_KEY = "reported"
LAST_MSG_KEY = "last_message_at"
QUOTA_KEY = "session_quota"

DEFAULT_COOLDOWN_S = 60.0     # min. interval between proactive messages
DEFAULT_REPEAT_THRESHOLD = 3  # escalation happens on the (threshold+1)-th sighting
DEFAULT_QUOTA = 5            # max messages per session


def note_seen(state: dict, pattern_key: str) -> int:
    """Record one sighting of a pattern; return the 1-indexed seen count.

    Called on EVERY error sighting (not just reported ones) so the escalation
    point is actually reachable."""
    reported = state.setdefault(REPORTED_KEY, {})
    entry = reported.setdefault(pattern_key, {"count": 0})
    entry["count"] = entry["count"] + 1
    return entry["count"]


def seen_count(state: dict, pattern_key: str) -> int:
    entry = state.get(REPORTED_KEY, {}).get(pattern_key)
    return entry.get("count", 0) if entry else 0


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

    `count` is the 1-indexed seen count (already includes the latest sighting):
    - count == 1 → first sight (helpful), gated by cooldown
    - count == threshold+1 → escalation (sarcastic), never throttled
    - otherwise → silent."""
    now = now if now is not None else time.time()

    # 1. Quota
    if state.get(QUOTA_KEY, 0) >= quota:
        return False

    # 2. Dedupe / escalation
    count = seen_count(state, pattern_key)
    if count == 1:
        is_new = True                 # first sight → helpful
    elif count == repeat_threshold + 1:
        is_new = False                # escalation → sarcastic
    else:
        return False                  # 2..threshold or beyond → silent

    # 3. Cooldown — only gates the helpful first report, never the escalation
    if is_new:
        last = state.get(LAST_MSG_KEY)
        if last is not None and now - float(last) < cooldown_s:
            return False

    return True


def mark_reported(state: dict, pattern_key: str, now: float | None = None) -> None:
    """Records that a report was made: sets cooldown timestamp, bumps quota.

    Does NOT touch the seen count — that is note_seen's job."""
    now = now if now is not None else time.time()
    state[LAST_MSG_KEY] = str(now)
    state[QUOTA_KEY] = state.get(QUOTA_KEY, 0) + 1


def reset_session_quota(state: dict) -> None:
    """Called on_session_start; dedupe memory survives sessions."""
    state[QUOTA_KEY] = 0
    state.pop(LAST_MSG_KEY, None)
