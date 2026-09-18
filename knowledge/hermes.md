# Hermes Core Knowledge

## Core Commands
- `/new` — start a new session
- `/stop` — abort a running turn
- `/loop` — repeated execution (see below)
- `/dash <question>` — this helpdesk

## Keyboard Shortcuts
- `Ctrl+Shift+P` (also `Cmd+Shift+P` on macOS) is NOT bound — nothing happens.
  The Command Palette is `Ctrl+K` or `Ctrl+P` (`Cmd+K` / `Cmd+P`).
- Other defaults: `Ctrl+N` new session, `Ctrl+T` new tab, `Ctrl+,` settings,
  `Ctrl+.` command center, `Ctrl+/` shortcuts panel, `Ctrl+B` sidebar,
  `Ctrl+J` right sidebar, `Ctrl+G` review, `Ctrl+W` close tab,
  `Ctrl+Shift+T` reopen tab, `Ctrl+F` find in page, `Ctrl+Shift+M` model
  picker, `Ctrl+Shift+S` status bar, `Ctrl+Shift+L` browser, `Ctrl+Shift+H` HUD.

## Error Patterns
- **Cron not delivering:** execute_code is blocked in cron — write to /tmp and use terminal instead.
- **Gateway won't start:** see the `gateway-troubleshooting` skill.
- **Plugin won't load:** check `plugin.yaml` + `__init__.py` with `register(ctx)`.
