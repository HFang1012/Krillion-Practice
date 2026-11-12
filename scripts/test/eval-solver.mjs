/**
 * Leave-one-out check of the rule solver: hide each rule-based question, rebuild
 * its category list from the other sheets, filter by the parsed rules, and score
 * the result against the hidden sheet (every answer on a sheet was accepted).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold, parseRules, passes } from '../../src/lib/rules.ts'
import { buildLexicons, headOf } from '../lexicon-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BANK = path.join(ROOT, 'public', 'bank')
const index = JSON.parse(fs.readFileSync(path.join(BANK, 'index.json'), 'utf8'))
const sheets = index.prompts.map((meta) => ({
  id: meta.id,
  text: meta.text,
  tiers: JSON.parse(fs.readFileSync(path.join(BANK, 'prompts', `${meta.id}.json`), 'utf8')).tiers,
}))
const minSupport = Number(process.argv[2] ?? 2)
const TOP = 20

let tested = 0, sumPrec = 0, sumTopPrec = 0, sumRecall = 0, sumTopScore = 0
const rows = []
for (const sheet of sheets) {
  const parsed = parseRules(sheet.text)
  if (!parsed.pure || !parsed.rules.length) continue
  const head = parsed.head
  const same = sheets.filter((s) => s.id !== sheet.id && headOf(s.text) === head)
  if (same.length < 2) continue
  const lex = buildLexicons(same).get(head)
  if (!lex) continue
  const actual = new Map()
  for (const [tier, list] of Object.entries(sheet.tiers)) for (const a of list) actual.set(fold(a), tier)
  const predicted = lex.rows.filter(([a, , n]) => (n >= minSupport || lex.questions.length < 4) && passes(parsed.rules, a))
  if (!predicted.length) continue
  const hits = predicted.filter(([a]) => actual.has(fold(a)))
  const top = predicted.slice(0, TOP)
  const topHits = top.filter(([a]) => actual.has(fold(a)))
  const TS = { krillion: 100, deepcut: 85, rare: 60, schooler: 30, tooclever: 15, plankton: 10 }
  const topScore = top.reduce((s, [a]) => s + (TS[actual.get(fold(a))] ?? 0), 0) / top.length
  tested += 1
  sumPrec += hits.length / predicted.length
  sumTopPrec += topHits.length / top.length
  sumRecall += hits.length / actual.size
  sumTopScore += topScore
  rows.push({ q: sheet.text.slice(0, 70), rules: parsed.rules.map((r) => r.label).join(' & '), prec: hits.length / predicted.length, top: topHits.length / top.length, n: predicted.length, wrong: predicted.filter(([a]) => !actual.has(fold(a))).slice(0, 5).map(([a]) => a) })
}
rows.sort((a, b) => a.prec - b.prec)
for (const r of rows.slice(0, 15)) console.log(`${(r.prec * 100).toFixed(0).padStart(3)}% all · ${(r.top * 100).toFixed(0).padStart(3)}% top${TOP} · ${String(r.n).padStart(5)} · ${r.q} [${r.rules}] wrong: ${r.wrong.join(', ')}`)
console.log(`\nminSupport=${minSupport} · ${tested} hidden questions · precision ${(sumPrec / tested * 100).toFixed(1)}% · top-${TOP} precision ${(sumTopPrec / tested * 100).toFixed(1)}% · recall ${(sumRecall / tested * 100).toFixed(1)}% · avg real score of top-${TOP} ${(sumTopScore / tested).toFixed(1)}`)
