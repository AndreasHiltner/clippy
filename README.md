# Clippy — Hermes Plugin

Clippit (the MS Office paperclip) as a proactive assistant for Hermes.
Phase 1: the brain (observer + helpdesk). Phase 2 (animated paperclip): later.

## Installation

1. Put the repo at `~/.hermes/plugins/clippy/` (or `git clone` it there).
2. Restart Hermes. The plugin is auto-discovered.

## Usage

- `/clippy <question>` — helpdesk for Hermes / Hermes Desktop
- Proactive: on repeated tool errors, Clippy interjects with a tip.

## Config (optional)

```yaml
# ~/.hermes/config.yaml
plugins:
  entries:
    clippy:
      allow_gateway_injection: true   # required for proactive messages in the gateway (Telegram/Discord)
      llm:
        allowed_models: []            # optionally restrict
```

## Behavior

- **Mood:** helpful → ironic on repetition.
- **Memory:** Clippy remembers reported patterns (survives sessions).
- **Throttle:** max 5 messages/session, min 60s cooldown.
- **Fail-open:** Clippy can never block the agent loop.
