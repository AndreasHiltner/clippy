# Hermes Core Knowledge

## Core Commands
- `/new` — start a new session
- `/stop` — abort a running turn
- `/loop` — repeated execution (see below)
- `/dash <question>` — this helpdesk

## Error Patterns
- **Cron not delivering:** execute_code is blocked in cron — write to /tmp and use terminal instead.
- **Gateway won't start:** see the `gateway-troubleshooting` skill.
- **Plugin won't load:** check `plugin.yaml` + `__init__.py` with `register(ctx)`.
