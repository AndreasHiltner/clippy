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
