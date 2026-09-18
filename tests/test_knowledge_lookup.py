from dash import knowledge_lookup


def test_finds_matching_section():
    hit = knowledge_lookup.search("gateway won't start")
    assert hit is not None
    assert "gateway" in hit.lower()


def test_no_match_returns_none():
    assert knowledge_lookup.search("xyzzy nonexistent topic") is None


def test_empty_query_returns_none():
    assert knowledge_lookup.search("") is None
