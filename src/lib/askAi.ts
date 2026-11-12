import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import type { BankIndex, PromptMeta } from '../types'
import { normalize } from './score'

/**
 * Local AI: the model is downloaded once into the browser cache and runs on
 * this device's GPU (WebGPU). Nothing is sent to a server after the download.
 */
export const MODELS = [
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Standard',
    detail: 'Qwen 2.5 3B · about 2 GB, knows far more',
    thinks: false,
    maxTokens: 520,
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Lite',
    detail: 'Qwen 2.5 1.5B · about 1 GB, for slower devices',
    thinks: false,
    maxTokens: 520,
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
    label: 'DeepSeek',
    detail: 'DeepSeek R1 7B · about 4.5 GB, slower, thinks first',
    thinks: true,
    maxTokens: 1800,
  },
] as const

export type ModelId = (typeof MODELS)[number]['id']
const MODEL_KEY = 'krillion-ai-model'

export function savedModel(): ModelId {
  try {
    const saved = localStorage.getItem(MODEL_KEY)
    if (MODELS.some((model) => model.id === saved)) return saved as ModelId
  } catch {
    // storage blocked
  }
  return MODELS[0].id
}

export function saveModel(id: ModelId) {
  try {
    localStorage.setItem(MODEL_KEY, id)
  } catch {
    // storage blocked
  }
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

export type LoadProgress = { progress: number; text: string }

type Loaded = { model: ModelId; worker: Worker; engine: Promise<WebWorkerMLCEngine>; cancel: (err: Error) => void }

let current: Loaded | null = null
const listeners = new Set<(p: LoadProgress) => void>()

/**
 * Load (or reuse) the engine. The first call downloads the model; later visits read it from cache.
 * Switching models stops the old worker at once, even mid-download, so the new one starts right away
 * (each worker holds its own GPU memory, which is freed when it is terminated).
 */
export function getEngine(model: ModelId, onProgress?: (p: LoadProgress) => void): Promise<WebWorkerMLCEngine> {
  if (onProgress) listeners.add(onProgress)
  if (current && current.model === model) return current.engine
  if (!hasWebGpu()) {
    return Promise.reject(new Error('This browser has no WebGPU. Use recent Chrome, Edge, or Safari to run the local AI.'))
  }

  if (current) {
    current.cancel(new Error('Switched to another model.'))
    current.worker.terminate()
    current = null
  }

  const worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
  let cancel: (err: Error) => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => {
    cancel = reject
  })
  const loading = (async () => {
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
    return CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (report) => {
        if (current?.worker !== worker) return
        for (const listener of listeners) listener({ progress: report.progress, text: report.text })
      },
    })
  })()
  const engine = Promise.race([loading, cancelled])
  const entry: Loaded = { model, worker, engine, cancel }
  current = entry
  engine.catch(() => {
    // Only forget this load if it is still the current one.
    if (current === entry) {
      current.worker.terminate()
      current = null
    }
  })
  return engine
}

/** Keeps the last bit of what the model is writing and reports it a few times a second. */
function thoughtTicker(onThought?: (tail: string) => void) {
  let all = ''
  let last = 0
  return (piece: string, flush = false) => {
    if (!onThought) return
    all = (all + piece).slice(-600)
    const now = performance.now()
    if (!flush && now - last < 90) return
    last = now
    onThought(all.replace(/<\/?think>/g, ' ').replace(/\s+/g, ' ').trim().slice(-110))
  }
}

type Delta = { content?: string | null; reasoning_content?: string | null }

/** Human-readable load status: "Downloading 412 MB · 38s" or "Starting on the GPU". */
export function describeLoad(report: LoadProgress | null): string {
  if (!report) return 'Preparing'
  const text = report.text
  const mb = text.match(/(\d+)MB fetched/)?.[1]
  const secs = text.match(/(\d+) secs elapsed/)?.[1]
  if (/param cache|Fetching/i.test(text) && mb) return `Downloading · ${mb} MB${secs ? ` · ${secs}s` : ''}`
  if (/Loading model from cache/i.test(text)) return 'Reading from cache'
  if (/shader|GPU|Loading GPU|compil/i.test(text)) return 'Starting on the GPU'
  if (/Start to fetch|params|wasm|config|tokenizer/i.test(text)) return 'Fetching model files'
  return text.replace(/\. It can take a while.*$/i, '').slice(0, 60) || 'Preparing'
}

export function stopListening(onProgress: (p: LoadProgress) => void) {
  listeners.delete(onProgress)
}

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
      // A word you typed that the question lacks ("from Africa") is a different question.
      if (shared < q.size) score = Math.min(score, 0.6)
    }
    if (!best || score > best.score || (score === best.score && meta.date > best.meta.date)) {
      best = { meta, score }
    }
  }
  return best
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+[-–—:(].*$/, '')
    .replace(/[.,;]+$/, '')
    .trim()
}

export type AskSpec = {
  /** The question with letter/length rules removed: the model never has to spell. */
  question: string
  /** Common answers to steer away from. */
  avoid: string[]
  /** List mode: many candidates for code to filter. Otherwise: a few obscure picks. */
  list: boolean
  /** Simple hints a model can follow ("starts with M"); code still checks every rule. */
  hint?: string
}

/**
 * Stream answers from the local model. `onAnswer` fires once per finished
 * line, so chips appear while it is still writing. A thinking model's
 * <think> block is skipped; `onThinking` reports that phase.
 */
export async function streamNiche(
  model: ModelId,
  { question, avoid, list, hint }: AskSpec,
  onAnswer: (answer: string) => void,
  onThinking: (thinking: boolean) => void,
  signal: AbortSignal,
  onThought?: (tail: string) => void,
): Promise<void> {
  const spec = MODELS.find((m) => m.id === model) ?? MODELS[0]
  const llm = await getEngine(model)
  const tick = thoughtTicker(onThought)
  if (signal.aborted) return

  const system =
    'You help players of Krillion, a daily trivia game where the rarest valid answers score the most. ' +
    'Every answer must be a real, correct, specific name that fits the question exactly. ' +
    'Output only answers: one per line, no numbering, no explanations, no extra text.'
  const user = list
    ? `Question: ${question}${hint ? ` (${hint})` : ''}\nList 40 different correct answers. Start with the obscure ones, then the well known ones.`
    : `Question: ${question}\n` +
      (avoid.length ? `Too common, do not use: ${avoid.slice(0, 25).join(', ')}\n` : '') +
      'Give 15 correct answers that few people would think of.'

  const stream = await llm.chat.completions.create({
    stream: true,
    temperature: list ? 0.4 : 0.7,
    max_tokens: spec.maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })

  const seen = new Set<string>()
  const emit = (line: string) => {
    const answer = cleanLine(line)
    const key = normalize(answer)
    if (!answer || !key || answer.length > 48 || seen.has(key)) return
    // Small models drift into descriptions ("Xylophone-like instrument called a ..."); keep names only.
    if (key.split(' ').length > 5 || /\blike\b|\bcalled\b|\btype of\b|\bkind of\b/.test(key.replace(/-/g, ' '))) return
    seen.add(key)
    onAnswer(answer)
  }

  let text = ''
  let thinking = spec.thinks
  onThinking(thinking)
  for await (const chunk of stream) {
    if (signal.aborted) {
      llm.interruptGenerate()
      return
    }
    const delta = (chunk.choices[0]?.delta ?? {}) as Delta
    const piece = delta.content ?? ''
    text += piece
    tick((delta.reasoning_content ?? '') + piece)
    if (thinking) {
      const end = text.indexOf('</think>')
      if (end < 0) continue
      text = text.slice(end + '</think>'.length)
      thinking = false
      onThinking(false)
    }
    const lines = text.split('\n')
    text = lines.pop() ?? ''
    lines.forEach(emit)
  }
  onThinking(false)
  tick('', true)
  emit(text)
}

/**
 * Judge real candidates one by one: "Ghana: yes". Small models stay accurate
 * only in short batches and only when they write each name out (numbered
 * replies lose track of which item is which), so batches are 12 items,
 * processed in order, with each "yes" reported as soon as it is written.
 */
export const PICK_BATCH = 12

export async function streamPick(
  model: ModelId,
  question: string,
  candidates: string[],
  onYes: (candidate: string) => void,
  onBatch: (done: number) => void,
  signal: AbortSignal,
  onThought?: (tail: string) => void,
): Promise<void> {
  const llm = await getEngine(model)
  const spec = MODELS.find((m) => m.id === model) ?? MODELS[0]
  const tick = thoughtTicker(onThought)
  // A thinking model reasons once per request, so it gets every candidate at once instead of batches.
  const size = spec.thinks ? candidates.length : PICK_BATCH
  const byKey = new Map(candidates.map((c) => [normalize(c), c]))
  for (let start = 0; start < candidates.length; start += size) {
    if (signal.aborted) return
    const batch = candidates.slice(start, start + size)
    const stream = await llm.chat.completions.create({
      stream: true,
      temperature: 0,
      max_tokens: (spec.thinks ? 1500 : 0) + batch.length * 14 + 24,
      messages: [
        { role: 'system', content: 'You are a careful fact checker. Judge each item on its own.' },
        {
          role: 'user',
          content:
            `Question: ${question}\n\nFor each item, write the item, a colon, then yes if it answers the question or no if it does not.\n\n` +
            batch.join('\n'),
        },
      ],
    })
    let text = ''
    let thinking = spec.thinks
    const take = (line: string) => {
      const m = line.match(/^\s*(?:[-*•]|\d+[.)])?\s*\**(.+?)\**\s*[:\-–—]\s*\**\s*(yes|no)\b/i)
      if (!m || m[2].toLowerCase() !== 'yes') return
      const hit = byKey.get(normalize(m[1]))
      if (hit && batch.includes(hit)) onYes(hit)
    }
    for await (const chunk of stream) {
      if (signal.aborted) {
        llm.interruptGenerate()
        return
      }
      const delta = (chunk.choices[0]?.delta ?? {}) as Delta
      const piece = delta.content ?? ''
      text += piece
      tick((delta.reasoning_content ?? '') + piece)
      if (thinking) {
        // DeepSeek writes its reasoning first; judgements only count after </think>.
        const end = text.indexOf('</think>')
        if (end < 0) continue
        text = text.slice(end + '</think>'.length)
        thinking = false
      }
      const lines = text.split('\n')
      text = lines.pop() ?? ''
      lines.forEach(take)
    }
    take(text)
    tick(' · ', true)
    onBatch(Math.min(candidates.length, start + size))
  }
}

// Dev-only prompt lab: lets prompts be tried against the loaded model from the console.
if (import.meta.env.DEV) {
  ;(globalThis as { __krillLab?: unknown }).__krillLab = async (system: string, user: string, maxTokens = 400) => {
    const llm = await getEngine(savedModel())
    const t0 = performance.now()
    const out = await llm.chat.completions.create({
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    return { ms: Math.round(performance.now() - t0), text: out.choices[0]?.message?.content ?? '' }
  }
}
