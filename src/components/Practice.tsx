import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Attempt, BankIndex, QuestionRecord } from '../types'
import { usePrompt } from '../hooks/usePrompt'
import { prepare, rate } from '../lib/score'
import { formatAccuracy, formatMeters, NO_ECHO, TIER_META } from '../lib/tiers'
import { Descending } from './Descending'
import { LogPanel } from './LogPanel'
import { Sprite } from './Sprite'
import { TopBar } from './TopBar'

function summarize(attempts: Attempt[]) {
  const total = attempts.reduce((sum, attempt) => sum + attempt.counted, 0)
  const best = attempts.reduce((max, attempt) => (attempt.tier === 'noecho' ? max : Math.max(max, attempt.score)), 0)
  return { total, best, accuracy: best / 100 }
}

export function Practice({
  index,
  forcedId,
  log,
  points,
  onHome,
  onClearForce,
  onAppend,
  onClearLog,
  onLivePoints,
}: {
  index: BankIndex
  forcedId: string | null
  log: QuestionRecord[]
  points: number
  onHome: () => void
  onClearForce: () => void
  onAppend: (record: QuestionRecord) => void
  onClearLog: () => void
  onLivePoints: (points: number) => void
}) {
  const loggedIdsRef = useRef(new Set<string>())
  loggedIdsRef.current = new Set(log.map((record) => record.id))
  const { meta, shard, loading, error, next } = usePrompt(index, forcedId, loggedIdsRef)
  const prepared = useMemo(() => (shard ? prepare(shard) : null), [shard])
  const [input, setInput] = useState('')
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const counted = useRef(new Set<string>())

  useEffect(() => {
    setInput('')
    setAttempts([])
    counted.current = new Set()
    onLivePoints(0)
    inputRef.current?.focus()
  }, [meta?.id, onLivePoints])

  const stats = summarize(attempts)
  const last = attempts[0] ?? null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!prepared) return
    const raw = input.trim()
    if (!raw) return
    const hit = rate(prepared, raw)
    const duplicate = hit.tier !== 'noecho' && counted.current.has(hit.norm)
    if (hit.tier !== 'noecho') counted.current.add(hit.norm)
    const attempt: Attempt = {
      raw,
      answer: hit.answer,
      tier: hit.tier,
      score: hit.score,
      counted: duplicate || hit.tier === 'noecho' ? 0 : hit.score,
      corrected: hit.corrected,
      duplicate,
    }
    const nextAttempts = [attempt, ...attempts]
    setAttempts(nextAttempts)
    onLivePoints(summarize(nextAttempts).total)
    setInput('')
    inputRef.current?.focus()
  }

  function finish() {
    if (!meta) return
    if (attempts.length) {
      onAppend({
        id: meta.id,
        date: meta.date,
        dive: meta.dive,
        text: meta.text,
        attempts,
        total: stats.total,
        best: stats.best,
        accuracy: stats.accuracy,
        at: Date.now(),
      })
    }
    if (forcedId) onClearForce()
    else next()
  }

  const lastMeta = last && last.tier !== 'noecho' ? TIER_META[last.tier] : null

  return (
    <div className="screen">
      <TopBar mode="Practice" points={points} onHome={onHome} logCount={log.length} />
      <div className="layout has-log">
        <main className="sheet">
          {error ? <p className="error">{error}</p> : null}
          {loading || !meta || !shard || !prepared ? (
            <Descending />
          ) : (
            <>
              <p className="dive-label">
                Dive #{meta.dive} · {meta.date} · {meta.count.toLocaleString('en-US')} answers
              </p>
              <h1 className="prompt" id="practice-prompt">
                {meta.text}
              </h1>

              {attempts.length ? (
                <div className="question-stats">
                  <span>
                    Score <strong>{stats.total}</strong>
                  </span>
                  <span>
                    Accuracy <strong>{formatAccuracy(stats.accuracy)}</strong>
                  </span>
                  <span>
                    Best <strong>{formatMeters(stats.best)}</strong>
                  </span>
                </div>
              ) : null}

              {last ? (
                <article className={`result ${last.tier === 'noecho' ? 'is-miss' : 'is-hit'}`} data-tier={last.tier}>
                  <Sprite tier={last.tier} size={96} />
                  <div>
                    <p className="tier-kicker" data-tier={last.tier}>
                      {lastMeta ? lastMeta.label : NO_ECHO.label}
                    </p>
                    <h2>{last.answer ?? last.raw}</h2>
                    <p className="points">
                      {last.duplicate ? '+0' : `+${last.score}`}
                      <small>{formatMeters(last.score)}</small>
                    </p>
                    <p className="flavor">
                      {last.duplicate
                        ? 'Already counted on this question.'
                        : lastMeta
                          ? lastMeta.line
                          : NO_ECHO.line}
                    </p>
                    {last.corrected && last.answer ? <p className="heard">Heard as {last.answer}</p> : null}
                    <div className="depth-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(last.score, last.tier === 'noecho' ? 0 : 6)}%` }} />
                    </div>
                  </div>
                </article>
              ) : null}

              {attempts.length > 1 ? (
                <ul className="attempt-list">
                  {attempts.slice(1).map((attempt, index) => (
                    <li key={`${attempt.raw}-${index}`}>
                      <span>{attempt.answer ?? attempt.raw}</span>
                      <span>
                        {attempt.tier === 'noecho' ? 'No echo' : TIER_META[attempt.tier].label}
                        {attempt.duplicate ? ' · repeat' : ` · ${attempt.counted}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <form className="answer-form" onSubmit={submit}>
                <label className="sr-only" htmlFor="answer">
                  Your answer
                </label>
                <input
                  id="answer"
                  ref={inputRef}
                  value={input}
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="an answer"
                  aria-labelledby="practice-prompt"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.repeat) return
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
                />
                <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
                  Rate
                </button>
              </form>

              <div className="next-bar">
                <p className="hint">{attempts.length ? 'Add another, or log this one' : 'Enter rates it'}</p>
                <button type="button" className="btn btn-ghost" onClick={finish}>
                  Next
                </button>
              </div>
            </>
          )}
        </main>
        <LogPanel log={log} onClear={onClearLog} />
      </div>
    </div>
  )
}
