export const TIERS = ['krillion', 'deepcut', 'rare', 'schooler', 'tooclever', 'plankton'] as const

export type Tier = (typeof TIERS)[number]

export type PromptMeta = {
  id: string
  date: string
  dive: number
  slot: string
  text: string
  count: number
  gems: string[]
}

export type BankIndex = {
  builtAt: string
  source: string
  through: string
  promptCount: number
  answerCount: number
  prompts: PromptMeta[]
}

export type Shard = {
  id: string
  date: string
  dive: number
  text: string
  tiers: Partial<Record<Tier, string[]>>
}

export type Attempt = {
  raw: string
  answer: string | null
  tier: Tier | 'noecho'
  score: number
  counted: number
  corrected: boolean
  duplicate: boolean
}

export type QuestionRecord = {
  id: string
  date: string
  dive: number
  text: string
  attempts: Attempt[]
  total: number
  best: number
  /** Best score divided by 100. A gem is 1. */
  accuracy: number
  at: number
}
