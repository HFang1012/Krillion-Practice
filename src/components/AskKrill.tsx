import { useEffect, useRef, useState } from 'react'
import type { BankIndex, PromptMeta, Tier } from '../types'
import { loadShard } from '../lib/bank'
import {
  findPrompt,
  getEngine,
  hasWebGpu,
  MODELS,
  saveModel,
  savedModel,
  stopListening,
  streamNiche,
  type LoadProgress,
  type ModelId,
} from '../lib/askAi'
import { publicUrl } from '../lib/publicUrl'
import { TIER_META } from '../lib/tiers'
import { CopyChip } from './CopyChip'

/** A dictionary hit this close is the same question. */
const SAME_QUESTION = 0.72
const NICHE_TIERS: Tier[] = ['krillion', 'deepcut', 'rare']

type BankHit = { meta: PromptMeta; groups: { tier: Tier; answers: string[] }[]; common: string[] }
type EngineState = 'idle' | 'loading' | 'ready' | 'error'

/** WebLLM's progress text, trimmed to the useful part ("Fetching param cache[12/27]: 410MB fetched..."). */
function loadDetail(text: string): string {
  return text.replace(/\. It can take a while.*$/i, '').slice(0, 110)
}

export function AskKrill({ index }: { index: BankIndex }) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState<ModelId>(savedModel)
  const [engineState, setEngineState] = useState<EngineState>('idle')
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [bank, setBank] = useState<BankHit | null>(null)
  const [ai, setAi] = useState<string[]>([])
  const [aiState, setAiState] = useState<'idle' | 'thinking' | 'streaming' | 'done' | 'error'>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingAsk = useRef<{ question: string; avoid: string[] } | null>(null)
  // Read by runAi, which can be called from inside the load promise (stale state there).
  const engineRef = useRef<{ state: EngineState; error: string | null }>({ state: 'idle', error: null })
  engineRef.current = { state: engineState, error: engineError }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => () => abort.current?.abort(), [])

  // Start loading the model as soon as the panel opens, so it is warm by the time you ask.
  useEffect(() => {
    if (!open) return
    let live = true
    const onProgress = (report: LoadProgress) => {
      if (live) setProgress(report)
    }
    setEngineState('loading')
    setEngineError(null)
    getEngine(model, onProgress)
      .then(() => {
        if (!live) return
        setEngineState('ready')
        engineRef.current = { state: 'ready', error: null }
        const next = pendingAsk.current
        pendingAsk.current = null
        if (next) runAi(next.question, next.avoid)
      })
      .catch((err: unknown) => {
        if (!live) return
        setEngineState('error')
        setEngineError(err instanceof Error ? err.message : 'The local model could not start.')
      })
    return () => {
      live = false
      stopListening(onProgress)
    }
  }, [open, model])

  function runAi(question: string, avoid: string[]) {
    abort.current?.abort()
    setAi([])
    setAiError(null)
    const engineNow = engineRef.current
    if (engineNow.state === 'error') {
      setAiState('error')
      setAiError(engineNow.error)
      return
    }
    if (engineNow.state !== 'ready') {
      // Model still downloading: queue the question and run it the moment it's ready.
      pendingAsk.current = { question, avoid }
      setAiState('thinking')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setAiState('thinking')
    streamNiche(
      model,
      question,
      avoid,
      (answer) => {
        setAiState('streaming')
        setAi((prev) => [...prev, answer])
      },
      (thinking) => setAiState(thinking ? 'thinking' : 'streaming'),
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted) setAiState('done')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setAiState('error')
        setAiError(err instanceof Error ? err.message : 'The local model did not answer.')
      })
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
        pendingAsk.current = null
        setAi([])
        setAiState('idle')
        return
      } catch {
        // sheet failed to load; ask the model instead
      }
    }
    runAi(question, [])
  }

  function pickModel(id: ModelId) {
    if (id === model) return
    abort.current?.abort()
    pendingAsk.current = null
    setAi([])
    setAiState('idle')
    setProgress(null)
    setEngineState('loading')
    engineRef.current = { state: 'loading', error: null }
    saveModel(id)
    setModel(id)
  }

  const pct = Math.round((progress?.progress ?? 0) * 100)

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

          <div className="ask-models" role="radiogroup" aria-label="Local model">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === model}
                className={m.id === model ? 'ask-model is-on' : 'ask-model'}
                onClick={() => pickModel(m.id)}
                title={m.detail}
              >
                {m.label}
              </button>
            ))}
            <span className="ask-model-detail">{MODELS.find((m) => m.id === model)?.detail}</span>
          </div>

          {engineState === 'loading' ? (
            <div className="ask-load">
              <div className="ask-bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="ask-note">
                {pct < 100 ? `Loading the local model · ${pct}%` : 'Starting the local model'}
                {' · downloads once, then it is cached'}
              </p>
              {progress?.text ? <p className="ask-note ask-load-detail">{loadDetail(progress.text)}</p> : null}
            </div>
          ) : null}
          {engineState === 'error' ? <p className="error ask-pad">{engineError}</p> : null}

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
                Paste a Krillion question. Past questions come straight from the dictionary. New ones go to an AI
                that runs on this device{hasWebGpu() ? '' : ' (needs WebGPU)'}.
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
                  AI ideas
                  {aiState === 'thinking'
                    ? engineState === 'loading'
                      ? ' · waiting for the model'
                      : ' · thinking'
                    : aiState === 'streaming'
                      ? ' · writing'
                      : ''}
                </h3>
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
                {aiState === 'done' && !ai.length ? (
                  <p className="ask-note">No answers came back. Try asking again.</p>
                ) : null}
                {aiState === 'done' && ai.length ? (
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
