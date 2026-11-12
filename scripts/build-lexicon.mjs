/** Writes public/bank/lexicon/: one word list per question category, plus an index. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLexicons, slug } from './lexicon-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BANK = path.join(ROOT, 'public', 'bank')
const OUT = path.join(BANK, 'lexicon')

const index = JSON.parse(fs.readFileSync(path.join(BANK, 'index.json'), 'utf8'))
const sheets = index.prompts.map((meta) => {
  const shard = JSON.parse(fs.readFileSync(path.join(BANK, 'prompts', `${meta.id}.json`), 'utf8'))
  return { id: meta.id, text: meta.text, tiers: shard.tiers }
})

const lexicons = buildLexicons(sheets)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const heads = {}
let total = 0
for (const [head, { questions, rows }] of lexicons) {
  const file = `${slug(head)}.json`
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(rows))
  heads[head] = { file, size: rows.length, questions: questions.length }
  total += rows.length
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ builtAt: index.builtAt, heads }))
console.log(`Wrote ${Object.keys(heads).length} category lists, ${total.toLocaleString('en-US')} answers`)
