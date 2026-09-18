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

import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'

// ---------------------------------------------------------------------------
// Dash pencil — original character, inline SVG twin of assets/dash.svg.
// Themed via CSS vars: yellow body = accent, pink eraser = red token, graphite
// + face lines = text color. Flat stylized pencil, NOT any existing assistant
// mascot.
// ---------------------------------------------------------------------------
function DashFace({ size = 96 }) {
  return jsx(
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
    jsx('path', {
      d: 'M 96 26 h 64 a 10 10 0 0 1 10 10 v 26 h -84 v -26 a 10 10 0 0 1 10 -10 Z',
      fill: 'var(--ui-red, #e5484d)',
    }),
    // ferrule
    jsx('path', {
      d: 'M 96 56 h 64 v 8 h -64 Z',
      fill: 'var(--ui-text-quaternary, #8a8f98)',
    }),
    jsx('path', {
      d: 'M 96 72 h 64 v 18 h -64 Z',
      fill: 'var(--ui-text-secondary)',
    }),
    // body
    jsx('path', {
      d: 'M 96 90 h 64 v 110 h -64 Z',
      fill: 'var(--ui-accent)',
    }),
    // body shading stripe
    jsx('path', {
      d: 'M 96 90 h 8 v 110 h -8 Z',
      fill: 'var(--ui-accent)',
      opacity: 0.55,
    }),
    // wood cone
    jsx('path', {
      d: 'M 96 200 h 64 l -14 32 h -36 Z',
      fill: '#e8c39e',
    }),
    // graphite tip
    jsx('path', {
      d: 'M 118 232 h 20 l -4 20 h -12 Z',
      fill: 'var(--ui-text-primary)',
    }),
    // eyes
    jsx('circle', { cx: 112, cy: 122, r: 6, fill: 'var(--ui-text-primary)' }),
    jsx('circle', { cx: 144, cy: 122, r: 6, fill: 'var(--ui-text-primary)' }),
    // eyebrows
    jsx('path', {
      d: 'M 103 106 Q 112 100 121 106',
      fill: 'none',
      stroke: 'var(--ui-text-primary)',
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    jsx('path', {
      d: 'M 135 106 Q 144 100 153 106',
      fill: 'none',
      stroke: 'var(--ui-text-primary)',
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    // smile
    jsx('path', {
      d: 'M 118 148 Q 128 156 138 148',
      fill: 'none',
      stroke: 'var(--ui-text-primary)',
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
  )
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
        title: 'Click to ask Dash',
      },
      DashFace({ size: 120 }),
      jsx(
        'div',
        { style: { textAlign: 'center', fontSize: '13px', color: 'var(--ui-text-secondary)' } },
        'Need a hand? Click me to ask!',
      ),
    )
  }

  // Editor view — question + answer, still inside the floating card.
  return jsxs('div', { style: { ...base, gap: '10px', padding: '10px 12px', overflow: 'auto' } }, ...[
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, ...[
      DashFace({ size: 40 }),
      jsx('div', { style: { flex: 1, fontSize: '13px', fontWeight: 600 } }, 'Ask Dash'),
      jsx(
        'button',
        {
          onClick: () => setView('avatar'),
          title: 'Back to Dash',
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
  id: 'dash',
  name: 'Dash',
  description: 'The pencil helper for Hermes — a floating window that answers questions about commands, errors, and the Desktop app.',
  register(ctx) {
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
      render: () => jsx(DashPane, {}),
    })
  },
}
