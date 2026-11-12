import { useEffect, useRef, useState } from 'react'
import type { BankIndex, PromptMeta, Tier } from '../types'
import { loadShard } from '../lib/bank'
import { findPrompt, RateLimited, streamNiche, waitMs } from '../lib/askAi'
import { publicUrl } from '../lib/publicUrl'
import { TIER_META } from '../lib/tiers'
import { CopyChip } from './CopyChip'

/** A dictionary hit this close is the same question. */
const SAME_QUESTION = 0.72
const NICHE_TIERS: Tier[] = ['krillion', 'deepcut', 'rare']

type BankHit = { meta: PromptMeta; groups: { tier: Tier; answers: string[] }[]; common: string[] }

export function AskKrill({ index }: { index: BankIndex }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [bank, setBank] = useState<BankHit | null>(null)
  const [ai, setAi] = useState<string[]>([])
  const [aiState, setAiState] = useState<'idle' | 'waiting' | 'streaming' | 'done' | 'error'>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(
    () => () => {
      abort.current?.abort()
      window.clearInterval(timer.current)
    },
    [],
  )

  function runAi(question: string, avoid: string[]) {
    abort.current?.abort()
    window.clearInterval(timer.current)
    setAi([])
    setAiError(null)

    const start = () => {
      const controller = new AbortController()
      abort.current = controller
      setAiState('streaming')
      streamNiche(question, avoid, (answer) => setAi((prev) => [...prev, answer]), controller.signal)
        .then(() => {
          if (!controller.signal.aborted) setAiState('done')
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof RateLimited) wait(err.retryMs)
          else {
            setAiState('error')
            setAiError(err instanceof Error ? err.message : 'The AI did not answer.')
          }
        })
    }

    // Free tier: one reply per ~45s. Count down, then fire on its own.
    const wait = (ms: number) => {
      setAiState('waiting')
      const until = Date.now() + ms
      setCountdown(Math.ceil(ms / 1000))
      window.clearInterval(timer.current)
      timer.current = window.setInterval(() => {
        const left = until - Date.now()
        if (left <= 0) {
          window.clearInterval(timer.current)
          start()
        } else setCountdown(Math.ceil(left / 1000))
      }, 250)
    }

    const pending = waitMs()
    if (pending > 0) wait(pending)
    else start()
  }

  async function ask(event?: React.FormEvent) {
    event?.preventDefault()
    const question = query.trim()
    if (!question) return
    setAsked(question)
    setBank(null)

    const hit = findPrompt(index, question)
    if (hit && hit.score >= SAME_QUESTION) {
      // Instant and exact: the real sheet already says which answers are rare.
      try {
        const shard = await loadShard(hit.meta.id)
        const groups = NICHE_TIERS.flatMap((tier) => {
          const answers = shard.tiers[tier] ?? []
          return answers.length ? [{ tier, answers: answers.slice(0, 24) }] : []
        })
        const common = [...(shard.tiers.schooler ?? []), ...(shard.tiers.plankton ?? [])]
        setBank({ meta: hit.meta, groups, common })
        abort.current?.abort()
        window.clearInterval(timer.current)
        setAi([])
        setAiState('idle')
        return
      } catch {
        // sheet failed to load; ask the AI instead
      }
    }
    runAi(question, [])
  }

  return (
    <div className={open ? 'ask-krill is-open' : 'ask-krill'}>
      {open ? (
        <section className="ask-panel" aria-label="Ask for niche answers">
          <header className="ask-head">
            <img className="sprite krill" src={publicUrl('art/krillion.png')} alt="" width={32} height={32} />
            <p>Niche finder</p>
            <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </header>
          <form className="ask-form" onSubmit={ask}>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste a question"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary btn-tiny" disabled={!query.trim()}>
              Ask
            </button>
          </form>

          <div className="ask-body">
            {!asked ? (
              <p className="ask-note">
                Paste a Krillion question. Past questions come straight from the dictionary. New ones go to a free AI.
              </p>
            ) : null}

            {bank ? (
              <>
                <p className="ask-note">
                  In the dictionary · Dive #{bank.meta.dive} · {bank.meta.date}
                </p>
                <p className="ask-q">{bank.meta.text}</p>
                {bank.groups.map((group) => (
                  <section key={group.tier} className="ask-tier">
                    <h3 className="tier-kicker" data-tier={group.tier}>
                      {TIER_META[group.tier].label} · {TIER_META[group.tier].score}
                    </h3>
                    <ul className="chips">
                      {group.answers.map((answer, i) => (
                        <li key={`${answer}-${i}`}>
                          <CopyChip answer={answer} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {aiState === 'idle' ? (
                  <button
                    type="button"
                    className="btn btn-tiny ask-more"
                    onClick={() => runAi(bank.meta.text, bank.common)}
                  >
                    More ideas from AI
                  </button>
                ) : null}
              </>
            ) : null}

            {aiState !== 'idle' ? (
              <section className="ask-tier">
                <h3 className="tier-kicker" data-tier="schooler">
                  AI ideas {aiState === 'streaming' ? '· thinking' : ''}
                </h3>
                {aiState === 'waiting' ? (
                  <p className="ask-note">Free AI cooldown. Asking in {countdown}s.</p>
                ) : null}
                {aiState === 'error' ? <p className="error">{aiError}</p> : null}
                {ai.length ? (
                  <ul className="chips">
                    {ai.map((answer, i) => (
                      <li key={`${answer}-${i}`}>
                        <CopyChip answer={answer} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {aiState === 'done' ? (
                  <p className="ask-note">AI ideas are guesses and are not checked against the sheet.</p>
                ) : null}
              </section>
            ) : null}
          </div>
        </section>
      ) : (
        <button type="button" className="ask-fab" onClick={() => setOpen(true)} aria-label="Open the niche finder">
          <img className="sprite krill" src={publicUrl('art/krillion.png')} alt="" width={40} height={40} />
          <span>Niche</span>
        </button>
      )}
    </div>
  )
}
