import { useEffect, useMemo, useRef } from 'react'
import type { BankIndex, Tier } from '../types'
import { usePrompt } from '../hooks/usePrompt'
import { TIER_META } from '../lib/tiers'
import { Descending } from './Descending'
import { Sprite } from './Sprite'
import { TopBar } from './TopBar'

const SHALLOW = ['rare', 'schooler', 'tooclever', 'plankton'] as const

function middle(list: string[]): string {
  return list[Math.floor((list.length - 1) / 2)] ?? ''
}

function DeepCuts({ answers }: { answers: string[] }) {
  return (
    <section className="deep-block">
      <h2>
        Deep cuts · 85
        {answers.length > 1 ? <span> · {answers.length.toLocaleString('en-US')}</span> : null}
      </h2>
      <ul className="chips deep-rows">
        {answers.map((answer, index) => (
          <li key={`${answer}-${index}`}>{answer}</li>
        ))}
      </ul>
    </section>
  )
}

export function Learn({
  index,
  forcedId,
  points,
  onHome,
  onClearForce,
}: {
  index: BankIndex
  forcedId: string | null
  points: number
  onHome: () => void
  onClearForce: () => void
}) {
  const { meta, shard, loading, error, next } = usePrompt(index, forcedId)
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const nextRef = useRef(next)
  nextRef.current = next
  const forcedRef = useRef(forcedId)
  forcedRef.current = forcedId
  const clearRef = useRef(onClearForce)
  clearRef.current = onClearForce

  const board = useMemo(() => {
    if (!shard) return null
    const gems = shard.tiers.krillion ?? []
    const deep = shard.tiers.deepcut ?? []
    const ladder = SHALLOW.flatMap((tier) => {
      const answer = middle(shard.tiers[tier] ?? [])
      return answer ? [{ tier: tier as Tier, answer }] : []
    })
    return { gems, deep, ladder }
  }, [shard])

  function advance() {
    if (loadingRef.current) return
    if (forcedRef.current) {
      clearRef.current()
      return
    }
    nextRef.current()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLButtonElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="screen">
      <TopBar mode="Learn" points={points} onHome={onHome} />
      <main className="sheet">
        {error ? <p className="error">{error}</p> : null}
        {loading || !meta || !shard || !board ? (
          <Descending />
        ) : (
          <>
            <p className="dive-label">
              Dive #{meta.dive} · {meta.date} · {meta.count.toLocaleString('en-US')} answers
            </p>
            <h1 className="prompt" id="learn-prompt">
              {meta.text}
            </h1>

            {board.gems.length ? (
              <section className="hero-card" aria-labelledby="learn-prompt">
                <Sprite tier="krillion" size={104} />
                <div>
                  <p className="tier-kicker" data-tier="krillion">
                    {TIER_META.krillion.label} · {TIER_META.krillion.score}
                    {board.gems.length > 1 ? ` · ${board.gems.length}` : ''}
                  </p>
                  <ul className="hero-answers">
                    {board.gems.map((answer, index) => (
                      <li key={`${answer}-${index}`}>{answer}</li>
                    ))}
                  </ul>
                  <p className="flavor">{TIER_META.krillion.line}</p>
                </div>
              </section>
            ) : null}

            {board.deep.length ? <DeepCuts key={meta.id} answers={board.deep} /> : null}

            {board.ladder.length ? (
              <section className="ladder">
                <h2>Shallower</h2>
                <ul>
                  {board.ladder.map((row) => (
                    <li key={row.tier}>
                      <Sprite tier={row.tier} size={48} />
                      <span className="tier-kicker" data-tier={row.tier}>
                        {TIER_META[row.tier].label}
                        <small>{TIER_META[row.tier].score}</small>
                      </span>
                      <span className="ladder-answer">{row.answer}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="next-bar">
              <p className="hint">Enter</p>
              <button type="button" className="btn btn-primary" onClick={advance} disabled={loading}>
                Next
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
