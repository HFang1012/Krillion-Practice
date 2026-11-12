import type { BankIndex, PromptMeta } from '../types'
import { normalize } from './score'

/**
 * Free, keyless, CORS-open LLM endpoint (Pollinations). The free tier allows
 * one reply per IP about every 45 seconds, so callers should check `waitMs`.
 */
const ENDPOINT = 'https://text.pollinations.ai/openai'
const MODEL = 'openai-fast'
export const COOLDOWN_MS = 45_000
const LAST_KEY = 'krillion-ai-last'

const STOP = new Set(
  'a an the of to in on for and or is are be that this with by from at as name give something someone thing type kind'.split(
    ' ',
  ),
)

function words(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((word) => word && !STOP.has(word))
}

/** Best dictionary question for free text, scored by shared keywords. */
export function findPrompt(index: BankIndex, query: string): { meta: PromptMeta; score: number } | null {
  const q = new Set(words(query))
  if (!q.size) return null
  const needle = normalize(query)
  let best: { meta: PromptMeta; score: number } | null = null
  for (const meta of index.prompts) {
    const hay = normalize(meta.text)
    let score: number
    // A pasted fragment of a question counts as exact, but not a lone keyword.
    if (q.size >= 3 && needle.length >= 0.5 * hay.length && hay.includes(needle)) score = 1
    else {
      const p = new Set(words(meta.text))
      let shared = 0
      for (const word of q) if (p.has(word)) shared += 1
      // Dice coefficient: rewards overlap, penalises size mismatch both ways.
      score = (2 * shared) / (q.size + p.size)
    }
    if (!best || score > best.score || (score === best.score && meta.date > best.meta.date)) {
      best = { meta, score }
    }
  }
  return best
}

export function waitMs(): number {
  try {
    const last = Number(localStorage.getItem(LAST_KEY) ?? 0)
    return Math.max(0, last + COOLDOWN_MS - Date.now())
  } catch {
    return 0
  }
}

function markCall() {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch {
    // storage blocked; the server limit still applies
  }
}

export class RateLimited extends Error {
  constructor(public retryMs: number) {
    super('rate limited')
  }
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+[-–—:(].*$/, '')
    .trim()
}

/**
 * Stream niche answers. `onAnswer` fires once per finished line, so chips
 * appear while the model is still writing.
 */
export async function streamNiche(
  question: string,
  avoid: string[],
  onAnswer: (answer: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const system =
    'You help players of Krillion, a daily trivia game where the rarest valid answers score the most. ' +
    'Give correct, real answers that very few people would think of. Skip the obvious ones. ' +
    'Output only answers: one per line, no numbering, no explanations, no extra text.'
  const user =
    `Question: ${question}\n` +
    (avoid.length ? `Too common, do not use: ${avoid.slice(0, 40).join(', ')}\n` : '') +
    'Give 12 obscure but valid answers.'

  markCall()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal,
  })

  if (response.status === 402 || response.status === 429) {
    const body = await response.text()
    const seconds = Number(body.match(/Retry after (\d+)s/)?.[1] ?? response.headers.get('retry-after') ?? 20)
    throw new RateLimited((seconds + 1) * 1000)
  }
  if (!response.ok || !response.body) throw new Error(`The AI is unavailable right now (${response.status}).`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let sse = ''
  let text = ''
  const seen = new Set<string>()

  const emit = (line: string) => {
    const answer = cleanLine(line)
    const key = normalize(answer)
    if (!answer || answer.length > 60 || seen.has(key)) return
    seen.add(key)
    onAnswer(answer)
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    sse += decoder.decode(value, { stream: true })
    const events = sse.split('\n')
    sse = events.pop() ?? ''
    for (const event of events) {
      const data = event.replace(/^data:\s*/, '').trim()
      if (!data || data === '[DONE]' || !event.startsWith('data:')) continue
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (typeof delta === 'string') text += delta
      } catch {
        // partial or non-JSON keepalive
      }
    }
    const lines = text.split('\n')
    text = lines.pop() ?? ''
    lines.forEach(emit)
  }
  emit(text)
}
