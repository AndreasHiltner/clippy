// Hermes Dash — desktop half (thin ESM, presentation-only).
//
// Unified agent+desktop package:
//   agent half   ~/.hermes/plugins/dash/__init__.py  (registers /dash + observer hooks)
//   desktop half ~/.hermes/plugins/dash/desktop/plugin.js  (this file)
//
// The pane is a FLOATING helpdesk card. The core pane shell renders
// `placement: 'floating'` as a fixed, draggable window — the header is the
// drag handle, the corner is a resize grip, and position + size are persisted
// per pane id. No drag code lives here.
//
// Two views inside the card:
//   avatar — the Dash pencil; a single click opens the editor
//   editor — question input + answer, sent to the ALREADY-running Python
//            brain via gateway RPC (command.dispatch → plugin command 'dash')
//
// Session-independent: the Python brain answers the question directly and the
// answer renders inside this card. No chat session is created, no tab opens —
// command.dispatch routes plugin commands without a session.
//
// Plain ESM, loaded uncompiled: jsx()/jsxs() calls only, imports limited to
// @hermes/plugin-sdk, react, react/jsx-runtime (the runtime loader's allowlist).
//
// CRITICAL: react/jsx-runtime reads children from props.children ONLY. Rest
// arguments after props are NOT children — the 3rd arg of jsx() is the KEY.
// Always build elements through el() below, which routes children into
// props.children (the filebox pattern).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'

// The plugin context, captured in register() (the desktop SDK's PluginContext).
// The pop-out button routes through ctx.os.openOverlay — the curated OS door,
// never the raw window.hermesDesktop bridge.
let dashCtx = null

// Children-safe element factory. jsx/jsxs ignore trailing rest args, so every
// child goes into props.children (cloned props — never mutate the caller's).
// `key` is extracted from props and passed as jsx/jsxs 3rd arg — the ONLY
// slot those functions read it from (a spread key triggers a React warning).
function el(tag, props, ...children) {
  const { key, ...rest } = props || {}
  if (children.length === 0) return jsx(tag, rest, key)
  if (children.length === 1) return jsx(tag, Object.assign({}, rest, { children: children[0] }), key)
  return jsxs(tag, Object.assign({}, rest, { children }), key)
}

// ---------------------------------------------------------------------------
// Dash brand colors — HARD-CODED, not theme vars.
//
// `var(--ui-accent)` is the desktop ACCENT (blue here) — the pencil body must
// be Dash yellow regardless of theme. Only chrome (text, borders, buttons)
// stays themed. While busy (thinking), the body turns blue.
// ---------------------------------------------------------------------------
const BRAND = {
  yellow: '#f6c945',
  yellowShade: '#e0b03a',
  pink: '#e5484d',
  ferruleDark: '#8a8f98',
  ferruleLight: '#c9ced6',
  wood: '#e8c39e',
  graphite: '#4a4a52',
  face: '#2b2b31',
  thinking: '#4d8df5',
}

// ---------------------------------------------------------------------------
// Dash pencil — original character, inline SVG twin of assets/dash.svg.
// Flat stylized pencil, NOT any existing assistant mascot.
// ---------------------------------------------------------------------------
function DashFace({ size = 96, thinking = false }) {
  const body = thinking ? BRAND.thinking : BRAND.yellow
  const shade = thinking ? BRAND.thinking : BRAND.yellowShade
  return el(
    'svg',
    {
      viewBox: '0 0 256 256',
      width: size,
      height: size,
      role: 'img',
      'aria-label': 'Dash the pencil',
      style: { display: 'block', flexShrink: 0 },
    },
    // eraser
    el('path', {
      d: 'M 96 26 h 64 a 10 10 0 0 1 10 10 v 26 h -84 v -26 a 10 10 0 0 1 10 -10 Z',
      fill: BRAND.pink,
    }),
    // ferrule
    el('path', { d: 'M 96 56 h 64 v 8 h -64 Z', fill: BRAND.ferruleDark }),
    el('path', { d: 'M 96 72 h 64 v 18 h -64 Z', fill: BRAND.ferruleLight }),
    // body
    el('path', { d: 'M 96 90 h 64 v 110 h -64 Z', fill: body }),
    // body shading stripe
    el('path', { d: 'M 96 90 h 8 v 110 h -8 Z', fill: shade, opacity: 0.55 }),
    // wood cone
    el('path', { d: 'M 96 200 h 64 l -14 32 h -36 Z', fill: BRAND.wood }),
    // graphite tip
    el('path', { d: 'M 118 232 h 20 l -4 20 h -12 Z', fill: BRAND.graphite }),
    // eyes
    el('circle', { cx: 112, cy: 122, r: 6, fill: BRAND.face }),
    el('circle', { cx: 144, cy: 122, r: 6, fill: BRAND.face }),
    // eyebrows
    el('path', {
      d: 'M 103 106 Q 112 100 121 106',
      fill: 'none',
      stroke: BRAND.face,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    el('path', {
      d: 'M 135 106 Q 144 100 153 106',
      fill: 'none',
      stroke: BRAND.face,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    // smile
    el('path', {
      d: 'M 118 148 Q 128 156 138 148',
      fill: 'none',
      stroke: BRAND.face,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
  )
}

// ---------------------------------------------------------------------------
// Mascot silhouette — the pencil's opaque regions as axis-aligned rects in
// viewBox units. On compositor-less systems the overlay window renders
// BLACK until its X11 shape is carved: the mascot contribution reports
// these rects and main clips the window to them, so only the pencil is
// visible and the desktop shows through everywhere else. The card posture
// reports [] — the card paints its own full opaque surface.
//
// All rects stay INSIDE the true silhouette: an over-wide carve would show
// unpainted (black) pixels, so the tapered cone is stepped instead of
// using one bounding rect.
// ---------------------------------------------------------------------------
const MASCOT_SPRITE_SIZE = 88
const MASCOT_WINDOW_SIZE = 96

const PENCIL_SHAPE_RECTS = [
  { x: 86, y: 26, w: 84, h: 38 }, // eraser + dark ferrule band
  { x: 96, y: 72, w: 64, h: 18 }, // light ferrule band
  { x: 96, y: 90, w: 64, h: 110 }, // body
  { x: 96, y: 200, w: 64, h: 8 }, // wood cone, tapering in 4 steps
  { x: 101, y: 208, w: 54, h: 8 },
  { x: 106, y: 216, w: 44, h: 8 },
  { x: 110, y: 224, w: 36, h: 8 },
  { x: 118, y: 232, w: 20, h: 8 }, // graphite tip, tapering
  { x: 122, y: 240, w: 12, h: 12 },
]

function spriteShapeRects() {
  const scale = MASCOT_SPRITE_SIZE / 256
  const inset = Math.round((MASCOT_WINDOW_SIZE - MASCOT_SPRITE_SIZE) / 2)

  return PENCIL_SHAPE_RECTS.map(r => ({
    x: inset + Math.round(r.x * scale),
    y: inset + Math.round(r.y * scale),
    width: Math.max(1, Math.round(r.w * scale)),
    height: Math.max(1, Math.round(r.h * scale)),
  }))
}

// ---------------------------------------------------------------------------
// Close (×) button — returns the card from the editor view to the avatar.
// The original bare '‹' glyph was invisible as a control; this is a bordered,
// labeled button with a real 24px hit target. The Dash face in the editor
// header is a second, discoverable way back (click it).
// ---------------------------------------------------------------------------
function CloseEditorButton({ onClick }) {
  return el(
    'button',
    {
      onClick,
      title: 'Back to Dash',
      'aria-label': 'Close editor, back to Dash',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        flexShrink: 0,
        border: '1px solid var(--ui-stroke-secondary)',
        borderRadius: '6px',
        background: 'var(--ui-bg-elevated)',
        color: 'var(--ui-text-secondary)',
        cursor: 'pointer',
        padding: 0,
      },
    },
    el(
      'svg',
      {
        viewBox: '0 0 12 12',
        width: 12,
        height: 12,
        fill: 'none',
        'aria-hidden': 'true',
      },
      el('path', {
        d: 'M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// Pop-out (⧉) button — opens Dash in the plugin-overlay window: a transparent,
// always-on-top window floating over ALL apps. Routes through
// ctx.os.openOverlay (the curated OS door), passing the card's in-window rect
// as viewport-space bounds — main converts them to screen space so the
// overlay lands where the card sat (pet overlay parity).
// ---------------------------------------------------------------------------
function PopOutButton() {
  return el(
    'button',
    {
      onClick: e => {
        const card = e.currentTarget.closest('[data-floating-pane]')
        const rect = card ? card.getBoundingClientRect() : null

        void (dashCtx?.os?.openOverlay
          ? dashCtx.os.openOverlay({
              mode: 'card',
              bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            })
          : Promise.resolve(false))
      },
      title: 'Pop out — float over all apps',
      'aria-label': 'Pop Dash out into a floating window',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        flexShrink: 0,
        border: '1px solid var(--ui-stroke-secondary)',
        borderRadius: '6px',
        background: 'var(--ui-bg-elevated)',
        color: 'var(--ui-text-secondary)',
        cursor: 'pointer',
        padding: 0,
      },
    },
    el(
      'svg',
      {
        viewBox: '0 0 12 12',
        width: 12,
        height: 12,
        fill: 'none',
        'aria-hidden': 'true',
      },
      el('path', {
        d: 'M4 8 L8 4 M8 4 H5.5 M8 4 V6.5',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      el('path', {
        d: 'M7 2.5 H3.5 A1 1 0 0 0 2.5 3.5 V8.5 A1 1 0 0 0 3.5 9.5 H8.5 A1 1 0 0 0 9.5 8.5 V5',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// Dash overlay contribution (`area: 'pluginOverlay'`) — ONE component that
// renders BOTH postures of the overlay window:
//
//   mascot — the pencil sprite. The window is 96×96, transparent, and bound
//            to the Hermes app window (drag-clamped, hides with the app).
//            A single click asks the overlay host to expand to the card.
//   card   — the Q&A editor. The host paints the opaque card surface; this
//            view renders question + answer. Its own close buttons live in
//            the host's header (✕ closes, – shrinks back to the pencil).
//
// The host drives the posture: main owns the OS geometry, and the overlay
// renderer passes the mode down through the contribution (ctx.os / bridge).
// ---------------------------------------------------------------------------
function DashOverlayPane() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // The overlay's posture, from the host. The window size is a reliable
  // INSTANT first guess (the mascot is always exactly 96×96; the card never
  // below 120×80 — main enforces both), so the first paint never flashes the
  // wrong view. `whoami` then confirms, and `onMode` follows every flip.
  const [mode, setMode] = useState(() =>
    typeof window !== 'undefined' && window.outerWidth <= 100 && window.outerHeight <= 100 ? 'mascot' : 'card'
  )

  useEffect(() => {
    let cancelled = false
    const bridge = window.hermesDesktop?.pluginOverlay

    if (bridge?.whoami) {
      void bridge
        .whoami()
        .then(who => {
          if (!cancelled && who?.pluginId === 'dash') {
            setMode(who.mode === 'mascot' ? 'mascot' : 'card')
          }
        })
        .catch(() => undefined)
    }

    const off = bridge?.onMode?.(m => {
      if (!cancelled) {
        setMode(m === 'mascot' ? 'mascot' : 'card')
      }
    })

    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  // Every posture change reports the shape that belongs to it: the mascot
  // carves the pencil silhouette, the card clears it (its own surface is
  // fully painted). The initial mount also reports — the shape-gated reveal
  // on compositor-less systems waits for this exact message.
  useEffect(() => {
    try {
      window.hermesDesktop?.pluginOverlay?.setShape?.(mode === 'mascot' ? spriteShapeRects() : [])
    } catch {
      // Older hosts without setShape — the window stays a full rect.
    }
  }, [mode])

  useEffect(() => {
    if (mode === 'card') {
      inputRef.current && inputRef.current.focus()
    }
  }, [mode])

  const submit = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      setAnswer(await askDash(q))
    } catch {
      setAnswer('✏️ I can\u2019t reach the gateway right now. Hermes is running, right?')
    } finally {
      setBusy(false)
    }
  }

  // ── Mascot posture: just the pencil, centered in the 96×96 window. The
  // overlay host handles the click-to-expand; this view only paints.
  if (mode === 'mascot') {
    return el(
      'div',
      {
        style: {
          alignItems: 'center',
          background: 'transparent',
          display: 'flex',
          height: '100%',
          justifyContent: 'center',
          pointerEvents: 'none', // the host's own surface handles clicks
          width: '100%',
        },
      },
      DashFace({ size: 88, thinking: busy }),
    )
  }

  // ── Card posture: question + answer.
  return el(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        height: '100%',
        padding: '10px 12px',
        overflow: 'auto',
        color: 'var(--ui-text-primary)',
      },
    },
    el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      DashFace({ size: 40, thinking: busy }),
      el('div', { style: { flex: 1, fontSize: '13px', fontWeight: 600 } }, 'Ask Dash'),
    ),
    el(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      el('input', {
        ref: inputRef,
        value: question,
        placeholder: 'e.g. gateway won\u2019t start',
        onChange: e => setQuestion(e.target.value),
        onKeyDown: e => {
          if (e.key === 'Enter') submit()
        },
        style: {
          flex: 1,
          minWidth: 0,
          padding: '8px 10px',
          borderRadius: '6px',
          border: '1px solid var(--ui-stroke-secondary)',
          background: 'var(--ui-bg-elevated)',
          color: 'var(--ui-text-primary)',
          outline: 'none',
        },
      }),
      el(
        'button',
        {
          onClick: submit,
          disabled: busy,
          style: {
            padding: '8px 14px',
            borderRadius: '6px',
            border: 'none',
            background: busy ? BRAND.thinking : BRAND.yellow,
            color: busy ? '#ffffff' : '#2b2b31',
            cursor: busy ? 'wait' : 'pointer',
            fontWeight: 600,
          },
        },
        busy ? '\u2026' : 'Ask',
      ),
    ),
    answer
      ? el(
          'div',
          {
            style: {
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid var(--ui-stroke-secondary)',
              background: 'var(--ui-bg-elevated)',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              cursor: 'text',
            },
          },
          renderMarkdown(answer),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// Mini Markdown renderer for KB answers.
//
// The Python brain returns knowledge-base sections as raw Markdown
// ('## General\n- a\n- b'). `whiteSpace: 'pre-wrap'` renders that as an ugly
// mono block — instead, turn `## ` headings and `- ` bullets into real DOM.
// Unknown line types fall through as plain paragraphs. This is presentation
// sugar only; no HTML is ever rendered from answer text.
//
// Every block is selectable text: userSelect 'text' + cursor 'text', so the
// user can select and copy the answer. The card itself stays a drag target
// via the header; the ANSWER container carries data-floating-no-drag so the
// pane shell's drag opt-out (floating-panes.tsx) lets text selection pass.
// ---------------------------------------------------------------------------
const MD_BASE = { fontSize: '13px', lineHeight: 1.5, margin: 0 }
const MD_SELECTABLE = {
  userSelect: 'text',
  WebkitUserSelect: 'text',
  cursor: 'text',
}

function renderMarkdown(text) {
  const blocks = []
  const lines = String(text || '').split('\n')
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        el(
          'div',
          { key: blocks.length, style: { ...MD_BASE, ...MD_SELECTABLE, fontWeight: 700, marginTop: blocks.length ? '8px' : '0' } },
          heading[1],
        ),
      )
      continue
    }
    const bullet = /^-\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push(
        el(
          'div',
          {
            key: blocks.length,
            style: { ...MD_BASE, ...MD_SELECTABLE, display: 'flex', gap: '6px', marginTop: '4px' },
          },
          el('span', { style: { flexShrink: 0, color: 'var(--ui-text-quaternary, #8a8f98)' } }, '•'),
          el('span', { style: { flex: 1, minWidth: 0 } }, bullet[1]),
        ),
      )
      continue
    }
    blocks.push(el('div', { key: blocks.length, style: { ...MD_BASE, ...MD_SELECTABLE, marginTop: '4px' } }, line))
  }
  return el('div', null, ...blocks)
}

// ---------------------------------------------------------------------------
// Helpdesk flow: question → gateway RPC → the Python brain answers.
// No session_id means no chat session, no tab — the gateway routes plugin
// commands straight to the Python handler and returns a plain string.
// ---------------------------------------------------------------------------
async function askDash(question) {
  const res = await host.request('command.dispatch', {
    name: 'dash',
    arg: question,
    session_id: '',
  })
  if (res && typeof res.output === 'string' && res.output) {
    return res.output
  }
  return '✏️ Hmm. No answer came back — is the Hermes gateway running?'
}

function DashPane() {
  const [view, setView] = useState('avatar')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (view === 'editor') {
      inputRef.current && inputRef.current.focus()
    }
  }, [view])

  const submit = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      setAnswer(await askDash(q))
    } catch {
      setAnswer('✏️ I can\u2019t reach the gateway right now. Hermes is running, right?')
    } finally {
      setBusy(false)
    }
  }

  const base = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: 'var(--ui-text-primary)',
  }

  // Avatar view — the whole card is the Dash pencil. One click opens the editor.
  if (view === 'avatar') {
    return el(
      'div',
      {
        style: {
          ...base,
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '16px',
          cursor: 'pointer',
        },
        onClick: () => setView('editor'),
        title: 'Click to ask Dash',
      },
      DashFace({ size: 120, thinking: busy }),
      el(
        'div',
        { style: { textAlign: 'center', fontSize: '13px', color: 'var(--ui-text-secondary)' } },
        'Need a hand? Click me to ask!',
      ),
    )
  }

  // Editor view — question + answer, still inside the floating card.
  return el(
    'div',
    { style: { ...base, gap: '10px', padding: '10px 12px', overflow: 'auto' } },
    el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      el(
        'div',
        {
          onClick: () => setView('avatar'),
          title: 'Back to Dash',
          style: { cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 },
        },
        DashFace({ size: 40, thinking: busy }),
      ),
      el('div', { style: { flex: 1, fontSize: '13px', fontWeight: 600 } }, 'Ask Dash'),
      el(PopOutButton, {}),
      el(CloseEditorButton, { onClick: () => setView('avatar') }),
    ),
    el(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      el('input', {
        ref: inputRef,
        value: question,
        placeholder: 'e.g. gateway won\u2019t start',
        onChange: e => setQuestion(e.target.value),
        onKeyDown: e => {
          if (e.key === 'Enter') submit()
        },
        style: {
          flex: 1,
          minWidth: 0,
          padding: '8px 10px',
          borderRadius: '6px',
          border: '1px solid var(--ui-stroke-secondary)',
          background: 'var(--ui-bg-elevated)',
          color: 'var(--ui-text-primary)',
          outline: 'none',
        },
      }),
      el(
        'button',
        {
          onClick: submit,
          disabled: busy,
          style: {
            padding: '8px 14px',
            borderRadius: '6px',
            border: 'none',
            background: busy ? BRAND.thinking : BRAND.yellow,
            color: busy ? '#ffffff' : '#2b2b31',
            cursor: busy ? 'wait' : 'pointer',
            fontWeight: 600,
          },
        },
        busy ? '\u2026' : 'Ask',
      ),
    ),
    answer
      ? el(
          'div',
          {
            // The pane shell's floating drag skips any element carrying
            // data-floating-no-drag — without it, dragging to select text
            // would move the whole card instead. Text stays selectable and
            // copyable here; the header remains the drag handle.
            'data-floating-no-drag': '',
            style: {
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid var(--ui-stroke-secondary)',
              background: 'var(--ui-bg-elevated)',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              cursor: 'text',
            },
          },
          renderMarkdown(answer),
        )
      : null,
  )
}

export default {
  id: 'dash',
  name: 'Dash',
  description: 'The pencil helper for Hermes — a floating window that answers questions about commands, errors, and the Desktop app.',
  register(ctx) {
    dashCtx = ctx
    ctx.register({
      id: 'pane-float',
      area: 'panes',
      title: 'Dash',
      data: {
        placement: 'floating',
        anchor: 'bottom-right',
        width: '300px',
        height: '360px',
      },
      render: () => el(DashPane, {}),
    })
    // The pop-out contribution: rendered by the plugin-overlay window
    // (`?win=plugoverlay&plugin=dash`) in BOTH postures — the pencil sprite
    // (mascot) and the Q&A editor (card). The overlay host flips the posture
    // and pushes it to this component.
    ctx.register({
      id: 'overlay',
      area: 'pluginOverlay',
      title: 'Dash',
      render: () => el(DashOverlayPane, {}),
    })

    // Auto-start: the pencil floats on the Hermes desktop from app launch
    // (the Petdex behavior). Mascot mode — small, transparent, bound to the
    // app window. Fails silently on builds without the overlay host.
    if (dashCtx?.os?.openOverlay) {
      void dashCtx.os.openOverlay({ mode: 'mascot' }).catch(() => undefined)
    }
  },
}
