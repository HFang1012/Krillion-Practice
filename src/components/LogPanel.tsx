import { useState } from 'react'
import type { QuestionRecord } from '../types'
import { formatAccuracy, TIER_META } from '../lib/tiers'
import { Sprite } from './Sprite'

export function LogPanel({
  log,
  onClear,
}: {
  log: QuestionRecord[]
  onClear: () => void
}) {
  const [armed, setArmed] = useState(false)
  const average = log.length
    ? log.reduce((sum, record) => sum + record.accuracy, 0) / log.length
    : 0

  return (
    <aside className="log" id="log">
      <div className="log-head">
        <div>
          <h2>Answered</h2>
          <p>
            {log.length} question{log.length === 1 ? '' : 's'}
            {log.length ? ` · avg ${formatAccuracy(average)}` : ''}
          </p>
        </div>
        {log.length ? (
          <button
            type="button"
            className="btn btn-ghost btn-tiny"
            onClick={() => {
              if (!armed) {
                setArmed(true)
                return
              }
              setArmed(false)
              onClear()
            }}
          >
            {armed ? 'Confirm' : 'Clear'}
          </button>
        ) : null}
      </div>
      {log.length === 0 ? (
        <p className="log-empty">Rate an answer, then hit Next. Every question stays here.</p>
      ) : (
        <ul className="log-list">
          {log.map((record) => {
            const bestTier = record.attempts.reduce<(typeof record.attempts)[number] | null>(
              (best, attempt) => {
                if (attempt.tier === 'noecho') return best
                if (!best || attempt.score > best.score) return attempt
                return best
              },
              null,
            )
            const tier = bestTier?.tier ?? 'noecho'
            return (
              <li key={`${record.id}-${record.at}`}>
                <details>
                  <summary>
                    <Sprite tier={tier} size={36} />
                    <span className="log-text">
                      <strong>{record.text}</strong>
                      <small>
                        Dive #{record.dive} · {formatAccuracy(record.accuracy)} · {record.total} pts
                      </small>
                    </span>
                  </summary>
                  <ul className="log-attempts">
                    {record.attempts.map((attempt, index) => (
                      <li key={`${record.at}-${index}`}>
                        <span>{attempt.answer ?? attempt.raw}</span>
                        <span>
                          {attempt.tier === 'noecho' ? 'No echo' : TIER_META[attempt.tier].label}
                          {attempt.duplicate ? ' · repeat' : ''}
                          {attempt.corrected ? ' · fixed' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
