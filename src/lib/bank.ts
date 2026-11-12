import type { Shard } from '../types'
import { publicUrl } from './publicUrl'

const cache = new Map<string, Promise<Shard>>()

export function loadShard(id: string): Promise<Shard> {
  const existing = cache.get(id)
  if (existing) return existing
  const pending = fetch(publicUrl(`bank/prompts/${encodeURIComponent(id)}.json`), { cache: 'no-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('This prompt sheet is missing.')
    return (await response.json()) as Shard
  })
  pending.catch(() => {
    cache.delete(id)
  })
  cache.set(id, pending)
  return pending
}
