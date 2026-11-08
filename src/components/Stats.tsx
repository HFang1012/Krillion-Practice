import type { QuestionRecord } from '../types'
import { summarizeLog, type PromptStats } from '../lib/stats'
import { formatAccuracy } from '../lib/tiers'
import { Sprite } from './Sprite'
import { TopBar } from './TopBar'

function ScoreMeter({
  label,
  value,
  copy,
}: {
  label: string
  value: number
  copy: string
}) {
  return (
    <article className="stat-score">
      <p className="mode-kicker">{label}</p>
      <p className="stat-score-value">{formatAccuracy(value)}</p>
      <p className="mode-copy">{copy}</p>
      <div className="depth-track" aria-hidden="true">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </article>
  )
}

function PromptList({
  title,
  empty,
  items,
  actionLabel,
  onOpen,
}: {
  title: string
  empty: string
  items: PromptStats[]
  actionLabel: string
  onOpen: (id: string) => void
}) {
  return (
    <section className="stat-list">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="log-empty">{empty}</p>
      ) : (
        <ul className="log-list">
          {items.map((prompt) => (
            <li key={prompt.id}>
              <button type="button" className="stat-row" onClick={() => onOpen(prompt.id)}>
                <Sprite tier={prompt.bestTier} size={36} />
                <span className="log-text">
                  <strong>{prompt.text}</strong>
                  <small>
                    Dive #{prompt.dive} · {formatAccuracy(prompt.accuracy)} ·{' '}
                    {prompt.hits === 1 ? '1 hit' : `${prompt.hits} hits`} · {actionLabel}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Stats({
  log,
  points,
  onHome,
  onNavigate,
}: {
  log: QuestionRecord[]
  points: number
  onHome: () => void
  onNavigate: (hash: string) => void
}) {
  const stats = summarizeLog(log)
  const showingGems = stats.best.some((prompt) => prompt.foundKrillion)

  return (
    <div className="screen">
      <TopBar mode="Statistics" points={points} onHome={onHome} />
      <main className="sheet stats-sheet">
        <p className="dive-label">
          {stats.questions
            ? `${stats.questions.toLocaleString('en-US')} question${stats.questions === 1 ? '' : 's'} · ${stats.dives.toLocaleString('en-US')} logged dive${stats.dives === 1 ? '' : 's'}`
            : 'No dives logged yet'}
        </p>
        <h1 className="prompt">your depths</h1>
        {stats.questions === 0 ? (
          <p className="dictionary-note">
            Practice a few prompts, then come back. Knowledge is how often you find the gem. Accuracy is how deep your best answer goes.
          </p>
        ) : (
          <>
            <div className="stat-scores">
              <ScoreMeter
                label="Knowledge"
                value={stats.knowledge}
                copy="Share of practiced questions where you found One in a Krillion."
              />
              <ScoreMeter
                label="Accuracy"
                value={stats.accuracy}
                copy="Average best answer on each question. A gem is 100%."
              />
            </div>
            <div className="stat-columns">
              <PromptList
                title={showingGems ? 'Best krillions' : 'Closest dives'}
                empty="No gems yet. Keep diving."
                items={stats.best}
                actionLabel="learn"
                onOpen={(id) => onNavigate(`#/learn/${id}`)}
              />
              <PromptList
                title="Work on"
                empty="No weak spots — every logged question has a gem."
                items={stats.workOn}
                actionLabel="practice"
                onOpen={(id) => onNavigate(`#/practice/${id}`)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
