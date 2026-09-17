'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLE_HOME } from '@/lib/constants'
import { clearSession, loadSession, saveSession } from '@/lib/storage'
import type { LoginResponse, Role } from '@/lib/types'

const SESSION_EVENT = 'slm-session-change'

function emitSessionChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SESSION_EVENT))
}

function getToken(session: LoginResponse | null) {
  return session?.access_token ?? null
}

function getRole(session: LoginResponse | null) {
  return session?.user.role ?? null
}

type SessionContextValue = {
  session: LoginResponse | null
  token: string | null
  role: Role | null
  isReady: boolean
  setSession: (value: LoginResponse | null) => void
  logout: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [session, setCurrentSession] = useState<LoginResponse | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const syncSession = () => {
      setCurrentSession(loadSession())
      setIsReady(true)
    }

    syncSession()
    window.addEventListener('storage', syncSession)
    window.addEventListener(SESSION_EVENT, syncSession)

    return () => {
      window.removeEventListener('storage', syncSession)
      window.removeEventListener(SESSION_EVENT, syncSession)
    }
  }, [])

  const setSession = useCallback((value: LoginResponse | null) => {
    if (value) saveSession(value)
    else clearSession()

    setCurrentSession(value)
    setIsReady(true)
    emitSessionChange()
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setCurrentSession(null)
    setIsReady(true)
    emitSessionChange()
    router.push('/login')
  }, [router])

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      token: getToken(session),
      role: getRole(session),
      isReady,
      setSession,
      logout,
    }),
    [isReady, logout, session, setSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within SessionProvider')
  }
  return context
}

export function getRoleHome(role: Role | null): string {
  if (!role) return '/login'
  return ROLE_HOME[role]
}
