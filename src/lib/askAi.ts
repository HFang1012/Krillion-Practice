import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import type { BankIndex, PromptMeta } from '../types'
import { normalize } from './score'

/**
 * Local AI: the model is downloaded once into the browser cache and runs on
 * this device's GPU (WebGPU). Nothing is sent to a server after the download.
 */
export const MODELS = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Fast',
    detail: 'Qwen 2.5 1.5B · about 1 GB',
    thinks: false,
    maxTokens: 220,
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
    label: 'DeepSeek',
    detail: 'DeepSeek R1 7B · about 4.5 GB, slower, thinks first',
    thinks: true,
    maxTokens: 1400,
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

let engine: Promise<WebWorkerMLCEngine> | null = null
let engineModel: ModelId | null = null
const listeners = new Set<(p: LoadProgress) => void>()

/** Load (or reuse) the engine. The first call downloads the model; later visits read it from cache. */
export function getEngine(model: ModelId, onProgress?: (p: LoadProgress) => void): Promise<WebWorkerMLCEngine> {
  if (onProgress) listeners.add(onProgress)
  if (engine && engineModel === model) return engine
  if (!hasWebGpu()) {
    return Promise.reject(new Error('This browser has no WebGPU. Use recent Chrome, Edge, or Safari to run the local AI.'))
  }

  const previous = engine
  engineModel = model
  engine = (async () => {
    if (previous) {
      // Free the GPU memory held by the other model.
      await previous.then((old) => old.unload()).catch(() => undefined)
    }
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
    const worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
    return CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (report) => {
        for (const listener of listeners) listener({ progress: report.progress, text: report.text })
      },
    })
  })()
  engine.catch(() => {
    engine = null
    engineModel = null
  })
  return engine
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

/**
 * Stream niche answers from the local model. `onAnswer` fires once per
 * finished line, so chips appear while it is still writing. A thinking
 * model's <think> block is skipped; `onThinking` reports that phase.
 */
export async function streamNiche(
  model: ModelId,
  question: string,
  avoid: string[],
  onAnswer: (answer: string) => void,
  onThinking: (thinking: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const spec = MODELS.find((m) => m.id === model) ?? MODELS[0]
  const llm = await getEngine(model)
  if (signal.aborted) return

  const system =
    'You help players of Krillion, a daily trivia game where the rarest valid answers score the most. ' +
    'Give correct, real answers that very few people would think of. Skip the obvious ones. ' +
    'Output only answers: one per line, no numbering, no explanations, no extra text.'
  const user =
    `Question: ${question}\n` +
    (avoid.length ? `Too common, do not use: ${avoid.slice(0, 25).join(', ')}\n` : '') +
    'Give 12 obscure but valid answers.'

  const stream = await llm.chat.completions.create({
    stream: true,
    temperature: 0.7,
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
    text += chunk.choices[0]?.delta?.content ?? ''
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
  emit(text)
}
