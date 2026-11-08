import type { Shard, Tier } from '../types'
import { TIERS } from '../types'
import { TIER_META } from './tiers'

export type Entry = {
  answer: string
  tier: Tier
  score: number
  norm: string
  mask: number
}

export type Prepared = {
  byNorm: Map<string, Entry>
  buckets: Map<number, Entry[]>
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789 '
const ROW = new Uint16Array(96)
const NEXT = new Uint16Array(96)

/** Same folding the archive practice tool uses before an exact sheet match. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function charMask(value: string): number {
  let mask = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    let bit = 36
    if (code >= 97 && code <= 122) bit = code - 97
    else if (code >= 48 && code <= 57) bit = 26 + (code - 48)
    mask |= 1 << bit
  }
  return mask
}

function bitCount(value: number): number {
  let count = 0
  let rest = value
  while (rest) {
    rest &= rest - 1
    count += 1
  }
  return count
}

function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i += 1
  return i
}

function editAtMost(a: string, b: string, max: number): number | null {
  const aLen = a.length
  const bLen = b.length
  if (Math.abs(aLen - bLen) > max || aLen >= ROW.length || bLen >= ROW.length) return null
  for (let j = 0; j <= bLen; j += 1) ROW[j] = j
  for (let i = 1; i <= aLen; i += 1) {
    NEXT[0] = i
    let rowMin = i
    const code = a.charCodeAt(i - 1)
    for (let j = 1; j <= bLen; j += 1) {
      const cost = code === b.charCodeAt(j - 1) ? 0 : 1
      const del = ROW[j] + 1
      const ins = NEXT[j - 1] + 1
      const sub = ROW[j - 1] + cost
      let value = del < ins ? del : ins
      if (sub < value) value = sub
      NEXT[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return null
    for (let j = 0; j <= bLen; j += 1) ROW[j] = NEXT[j]
  }
  return ROW[bLen] <= max ? ROW[bLen] : null
}

export function prepare(shard: Shard): Prepared {
  const byNorm = new Map<string, Entry>()
  for (const tier of TIERS) {
    const score = TIER_META[tier].score
    for (const answer of shard.tiers[tier] ?? []) {
      const norm = normalize(answer)
      if (!norm) continue
      const prev = byNorm.get(norm)
      if (prev && prev.score >= score) continue
      byNorm.set(norm, { answer, tier, score, norm, mask: charMask(norm) })
    }
  }
  const buckets = new Map<number, Entry[]>()
  for (const entry of byNorm.values()) {
    const list = buckets.get(entry.norm.length)
    if (list) list.push(entry)
    else buckets.set(entry.norm.length, [entry])
  }
  return { byNorm, buckets }
}

function withinOne(norm: string, byNorm: Map<string, Entry>): Entry | null {
  const hits: Entry[] = []
  const seen = new Set<string>()
  const consider = (candidate: string) => {
    const hit = byNorm.get(candidate)
    if (!hit || seen.has(hit.norm) || hit.norm === norm) return
    seen.add(hit.norm)
    hits.push(hit)
  }

  for (let i = 0; i <= norm.length; i += 1) {
    const left = norm.slice(0, i)
    const right = norm.slice(i)
    if (right) consider(left + right.slice(1))
    if (right.length > 1) consider(left + right[1] + right[0] + right.slice(2))
    for (let k = 0; k < ALPHA.length; k += 1) {
      const char = ALPHA[k]
      if (right && char !== right[0]) consider(left + char + right.slice(1))
      consider(left + char + right)
    }
  }

  if (hits.length === 0) return null
  hits.sort(
    (a, b) => sharedPrefix(norm, b.norm) - sharedPrefix(norm, a.norm) || b.score - a.score,
  )
  if (hits.length === 1) return hits[0]
  if (sharedPrefix(norm, hits[0].norm) > sharedPrefix(norm, hits[1].norm)) return hits[0]
  return null
}

function withinTwo(norm: string, buckets: Map<number, Entry[]>): Entry | null {
  const queryMask = charMask(norm)
  let found: Entry | null = null
  for (let length = norm.length - 2; length <= norm.length + 2; length += 1) {
    const bucket = buckets.get(length)
    if (!bucket) continue
    for (const entry of bucket) {
      if (bitCount(queryMask ^ entry.mask) > 4) continue
      const distance = editAtMost(norm, entry.norm, 2)
      if (distance == null || distance < 1 || distance > 2) continue
      if (found && found.norm !== entry.norm) return null
      found = entry
    }
  }
  return found
}

export type RateHit = {
  norm: string
  tier: Tier | 'noecho'
  score: number
  answer: string | null
  corrected: boolean
}

export function rate(prepared: Prepared, raw: string): RateHit {
  const norm = normalize(raw)
  if (!norm) {
    return { norm, tier: 'noecho', score: 0, answer: null, corrected: false }
  }
  const exact = prepared.byNorm.get(norm)
  if (exact) {
    return {
      norm: exact.norm,
      tier: exact.tier,
      score: exact.score,
      answer: exact.answer,
      corrected: false,
    }
  }
  if (norm.length < 4 || norm.length > 48) {
    return { norm, tier: 'noecho', score: 0, answer: null, corrected: false }
  }
  const close = withinOne(norm, prepared.byNorm)
  if (close) {
    return {
      norm: close.norm,
      tier: close.tier,
      score: close.score,
      answer: close.answer,
      corrected: true,
    }
  }
  if (norm.length < 8) {
    return { norm, tier: 'noecho', score: 0, answer: null, corrected: false }
  }
  const farther = withinTwo(norm, prepared.buckets)
  if (farther) {
    return {
      norm: farther.norm,
      tier: farther.tier,
      score: farther.score,
      answer: farther.answer,
      corrected: true,
    }
  }
  return { norm, tier: 'noecho', score: 0, answer: null, corrected: false }
}

export function spreadAnswers(list: string[], count: number): string[] {
  if (list.length <= count) return list.slice()
  const picked: string[] = []
  for (let i = 0; i < count; i += 1) {
    const index = Math.min(list.length - 1, Math.floor(((i + 0.5) * list.length) / count))
    picked.push(list[index])
  }
  return picked
}
