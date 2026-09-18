// Hermes Clippy — desktop half (thin ESM, presentation-only).
//
// Unified agent+desktop package:
//   agent half   ~/.hermes/plugins/clippy/__init__.py  (registers /clippy + observer hooks)
//   desktop half ~/.hermes/plugins/clippy/desktop/plugin.js  (this file)
//
// The pane is a FLOATING helpdesk card. The core pane shell renders
// `placement: 'floating'` as a fixed, draggable window — the header is the
// drag handle, the corner is a resize grip, and position + size are persisted
// per pane id. No drag code lives here.
//
// Two views inside the card:
//   avatar — the Clippy face; a single click opens the editor
//   editor — question input + answer, sent to the ALREADY-running Python
//            brain via gateway RPC (command.dispatch → plugin command 'clippy')
//
// Session-independent: the Python brain answers the question directly and the
// answer renders inside this card. No chat session is created, no tab opens —
// command.dispatch routes plugin commands without a session.
//
// Plain ESM, loaded uncompiled: jsx()/jsxs() calls only, imports limited to
// @hermes/plugin-sdk, react, react/jsx-runtime (the runtime loader's allowlist).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'

// ---------------------------------------------------------------------------
// Clippy face — inline SVG twin of assets/clippy.svg, themed via CSS vars so
// no asset-resolution is needed in the blob-loaded runtime context.
// ---------------------------------------------------------------------------
const WIRE =
  'M 78 34 C 78 20, 92 14, 106 14 C 126 14, 140 26, 140 44 ' +
  'L 140 196 C 140 218, 156 234, 178 234 C 200 234, 214 220, 214 202 ' +
  'L 214 78 C 214 62, 202 52, 188 52 C 174 52, 162 62, 162 76 ' +
  'L 162 178 C 162 190, 168 198, 178 198'

function ClippyFace({ size = 96 }) {
  return jsx(
    'svg',
    {
      viewBox: '0 0 256 256',
      width: size,
      height: size,
      role: 'img',
      'aria-label': 'Clippy the paperclip',
      style: { display: 'block', flexShrink: 0 },
    },
    jsx('path', {
      d: WIRE,
      fill: 'none',
      stroke: 'var(--ui-text-primary)',
      strokeWidth: 24,
      strokeLinecap: 'round',
    }),
    jsx('path', {
      d: WIRE,
      fill: 'none',
      stroke: 'var(--ui-bg-elevated)',
      strokeWidth: 16,
      strokeLinecap: 'round',
    }),
    jsx('ellipse', { cx: 112, cy: 60, rx: 12, ry: 16, fill: '#ffffff' }),
    jsx('ellipse', { cx: 158, cy: 60, rx: 12, ry: 16, fill: '#ffffff' }),
    jsx('circle', { cx: 115, cy: 62, r: 5.5, fill: '#20202a' }),
    jsx('circle', { cx: 161, cy: 62, r: 5.5, fill: '#20202a' }),
    jsx('circle', { cx: 117.5, cy: 59, r: 2, fill: '#ffffff' }),
    jsx('circle', { cx: 163.5, cy: 59, r: 2, fill: '#ffffff' }),
    jsx('path', { d: 'M 100 40 Q 112 34 124 40', fill: 'none', stroke: 'var(--ui-text-secondary)', strokeWidth: 4, strokeLinecap: 'round' }),
    jsx('path', { d: 'M 146 40 Q 158 34 170 40', fill: 'none', stroke: 'var(--ui-text-secondary)', strokeWidth: 4, strokeLinecap: 'round' }),
  )
}

// ---------------------------------------------------------------------------
// Helpdesk flow: question → gateway RPC → the Python brain answers.
// No session_id means no chat session, no tab — the gateway routes plugin
// commands straight to the Python handler and returns a plain string.
// ---------------------------------------------------------------------------
async function askClippy(question) {
  const res = await host.request('command.dispatch', {
    name: 'clippy',
    arg: question,
    session_id: '',
  })
  if (res && typeof res.output === 'string' && res.output) {
    return res.output
  }
  return '📎 Hmm. No answer came back — is the Hermes gateway running?'
}

function ClippyPane() {
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
      setAnswer(await askClippy(q))
    } catch {
      setAnswer('📎 I can\u2019t reach the gateway right now. Hermes is running, right?')
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

  // Avatar view — the whole card is the Clippy face. One click opens the editor.
  if (view === 'avatar') {
    return jsxs(
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
        title: 'Click to ask Clippy',
      },
      ClippyFace({ size: 120 }),
      jsx(
        'div',
        { style: { textAlign: 'center', fontSize: '13px', color: 'var(--ui-text-secondary)' } },
        'It looks like you might have a question. Click me to ask!',
      ),
    )
  }

  // Editor view — question + answer, still inside the floating card.
  return jsxs('div', { style: { ...base, gap: '10px', padding: '10px 12px', overflow: 'auto' } }, ...[
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, ...[
      ClippyFace({ size: 40 }),
      jsx('div', { style: { flex: 1, fontSize: '13px', fontWeight: 600 } }, 'Ask Clippy'),
      jsx(
        'button',
        {
          onClick: () => setView('avatar'),
          title: 'Back to Clippy',
          style: {
            border: 'none',
            background: 'transparent',
            color: 'var(--ui-text-secondary)',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '0 4px',
          },
        },
        '\u2039',
      ),
    ]),
    jsxs('div', { style: { display: 'flex', gap: '8px' } }, ...[
      jsx('input', {
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
      jsx(
        'button',
        {
          onClick: submit,
          disabled: busy,
          style: {
            padding: '8px 14px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--ui-accent)',
            color: 'var(--ui-bg)',
            cursor: busy ? 'wait' : 'pointer',
            fontWeight: 600,
          },
        },
        busy ? '\u2026' : 'Ask',
      ),
    ]),
    answer
      ? jsx(
          'div',
          {
            style: {
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid var(--ui-stroke-secondary)',
              background: 'var(--ui-bg-elevated)',
              whiteSpace: 'pre-wrap',
              fontSize: '13px',
            },
          },
          answer,
        )
      : null,
  ])
}

export default {
  id: 'clippy',
  name: 'Clippy',
  description: 'The paperclip helpdesk for Hermes — a floating window that answers questions about commands, errors, and the Desktop app.',
  register(ctx) {
    ctx.register({
      id: 'pane-float',
      area: 'panes',
      title: 'Clippy',
      data: {
        placement: 'floating',
        anchor: 'bottom-right',
        width: '300px',
        height: '360px',
      },
      render: () => jsx(ClippyPane, {}),
    })
  },
}
