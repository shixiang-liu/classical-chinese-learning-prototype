'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ReactNode, useMemo, useState } from 'react'
import { getAdminTraceDetail, listAdminResults, listAdminTraces } from '@/lib/api'
import { formatBloom, formatRole, formatTaskType, formatTime } from '@/lib/format'
import { useSession } from '@/hooks/useSession'

type AdminTraceWorkspaceProps = {
  initialSession?: string
}

function resultTitle(content: Record<string, unknown>, fallback: string) {
  return typeof content.title === 'string' ? content.title : fallback
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

export function AdminTraceWorkspace({ initialSession = '' }: AdminTraceWorkspaceProps) {
  const { token, role, isReady } = useSession()
  const [manualSelectedSession, setManualSelectedSession] = useState<string | null>(null)

  const tracesQuery = useSWR(
    token && role === 'admin' ? ['admin-traces', token] : null,
    ([, currentToken]) => listAdminTraces(currentToken),
  )
  const resultsQuery = useSWR(
    token && role === 'admin' ? ['admin-results', token] : null,
    ([, currentToken]) => listAdminResults(currentToken),
  )

  const traces = tracesQuery.data ?? []
  const erroredTraces = traces.filter((item) => item.last_error_code)
  const prioritizedTraces = erroredTraces.length ? erroredTraces : traces

  const selectedSession = manualSelectedSession || initialSession || prioritizedTraces[0]?.session_id || null
  const selectedTrace = prioritizedTraces.find((item) => item.session_id === selectedSession) ?? prioritizedTraces[0] ?? null

  const detailQuery = useSWR(
    token && role === 'admin' && selectedSession ? ['admin-trace-detail', token, selectedSession] : null,
    ([, currentToken, sessionId]) => getAdminTraceDetail(currentToken, sessionId),
  )

  const selectedDetail = detailQuery.data
  const relatedResults = (resultsQuery.data ?? []).filter((item) => item.session_id === selectedSession).slice(0, 3)
  const healthyCount = traces.filter((item) => !item.last_error_code).length

  const metricItems = useMemo(
    () => [
      { label: '异常会话', value: String(erroredTraces.length), note: erroredTraces.length ? '优先处理这些会话' : '当前没有异常' },
      { label: '正常会话', value: String(healthyCount), note: '最近运行正常的会话数量' },
      { label: '当前阶段数', value: String(selectedDetail?.stage_summary.length ?? 0), note: selectedTrace ? '当前选中会话的阶段摘要' : '等待选择会话' },
      { label: '相关结果', value: String(relatedResults.length), note: '当前会话产出的最近结果' },
    ],
    [erroredTraces.length, healthyCount, selectedDetail?.stage_summary.length, relatedResults.length, selectedTrace],
  )

  if (!isReady) {
    return <section className="flex min-h-[60vh] items-center justify-center text-primary">正在加载运行记录...</section>
  }

  if (role && role !== 'admin') {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">当前账号不是管理员身份</h1>
          <p className="mt-3 text-sm text-on-surface-variant">请切换到管理员账号后查看运行记录。</p>
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

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[radial-gradient(circle_at_top,rgba(16,56,72,0.12),transparent_32%),linear-gradient(180deg,#fbf7ef_0%,#f2ead9_100%)]">
      <section className="mx-auto max-w-[1280px] space-y-6 px-4 py-8">
        <Section
          eyebrow="RUN DIAGNOSTICS"
          title="会话追踪与异常诊断"
          description="先看异常队列，再看当前会话的状态卡、阶段时间线和相关结果。把真正需要排查的信号集中到同一个诊断面板里。"
          actions={
            <Link className="rounded-full border border-black/8 bg-[#f8f3e8] px-4 py-2 text-sm font-medium text-primary transition hover:border-[#103848]/12" href="/admin/skills">
              返回系统管理
            </Link>
          }
        >
          <div className="grid gap-4 md:grid-cols-4">
            {metricItems.map((item) => (
              <MetricCard key={item.label} label={item.label} value={item.value} note={item.note} />
            ))}
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Section
            eyebrow="QUEUE"
            title={traces.some((item) => item.last_error_code) ? '优先处理这些会话' : '最近会话'}
            description={traces.some((item) => item.last_error_code) ? '列表已自动把有错误的会话排在前面。' : '当前没有报错，会话列表按最近时间展示。'}
          >
            <div className="space-y-3">
              {prioritizedTraces.map((item) => {
                const active = item.session_id === selectedTrace?.session_id
                return (
                  <button
                    key={item.session_id}
                    type="button"
                    onClick={() => setManualSelectedSession(item.session_id)}
                    className={[
                      'w-full rounded-[26px] border px-5 py-4 text-left transition',
                      active
                        ? 'border-[#103848]/16 bg-white shadow-[0_18px_40px_rgba(16,56,72,0.08)]'
                        : 'border-black/8 bg-[#faf6ee] hover:border-[#103848]/12 hover:bg-white',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-base font-semibold text-on-surface">{formatTaskType(item.task_type)}</div>
                      <div className="rounded-full bg-white px-3 py-2 text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                    </div>
                    <div className="mt-3 text-sm leading-7 text-on-surface-variant">
                      {formatRole(item.user_role)} · {item.session_id.slice(0, 8)} · {item.last_error_code ?? '正常'}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-white px-3 py-2 text-on-surface-variant">{item.session_status}</span>
                      <span className="rounded-full bg-white px-3 py-2 text-on-surface-variant">{item.context_mode}</span>
                      <span className={`rounded-full px-3 py-2 ${item.last_error_code ? 'bg-[#fff0ef] text-error' : 'bg-[#d8eadc] text-secondary'}`}>
                        {item.last_error_code ? '异常' : '正常'}
                      </span>
                    </div>
                  </button>
                )
              })}
              {!prioritizedTraces.length ? <div className="rounded-[24px] bg-[#faf6ee] px-4 py-4 text-sm text-on-surface-variant">当前还没有可查看的运行记录。</div> : null}
            </div>
          </Section>

          <div className="space-y-6">
            <Section
              eyebrow="CURRENT SESSION"
              title={selectedTrace ? `${formatTaskType(selectedTrace.task_type)} · ${selectedTrace.session_id.slice(0, 8)}` : '未选择会话'}
              description={selectedTrace ? '先看状态摘要，再往下看时间线和产出。' : '从左侧列表中选择一条会话后，这里会显示详情。'}
            >
              {selectedTrace ? (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">当前状态</div>
                      <div className="mt-2 text-sm font-medium text-on-surface">{selectedTrace.session_status}</div>
                    </div>
                    <div className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">掌握层级</div>
                      <div className="mt-2 text-sm font-medium text-on-surface">{formatBloom(selectedTrace.current_bloom_level)}</div>
                    </div>
                    <div className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">事件总数</div>
                      <div className="mt-2 text-sm font-medium text-on-surface">{selectedTrace.event_count}</div>
                    </div>
                    <div className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">错误信息</div>
                      <div className="mt-2 text-sm font-medium text-on-surface">{selectedTrace.last_error_code ?? '无'}</div>
                    </div>
                  </div>

                  <div className="rounded-[30px] bg-[#103848] px-5 py-5 text-white shadow-[0_28px_60px_rgba(16,56,72,0.18)]">
                    <div className="text-[11px] tracking-[0.22em] text-white/55">PIPELINE STAGES</div>
                    <div className="mt-2 font-headline text-2xl">当前链路走过这些阶段</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedTrace.pipeline_stages.map((stage) => (
                        <span key={stage} className="rounded-full border border-white/16 bg-white/8 px-3 py-2 text-xs text-white/78">
                          {stage}
                        </span>
                      ))}
                      {!selectedTrace.pipeline_stages.length ? <span className="rounded-full border border-white/16 bg-white/8 px-3 py-2 text-xs text-white/78">暂无阶段信息</span> : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </Section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_360px]">
              <Section eyebrow="TIMELINE" title="处理过程" description="按时间顺序看当前会话的处理阶段。">
                <div className="space-y-3">
                  {selectedDetail?.stage_summary.map((item) => (
                    <div key={`${item.stage}-${item.created_at}`} className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-on-surface">{item.stage}</div>
                        <div className="text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-on-surface-variant">
                        {item.actor} · {formatBloom(item.bloom_level)} · {item.mastery_status ?? '未记录'} · {item.error_code ?? '正常'}
                      </div>
                    </div>
                  ))}
                  {!selectedDetail?.stage_summary.length ? <div className="rounded-[24px] bg-[#faf6ee] px-4 py-4 text-sm text-on-surface-variant">选择会话后，这里会显示处理过程。</div> : null}
                </div>
              </Section>

              <Section eyebrow="OUTPUT" title="相关结果" description="这条会话最近生成的结果会出现在这里。">
                <div className="space-y-3">
                  {relatedResults.map((item) => (
                    <div key={item.result_id} className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="text-sm font-semibold text-on-surface">{resultTitle(item.content_json as Record<string, unknown>, item.result_type)}</div>
                      <div className="mt-2 text-sm leading-7 text-on-surface-variant">
                        {formatTaskType(item.result_type)} · {formatTime(item.created_at)}
                      </div>
                    </div>
                  ))}
                  {!relatedResults.length ? <div className="rounded-[24px] bg-[#faf6ee] px-4 py-4 text-sm text-on-surface-variant">这条会话当前没有可展示的生成结果。</div> : null}
                </div>
              </Section>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
