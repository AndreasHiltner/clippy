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
