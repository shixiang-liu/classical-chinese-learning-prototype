'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { deleteSession, listSessions, listTeacherResults } from '@/lib/api'
import { ROLE_HOME } from '@/lib/constants'
import { formatTaskType, formatTime } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import { loadHiddenStudentHistoryKeys, saveHiddenStudentHistoryKeys } from '@/lib/storage'
import type { ResultRecord, Role, SessionInfo } from '@/lib/types'

type NavItem = {
  href: string
  label: string
}

type StudentHistoryGroup = {
  key: string
  title: string
  href: string
  createdAt: string
  count: number
  active: boolean
  kind: 'project' | 'chat'
  sessionIds: string[]
}

const NAV_ITEMS: Record<'guest' | Role, NavItem[]> = {
  guest: [{ href: '/login', label: '登录' }],
  student: [{ href: '/student', label: '学习' }],
  teacher: [
    { href: '/teacher', label: '教师首页' },
    { href: '/accounts', label: '账号' },
  ],
  admin: [
    { href: '/admin', label: '治理' },
    { href: '/accounts', label: '账号' },
  ],
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function buildStudentHistoryTitle(item: SessionInfo) {
  const shorten = (value: string, maxLength = 18) => (value.length <= maxLength ? value : `${value.slice(0, maxLength).trim()}...`)
  const projectTitle = item.project_title?.trim()
  if (projectTitle) return `《${projectTitle.replace(/^《|》$/g, '')}》`
  const prompt = item.prompt_preview?.trim()
  if (prompt) return shorten(prompt.replace(/\s+/g, ' '))
  if (item.project_id || item.project_title) return '诗文项目'
  if (item.task_type === 'general_chat') return '普通对话'
  return formatTaskType(item.task_type)
}

function buildStudentHistoryGroups(items: SessionInfo[], activeSessionId: string): StudentHistoryGroup[] {
  const grouped = new Map<string, StudentHistoryGroup>()

  for (const item of items) {
    const normalizedProjectTitle = item.project_title?.trim().replace(/^《|》$/g, '') ?? ''
    const isProject = Boolean(item.project_id || normalizedProjectTitle)
    const key = isProject ? `project:${item.project_id ?? normalizedProjectTitle}` : `session:${item.session_id}`
    const current = grouped.get(key)

    if (!current) {
      grouped.set(key, {
        key,
        title: buildStudentHistoryTitle(item),
        href: `/student?session=${item.session_id}&panel=history`,
        createdAt: item.created_at,
        count: 1,
        active: item.session_id === activeSessionId,
        kind: isProject ? 'project' : 'chat',
        sessionIds: [item.session_id],
      })
      continue
    }

    current.count += 1
    current.sessionIds.push(item.session_id)
    current.active = current.active || item.session_id === activeSessionId
    if (new Date(item.created_at).getTime() > new Date(current.createdAt).getTime()) {
      current.createdAt = item.created_at
      current.href = `/student?session=${item.session_id}&panel=history`
    }
  }

  return Array.from(grouped.values()).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

function buildTeacherHistory(items: ResultRecord[]) {
  return items.slice(0, 6).map((item) => ({
    id: item.result_id,
    title: buildStudentHistoryTitle({ ...item, task_type: item.result_type, session_id: item.session_id, created_at: item.created_at ?? '', status: item.status, context_mode: '', role: 'teacher' } as SessionInfo),
    meta: `${formatTaskType(item.result_type)} · ${formatTime(item.created_at)}`,
    href: `/teacher?panel=review&result=${item.result_id}`,
  }))
}

function isNavActive(pathname: string, href: string) {
  if (href === '/') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function isStandalonePath(pathname: string) {
  return pathname === '/' || pathname === '/login'
}

function isStudentAreaPath(pathname: string) {
  return pathname === '/student' || pathname.startsWith('/student/') || pathname === '/trajectory' || pathname.startsWith('/trajectory/') || pathname === '/challenge' || pathname.startsWith('/challenge/')
}

function isTeacherAreaPath(pathname: string) {
  return pathname === '/teacher' || pathname.startsWith('/teacher/')
}

function isAdminAreaPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function normalizeDisplayName(name?: string | null) {
  if (!name) return '用户'
  if (name === 'Demo Teacher') return '演示教师'
  if (name === 'Demo Student') return '演示学生'
  if (name === 'Demo Admin') return '演示管理员'
  return name
}

function BrandBlock({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-[28px] border border-black/8 bg-white/88 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="text-[11px] tracking-[0.26em] text-on-surface-variant">{subtitle}</div>
      <div className="mt-2 font-headline text-2xl text-primary">{title}</div>
    </div>
  )
}

function StudentSidebar({ pathname, searchParams, token, sessionName, logout, children }: { pathname: string; searchParams: ReturnType<typeof useSearchParams>; token: string | null; sessionName?: string | null; logout: () => void; children: ReactNode }) {
  const router = useRouter()
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([])
  const activeSessionId = pathname === '/student' ? searchParams.get('session') ?? '' : ''

  const historyQuery = useSWR(token ? ['shell-student-history', token] : null, ([, currentToken]) => listSessions(currentToken))
  const historyGroups = useMemo(() => buildStudentHistoryGroups(historyQuery.data ?? [], activeSessionId).filter((item) => !hiddenKeys.includes(item.key)), [activeSessionId, hiddenKeys, historyQuery.data])

  useEffect(() => {
    if (!sessionName) return
    const timeout = window.setTimeout(() => setHiddenKeys(loadHiddenStudentHistoryKeys(sessionName)), 0)
    return () => window.clearTimeout(timeout)
  }, [sessionName])

  useEffect(() => {
    if (!sessionName) return
    saveHiddenStudentHistoryKeys(sessionName, hiddenKeys)
  }, [hiddenKeys, sessionName])

  const handleHide = async (item: StudentHistoryGroup) => {
    if (!token) return
    if (item.kind === 'chat') {
      await Promise.all(item.sessionIds.map((sessionId) => deleteSession(token, sessionId)))
      await historyQuery.mutate()
      if (item.active) router.push('/student')
      return
    }

    setHiddenKeys((current) => (current.includes(item.key) ? current : [...current, item.key]))
    if (item.active) router.push('/student')
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5efe2_0%,#f7f4ee_100%)] text-on-surface">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[286px_minmax(0,1fr)]">
        <aside className="hidden border-r border-black/8 bg-[#f3ede2] px-4 py-5 lg:flex lg:flex-col">
          <Link href="/student" className="block">
            <BrandBlock title="学生学习工作台" subtitle="学生端" />
          </Link>
          <Link href="/student" className="mt-4 inline-flex items-center justify-center rounded-full bg-[#103848] px-4 py-3 text-sm font-medium text-white">
            新建会话
          </Link>
          <div className="mt-6 flex-1 overflow-auto">
            {historyGroups.length ? <div className="mb-3 text-[11px] tracking-[0.22em] text-on-surface-variant">最近学习</div> : null}
            <div className="space-y-2">
              {historyGroups.map((item) => (
                <div key={item.key} className={cn('rounded-[22px] border px-4 py-3 transition', item.active ? 'border-[#103848]/16 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.07)]' : 'border-transparent bg-white/60 hover:border-[#103848]/10 hover:bg-white')}>
                  <div className="flex items-start justify-between gap-3">
                    <Link href={item.href} className="block min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm leading-6 text-on-surface">{item.title}</div>
                      <div className="mt-2 text-xs text-on-surface-variant">{formatTime(item.createdAt)}</div>
                    </Link>
                    <button type="button" onClick={() => void handleHide(item)} className="rounded-full border border-black/8 bg-white px-2 py-1 text-[11px] text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary">
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-[24px] border border-black/8 bg-white/78 px-4 py-4">
            <div className="text-sm font-medium text-on-surface">{normalizeDisplayName(sessionName)}</div>
            <div className="mt-1 text-xs tracking-[0.16em] text-on-surface-variant">学生工作台</div>
            <button onClick={logout} className="mt-4 w-full rounded-full border border-black/8 px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary">
              退出登录
            </button>
          </div>
        </aside>
        <div className="relative flex min-h-screen flex-col overflow-hidden">
          <main className="relative flex-1 px-4 py-5 md:px-6 xl:px-8">
            <div className="mx-auto w-full max-w-[1320px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { role, logout, session, token } = useSession()

  const standalone = isStandalonePath(pathname)
  const studentAreaPath = isStudentAreaPath(pathname)
  const teacherAreaPath = isTeacherAreaPath(pathname)
  const adminAreaPath = isAdminAreaPath(pathname)
  const shellRole: 'guest' | Role = role ?? (adminAreaPath ? 'admin' : teacherAreaPath ? 'teacher' : studentAreaPath ? 'student' : 'guest')
  const navItems = NAV_ITEMS[shellRole]
  const homeHref = shellRole === 'guest' ? '/login' : ROLE_HOME[shellRole]

  const teacherHistoryQuery = useSWR(token && role === 'teacher' ? ['shell-teacher-history', token] : null, ([, currentToken]) => listTeacherResults(currentToken))
  const teacherHistory = useMemo(() => buildTeacherHistory(teacherHistoryQuery.data ?? []), [teacherHistoryQuery.data])

  if (standalone) {
    return <main className="min-h-screen bg-[#f5efe2] text-on-surface">{children}</main>
  }

  if (role === 'student' || (!role && studentAreaPath)) {
    return <StudentSidebar logout={logout} pathname={pathname} searchParams={searchParams} sessionName={session?.user.display_name ?? null} token={token}>{children}</StudentSidebar>
  }

  if (role === 'teacher' && teacherAreaPath) {
    return <main className="min-h-screen bg-[linear-gradient(180deg,#f5efe2_0%,#f7f4ee_100%)] text-on-surface">{children}</main>
  }

  if (role === 'admin' || (!role && adminAreaPath)) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f5efe2_0%,#f7f4ee_100%)] text-on-surface">
        <div className="grid min-h-screen grid-cols-1 xl:grid-cols-[264px_minmax(0,1fr)]">
          <aside className="hidden border-r border-black/8 bg-[#efe7d6] px-4 py-5 xl:flex xl:flex-col">
            <Link href={homeHref} className="block">
              <div className="rounded-[28px] border border-black/8 bg-white/88 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                <div className="text-[11px] tracking-[0.24em] text-on-surface-variant">管理端</div>
                <div className="mt-2 font-headline text-2xl text-primary">学校治理工作台</div>
              </div>
            </Link>
            <nav className="mt-6 space-y-2">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className={[
                  'block rounded-[20px] border px-4 py-3 text-sm transition',
                  isNavActive(pathname, item.href)
                    ? 'border-[#103848]/16 bg-white text-primary shadow-[0_14px_30px_rgba(15,23,42,0.07)]'
                    : 'border-transparent bg-white/60 text-on-surface-variant hover:border-[#103848]/10 hover:bg-white hover:text-primary',
                ].join(' ')}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto rounded-[24px] border border-black/8 bg-white/78 px-4 py-4">
              <div className="text-sm font-medium text-on-surface">管理员账号</div>
              <div className="mt-1 text-xs tracking-[0.16em] text-on-surface-variant">管理员权限</div>
              <button
                onClick={() => {
                  if (session) logout()
                }}
                className="mt-4 rounded-full border border-black/8 px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary"
              >
                退出登录
              </button>
            </div>
          </aside>
          <div className="relative flex min-h-screen flex-col overflow-hidden">
            <header className="sticky top-0 z-30 border-b border-black/8 bg-[#f7f4ee]/88 px-4 py-4 backdrop-blur xl:hidden">
              <div className="flex items-center justify-between gap-4">
                <Link href={homeHref} className="font-headline text-2xl text-primary">学校治理工作台</Link>
                <button
                  onClick={() => {
                    if (session) logout()
                  }}
                  className="rounded-full border border-black/8 px-3 py-1.5 text-xs text-on-surface-variant"
                >
                  退出
                </button>
              </div>
            </header>
            <main className="relative flex-1 px-4 py-5 md:px-6 xl:px-8 2xl:px-10">
              <div className="mx-auto w-full max-w-[1520px]">{children}</div>
            </main>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5efe2_0%,#f7f4ee_100%)] text-on-surface">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r border-black/8 bg-[#efe7d6] px-4 py-5 lg:flex lg:flex-col">
          <Link href={homeHref} className="block">
            <BrandBlock title="教师工作台" subtitle="教师端" />
          </Link>
          <nav className="mt-6 space-y-2">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={[
                'block rounded-[20px] border px-4 py-3 text-sm transition',
                isNavActive(pathname, item.href)
                  ? 'border-[#103848]/16 bg-white text-primary shadow-[0_14px_30px_rgba(15,23,42,0.07)]'
                  : 'border-transparent bg-white/60 text-on-surface-variant hover:border-[#103848]/10 hover:bg-white hover:text-primary',
              ].join(' ')}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 rounded-[24px] border border-black/8 bg-white/78 px-4 py-4">
            <div className="text-[11px] tracking-[0.22em] text-on-surface-variant">最近结果</div>
            <div className="mt-3 space-y-2">
              {teacherHistory.map((item) => (
                <Link key={item.id} href={item.href} className="block rounded-[18px] bg-[#f7f3eb] px-3 py-3 transition hover:bg-white">
                  <div className="line-clamp-2 text-sm leading-6 text-on-surface">{item.title}</div>
                  <div className="mt-1 text-xs text-on-surface-variant">{item.meta}</div>
                </Link>
              ))}
              {!teacherHistory.length ? <div className="text-sm text-on-surface-variant">还没有最近处理结果。</div> : null}
            </div>
          </div>
          <div className="mt-auto rounded-[24px] border border-black/8 bg-white/78 px-4 py-4">
            <div className="text-sm font-medium text-on-surface">{normalizeDisplayName(session?.user.display_name)}</div>
            <div className="mt-1 text-xs tracking-[0.16em] text-on-surface-variant">教师权限</div>
            {session ? <button onClick={logout} className="mt-4 rounded-full border border-black/8 px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary">退出登录</button> : null}
          </div>
        </aside>
        <div className="relative flex min-h-screen flex-col overflow-hidden">
          <header className="sticky top-0 z-30 border-b border-black/8 bg-[#f7f4ee]/88 px-4 py-4 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <Link href={homeHref} className="font-headline text-2xl text-primary">教师工作台</Link>
              {session ? <button onClick={logout} className="rounded-full border border-black/8 px-3 py-1.5 text-xs text-on-surface-variant">退出</button> : null}
            </div>
          </header>
          <main className="relative flex-1 px-4 py-5 md:px-6 xl:px-8">
            <div className="mx-auto w-full max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
