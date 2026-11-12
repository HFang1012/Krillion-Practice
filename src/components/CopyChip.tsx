import { useEffect, useRef, useState } from 'react'
import { copyForm, copyText } from '../lib/copy'

/** An answer box that copies its answer (lowercase, hyphens as spaces) on click. */
export function CopyChip({ answer }: { answer: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    const ok = await copyText(copyForm(answer))
    setState(ok ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1100)
  }

  return (
    <button
      type="button"
      className={`chip-copy${state === 'copied' ? ' is-copied' : ''}${state === 'failed' ? ' is-failed' : ''}`}
      onClick={copy}
      title={`Copy "${copyForm(answer)}"`}
    >
      {answer}
      {state !== 'idle' ? (
        <span className="chip-flag" role="status">
          {state === 'copied' ? 'copied' : 'copy failed'}
        </span>
      ) : null}
    </button>
  )
}
