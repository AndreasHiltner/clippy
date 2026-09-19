# Plugin Overlay — Architecture Notes

Why the Dash mascot/card overlay behaves the way it does, and the two bugs that
shaped its window design.

## The window is a transient child of the main Hermes window

The overlay is spawned with `parent: mainWindow`, which sets `WM_TRANSIENT_FOR`
on X11. A transient window on xfwm4 gets:

- no taskbar entry of its own,
- no alt-tab slot,
- automatic minimize-with-parent,
- stacking above its parent.

This is the X11-standard dialog pattern and the correct primitive for a
floating helper that belongs to one application window.

## Bug 1: taskbar entry

**Symptom:** the mascot appeared as its own button in the xfwm4 taskbar.

**Root cause (two independent facts):**

1. `setSkipTaskbar()` sends an `_NET_WM_STATE_SKIP_TASKBAR` client message,
   which xfwm4 only honors on an **already-mapped** window. The overlay spawns
   with `show: false`, so the message was dropped. `setAlwaysOnTop()` on Linux
   also rewrites the entire `_NET_WM_STATE` list and drops the skip hint again.
2. `_NET_CLIENT_LIST` is **not** the taskbar list — it lists every WM-managed
   window. The xfce4-panel taskbar filters on `_NET_WM_STATE_SKIP_TASKBAR`.
   Checking `_NET_CLIENT_LIST` membership is therefore a false-positive test
   for "is in the taskbar".

**Fix:** spawn as a transient child (`parent: mainWindow`). xfwm4 then sets
`_NET_WM_STATE_SKIP_TASKBAR` and keeps the window out of the panel without any
`setSkipTaskbar` juggling.

## Bug 2: keyboard input never reached the card

**Symptom:** keystrokes landed in the main chat window instead of the card.

**Root cause:** the window was spawned `focusable: false` (pet parity). On
xfwm4 a `focusable: false` window is **not managed at all** — no `WM_STATE`,
no `WM_HINTS` — so it never receives keyboard focus. A runtime
`setFocusable(true)` does **not** reliably re-manage it (the card stayed
`WM_HINTS`-less and focus never stuck).

**Fix:** spawn with `focusable: true` always, so `WM_HINTS.input` is set and
the card takes keystrokes. Taskbar avoidance comes from the transient-child
relationship, **not** from `focusable`. The mascot posture stays non-activating
via `showInactive()` + `blur()` rather than a focusable flip.

## Net window contract

| Property       | Value                          | Why                                   |
| -------------- | ------------------------------ | ------------------------------------- |
| `parent`       | `mainWindow` (Linux)           | transient → no taskbar, no alt-tab    |
| `focusable`    | `true`                         | `WM_HINTS.input` → keyboard works     |
| `transparent`  | `true`                         | mascot paints only its sprite         |
| `skipTaskbar`  | `!IS_MAC`                      | belt-and-braces for non-Linux WMs     |
| mascot posture | `showInactive()` + `blur()`    | non-activating without a focusable flip |

The overlay is a single window with two postures (mascot ↔ card) rather than a
separate child per mode; Electron cannot flip `transparent` at runtime, so the
card paints its own opaque surface while the window stays technically
transparent underneath.
