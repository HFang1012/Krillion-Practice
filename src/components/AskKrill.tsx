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
  streamPick,
  type AskSpec,
  type LoadProgress,
  type ModelId,
} from '../lib/askAi'
import { parseRules, passes, type Rule } from '../lib/rules'
import { fold, solve, type LexRow } from '../lib/solver'
import { publicUrl } from '../lib/publicUrl'
import { TIER_META } from '../lib/tiers'
import { CopyChip } from './CopyChip'

/** A dictionary hit this close is the same question. */
const SAME_QUESTION = 0.72
const NICHE_TIERS: Tier[] = ['krillion', 'deepcut', 'rare']
const SHOW_FIRST = 36
/** Candidates judged per round, rarest first. Rare answers are the ones worth points. */
const PICK_ROUND = 48

type BankHit = { meta: PromptMeta; groups: { tier: Tier; answers: string[] }[] }
type Checked = { head: string; rules: string[]; answers: LexRow[] }
type EngineState = 'idle' | 'loading' | 'ready' | 'error'
type AiPick = { answer: string; score: number | null }
/** How model output is screened: letter rules always, and real-answer lookup when a category list exists. */
type Screen = { rules: Rule[]; known: Map<string, LexRow> | null; exclude: Set<string> }

function rarityLabel(score: number): string {
  if (score >= 80) return 'deep'
  if (score >= 50) return 'rare'
  return 'common'
}

function sameRules(a: string, b: string): boolean {
  const la = parseRules(a).rules.map((r) => r.label).sort().join('|')
  const lb = parseRules(b).rules.map((r) => r.label).sort().join('|')
  return la === lb
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
  const [checked, setChecked] = useState<Checked | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [verified, setVerified] = useState<AiPick[]>([])
  const [unchecked, setUnchecked] = useState<AiPick[]>([])
  const [rejected, setRejected] = useState(0)
  const [aiState, setAiState] = useState<'idle' | 'thinking' | 'streaming' | 'done' | 'error'>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const [nextSpec, setNextSpec] = useState<{ spec: AskSpec; screen: Screen } | null>(null)
  /** Pick mode: real candidates the model judges in batches. */
  const [pick, setPick] = useState<{ question: string; candidates: LexRow[]; checked: number; total: number } | null>(null)
  const pendingPick = useRef<{ question: string; candidates: LexRow[]; from: number } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingAsk = useRef<{ spec: AskSpec; screen: Screen } | null>(null)
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
        if (next) runAi(next.spec, next.screen)
        const nextPick = pendingPick.current
        pendingPick.current = null
        if (nextPick) runPick(nextPick.question, nextPick.candidates, nextPick.from)
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

  function resetAi() {
    abort.current?.abort()
    pendingAsk.current = null
    pendingPick.current = null
    setPick(null)
    setVerified([])
    setUnchecked([])
    setRejected(0)
    setAiError(null)
    setAiState('idle')
  }

  function runAi(spec: AskSpec, screen: Screen) {
    resetAi()
    setNextSpec(null)
    const engineNow = engineRef.current
    if (engineNow.state === 'error') {
      setAiState('error')
      setAiError(engineNow.error)
      return
    }
    if (engineNow.state !== 'ready') {
      // Model still loading: queue the question and run it the moment it's ready.
      pendingAsk.current = { spec, screen }
      setAiState('thinking')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setAiState('thinking')
    streamNiche(
      model,
      spec,
      (answer) => {
        setAiState('streaming')
        const key = fold(answer)
        if (screen.exclude.has(key) || !passes(screen.rules, answer)) {
          setRejected((n) => n + 1)
          return
        }
        const row = screen.known?.get(key)
        if (row) {
          setVerified((prev) =>
            prev.some((p) => p.answer === row[0])
              ? prev
              : [...prev, { answer: row[0], score: row[1] }].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
          )
        } else setUnchecked((prev) => [...prev, { answer, score: null }])
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

  /** Let the model judge real candidates (rarest first), PICK_ROUND at a time. */
  function runPick(question: string, candidates: LexRow[], from: number) {
    abort.current?.abort()
    if (from === 0) {
      setVerified([])
      setUnchecked([])
      setRejected(0)
    }
    setAiError(null)
    setNextSpec(null)
    const total = candidates.length
    setPick({ question, candidates, checked: from, total })
    const engineNow = engineRef.current
    if (engineNow.state === 'error') {
      setAiState('error')
      setAiError(engineNow.error)
      return
    }
    if (engineNow.state !== 'ready') {
      pendingPick.current = { question, candidates, from }
      setAiState('thinking')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setAiState('thinking')
    const round = candidates.slice(from, from + PICK_ROUND)
    const score = new Map(candidates.map((row) => [row[0], row[1]]))
    streamPick(
      model,
      question,
      round.map((row) => row[0]),
      (hit) => {
        setAiState('streaming')
        setVerified((prev) =>
          prev.some((p) => p.answer === hit)
            ? prev
            : [...prev, { answer: hit, score: score.get(hit) ?? null }].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
        )
      },
      (done) => setPick((prev) => (prev ? { ...prev, checked: from + done } : prev)),
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
    setChecked(null)
    setShowAll(false)
    setNextSpec(null)
    resetAi()

    // 1. The exact question is in the dictionary: its real sheet says what is rare.
    const hit = findPrompt(index, question)
    if (hit && hit.score >= SAME_QUESTION && sameRules(question, hit.meta.text)) {
      try {
        const shard = await loadShard(hit.meta.id)
        const groups = NICHE_TIERS.flatMap((tier) => {
          const answers = shard.tiers[tier] ?? []
          return answers.length ? [{ tier, answers: answers.slice(0, 24) }] : []
        })
        const common = [...(shard.tiers.schooler ?? []), ...(shard.tiers.plankton ?? [])]
        const seen = Object.values(shard.tiers).flat()
        setBank({ meta: hit.meta, groups })
        setNextSpec({
          spec: { question: hit.meta.text, avoid: common, list: false },
          screen: { rules: parseRules(hit.meta.text).rules, known: null, exclude: new Set(seen.map(fold)) },
        })
        return
      } catch {
        // sheet failed to load; fall through
      }
    }

    // 2. A new question in a known category: real past answers, checked against its rules in code.
    const solved = await solve(question)
    const rules = solved.parsed.rules
    if (solved.exact && solved.answers.length) {
      setChecked({ head: solved.head ?? '', rules: rules.map((r) => r.label), answers: solved.answers })
      setNextSpec({
        spec: { question: solved.parsed.base, avoid: [], list: true },
        screen: { rules, known: null, exclude: new Set(solved.answers.map((row) => fold(row[0]))) },
      })
      return
    }

    // 3. Something only a model can judge ("…in Africa").
    // With a category list, code first narrows it to answers that pass the letter rules, and the
    // model just picks which of those fit: choosing from a list is far easier than recalling one.
    // Big open categories (every fruit, every animal) are too many to judge, so those still go to recall.
    if (solved.answers.length && (rules.length > 0 || solved.answers.length <= 400)) {
      runPick(rules.length ? solved.parsed.base : question, solved.answers, 0)
      return
    }
    // Otherwise the model lists candidates and code screens them.
    // Letter rules are taken out of the prompt, since small models cannot count letters.
    // First-letter rules are easy for a model to follow, so they are passed on as a hint.
    const hint = rules.filter((r) => r.label.startsWith('starts with')).map((r) => r.label).join(', ')
    runAi(
      { question: rules.length ? solved.parsed.base : question, avoid: [], list: true, hint: hint || undefined },
      { rules, known: solved.known.size ? solved.known : null, exclude: new Set() },
    )
  }

  function pickModel(id: ModelId) {
    if (id === model) return
    resetAi()
    setProgress(null)
    setEngineState('loading')
    engineRef.current = { state: 'loading', error: null }
    saveModel(id)
    setModel(id)
  }

  const pct = Math.round((progress?.progress ?? 0) * 100)
  const shownChecked = checked ? (showAll ? checked.answers : checked.answers.slice(0, SHOW_FIRST)) : []

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
                {pct < 100 ? `Loading the local AI · ${pct}%` : 'Starting the local AI'}
                {' · downloads once, then it is cached'}
              </p>
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
                Paste a Krillion question. Past questions come from the dictionary. New ones are answered from every
                answer the game has accepted, with letter rules checked exactly. The AI on this device
                {hasWebGpu() ? '' : ' (needs WebGPU)'} only fills gaps.
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
              </>
            ) : null}

            {checked ? (
              <section className="ask-tier">
                <h3 className="tier-kicker" data-tier="deepcut">
                  Checked answers · {checked.answers.length}
                </h3>
                <p className="ask-note">
                  Every {checked.head} the game has accepted
                  {checked.rules.length ? `, filtered by: ${checked.rules.join(' · ')}` : ''}. Rarest first.
                </p>
                <ul className="chips">
                  {shownChecked.map(([answer, score]) => (
                    <li key={answer} className="ask-scored" data-rarity={rarityLabel(score)}>
                      <CopyChip answer={answer} />
                    </li>
                  ))}
                </ul>
                {checked.answers.length > SHOW_FIRST ? (
                  <button type="button" className="btn btn-tiny ask-more" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show fewer' : `Show all ${checked.answers.length}`}
                  </button>
                ) : null}
              </section>
            ) : null}

            {nextSpec && aiState === 'idle' ? (
              <button type="button" className="btn btn-tiny ask-more" onClick={() => runAi(nextSpec.spec, nextSpec.screen)}>
                More ideas from AI
              </button>
            ) : null}

            {aiState !== 'idle' ? (
              <section className="ask-tier">
                <h3 className="tier-kicker" data-tier="schooler">
                  AI ideas
                  {aiState === 'thinking'
                    ? engineState === 'loading'
                      ? ' · waiting for the AI to load'
                      : ' · thinking'
                    : aiState === 'streaming'
                      ? ' · writing'
                      : ''}
                </h3>
                {aiState === 'error' ? <p className="error">{aiError}</p> : null}
                {pick ? (
                  <p className="ask-note">
                    AI checked {pick.checked} of {pick.total} real {pick.total === 1 ? 'answer' : 'answers'} that pass
                    the letter rules, rarest first.
                  </p>
                ) : null}
                {verified.length ? (
                  <>
                    <p className="ask-note">{pick
                        ? 'Real answers, letter rules checked. The AI thinks these fit the rest (it can be wrong on obscure names):'
                        : 'Real past answers, rules checked:'}</p>
                    <ul className="chips">
                      {verified.map((pick) => (
                        <li key={pick.answer} className="ask-scored" data-rarity={rarityLabel(pick.score ?? 0)}>
                          <CopyChip answer={pick.answer} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {unchecked.length ? (
                  <>
                    <p className="ask-note">
                      {verified.length ? 'Not in any past sheet (rules checked, facts not):' : 'Rules checked, facts not:'}
                    </p>
                    <ul className="chips ask-unchecked">
                      {unchecked.map((pick, i) => (
                        <li key={`${pick.answer}-${i}`}>
                          <CopyChip answer={pick.answer} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {pick && aiState === 'done' && pick.checked < pick.total ? (
                  <button
                    type="button"
                    className="btn btn-tiny ask-more"
                    onClick={() => runPick(pick.question, pick.candidates, pick.checked)}
                  >
                    Check {Math.min(PICK_ROUND, pick.total - pick.checked)} more
                  </button>
                ) : null}
                {aiState === 'done' && !verified.length && !unchecked.length ? (
                  <p className="ask-note">Nothing the AI said passed the checks. Try rewording the question.</p>
                ) : null}
                {aiState === 'done' && rejected > 0 ? (
                  <p className="ask-note">
                    {rejected} AI {rejected === 1 ? 'guess was' : 'guesses were'} dropped for breaking the rules or
                    repeating.
                  </p>
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
