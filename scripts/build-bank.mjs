/**
 * Pulls dated answer sheets from krilliongame.com into lazy prompt shards.
 * The official /api/reveal endpoint is closed; these archive pages still
 * include every stored answer, tier, and score.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, 'data', 'cache')
const PROMPTS_DIR = path.join(ROOT, 'public', 'bank', 'prompts')
const INDEX_PATH = path.join(ROOT, 'public', 'bank', 'index.json')
const ORIGIN = 'https://krilliongame.com/krillion-answers'

const SCORE_TIER = new Map([
  [100, 'krillion'],
  [85, 'deepcut'],
  [60, 'rare'],
  [30, 'schooler'],
  [15, 'tooclever'],
  [10, 'plankton'],
])

const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null

function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tierFromHeading(heading) {
  const text = heading.trim().toLowerCase()
  if (text.startsWith('one in a krillion')) return 'krillion'
  if (text.startsWith('deep cut')) return 'deepcut'
  if (text.startsWith('too clever')) return 'tooclever'
  if (text.startsWith('schooler')) return 'schooler'
  if (text.startsWith('plankton')) return 'plankton'
  if (text.startsWith('rare')) return 'rare'
  return null
}

function parseDive(html, date) {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? ''
  const dive = Number(title.match(/Dive #(\d+)/)?.[1] ?? 0)
  const warnings = []
  const prompts = []
  const blocks = html.split('<section class="answer-block"').slice(1)

  for (const block of blocks) {
    const slot = block.match(/id="prompt-(p\d+)"/)?.[1]
    const h2 = block.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? ''
    const text = decode(h2.match(/<span lang="en">([\s\S]*?)<\/span>/)?.[1] ?? '')
    const declared = Number(block.match(/Open the complete answer list \((\d+)\)/)?.[1] ?? NaN)
    const full = block.split('<div class="answer-full"')[1] ?? ''
    const tiers = {
      krillion: [],
      deepcut: [],
      rare: [],
      schooler: [],
      tooclever: [],
      plankton: [],
    }
    let parsed = 0

    for (const part of full.split('<div class="answer-tier">').slice(1)) {
      const heading = decode(part.match(/<h3>([^<]*)/)?.[1] ?? '')
      const headingTier = tierFromHeading(heading)
      for (const li of part.split('<li>').slice(1)) {
        const scoreMatch = li.match(/<span class="score">(\d+)<\/span>/)
        if (!scoreMatch || scoreMatch.index == null) continue
        parsed += 1
        const answer = decode(li.slice(0, scoreMatch.index))
        const score = Number(scoreMatch[1])
        if (!answer) continue
        const scoreTier = SCORE_TIER.get(score) ?? null
        const tier = scoreTier ?? headingTier
        if (!tier) {
          warnings.push(`${date} ${slot} unknown score ${score} for "${answer}"`)
          continue
        }
        if (headingTier && scoreTier && headingTier !== scoreTier) {
          warnings.push(`${date} ${slot} "${answer}" heading ${headingTier} score ${score}`)
        }
        tiers[tier].push(answer)
      }
    }

    if (!slot || !text) {
      warnings.push(`${date} skipped a block (slot=${slot || 'missing'})`)
      continue
    }
    if (Number.isFinite(declared) && declared !== parsed) {
      warnings.push(`${date} ${slot} declared ${declared} parsed ${parsed}`)
    }

    const compact = {}
    let count = 0
    for (const [tier, list] of Object.entries(tiers)) {
      if (!list.length) continue
      compact[tier] = list
      count += list.length
    }
    prompts.push({
      id: `${date}-${slot}`,
      date,
      dive,
      slot,
      text,
      count,
      gems: tiers.krillion,
      tiers: compact,
    })
  }

  return { dive, prompts, warnings }
}

function extractDates(html) {
  const raw = html.match(/id="krilling-practice-data">([\s\S]*?)<\/script>/)?.[1]
  if (!raw) return []
  const data = JSON.parse(raw)
  return Array.isArray(data.dates) ? data.dates.map((entry) => entry.date) : []
}

function linkedDates(html) {
  return [...html.matchAll(/krillion-answers\/(\d{4}-\d{2}-\d{2})\//g)].map((m) => m[1])
}

/** Every calendar day from the first dive through today (UTC and a day ahead for time zones). */
function calendarDates(from) {
  const out = []
  const end = new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10)
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

class NotPublished extends Error {}

async function fetchText(url) {
  let lastError = new Error(`Failed to fetch ${url}`)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 KrillionPractice/1.0' },
        signal: AbortSignal.timeout(180000),
      })
      if (response.status === 404) throw new NotPublished(`404 ${url}`)
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      return await response.text()
    } catch (error) {
      if (error instanceof NotPublished) throw error
      lastError = error instanceof Error ? error : lastError
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
  throw lastError
}

/** The newest two days are still collecting answers, so they are always refetched. */
const FRESH_DAYS = 2

function isRecent(date) {
  const ageMs = Date.now() - Date.parse(`${date}T00:00:00Z`)
  return ageMs < FRESH_DAYS * 24 * 3600 * 1000 + 14 * 3600 * 1000
}

async function loadPage(date) {
  const file = path.join(CACHE, `${date}.html`)
  if (!refresh && !isRecent(date) && fs.existsSync(file) && fs.statSync(file).size > 500) {
    return fs.readFileSync(file, 'utf8')
  }
  const html = await fetchText(`${ORIGIN}/${date}/`)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(file, html)
  return html
}

async function mapPool(items, limit, fn) {
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}

async function main() {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  let dates
  if (only) {
    dates = [only]
  } else {
    // Union of three sources so a day is never skipped: the seed page's embedded
    // date list, every link on the archive index, and every calendar day since dive #1.
    const seed = await fetchText(`${ORIGIN}/2026-07-16/`)
    const archive = await fetchText(`${ORIGIN}/`).catch(() => '')
    const listed = new Set([...extractDates(seed), ...linkedDates(archive)])
    if (listed.size < 7) throw new Error('Date list looks incomplete')
    dates = [...new Set([...listed, ...calendarDates('2026-07-16')])].sort()
    const unlisted = dates.filter((date) => !listed.has(date))
    if (unlisted.length) console.log(`Also checking ${unlisted.length} unlisted days: ${unlisted.join(', ')}`)
  }
  const results = new Array(dates.length)
  const failures = []
  const unpublished = []

  await mapPool(dates, 3, async (date, index) => {
    const started = Date.now()
    try {
      let html = await loadPage(date)
      let parsed = parseDive(html, date)
      if (parsed.prompts.length !== 7) {
        const file = path.join(CACHE, `${date}.html`)
        fs.rmSync(file, { force: true })
        html = await loadPage(date)
        parsed = parseDive(html, date)
      }
      if (parsed.prompts.length !== 7) {
        throw new Error(`${date} parsed ${parsed.prompts.length} prompts`)
      }
      for (const prompt of parsed.prompts) {
        fs.writeFileSync(
          path.join(PROMPTS_DIR, `${prompt.id}.json`),
          JSON.stringify({
            id: prompt.id,
            date: prompt.date,
            dive: prompt.dive,
            text: prompt.text,
            tiers: prompt.tiers,
          }),
        )
      }
      results[index] = parsed
      const answers = parsed.prompts.reduce((sum, prompt) => sum + prompt.count, 0)
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`[${index + 1}/${dates.length}] ${date} dive ${parsed.dive} · ${answers} answers · ${seconds}s`)
      for (const warning of parsed.warnings) console.warn(`  ! ${warning}`)
    } catch (error) {
      if (error instanceof NotPublished) {
        unpublished.push(date)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${date}: ${message}`)
      console.error(`[${index + 1}/${dates.length}] ${date} FAILED ${message}`)
    }
  })

  const prompts = results
    .filter(Boolean)
    .flatMap((parsed) => parsed.prompts)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slot.localeCompare(b.slot))
    .map(({ tiers: _tiers, ...meta }) => meta)

  const index = {
    builtAt: new Date().toISOString(),
    source: `${ORIGIN}/`,
    through: prompts.reduce((latest, prompt) => (prompt.date > latest ? prompt.date : latest), ''),
    promptCount: prompts.length,
    answerCount: prompts.reduce((sum, prompt) => sum + prompt.count, 0),
    prompts,
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index))
  console.log(`Wrote ${index.promptCount} prompts, ${index.answerCount} answers, through ${index.through}`)

  const known = prompts.find((prompt) => prompt.text.startsWith('Name a country that shares a land'))
  if (known) {
    console.log(`Check gem: ${known.id} → ${known.gems.join(', ') || '(none)'}`)
  }

  if (unpublished.length) {
    console.warn(`Not published at the source yet: ${unpublished.join(', ')}`)
  }
  const diveNumbers = new Set(prompts.map((prompt) => prompt.dive))
  const maxDive = Math.max(0, ...diveNumbers)
  const missingDives = []
  for (let dive = 1; dive <= maxDive; dive += 1) if (!diveNumbers.has(dive)) missingDives.push(dive)
  index.missingDives = missingDives
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index))
  if (missingDives.length) console.warn(`Missing dives (source has no page): #${missingDives.join(', #')}`)

  if (failures.length) {
    console.error(`${failures.length} dates failed`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
