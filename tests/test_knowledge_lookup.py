from dash import knowledge_lookup


def test_finds_matching_section():
    hit = knowledge_lookup.search("gateway won't start")
    assert hit is not None
    assert "gateway" in hit.lower()


def test_section_starts_with_heading():
    hit = knowledge_lookup.search("floating panes")
    assert hit is not None
    assert hit.startswith("## ")


def test_h1_preamble_is_not_searchable():
    # 'desktop' only matches the H1 title line of desktop.md; the search must
    # skip the preamble and find a real section instead (or none).
    hit = knowledge_lookup.search("desktop")
    assert hit is None or hit.startswith("## ")
    assert "# Hermes Desktop Knowledge" not in (hit or "")


def test_no_match_returns_none():
    assert knowledge_lookup.search("xyzzy nonexistent topic") is None


def test_empty_query_returns_none():
    assert knowledge_lookup.search("") is None


def test_short_terms_are_ignored():
    # Terms of 1-2 chars are filtered out; no terms at all → None.
    assert knowledge_lookup.search("an") is None


def test_stop_words_do_not_score():
    # Regression: "was soll das tun?" used to match "das" ⊂ "dash" and
    # surface the irrelevant Core Commands section.
    hit = knowledge_lookup.search("was soll das tun?")
    assert hit is None


def test_keyboard_shortcut_question():
    hit = knowledge_lookup.search("Ctrl+Shift+P - was soll das tun?")
    assert hit is not None
    assert hit.startswith("## Keyboard Shortcuts")
    assert "Ctrl+Shift+P" in hit
    assert "not" in hit.lower() or "NOT" in hit


def test_no_substring_false_positive():
    # 'dash' must not be found via the 'das' substring; 'api' must not match
    # inside 'escaping'.
    assert knowledge_lookup.search("das") is None
    hit = knowledge_lookup.search("api gateway")
    assert hit is None or "escaping" not in hit.lower()
