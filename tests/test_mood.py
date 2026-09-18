from dash import mood


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
