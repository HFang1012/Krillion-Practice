/**
 * Category word lists ("lexicons") built from every answer sheet.
 * Each category (the noun a question asks for: country, animal, type of cheese)
 * collects every answer the game accepted for any question in it, with how rare
 * it tends to be. New questions in that category are answered from this list.
 */
import { categoryOf, fold, parseRules } from '../src/lib/rules.ts'

export const TIER_SCORE = { krillion: 100, deepcut: 85, rare: 60, schooler: 30, tooclever: 15, plankton: 10 }

export function slug(head) {
  return head.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Category of a stored question, or null when it is too generic to group. */
export function headOf(text) {
  return parseRules(text).head ?? categoryOf(text)
}

/**
 * @param {{id:string,text:string,tiers:Record<string,string[]>}[]} sheets
 * @param {string|null} excludeId leave one question out (for testing)
 */
export function buildLexicons(sheets, excludeId = null) {
  const heads = new Map()
  for (const sheet of sheets) {
    if (sheet.id === excludeId) continue
    const head = headOf(sheet.text)
    if (!head) continue
    let bucket = heads.get(head)
    if (!bucket) {
      bucket = { questions: [], answers: new Map() }
      heads.set(head, bucket)
    }
    bucket.questions.push(sheet.id)
    for (const [tier, list] of Object.entries(sheet.tiers)) {
      const score = TIER_SCORE[tier] ?? 0
      for (const answer of list) {
        const key = fold(answer)
        if (!key) continue
        let entry = bucket.answers.get(key)
        if (!entry) {
          entry = { spellings: new Map(), sum: 0, n: 0 }
          bucket.answers.set(key, entry)
        }
        entry.spellings.set(answer, (entry.spellings.get(answer) ?? 0) + 1)
        entry.sum += score
        entry.n += 1
      }
    }
  }

  const out = new Map()
  for (const [head, bucket] of heads) {
    const rows = [...bucket.answers.values()]
      .map((entry) => {
        const display = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
        return [display, Math.round(entry.sum / entry.n), entry.n]
      })
      .sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0].localeCompare(b[0]))
    out.set(head, { questions: bucket.questions, rows })
  }
  return out
}
