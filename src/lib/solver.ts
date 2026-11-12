import { publicUrl } from './publicUrl'
import { parseRules, passes, type Parsed } from './rules'

/** One row of a category list: [answer, average score 10–100, how many sheets accepted it]. */
export type LexRow = [string, number, number]

type LexIndex = { heads: Record<string, { file: string; size: number; questions: number }> }

let lexIndex: Promise<LexIndex> | null = null
const lexFiles = new Map<string, Promise<LexRow[]>>()

function loadIndex(): Promise<LexIndex> {
  lexIndex ??= fetch(publicUrl('bank/lexicon/index.json'), { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error('Category lists are missing.')
    return r.json() as Promise<LexIndex>
  })
  lexIndex.catch(() => {
    lexIndex = null
  })
  return lexIndex
}

function loadRows(file: string): Promise<LexRow[]> {
  let pending = lexFiles.get(file)
  if (!pending) {
    pending = fetch(publicUrl(`bank/lexicon/${file}`)).then((r) => r.json() as Promise<LexRow[]>)
    pending.catch(() => lexFiles.delete(file))
    lexFiles.set(file, pending)
  }
  return pending
}

export type Solved = {
  parsed: Parsed
  /** The category list used, if any ("country"). */
  head: string | null
  /** True when the category matched exactly and nothing else is asked: every answer is checked. */
  exact: boolean
  /** Answers that pass every rule, rarest first. */
  answers: LexRow[]
  /** Every accepted answer in the category (folded → row), for checking model output. */
  known: Map<string, LexRow>
}

/**
 * Answer a new question from real game answers: find its category list,
 * then keep only the answers that pass its letter/length rules.
 */
export async function solve(question: string): Promise<Solved> {
  const parsed = parseRules(question)
  const empty: Solved = { parsed, head: null, exact: false, answers: [], known: new Map() }
  if (!parsed.head) return empty

  const index = await loadIndex().catch(() => null)
  if (!index) return empty

  // "african country" falls back to "country"; the dropped word means the list alone can't answer it.
  const words = parsed.head.split(' ')
  let head: string | null = null
  for (let i = 0; i < words.length && !head; i += 1) {
    const candidate = words.slice(i).join(' ')
    if (index.heads[candidate]) head = candidate
  }
  if (!head) return empty

  const meta = index.heads[head]
  const rows = await loadRows(meta.file)
  // An answer accepted by only one sheet in a big category is often a stretch (Hawaii as a country).
  const minSupport = meta.questions >= 20 ? 3 : meta.questions >= 4 ? 2 : 1
  const known = new Map(rows.filter((row) => row[2] >= minSupport).map((row) => [fold(row[0]), row] as const))
  const answers = rows.filter((row) => row[2] >= minSupport && passes(parsed.rules, row[0]))
  return { parsed, head, exact: parsed.pure && head === parsed.head, answers, known }
}

export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
