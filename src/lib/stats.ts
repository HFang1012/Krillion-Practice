import type { QuestionRecord, Tier } from '../types'

const LIST_LIMIT = 8

export type PromptStats = {
  id: string
  date: string
  dive: number
  text: string
  accuracy: number
  total: number
  hits: number
  foundKrillion: boolean
  bestTier: Tier | 'noecho'
  at: number
}

export type OverallStats = {
  questions: number
  dives: number
  knowledge: number
  accuracy: number
  best: PromptStats[]
  workOn: PromptStats[]
}

function uniqueHits(record: QuestionRecord): number {
  const seen = new Set<string>()
  for (const attempt of record.attempts) {
    if (attempt.tier === 'noecho' || attempt.duplicate) continue
    seen.add(attempt.answer ?? attempt.raw)
  }
  return seen.size
}

function bestTierOf(record: QuestionRecord): Tier | 'noecho' {
  let best: { tier: Tier; score: number } | null = null
  for (const attempt of record.attempts) {
    if (attempt.tier === 'noecho') continue
    if (!best || attempt.score > best.score) best = { tier: attempt.tier, score: attempt.score }
  }
  return best?.tier ?? 'noecho'
}

function toPromptStats(record: QuestionRecord): PromptStats {
  return {
    id: record.id,
    date: record.date,
    dive: record.dive,
    text: record.text,
    accuracy: record.accuracy,
    total: record.total,
    hits: uniqueHits(record),
    foundKrillion: record.attempts.some((attempt) => attempt.tier === 'krillion'),
    bestTier: bestTierOf(record),
    at: record.at,
  }
}

function betterRun(a: PromptStats, b: PromptStats): PromptStats {
  const pick =
    b.accuracy !== a.accuracy
      ? b.accuracy > a.accuracy
        ? b
        : a
      : b.total !== a.total
        ? b.total > a.total
          ? b
          : a
        : b.at > a.at
          ? b
          : a
  return {
    ...pick,
    foundKrillion: a.foundKrillion || b.foundKrillion,
    bestTier: a.accuracy >= b.accuracy ? a.bestTier : b.bestTier,
  }
}

export function summarizeLog(log: QuestionRecord[]): OverallStats {
  const byId = new Map<string, PromptStats>()
  for (const record of log) {
    const next = toPromptStats(record)
    const prev = byId.get(record.id)
    byId.set(record.id, prev ? betterRun(prev, next) : next)
  }

  const prompts = [...byId.values()]
  const questions = prompts.length
  const knowledge = questions ? prompts.filter((prompt) => prompt.foundKrillion).length / questions : 0
  const accuracy = questions ? prompts.reduce((sum, prompt) => sum + prompt.accuracy, 0) / questions : 0

  const gems = prompts.filter((prompt) => prompt.foundKrillion)
  const rest = prompts.filter((prompt) => !prompt.foundKrillion)
  const byBest = (a: PromptStats, b: PromptStats) =>
    b.accuracy - a.accuracy || b.total - a.total || b.at - a.at
  const byWeak = (a: PromptStats, b: PromptStats) =>
    a.accuracy - b.accuracy || a.total - b.total || b.at - a.at

  let best: PromptStats[]
  let workOn: PromptStats[]
  if (gems.length) {
    best = gems.slice().sort(byBest).slice(0, LIST_LIMIT)
    workOn = rest.slice().sort(byWeak).slice(0, LIST_LIMIT)
  } else {
    const ranked = prompts.slice().sort(byBest)
    const bestCount = ranked.length <= 1 ? ranked.length : Math.min(LIST_LIMIT, Math.ceil(ranked.length / 2))
    best = ranked.slice(0, bestCount)
    workOn = ranked.slice(bestCount).sort(byWeak).slice(0, LIST_LIMIT)
  }

  return {
    questions,
    dives: log.length,
    knowledge,
    accuracy,
    best,
    workOn,
  }
}
