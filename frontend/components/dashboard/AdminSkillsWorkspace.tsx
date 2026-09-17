'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { getAdminSkillsSnapshot, reloadAdminSkills, upsertAdminConfig } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import type { AdminConfigItem } from '@/lib/types'

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function Section({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[32px] border border-black/8 bg-white/80 px-5 py-5 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? <div className="text-[11px] tracking-[0.22em] text-on-surface-variant">{eyebrow}</div> : null}
          <h2 className="mt-2 font-headline text-3xl text-primary">{title}</h2>
          {description ? <p className="mt-3 max-w-3xl text-sm leading-7 text-on-surface-variant">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}

function ActionButton({
  children,
  tone = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'secondary' | 'ghost'
}) {
  return (
    <button
      {...props}
      className={[
        'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary'
          ? 'border-[#103848]/16 bg-[#103848] text-white hover:bg-[#0d3140]'
          : tone === 'secondary'
            ? 'border-black/8 bg-[#f8f3e8] text-on-surface hover:border-[#103848]/12 hover:text-primary'
            : 'border-black/8 bg-white text-on-surface-variant hover:border-[#103848]/12 hover:text-primary',
        props.className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[26px] border border-[#103848]/8 bg-[#faf6ee] px-4 py-4">
      <div className="text-[11px] tracking-[0.18em] text-on-surface-variant">{label}</div>
      <div className="mt-2 font-headline text-3xl text-primary">{value}</div>
      <div className="mt-1 text-sm text-on-surface-variant">{note}</div>
    </div>
  )
}

function CodeEditor({
  title,
  description,
  value,
  onChange,
  onSave,
  busy,
}: {
  title: string
  description: string
  value: string
  onChange: (value: string) => void
  onSave: () => Promise<void>
  busy: boolean
}) {
  return (
    <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5">
      <div>
        <div className="text-base font-semibold text-on-surface">{title}</div>
        <p className="mt-2 text-sm leading-7 text-on-surface-variant">{description}</p>
      </div>
      <textarea
        className="mt-5 h-80 w-full rounded-[24px] border border-[#103848]/10 bg-[#fbf7ef] px-4 py-4 font-mono text-sm leading-7 outline-none transition focus:border-[#103848]/20 focus:bg-white"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-4">
        <ActionButton onClick={() => void onSave()} disabled={busy} tone="secondary">
          {busy ? '保存中...' : `保存${title}`}
        </ActionButton>
      </div>
    </div>
  )
}

export function AdminSkillsWorkspace() {
  const { token, role, isReady } = useSession()
  const [mcpDraft, setMcpDraft] = useState('')
  const [skillsDraft, setSkillsDraft] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState('')

  const snapshotQuery = useSWR(
    token && role === 'admin' ? ['admin-skills-snapshot', token] : null,
    ([, currentToken]) => getAdminSkillsSnapshot(currentToken),
  )

  const snapshot = snapshotQuery.data
  const latestConfig = useMemo<AdminConfigItem | null>(() => {
    if (!snapshot?.admin_configs.length) return null
    return snapshot.admin_configs.reduce((latest, item) =>
      new Date(item.updated_at).getTime() > new Date(latest.updated_at).getTime() ? item : latest,
    )
  }, [snapshot])
  const skillItems = Object.values(snapshot?.skills ?? {})
  const errorSkillCount = skillItems.filter((item) => item.last_error).length
  const providerCount = snapshot?.mcp.providers.length ?? 0
  const enabledSkillCount = skillItems.filter((item) => item.enabled).length
  const healthLabel = errorSkillCount || snapshot?.mcp.last_error ? '需要关注' : '稳定'
  const healthNote = snapshot?.mcp.last_error ?? (errorSkillCount ? `${errorSkillCount} 个能力最近有错误记录。` : '当前没有阻塞性问题。')

  useEffect(() => {
    if (!snapshot) return
    const mcpConfig = snapshot.admin_configs.find((item) => item.config_key === 'mcp')
    const skillsConfig = snapshot.admin_configs.find((item) => item.config_key === 'skills')

    setMcpDraft((current) => (current.trim() ? current : prettyJson(mcpConfig?.config_json ?? snapshot.mcp)))
    setSkillsDraft((current) => (current.trim() ? current : prettyJson(skillsConfig?.config_json ?? snapshot.skills)))
  }, [snapshot])

  if (!isReady) {
    return <section className="flex min-h-[60vh] items-center justify-center text-primary">正在加载系统管理页...</section>
  }

  if (role && role !== 'admin') {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">当前账号不是管理员身份</h1>
          <p className="mt-3 text-sm text-on-surface-variant">请切换到管理员账号后再进入系统管理页。</p>
        </div>
      </section>
    )
  }

  if (!token) {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">请先登录管理员账号</h1>
        </div>
      </section>
    )
  }

  const refreshSnapshot = async () => {
    await snapshotQuery.mutate()
  }

  const handleSaveConfig = async (configKey: 'mcp' | 'skills') => {
    const draft = configKey === 'mcp' ? mcpDraft : skillsDraft

    try {
      setBusyAction(`save-${configKey}`)
      setError(null)
      const parsed = JSON.parse(draft) as Record<string, unknown>
      const response = await upsertAdminConfig(token, { config_key: configKey, config_json: parsed })
      setMessage(response.message ?? `${configKey} 配置已更新。`)
      await refreshSnapshot()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '保存配置失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleReload = async () => {
    try {
      setBusyAction('reload')
      setError(null)
      const response = await reloadAdminSkills(token)
      setMessage(response.message ?? '系统状态已刷新。')
      await snapshotQuery.mutate(
        (current) =>
          current
            ? {
                ...current,
                mcp: response.mcp,
                skills: response.skills,
              }
            : current,
        { revalidate: false },
      )
      await refreshSnapshot()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '刷新状态失败')
    } finally {
      setBusyAction('')
    }
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[radial-gradient(circle_at_top,rgba(16,56,72,0.12),transparent_32%),linear-gradient(180deg,#fbf7ef_0%,#f2ead9_100%)]">
      <section className="mx-auto max-w-[1280px] space-y-6 px-4 py-8">
        <Section
          eyebrow="SYSTEM OPERATIONS"
          title="能力编排与运行中枢"
          description="这里负责看系统健康、接入状态、能力开关和底层配置。日常先看上面的状态卡，只有真的需要排查或调整时再展开配置。"
          actions={
            <ActionButton onClick={() => void handleReload()} disabled={busyAction === 'reload'}>
              {busyAction === 'reload' ? '刷新中...' : '刷新系统状态'}
            </ActionButton>
          }
        >
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="系统状态" value={healthLabel} note={healthNote} />
            <MetricCard label="外部接入" value={snapshot?.mcp.enabled ? '已开启' : '已关闭'} note={`当前接入 ${providerCount} 个 provider`} />
            <MetricCard label="启用能力" value={String(enabledSkillCount)} note={`共登记 ${skillItems.length} 个任务能力`} />
            <MetricCard label="最近调整" value={latestConfig ? formatTime(latestConfig.updated_at) : '暂无'} note={latestConfig ? `最近改动来自 ${latestConfig.config_key}` : '还没有配置变更'} />
          </div>

          {error ? <div className="mt-5 rounded-[24px] border border-error/10 bg-error-container/60 px-4 py-4 text-sm text-error">{error}</div> : null}
          {message ? <div className="mt-5 rounded-[24px] border border-[#103848]/10 bg-[#f8f3e8] px-4 py-4 text-sm text-primary">{message}</div> : null}
        </Section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.04fr)_360px]">
          <Section eyebrow="CAPABILITIES" title="能力地图" description="先看哪些能力已启用、上下文模式是什么、有没有最近报错，再决定是否深入到底层配置。">
            <div className="grid gap-4 md:grid-cols-2">
              {skillItems.map((item) => (
                <div key={item.task_type} className="rounded-[26px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-on-surface">{item.task_type}</div>
                      <div className="mt-1 text-sm text-on-surface-variant">上下文模式：{item.context_mode}</div>
                    </div>
                    <div className={`rounded-full px-3 py-2 text-xs ${item.enabled ? 'bg-[#d8eadc] text-secondary' : 'bg-white text-on-surface-variant'}`}>
                      {item.enabled ? '已启用' : '已关闭'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full px-3 py-2 ${item.registered ? 'bg-white text-primary' : 'bg-[#fff1f1] text-error'}`}>
                      {item.registered ? '已注册' : '未注册'}
                    </span>
                    <span className="rounded-full bg-white px-3 py-2 text-on-surface-variant">{item.context_mode}</span>
                  </div>
                  <div className="mt-3 text-sm leading-7 text-on-surface-variant">
                    {item.last_error ? `最近错误：${item.last_error}` : '最近运行正常，没有错误记录。'}
                  </div>
                </div>
              ))}
              {!skillItems.length ? <div className="rounded-[24px] bg-[#faf6ee] px-4 py-4 text-sm text-on-surface-variant">当前还没有可展示的能力登记信息。</div> : null}
            </div>
          </Section>

          <div className="space-y-6">
            <Section eyebrow="ENTRY" title="常用入口" description="真正高频的管理动作不应该藏在底层配置里。">
              <div className="space-y-3">
                <Link className="block rounded-[26px] border border-black/8 bg-white px-5 py-5 transition hover:border-[#103848]/12 hover:shadow-[0_18px_40px_rgba(16,56,72,0.08)]" href="/admin?panel=audit">
                  <div className="text-base font-semibold text-on-surface">查看运行追踪</div>
                  <div className="mt-2 text-sm leading-7 text-on-surface-variant">异常会话、阶段时间线、相关结果都从这里排查。</div>
                </Link>
                <Link className="block rounded-[26px] border border-black/8 bg-white px-5 py-5 transition hover:border-[#103848]/12 hover:shadow-[0_18px_40px_rgba(16,56,72,0.08)]" href="/accounts">
                  <div className="text-base font-semibold text-on-surface">管理成员账号</div>
                  <div className="mt-2 text-sm leading-7 text-on-surface-variant">教师、学生账号的创建与密码处理都在成员运营页完成。</div>
                </Link>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((current) => !current)}
                  className="w-full rounded-[26px] border border-black/8 bg-white px-5 py-5 text-left transition hover:border-[#103848]/12 hover:shadow-[0_18px_40px_rgba(16,56,72,0.08)]"
                >
                  <div className="text-base font-semibold text-on-surface">底层配置</div>
                  <div className="mt-2 text-sm leading-7 text-on-surface-variant">
                    {showAdvanced ? '高级配置当前已展开。' : '默认先隐藏，只有需要排查或调整底层时再打开。'}
                  </div>
                </button>
              </div>
            </Section>

            <Section eyebrow="MCP" title="接入摘要" description="快速看接入是否正常、provider 列表以及最近一次 reload 情况。">
              <div className="rounded-[28px] bg-[#103848] px-5 py-5 text-white shadow-[0_28px_60px_rgba(16,56,72,0.18)]">
                <div className="text-[11px] tracking-[0.22em] text-white/55">MCP STATUS</div>
                <div className="mt-2 font-headline text-2xl">{snapshot?.mcp.enabled ? '系统已连接外部能力' : '当前未启用外部能力'}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(snapshot?.mcp.providers ?? []).map((provider) => (
                    <span key={provider} className="rounded-full border border-white/14 bg-white/8 px-3 py-2 text-xs text-white/78">
                      {provider}
                    </span>
                  ))}
                  {!snapshot?.mcp.providers.length ? <span className="rounded-full border border-white/14 bg-white/8 px-3 py-2 text-xs text-white/78">暂无 provider</span> : null}
                </div>
                <div className="mt-4 text-sm leading-7 text-white/72">
                  最近 reload：{snapshot?.mcp.last_reload ? formatTime(snapshot.mcp.last_reload) : '暂无'}。热重载：{snapshot?.mcp.hot_reload ? '开启' : '关闭'}。
                </div>
              </div>
            </Section>
          </div>
        </div>

        {showAdvanced ? (
          <Section eyebrow="ADVANCED" title="底层配置" description="只有在确认要调整系统能力时，再修改这些配置。这里保留原始 JSON 编辑方式，方便与你现有后端保持一致。">
            <div className="grid gap-6 xl:grid-cols-2">
              <CodeEditor
                title="MCP 配置"
                description={`当前接入：${snapshot?.mcp.providers.join('、') || '未配置'}。热重载：${snapshot?.mcp.hot_reload ? '开启' : '关闭'}。`}
                value={mcpDraft}
                onChange={setMcpDraft}
                onSave={async () => handleSaveConfig('mcp')}
                busy={busyAction === 'save-mcp'}
              />
              <CodeEditor
                title="Skills 配置"
                description="控制各类任务是否启用，以及回答时采用的上下文模式。"
                value={skillsDraft}
                onChange={setSkillsDraft}
                onSave={async () => handleSaveConfig('skills')}
                busy={busyAction === 'save-skills'}
              />
            </div>
          </Section>
        ) : null}
      </section>
    </div>
  )
}
