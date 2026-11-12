import { useEffect, useMemo, useState } from 'react'
import type { BankIndex, PromptMeta, Shard } from '../types'
import { TIERS } from '../types'
import { loadShard } from '../lib/bank'
import { TIER_META } from '../lib/tiers'
import { TopBar } from './TopBar'
import { CopyChip } from './CopyChip'

const MATCH_LIMIT = 12

function AnswerSheet({ meta, shard }: { meta: PromptMeta; shard: Shard }) {
  const groups = TIERS.flatMap((tier) => {
    const answers = shard.tiers[tier] ?? []
    return answers.length ? [{ tier, answers }] : []
  })

  return (
    <section className="dict-sheet" aria-label={meta.text}>
      <p className="dive-label">
        Dive #{meta.dive} · {meta.date} · {meta.count.toLocaleString('en-US')} answers
      </p>
      <p className="dictionary-note dict-copy-hint">Click any answer to copy it.</p>
      {groups.map((group) => (
        <section key={group.tier} className="dict-tier">
          <h3 className="tier-kicker" data-tier={group.tier}>
            {TIER_META[group.tier].label} · {TIER_META[group.tier].score}
            {group.answers.length > 1 ? ` · ${group.answers.length.toLocaleString('en-US')}` : ''}
          </h3>
          <ul className="chips">
            {group.answers.map((answer, index) => (
              <li key={`${group.tier}-${answer}-${index}`}>
                <CopyChip answer={answer} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  )
}

export function Dictionary({
  index,
  points,
  onHome,
}: {
  index: BankIndex
  points: number
  onHome: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [shard, setShard] = useState<Shard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle) return []
    return index.prompts.filter((prompt) => prompt.text.toLowerCase().includes(needle))
  }, [index.prompts, needle])
  const visible = matches.slice(0, MATCH_LIMIT)
  const extra = matches.length - visible.length
  // Only a question you clicked is open. Clicking it again closes it.
  const selected = matches.find((prompt) => prompt.id === selectedId) ?? null
  const selectedKey = selected?.id ?? null

  useEffect(() => {
    if (!selectedKey) {
      setShard(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancel = false
    setLoading(true)
    setError(null)
    setShard(null)
    loadShard(selectedKey)
      .then((data) => {
        if (!cancel) setShard(data)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Could not load this sheet.')
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [selectedKey])

  return (
    <div className="screen">
      <TopBar mode="Dictionary" points={points} onHome={onHome} />
      <main className="sheet">
        <h1 className="prompt">Dictionary</h1>
        <form className="dict-search" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="dictionary-query">
            Search questions
          </label>
          <input
            id="dictionary-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a question"
            autoComplete="off"
            autoFocus
          />
        </form>

        {!needle ? <p className="dictionary-note">Type a question to see its answers.</p> : null}
        {needle && visible.length === 0 ? <p className="dictionary-note">No questions match.</p> : null}
        {selected ? (
          <div className="dict-open">
            <button
              type="button"
              className="dict-match is-selected"
              onClick={() => setSelectedId(null)}
              aria-expanded="true"
              title="Close this question"
            >
              <span className="dict-text">{selected.text}</span>
              <span className="dict-meta">
                Dive #{selected.dive} · {selected.date} · click to close
              </span>
            </button>
            {error ? <p className="error">{error}</p> : null}
            {loading ? <p className="dictionary-note">Loading the sheet.</p> : null}
            {shard ? <AnswerSheet meta={selected} shard={shard} /> : null}
          </div>
        ) : null}
        {visible.some((prompt) => prompt.id !== selected?.id) ? (
          <>
            {selected ? <p className="dictionary-note dict-others">Other questions</p> : null}
            <ul className="dict-matches">
              {visible
                .filter((prompt) => prompt.id !== selected?.id)
                .map((prompt) => (
                  <li key={prompt.id}>
                    <button
                      type="button"
                      className="dict-match"
                      aria-expanded="false"
                      onClick={() => {
                        setSelectedId(prompt.id)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      <span className="dict-text">{prompt.text}</span>
                      <span className="dict-meta">
                        Dive #{prompt.dive} · {prompt.date}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
            {extra > 0 ? (
              <p className="dictionary-note">
                {extra.toLocaleString('en-US')} more {extra === 1 ? 'match' : 'matches'}. Narrow the search.
              </p>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  )
}
