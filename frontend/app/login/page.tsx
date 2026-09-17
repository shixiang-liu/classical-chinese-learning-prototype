'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { login } from '@/lib/api'
import { ROLE_HOME } from '@/lib/constants'
import type { LoginResponse } from '@/lib/types'

type RoleKey = 'student' | 'teacher' | 'admin'

const DEMO_ACCOUNTS: Record<
  RoleKey,
  {
    label: string
    username: string
    password: string
    hint: string
  }
> = {
  student: {
    label: '学生端',
    username: 'student',
    password: 'student123456',
    hint: '进入学生首页与诗文项目',
  },
  teacher: {
    label: '教师端',
    username: 'teacher',
    password: 'teacher123456',
    hint: '进入教师工作台',
  },
  admin: {
    label: '管理员端',
    username: 'admin',
    password: 'admin123456',
    hint: '进入管理员控制台',
  },
}

const DEFAULT_ROLE: RoleKey = 'student'

function buildDemoSession(role: RoleKey, rememberMe: boolean): LoginResponse {
  const account = DEMO_ACCOUNTS[role]
  const now = Math.floor(Date.now() / 1000)

  return {
    access_token: `demo-${role}-token`,
    token_type: 'bearer',
    user: {
      user_id: `demo-${role}`,
      username: account.username,
      display_name: role === 'student' ? '演示学生' : role === 'teacher' ? '演示教师' : '演示管理员',
      role,
      session: {
        user_id: `demo-${role}`,
        role,
        remember_me: rememberMe,
        exp: now + 60 * 60 * 8,
      },
    },
  }
}

function canUseDemoFallback(role: RoleKey, username: string, password: string) {
  const account = DEMO_ACCOUNTS[role]
  return username.trim() === account.username && password === account.password
}

export default function LoginPage() {
  const router = useRouter()
  const { setSession } = useSession()
  const [activeRole, setActiveRole] = useState<RoleKey>(DEFAULT_ROLE)
  const account = useMemo(() => DEMO_ACCOUNTS[activeRole], [activeRole])
  const [username, setUsername] = useState(DEMO_ACCOUNTS[DEFAULT_ROLE].username)
  const [password, setPassword] = useState(DEMO_ACCOUNTS[DEFAULT_ROLE].password)
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setUsername(DEMO_ACCOUNTS[activeRole].username)
    setPassword(DEMO_ACCOUNTS[activeRole].password)
  }, [activeRole])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const nextSession = await login(username, password, rememberMe)
      setSession(nextSession)
      router.replace(ROLE_HOME[nextSession.user.role])
    } catch (err) {
      if (canUseDemoFallback(activeRole, username, password)) {
        const nextSession = buildDemoSession(activeRole, rememberMe)
        setSession(nextSession)
        router.replace(ROLE_HOME[nextSession.user.role])
        return
      }

      setError(err instanceof Error ? err.message : '登录失败，请检查账号或稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f6efdf] px-4 py-6">
      <div className="mx-auto w-full max-w-[400px]">
        <section className="rounded-[24px] border border-[#103848]/8 bg-[rgba(255,252,246,0.98)] px-5 py-6 shadow-[0_18px_50px_rgba(16,56,72,0.10)] md:px-6">
          <div className="text-center">
            <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#103848] text-base font-semibold text-white">
              文
            </div>
            <h1 className="mt-4 font-headline text-[2rem] text-primary">古诗文教学工作台</h1>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">选择身份后登录</p>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 rounded-[18px] bg-[#f3ebda] p-1.5">
            {Object.entries(DEMO_ACCOUNTS).map(([role, item]) => (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(role as RoleKey)}
                className={[
                  'rounded-[14px] px-3 py-2.5 text-sm font-semibold transition',
                  activeRole === role
                    ? 'bg-[#103848] text-white shadow-[0_12px_28px_rgba(16,56,72,0.16)]'
                    : 'text-on-surface-variant hover:bg-white hover:text-primary',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-center text-sm leading-6 text-on-surface-variant">{account.hint}</p>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">账号</div>
              <input
                autoComplete="username"
                className="w-full rounded-[16px] border border-[#103848]/10 bg-white px-4 py-3.5 text-sm text-on-surface outline-none transition focus:border-[#103848]/20"
                placeholder="请输入登录用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">密码</div>
              <div className="relative">
                <input
                  autoComplete="current-password"
                  className="w-full rounded-[16px] border border-[#103848]/10 bg-white px-4 py-3.5 pr-20 text-sm text-on-surface outline-none transition focus:border-[#103848]/20"
                  placeholder="请输入密码"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-primary/70 hover:text-primary"
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="group flex cursor-pointer items-center gap-3 text-sm text-on-surface-variant">
                <input
                  className="peer hidden"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[#103848]/18 bg-white text-[10px] text-white transition peer-checked:border-secondary peer-checked:bg-secondary">
                  {rememberMe ? '✓' : ''}
                </span>
                <span className="transition group-hover:text-primary">保持登录状态</span>
              </label>
            </div>

            {error ? <div className="rounded-[18px] border border-error/10 bg-error-container/55 px-4 py-4 text-sm text-error">{error}</div> : null}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[18px] bg-[#103848] px-5 py-4 text-base font-semibold text-white shadow-[0_16px_36px_rgba(16,56,72,0.16)] transition hover:bg-[#0d3140] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? '正在登录...' : `进入${account.label}`}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
