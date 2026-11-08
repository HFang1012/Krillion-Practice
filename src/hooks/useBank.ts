import { useEffect, useState } from 'react'
import type { BankIndex } from '../types'
import { publicUrl } from '../lib/publicUrl'

export function useBank() {
  const [index, setIndex] = useState<BankIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    fetch(publicUrl('bank/index.json'))
      .then(async (response) => {
        if (!response.ok) throw new Error('The answer bank is not built yet.')
        return (await response.json()) as BankIndex
      })
      .then((data) => {
        if (!cancel) setIndex(data)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Could not load the answer bank.')
      })
    return () => {
      cancel = true
    }
  }, [])

  return { index, error }
}
