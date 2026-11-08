import type { QuestionRecord } from '../types'

const KEY = 'krillion-practice-log-v1'

export function loadLog(): QuestionRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter((item) => item && typeof item === 'object' && 'id' in item) as QuestionRecord[]
  } catch {
    return []
  }
}

export function saveLog(log: QuestionRecord[]): void {
  const payload = log.slice(0, 2000)
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    localStorage.setItem(KEY, JSON.stringify(payload.slice(0, 200)))
  }
}
