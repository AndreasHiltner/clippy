# Hermes Desktop Knowledge

## General
- The desktop app renders Markdown with full GitHub flavor.
- Plugins: desktop renderer in `desktop/plugin.js`, Python backend optional.
- Floating panes: `data: { placement: 'floating', anchor, width, height }` in a
  `ctx.register` contribution. The core pane shell renders it as a fixed,
  draggable card (header = drag handle, corner = resize grip); position and
  size are persisted per pane id. No drag code needed in the plugin.
- Plugin commands dispatch through `command.dispatch` without a session:
  `session_id: ''` routes to the Python handler and returns a plain string.
  No chat session is created, no tab opens.

## Error Patterns
- **Empty preview pane:** write the widget file as HTML and use `::preview{file="..."}`.
- **A chat tab opened but stayed empty:** a slash command went through the
  composer path, which creates a backend session before dispatching. Ask from
  the floating pane instead — it renders the answer inline.
