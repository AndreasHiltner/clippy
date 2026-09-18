// Hermes Clippy — desktop half (thin ESM, presentation-only).
//
// Unified agent+desktop package:
//   agent half   ~/.hermes/plugins/clippy/__init__.py  (registers /clippy + observer hooks)
//   desktop half ~/.hermes/plugins/clippy/desktop/plugin.js  (this file)
//
// This pane is a helpdesk UI only: questions are answered by the ALREADY-running
// Python brain through the gateway RPC (`command.dispatch` → plugin command
// 'clippy'). No second brain, no LLM, no tokens in the renderer.
//
// Plain ESM, loaded uncompiled: jsx()/jsxs() calls only, imports limited to
// @hermes/plugin-sdk, react, react/jsx-runtime (the runtime loader's allowlist).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'
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
      style: { display: 'block', margin: '0 auto 14px' },
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
  return '📎 Hmm. No answer came back — try again?'
}

function ClippyPane() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      setAnswer(await askClippy(q))
    } catch {
      setAnswer('📎 I need a live Hermes session to answer. Open a chat first, then ask me again.')
    } finally {
      setBusy(false)
    }
  }

  const style = {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    height: '100%',
    overflow: 'auto',
    color: 'var(--ui-text-primary)',
  }

  return jsxs('div', { style }, ...[
    ClippyFace({ size: 96 }),
    jsx(
      'div',
      { style: { textAlign: 'center', fontSize: '13px', color: 'var(--ui-text-secondary)' } },
      'It looks like you have a question about Hermes. Ask me anything — commands, errors, the Desktop app.',
    ),
    jsxs('div', { style: { display: 'flex', gap: '8px' } }, ...[
      jsx('input', {
        value: question,
        placeholder: 'e.g. gateway won\u2019t start',
        onChange: e => setQuestion(e.target.value),
        onKeyDown: e => {
          if (e.key === 'Enter') submit()
        },
        style: {
          flex: 1,
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
        busy ? '…' : 'Ask',
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
  description: 'The paperclip helpdesk for Hermes — ask about commands, errors, and the Desktop app.',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Clippy',
      data: { placement: 'main' },
      render: () => jsx(ClippyPane, {}),
    })
  },
}
