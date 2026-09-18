# Clippy — Hermes Plugin (Phase 1: Das Hirn)

**Date:** 2026-09-18
**Status:** Approved (Spec v2 — nach Cross-LLM Review, API gegen Source verifiziert)
**Spur:** A (Eigengebrauch)

## Purpose

Clippit (Clippy), die Büroklammer aus MS Office 97–2003, als persönlicher Assistent für Hermes wiederbeleben. Zwei Jobs:

1. **Proaktiver Beobachter** — hängt an Hermes' Innenleben (Tool-Calls), erkennt Muster und mischt sich mit Tipps ein — wie das Original ("It looks like you're writing a letter"), aber ohne den Fehler von damals: Clippy *merkt* sich, was er schon gesehen hat.
2. **Hermes-Helpdesk** — beantwortet Fragen über Hermes selbst und Hermes Desktop aus einer eigenen Wissensbasis, mit Fallback auf die lebenden Docs.

## Die Lehre aus der Historie (Design-Prinzip)

Clippy scheiterte, weil er "optimized for first use" war — er lernte nie, wer der Nutzer ist, und fragte zum 50. Mal dasselbe. Clifford Nass' Diagnose: Menschen behandeln Clippy wie eine Person, also gilt er denselben sozialen Erwartungen.

**Konsequenz:** Clippy darf nie repetitiv nerven. Er braucht ein Gedächtnis (Dedupe), ein Stimmungssystem (Wiederholung → ironisch statt hilfreich) und eine Drossel (Quota). Das ist der Unterschied zwischen "charmanter Assistent" und "TFC — That Fucking Clown" (Microsofts interner Codename).

## Architecture

```
Clippy (Plugin, ~/.hermes/plugins/clippy/)
├── plugin.yaml        # Manifest (name, description, version)
├── __init__.py        # register(ctx): Kommandos + Hooks
├── mood.py            # Stimmungssystem (Eskalation bei Wiederholung)
├── memory.py          # Dedupe-Gedächtnis + Drossel (auf ctx.state)
├── knowledge/         # Eigene Wissensbasis (Markdown)
│   ├── hermes.md      # Hermes-Kernwissen (Kommandos, Config, Fehlerbilder)
│   └── desktop.md     # Hermes Desktop-Wissen
```

**Persistenz:** `ctx.state` (PluginState) — atomarer, quota-begrenzter JSON-Key/Value-Store unter `~/.hermes/plugin-data/clippy/state.json`. **Nicht** selbst `data/state.json` im Plugin-Ordner schreiben (wird bei Update überschrieben, falscher Namensraum).

## Verified Plugin API (gegen `hermes_cli/plugins.py`, `observer-hooks.md`, `plugin_llm.py`)

Die aktuelle Plugin-API — **nicht** die Legacy-`skill_factory.py`-Form:

```python
def register(ctx):                      # ctx = PluginContext
    # Kommando: handler(raw_args: str) -> str | None
    ctx.register_command("clippy", handler, description="...", args_hint="<frage>")
    # Hooks: nur VALID_HOOKS, kein "tool_call"
    ctx.register_hook("post_tool_call", on_post_tool_call)
    # LLM (host-owned, fail-closed, trust-gated)
    ctx.llm.complete(messages)          # -> PluginLlmCompleteResult(.text)
    ctx.llm.complete_structured(instructions=..., input=..., json_schema=...)
    # Proaktive Ausgabe: in CLI/Gateway-Convo injizieren
    ctx.inject_message(content, role="user", session_key=...)  # -> bool
    # Persistenz
    ctx.state.get("key") / ctx.state.set("key", value)
```

**Kritische Unterschiede zum Spec v1 (alle verifiziert):**

| Annahme v1 | Realität |
|---|---|
| `register(hermes)` vs `register(ctx)` = zwei Objekte | **Dasselbe Objekt** (`PluginContext`). Doku nutzt `register(ctx)`. |
| `@hermes.command()` / `@hermes.on("tool_call")` | **Existiert nicht** in der aktuellen Klasse. Echt: `ctx.register_command()` / `ctx.register_hook()`. `skill_factory.py` ist Legacy. |
| Hook `"tool_call"` | **Kein gültiger Hook.** Echt: `pre_tool_call`, `post_tool_call`, `transform_tool_result`. |
| "Kein `exit_code`" | `post_tool_call` liefert `status` (`ok`/`error`/`blocked`/`cancelled`), `error_type`, `error_message`, `result`, `duration_ms`. |
| "Keine LLM-API belegt" | **`ctx.llm.complete()` / `complete_structured()` existieren** — host-owned, routet über aktives Modell, overrides fail-closed. |
| "Proaktive Antwort unbelegt" | **`ctx.inject_message()` existiert** — injiziert neuen Turn (idle) oder interrumpiert (running). |
| Persistenz in Plugin-Ordner | **`ctx.state`** = kanonischer, atomarer, profile-scoped Store. |

## Data Model (via `ctx.state`)

Keys (JSON, atomar geschrieben durch PluginState):

```json
{
  "mood": 0.0,                // -1..1; negativ = ironisch, positiv = hilfreich
  "reported": {               // Dedupe-Gedächtnis: key -> {count, last_at}
    "tool_error:terminal": {"count": 3, "last_at": "2026-09-18T10:00:00Z"}
  },
  "last_message_at": "...",   // Drossel: min. Abstand zwischen Meldungen
  "session_quota": 0          // Meldungen in aktueller Session (reset on_session_start)
}
```

- **Muster-Erkennung deterministisch** (kein LLM): `post_tool_call` liefert `status`/`error_type`/`error_message` → Klassifikation über Tool-Name + Status. **Kein** Exit-Code-Parsing nötig.
- **Formulierung via LLM:** nur wenn ein Muster gemeldet wird, formuliert `ctx.llm.complete()` die Nachricht in Clippy-Voice (Stimmung fließt in den Prompt ein).
- **Drossel-Reset:** `session_quota` wird im Hook `on_session_start` zurückgesetzt; `reported` überlebt Sessions (das ist der "er merkt sich"-Teil).

## Components

| Datei | Verantwortung | Interface |
|-------|--------------|-----------|
| `plugin.yaml` | Manifest | `name: clippy` |
| `__init__.py` | `register(ctx)`: `/clippy`-Kommando + `post_tool_call`-Hook + `on_session_start`-Hook | `register(ctx)` |
| `mood.py` | Stimmung lesen/setzen, Eskalation (Wiederholung → ironisch) | `get_mood(state)`, `note_repeat(state, key)`, `tone_for(state, key)` |
| `memory.py` | Dedupe + Drossel + Quota über `ctx.state` | `should_report(state, key)`, `mark_reported(state, key)` |
| `knowledge/*.md` | Wissensbasis für Q&A | statisch, vom Agent gepflegt |

## User Interaction

- **`/clippy <frage>`** — Handler liest Frage, sucht in `knowledge/*.md`; bei Treffer antwortet er mit dem Text. Kein Treffer → `ctx.llm.complete()` mit der Wissensbasis als Kontext + Hinweis auf `hermes-capability-reference`-Skill.
- **Proaktive Meldung** — `post_tool_call`-Hook: wenn `status == "error"` und der Key (tool + error_type) ≥ N-mal wiederholt wurde und Drossel/Quota es zulassen → `ctx.inject_message()` mit Clippy-Tipp.

## Edge Cases & Errors

- **Spam-Prevention:** Drossel (Zeitabstand) + Dedupe (`reported`) + Quota (`session_quota`). Clippy darf nie zum "That Fucking Clown" werden.
- **Hook wirft:** Hooks sind fail-open (Hermes fängt Exceptions). Trotzdem try/except in jedem Callback — Plugin darf den Agent-Loop nie stören.
- **State kaputt:** PluginState wirft `RuntimeError` bei unparsbarem JSON. Abfangen → frische Werte, nie crashen.
- **`inject_message` schlägt fehl** (z.B. kein Gateway-Kontext): Rückgabe `False` ignorieren, still loggen — kein Fehler.
- **Kein Desktop-Kontext:** Phase 1 ist Chat-only. Animi­erte Klammer = Phase 2.

## Testing Strategy

- **Unit:** `mood.py` (Eskalation), `memory.py` (Dedupe/Drossel) — reine Funktionen mit gemocktem `ctx.state`-Dict.
- **Integration:** `/clippy`-Q&A gibt korrekte Antwort aus Wissensbasis; LLM-Fallback greift.
- **Hook-Fixture:** Tests bauen die echte `post_tool_call`-Payload nach (`tool_name`, `status`, `error_type`, `error_message`) — nicht die v1-angenommene Signatur.

## Phase 2 (später, NICHT in dieser Version)

Animierte Clippy-SVG als Desktop-Overlay (`desktop/plugin.js`), Event-Bridge Python→JS, Sprechblase. Erst wenn das Hirn läuft.

## Monetization

— (Spur A, Eigengebrauch)
