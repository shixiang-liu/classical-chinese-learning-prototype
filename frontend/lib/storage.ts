import type { LoginResponse } from '@/lib/types'

const SESSION_KEY = 'slm-session'
const SESSION_EVENT = 'slm-session-change'
const STUDENT_HISTORY_HIDDEN_PREFIX = 'slm-student-history-hidden'

let cachedRaw: string | null = null
let cachedSession: LoginResponse | null = null

export function saveSession(session: LoginResponse): void {
  if (typeof window === 'undefined') return
  const raw = JSON.stringify(session)
  window.localStorage.setItem(SESSION_KEY, raw)
  cachedRaw = raw
  cachedSession = session
}

export function loadSession(): LoginResponse | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(SESSION_KEY)
  if (!raw) {
    cachedRaw = null
    cachedSession = null
    return null
  }
  if (raw === cachedRaw) {
    return cachedSession
  }
  try {
    const session = JSON.parse(raw) as LoginResponse
    cachedRaw = raw
    cachedSession = session
    return session
  } catch {
    window.localStorage.removeItem(SESSION_KEY)
    cachedRaw = null
    cachedSession = null
    return null
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(SESSION_KEY)
  cachedRaw = null
  cachedSession = null
}

export function clearSessionWithBroadcast(): void {
  if (typeof window === 'undefined') return
  clearSession()
  window.dispatchEvent(new Event(SESSION_EVENT))
}

function buildStudentHistoryHiddenKey(userId: string) {
  return `${STUDENT_HISTORY_HIDDEN_PREFIX}:${userId}`
}

export function loadHiddenStudentHistoryKeys(userId: string): string[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(buildStudentHistoryHiddenKey(userId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    window.localStorage.removeItem(buildStudentHistoryHiddenKey(userId))
    return []
  }
}

export function saveHiddenStudentHistoryKeys(userId: string, keys: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(buildStudentHistoryHiddenKey(userId), JSON.stringify(keys))
}
