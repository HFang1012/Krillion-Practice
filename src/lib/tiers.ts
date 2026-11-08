import type { Tier } from '../types'
import { TIERS } from '../types'

export { TIERS }

export const TIER_META: Record<
  Tier,
  { label: string; score: number; line: string; art: string }
> = {
  krillion: {
    label: 'One in a Krillion',
    score: 100,
    line: 'The designated gem. Trench floor.',
    art: '/art/krillion.png',
  },
  deepcut: {
    label: 'Deep cut',
    score: 85,
    line: 'True obscurity. Few go this deep.',
    art: '/art/deepcut.png',
  },
  rare: {
    label: 'Rare',
    score: 60,
    line: 'Genuinely uncommon. Nice pull.',
    art: '/art/rare.png',
  },
  schooler: {
    label: 'Schooler',
    score: 30,
    line: 'Solid — swims with the school.',
    art: '/art/schooler.png',
  },
  tooclever: {
    label: 'Too clever',
    score: 15,
    line: 'The go-to obscure pick. Everyone reaches for it.',
    art: '/art/tooclever.png',
  },
  plankton: {
    label: 'Plankton',
    score: 10,
    line: 'The answer everyone blurts out.',
    art: '/art/plankton.png',
  },
}

export const NO_ECHO = {
  label: 'No echo',
  score: 0,
  line: 'No echo. Not on this sheet.',
}

export function depthMeters(points: number): number {
  return points * 10
}

export function formatMeters(points: number): string {
  return `${depthMeters(points).toLocaleString('en-US')} m`
}

export function formatAccuracy(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`
}
