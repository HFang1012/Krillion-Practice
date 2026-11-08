import { useCallback, useEffect, useRef, useState } from 'react'
import type { BankIndex, PromptMeta, Shard } from '../types'
import { loadShard } from '../lib/bank'

type State = {
  meta: PromptMeta | null
  shard: Shard | null
  loading: boolean
  error: string | null
}

export function usePrompt(
  index: BankIndex | null,
  forcedId: string | null,
  loggedIdsRef?: { current: Set<string> },
) {
  const seen = useRef(new Set<string>())
  const currentId = useRef<string | null>(null)
  const token = useRef(0)
  const [state, setState] = useState<State>({
    meta: null,
    shard: null,
    loading: true,
    error: null,
  })

  const go = useCallback(
    async (explicit?: string | null) => {
      if (!index) return
      const mine = ++token.current
      setState((prev) => ({ ...prev, loading: true, error: null }))
      let meta = explicit ? index.prompts.find((prompt) => prompt.id === explicit) : undefined
      if (!meta) {
        const avoid = new Set(seen.current)
        if (currentId.current) avoid.add(currentId.current)
        let pool = index.prompts.filter((prompt) => !avoid.has(prompt.id))
        if (!pool.length) {
          seen.current.clear()
          pool = index.prompts.filter((prompt) => prompt.id !== currentId.current)
          if (!pool.length) pool = index.prompts
        }
        const logged = loggedIdsRef?.current
        if (logged && logged.size) {
          const fresh = pool.filter((prompt) => !logged.has(prompt.id))
          if (fresh.length) pool = fresh
        }
        meta = pool[Math.floor(Math.random() * pool.length)]
      }
      try {
        const shard = await loadShard(meta.id)
        if (token.current !== mine) return
        seen.current.add(meta.id)
        currentId.current = meta.id
        setState({ meta, shard, loading: false, error: null })
      } catch (err: unknown) {
        if (token.current !== mine) return
        setState({
          meta: null,
          shard: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load this prompt.',
        })
      }
    },
    [index, loggedIdsRef],
  )

  useEffect(() => {
    if (!index) return
    void go(forcedId)
    return () => {
      token.current += 1
    }
  }, [index, forcedId, go])

  return { ...state, next: () => go(null) }
}
