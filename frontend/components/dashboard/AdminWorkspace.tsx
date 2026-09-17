'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import {
  getAdminSkillsSnapshot,
  getAdminTraceDetail,
  listAdminResults,
  listAdminTraces,
  listStudents,
  listTeachers,
  reloadAdminSkills,
  upsertAdminConfig,
} from '@/lib/api'
import { BLOOM_OPTIONS } from '@/lib/constants'
import { formatBloom, formatTaskType, formatTime } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import type { AdminConfigItem, ResultRecord, StudentAccount, TeacherAccount, TraceSummary } from '@/lib/types'

type AdminPanel = 'overview' | 'audit' | 'settings' | 'data'
type SampleType = 'bloom' | 'challenge' | 'answer' | 'think'
type SampleRecord = {
  id: string
  type: SampleType
  title: string
  summary: string
  createdAt: string
  owner: string
  status: 'unprocessed' | 'confirmed' | 'needs_review' | 'exported'
  reward: 'pending' | 'positive' | 'neutral' | 'negative'
  tags: string[]
  detail: string[]
}

type GovernanceDraft = {
  web_search_enabled: boolean
  file_upload_enabled: boolean
  think_audit_enabled: boolean
  teacher_release_required: boolean
  export_profile: 'teacher-confirmed only' | 'all audit records'
  model_profile: 'school-safe' | 'teacher-priority'
}

const REMOVED_PROVIDER_NAMES = new Set(['filesystem', 'playwright'])

type AdminWorkspaceProps = {
  initialPanel?: AdminPanel
  initialSession?: string
}

const PANEL_LABELS: Record<AdminPanel, { title: string; note: string }> = {
  overview: { title: '治理总览', note: '认知层级分布、教师覆盖与异常会话。' },
  audit: { title: '问题处理', note: '异常会话、阶段记录与关联结果。' },
  settings: { title: '配置', note: '治理策略、运行状态与高级配置。' },
  data: { title: '数据工坊', note: '训练样本标注、状态与导出。' },
}

const SAMPLE_META: Record<SampleType, { label: string; note: string }> = {
  bloom: { label: '层级判断', note: '认知层级判断与教师覆盖信号' },
  challenge: { label: '挑战升级', note: '升级建议、复核与风险点' },
  answer: { label: '答案偏好', note: '答案接受、编辑与拒绝样本' },
  think: { label: '思维审计', note: '长链路与复杂推理审计样本' },
}

const EMPTY_TRACES: TraceSummary[] = []
const EMPTY_RESULTS: ResultRecord[] = []
const EMPTY_TEACHERS: TeacherAccount[] = []
const EMPTY_STUDENTS: StudentAccount[] = []

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function sanitizeMcpDraft(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const draft = { ...(value as Record<string, unknown>) }
  if (Array.isArray(draft.providers)) {
    draft.providers = draft.providers.filter((item) => {
      if (typeof item === 'string') return !REMOVED_PROVIDER_NAMES.has(item)
      if (item && typeof item === 'object' && 'name' in item) {
        const name = (item as { name?: unknown }).name
        return !(typeof name === 'string' && REMOVED_PROVIDER_NAMES.has(name))
      }
      return true
    })
  }
  return draft
}

function badgeTone(value: string) {
  if (value === '异常' || value === '需复核' || value === '拒绝') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (value === '已确认' || value === '高价值' || value === '正常') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === '待定' || value === '未处理') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-slate-200 bg-white text-slate-600'
}

function statusLabel(value: SampleRecord['status']) {
  if (value === 'confirmed') return '已确认'
  if (value === 'needs_review') return '需复核'
  if (value === 'exported') return '已导出'
  return '未处理'
}

function rewardLabel(value: SampleRecord['reward']) {
  if (value === 'positive') return '高价值'
  if (value === 'neutral') return '一般'
  if (value === 'negative') return '拒绝'
  return '待定'
}

function nameLabel(value?: string | null) {
  if (!value) return '未命名'
  if (value === 'Demo Teacher') return '演示教师'
  if (value === 'Demo Student') return '演示学生'
  if (value === 'Demo Admin') return '演示管理员'
  return value
}

function contextModeLabel(value?: string | null) {
  if (!value || value === 'default') return '常规模式'
  if (value === 'full') return '完整模式'
  if (value === 'light') return '轻量模式'
  return value.replace(/_/g, ' ')
}

function reviewStatusLabel(value?: string | null) {
  if (!value) return '未审校'
  if (value === 'accepted') return '已通过'
  if (value === 'rejected') return '已退回'
  if (value === 'edited') return '已编辑'
  if (value === 'pending') return '待审校'
  return value
}

function stageLabel(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'user_input') return '用户输入'
  if (normalized === 'pruning') return '裁剪'
  if (normalized === 'generation') return '生成'
  if (normalized === 'validation') return '校验'
  if (normalized === 'assistant_output') return '结果输出'
  if (normalized === 'challenge_prompt') return '挑战题面'
  if (normalized === 'review') return '复核'
  return value.replace(/_/g, ' ')
}

function actorLabel(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'system') return '系统'
  if (normalized === 'assistant') return '助手'
  if (normalized === 'user') return '用户'
  return value
}

function traceOwner(trace: TraceSummary, teachers: TeacherAccount[], students: StudentAccount[]) {
  if (trace.user_role === 'teacher') {
    const teacher = teachers.find((item) => item.user_id === trace.user_id)
    return teacher ? `${nameLabel(teacher.display_name)} / 教师` : '教师会话'
  }

  if (trace.user_role === 'student') {
    const student = students.find((item) => item.user_id === trace.user_id)
    if (!student) return '学生会话'
    const teacher = teachers.find((item) => item.user_id === student.teacher_id)
    return teacher ? `${nameLabel(student.display_name)} / ${nameLabel(teacher.display_name)}` : `${nameLabel(student.display_name)} / 未分配教师`
  }

  return '管理员会话'
}

function buildTeacherLoad(teachers: TeacherAccount[], students: StudentAccount[]) {
  return teachers
    .map((teacher) => ({
      teacher,
      studentCount: students.filter((item) => item.teacher_id === teacher.user_id).length,
    }))
    .sort((left, right) => right.studentCount - left.studentCount)
}

function buildBloomBuckets(traces: TraceSummary[]) {
  const counts = new Map<string, number>()
  for (const level of BLOOM_OPTIONS) counts.set(level, 0)
  for (const item of traces) {
    if (!item.current_bloom_level) continue
    counts.set(item.current_bloom_level, (counts.get(item.current_bloom_level) ?? 0) + 1)
  }
  return BLOOM_OPTIONS.map((level) => ({ level, count: counts.get(level) ?? 0 }))
}

function resultTitle(item: ResultRecord) {
  return typeof item.content_json?.title === 'string' ? item.content_json.title : formatTaskType(item.result_type)
}

function buildSampleRecords(traces: TraceSummary[], results: ResultRecord[], teachers: TeacherAccount[], students: StudentAccount[]) {
  const bloom = traces
    .filter((item) => item.current_bloom_level)
    .slice(0, 8)
    .map<SampleRecord>((item) => ({
      id: `bloom:${item.session_id}`,
      type: 'bloom',
      title: `${formatTaskType(item.task_type)} / ${formatBloom(item.current_bloom_level)}`,
      summary: item.last_error_code ? '层级判断伴随错误，需要进入人工复核。' : '层级判断已稳定，可进入教师确认样本。',
      createdAt: item.created_at,
      owner: traceOwner(item, teachers, students),
      status: item.last_error_code ? 'needs_review' : 'confirmed',
      reward: item.last_error_code ? 'neutral' : 'positive',
      tags: [formatBloom(item.current_bloom_level), contextModeLabel(item.context_mode), item.last_error_code ? '异常' : '正常'],
      detail: [
        `会话 ${item.session_id.slice(0, 8)} 当前认知层级为 ${formatBloom(item.current_bloom_level)}。`,
        `链路阶段数 ${item.pipeline_stages.length}，事件数 ${item.event_count}。`,
        item.last_error_code ? `最近错误：${item.last_error_code}` : '当前无错误，可作为稳定判断样本。',
      ],
    }))

  const challengeSource = traces.filter(
    (item) =>
      item.pipeline_stages.some((stage) => /challenge/i.test(stage)) ||
      /challenge/i.test(item.last_event_type ?? '') ||
      item.task_type === 'guided_explain',
  )

  const challenge = (challengeSource.length ? challengeSource : traces).slice(0, 8).map<SampleRecord>((item) => ({
    id: `challenge:${item.session_id}`,
    type: 'challenge',
    title: `${formatTaskType(item.task_type)} / 挑战升级`,
    summary: item.last_error_code ? '挑战链路触发异常，建议优先复核。' : '挑战流程已形成升级线索，可进入升级样本池。',
    createdAt: item.created_at,
    owner: traceOwner(item, teachers, students),
    status: item.last_error_code ? 'needs_review' : 'unprocessed',
    reward: item.last_error_code ? 'negative' : 'pending',
    tags: [contextModeLabel(item.context_mode), `${item.pipeline_stages.length} 阶段`, item.last_error_code ? '异常' : '待确认'],
    detail: [
      `会话 ${item.session_id.slice(0, 8)} 可作为挑战升级候选。`,
      `当前链路阶段：${item.pipeline_stages.join(' / ') || '未记录阶段'}。`,
      item.last_error_code ? `最近错误：${item.last_error_code}` : '建议结合教师复核决定是否正式升级。',
    ],
  }))

  const answer = results.slice(0, 10).map<SampleRecord>((item) => ({
    id: `answer:${item.result_id}`,
    type: 'answer',
    title: resultTitle(item),
    summary: item.review_status === 'accepted' ? '已被接受，可作为正向偏好样本。' : '存在编辑或拒绝动作，可进入偏好标注。',
    createdAt: item.created_at ?? '',
    owner: `会话 ${item.session_id.slice(0, 8)}`,
    status: item.review_status === 'accepted' ? 'confirmed' : 'needs_review',
    reward: item.review_status === 'accepted' ? 'positive' : item.review_status === 'rejected' ? 'negative' : 'neutral',
    tags: [formatTaskType(item.result_type), reviewStatusLabel(item.review_status)],
    detail: [
      `结果 ${item.result_id.slice(0, 8)} 来自 ${formatTaskType(item.result_type)}。`,
      `当前审校状态：${reviewStatusLabel(item.review_status)}。`,
      '可继续标注为教师确认偏好、需编辑或拒绝答案。',
    ],
  }))

  const thinkSource = traces.filter(
    (item) => item.pipeline_stages.length >= 4 || item.context_mode !== 'default' || Boolean(item.last_error_code),
  )

  const think = (thinkSource.length ? thinkSource : traces).slice(0, 8).map<SampleRecord>((item) => ({
    id: `think:${item.session_id}`,
    type: 'think',
    title: `${formatTaskType(item.task_type)} / 思维审计`,
    summary: item.last_error_code ? '复杂链路伴随错误，适合作为审计案例。' : '链路较长，可进入推理审计样本。',
    createdAt: item.created_at,
    owner: traceOwner(item, teachers, students),
    status: item.last_error_code ? 'needs_review' : 'unprocessed',
    reward: 'pending',
    tags: [contextModeLabel(item.context_mode), `${item.pipeline_stages.length} 阶段`, `${item.event_count} 事件`],
    detail: [
      `会话经历 ${item.pipeline_stages.length} 个阶段。`,
      `事件数 ${item.event_count}，上下文模式为 ${contextModeLabel(item.context_mode)}。`,
      item.last_error_code ? `最近错误：${item.last_error_code}` : '适合作为链路质量与推理深度审计样本。',
    ],
  }))

  return { bloom, challenge, answer, think } satisfies Record<SampleType, SampleRecord[]>
}

function Surface({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={[
        'rounded-[24px] border border-black/8 bg-white/92 shadow-[0_18px_40px_rgba(16,56,72,0.06)] backdrop-blur',
        className ?? '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-4 border-b border-black/6 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-primary">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className={['px-5 py-5', bodyClassName ?? ''].join(' ')}>{children}</div>
    </section>
  )
}

function CompactMetric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[22px] border border-black/8 bg-[#f8f4ed] px-4 py-4 shadow-[0_12px_28px_rgba(16,56,72,0.04)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">{label}</div>
      <div className="mt-3 text-[1.9rem] font-semibold tracking-[-0.05em] text-primary">{value}</div>
      <div className="mt-1 text-sm leading-6 text-on-surface-variant">{note}</div>
    </div>
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
        'inline-flex min-h-[42px] items-center justify-center rounded-xl border px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary'
          ? 'border-[#103848] bg-[#103848] text-white hover:bg-[#0d3140]'
          : tone === 'secondary'
            ? 'border-[#103848]/10 bg-[#f3ede2] text-primary hover:bg-[#ece3d3]'
            : 'border-black/8 bg-white text-on-surface-variant hover:border-[#103848]/12 hover:text-primary',
        props.className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-[86px] items-center justify-between gap-4 rounded-xl border border-black/8 bg-[#f8f4ed] px-4 py-4 text-left transition hover:border-[#103848]/10 hover:bg-white"
    >
      <div>
        <div className="text-sm font-medium text-primary">{title}</div>
        <div className="mt-1 text-sm text-on-surface-variant">{description}</div>
      </div>
      <span className={`inline-flex h-7 min-w-[56px] items-center rounded-full p-1 transition ${checked ? 'bg-[#103848]' : 'bg-[#dcd4c7]'}`}>
        <span className={`h-5 w-5 rounded-full bg-white transition ${checked ? 'translate-x-[28px]' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}

function CodeEditor({
  title,
  value,
  description,
  busy,
  onChange,
  onSave,
}: {
  title: string
  value: string
  description: string
  busy: boolean
  onChange: (value: string) => void
  onSave: () => Promise<void>
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-4">
      <div className="text-sm font-medium text-primary">{title}</div>
      <div className="mt-1 text-sm text-on-surface-variant">{description}</div>
      <textarea
        className="mt-4 h-64 w-full rounded-xl border border-black/8 bg-[#f8f4ed] px-4 py-3 font-mono text-sm leading-6 text-on-surface outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-3">
        <ActionButton tone="secondary" onClick={() => void onSave()} disabled={busy}>
          {busy ? '保存中...' : `保存${title}`}
        </ActionButton>
      </div>
    </div>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${tone ?? 'border-black/8 bg-[#f3ede2] text-on-surface-variant'}`}
    >
      {children}
    </span>
  )
}

function SignalPill({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-full border border-[#103848]/10 bg-white/92 px-3 py-1.5 shadow-[0_10px_24px_rgba(16,56,72,0.05)]">
      <div className="text-[10px] font-medium tracking-[0.16em] text-on-surface-variant">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-primary">{value}</div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  title,
  note,
}: {
  active: boolean
  onClick: () => void
  title: string
  note: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-[18px] border px-3.5 py-3 text-left transition',
        active
          ? 'border-[#103848]/16 bg-[#103848] text-white shadow-[0_16px_36px_rgba(16,56,72,0.14)]'
          : 'border-black/8 bg-[#fbf8f2] text-on-surface hover:border-[#103848]/10 hover:bg-white',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className={`mt-1 text-[11px] leading-5 ${active ? 'text-white/72' : 'text-on-surface-variant'}`}>{note}</div>
        </div>
        <span className={`text-[11px] ${active ? 'text-white/72' : 'text-on-surface-variant'}`}>进入</span>
      </div>
    </button>
  )
}

function LoadingGate({ isReady, role, token }: { isReady: boolean; role: string | null; token: string | null }) {
  if (!isReady) {
    return <section className="flex min-h-[60vh] items-center justify-center text-slate-700">正在加载管理员工作台...</section>
  }

  if (role && role !== 'admin') {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">当前账号不是管理员身份</h1>
          <p className="mt-3 text-sm text-slate-500">请切换到管理员账号后查看校级治理工作台。</p>
        </div>
      </section>
    )
  }

  if (!token) {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">请先登录管理员账号</h1>
        </div>
      </section>
    )
  }

  return null
}

function OverviewPanel({
  metricItems,
  bloomBuckets,
  traces,
  teacherLoad,
  teacherFilter,
  setTeacherFilter,
  setActivePanel,
  setManualSelectedSession,
}: {
  metricItems: Array<{ label: string; value: string; note: string }>
  bloomBuckets: Array<{ level: string; count: number }>
  traces: TraceSummary[]
  teacherLoad: Array<{ teacher: TeacherAccount; studentCount: number }>
  teacherFilter: string
  setTeacherFilter: (value: string) => void
  setActivePanel: (value: AdminPanel) => void
  setManualSelectedSession: (value: string) => void
}) {
  const maxBloom = Math.max(...bloomBuckets.map((item) => item.count), 1)
  const queue = traces.filter((item) => item.last_error_code).slice(0, 5)
  const teacherPreview = teacherLoad.slice(0, 3)
  const selectedTeacher = teacherFilter === 'all' ? null : teacherLoad.find((item) => item.teacher.user_id === teacherFilter)?.teacher
  const scopeLabel = selectedTeacher ? selectedTeacher.display_name : '全校'

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {metricItems.map((item) => (
          <CompactMetric key={item.label} label={item.label} value={item.value} note={item.note} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_340px]">
        <Surface
          title="认知层级分布"
          subtitle={`${scopeLabel}当前会话的层级统计`}
          actions={
            <label className="block">
              <span className="sr-only">教师筛选</span>
              <select
                className="min-h-[42px] rounded-xl border border-black/8 bg-[#f8f4ed] px-3 py-2 text-sm text-on-surface outline-none"
                value={teacherFilter}
                onChange={(event) => setTeacherFilter(event.target.value)}
              >
                <option value="all">全校</option>
                {teacherLoad.map((item) => (
                  <option key={item.teacher.user_id} value={item.teacher.user_id}>
                    {item.teacher.display_name}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <div className="space-y-5">
            {bloomBuckets.map((item) => (
              <div key={item.level} className="grid grid-cols-[72px_minmax(0,1fr)_32px] items-center gap-3">
                <div className="text-sm font-medium text-on-surface">{formatBloom(item.level)}</div>
                <div className="h-2.5 rounded-full bg-[#ece3d3]">
                  <div
                    className="h-2.5 rounded-full bg-[#103848] transition-all"
                    style={{ width: `${Math.max((item.count / maxBloom) * 100, item.count ? 14 : 6)}%` }}
                  />
                </div>
                <div className="text-right text-sm text-on-surface-variant">{item.count}</div>
              </div>
            ))}
            <div className="rounded-[20px] border border-black/8 bg-[#f8f4ed] px-4 py-4 text-sm leading-7 text-on-surface-variant">
              统计口径：{scopeLabel} · 会话 {traces.length} 条
            </div>
          </div>
        </Surface>

        <div className="space-y-5">
          <Surface title="教师覆盖" subtitle="教师与学生绑定情况。">
            <div className="space-y-3">
              {teacherPreview.map((item) => (
                <div
                  key={item.teacher.user_id}
                  className={[
                    'flex items-center justify-between rounded-[18px] border px-4 py-3',
                    teacherFilter === item.teacher.user_id ? 'border-[#103848]/16 bg-white shadow-[0_12px_24px_rgba(16,56,72,0.06)]' : 'border-black/8 bg-[#f8f4ed]',
                  ].join(' ')}
                >
                  <div>
                    <div className="text-sm font-semibold text-primary">{nameLabel(item.teacher.display_name)}</div>
                    <div className="mt-1 text-xs text-on-surface-variant">@{item.teacher.username}</div>
                  </div>
                  <Badge>{item.studentCount} 名学生</Badge>
                </div>
              ))}
              {!teacherPreview.length ? <div className="rounded-xl border border-dashed border-black/8 px-4 py-5 text-sm text-on-surface-variant">当前没有教师数据。</div> : null}
            </div>
          </Surface>

          <Surface
            title="待处理队列"
            subtitle={`${scopeLabel}范围内的异常会话`}
            actions={<ActionButton onClick={() => setActivePanel('audit')}>进入审计</ActionButton>}
          >
            <div className="space-y-3">
              {queue.map((item) => (
                <button
                  key={item.session_id}
                  type="button"
                  onClick={() => {
                    setManualSelectedSession(item.session_id)
                    setActivePanel('audit')
                  }}
                  className="w-full rounded-[18px] border border-black/8 bg-[#fbf8f2] px-4 py-3 text-left transition hover:border-[#103848]/12 hover:bg-white"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-primary">{formatTaskType(item.task_type)}</div>
                    <Badge tone={badgeTone('异常')}>异常</Badge>
                  </div>
                  <div className="mt-2 text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                  <div className="mt-2 text-sm text-on-surface-variant">{item.last_error_code}</div>
                </button>
              ))}
              {!queue.length ? <div className="rounded-xl border border-dashed border-black/8 px-4 py-5 text-sm text-on-surface-variant">当前没有阻塞型异常，可直接进入数据工坊。</div> : null}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}

function AuditPanel({
  traces,
  selectedTrace,
  relatedResults,
  detail,
  teachers,
  students,
  onSelect,
}: {
  traces: TraceSummary[]
  selectedTrace: TraceSummary | null
  relatedResults: ResultRecord[]
  detail: Awaited<ReturnType<typeof getAdminTraceDetail>> | undefined
  teachers: TeacherAccount[]
  students: StudentAccount[]
  onSelect: (value: string) => void
}) {
  const issueQueue = traces.filter((item) => item.last_error_code)
  const baseQueue = (issueQueue.length ? issueQueue : traces).slice(0, 6)
  const queueItems =
    selectedTrace && !baseQueue.some((item) => item.session_id === selectedTrace.session_id)
      ? [selectedTrace, ...baseQueue].slice(0, 6)
      : baseQueue
  const recentStages = (detail?.stage_summary ?? []).slice(-4)
  const recentResults = relatedResults.slice(0, 3)

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Surface
        title="待处理会话"
        subtitle="异常优先，按最近时间排序。"
        bodyClassName="max-h-[720px] space-y-3 overflow-auto pr-1"
      >
        <div className="space-y-3">
          {queueItems.map((item) => {
            const active = item.session_id === selectedTrace?.session_id
            return (
              <button
                key={item.session_id}
                type="button"
                onClick={() => onSelect(item.session_id)}
                className={[
                  'w-full rounded-xl border px-4 py-3 text-left transition',
                  active ? 'border-[#103848]/16 bg-[#103848] text-white' : 'border-black/8 bg-[#fbf8f2] hover:border-[#103848]/12 hover:bg-white',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{formatTaskType(item.task_type)}</div>
                    <div className={`mt-1 line-clamp-1 text-xs ${active ? 'text-white/72' : 'text-on-surface-variant'}`}>
                      {traceOwner(item, teachers, students)}
                    </div>
                  </div>
                  <Badge tone={active ? 'border-white/12 bg-white/10 text-white' : badgeTone(item.last_error_code ? '异常' : '正常')}>
                    {item.last_error_code ? '异常' : '正常'}
                  </Badge>
                </div>
                <div className={`mt-3 flex items-center justify-between gap-3 text-xs ${active ? 'text-white/72' : 'text-on-surface-variant'}`}>
                  <span>{formatBloom(item.current_bloom_level)}</span>
                  <span>{formatTime(item.created_at)}</span>
                </div>
              </button>
            )
          })}
          {!queueItems.length ? <div className="rounded-xl border border-dashed border-black/8 px-4 py-5 text-sm text-on-surface-variant">当前没有可处理的会话。</div> : null}
        </div>
      </Surface>

      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <CompactMetric label="当前阶段" value={String(selectedTrace?.pipeline_stages.length ?? 0)} note="只看链路是否过长" />
          <CompactMetric label="关联结果" value={String(relatedResults.length)} note="当前会话产出的可回看结果" />
        </div>

        <Surface
          title={selectedTrace ? `${formatTaskType(selectedTrace.task_type)} / ${selectedTrace.session_id.slice(0, 8)}` : '未选择会话'}
          subtitle={selectedTrace ? '会话摘要、阶段记录与关联结果。' : '从左侧队列选择会话。'}
          bodyClassName="space-y-4"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(selectedTrace?.pipeline_stages ?? []).map((stage) => (
                <Badge key={stage}>{stageLabel(stage)}</Badge>
              ))}
              {!selectedTrace?.pipeline_stages.length ? <Badge>暂无阶段信息</Badge> : null}
            </div>

            <div className="rounded-[20px] border border-black/8 bg-[#f8f4ed] px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={badgeTone(selectedTrace?.last_error_code ? '异常' : '正常')}>{selectedTrace?.last_error_code ? '异常会话' : '正常会话'}</Badge>
                <Badge>{contextModeLabel(selectedTrace?.context_mode)}</Badge>
              </div>
              <div className="mt-3 text-sm leading-7 text-on-surface-variant">{selectedTrace?.last_error_code ? `最近错误：${selectedTrace.last_error_code}` : '当前没有错误码。'}</div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-primary">最近阶段</div>
              {recentStages.map((item) => (
                <div key={`${item.stage}-${item.created_at}`} className="rounded-xl border border-black/8 bg-[#fbf8f2] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-primary">{stageLabel(item.stage)}</div>
                    <div className="text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{actorLabel(item.actor)}</Badge>
                    <Badge>{formatBloom(item.bloom_level)}</Badge>
                    <Badge tone={badgeTone(item.error_code ? '异常' : '正常')}>{item.error_code ?? '正常'}</Badge>
                  </div>
                </div>
              ))}
              {!recentStages.length ? <div className="rounded-xl border border-dashed border-black/8 px-4 py-5 text-sm text-on-surface-variant">当前会话没有可展示的阶段记录。</div> : null}
            </div>

            <div className="space-y-3 border-t border-black/6 pt-4">
              <div className="text-sm font-semibold text-primary">关联结果</div>
              {recentResults.map((item) => (
                <div key={item.result_id} className="rounded-xl border border-black/8 bg-[#fbf8f2] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium text-primary">{resultTitle(item)}</div>
                      <div className="mt-1 text-xs text-on-surface-variant">
                        {formatTaskType(item.result_type)} · {formatTime(item.created_at)}
                      </div>
                    </div>
                    <Badge tone={badgeTone(reviewStatusLabel(item.review_status))}>{reviewStatusLabel(item.review_status)}</Badge>
                  </div>
                </div>
              ))}
              {!relatedResults.length ? <div className="rounded-xl border border-dashed border-black/8 px-4 py-5 text-sm text-on-surface-variant">当前会话还没有可显示的输出结果。</div> : null}
            </div>
          </div>
        </Surface>
      </div>
    </div>
  )
}

function SettingsPanel({
  snapshot,
  skillItems,
  latestConfig,
  governanceDraft,
  setGovernanceDraft,
  busyAction,
  onReload,
  onApplyGovernance,
  showAdvanced,
  setShowAdvanced,
  mcpDraft,
  setMcpDraft,
  skillsDraft,
  setSkillsDraft,
  onSaveConfig,
}: {
  snapshot: Awaited<ReturnType<typeof getAdminSkillsSnapshot>> | undefined
  skillItems: Array<Awaited<ReturnType<typeof getAdminSkillsSnapshot>>['skills'][string]>
  latestConfig: AdminConfigItem | null
  governanceDraft: GovernanceDraft
  setGovernanceDraft: React.Dispatch<React.SetStateAction<GovernanceDraft>>
  busyAction: string
  onReload: () => Promise<void>
  onApplyGovernance: () => Promise<void>
  showAdvanced: boolean
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>
  mcpDraft: string
  setMcpDraft: React.Dispatch<React.SetStateAction<string>>
  skillsDraft: string
  setSkillsDraft: React.Dispatch<React.SetStateAction<string>>
  onSaveConfig: (configKey: 'mcp' | 'skills') => Promise<void>
}) {
  const healthLabel = skillItems.some((item) => item.last_error) || snapshot?.mcp.last_error ? '需要关注' : '稳定'

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_380px]">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <CompactMetric label="系统状态" value={healthLabel} note={snapshot?.mcp.last_error ?? '当前没有阻塞性错误'} />
          <CompactMetric label="MCP 接入" value={String(snapshot?.mcp.providers.length ?? 0)} note={snapshot?.mcp.enabled ? '已接入外部 provider' : '当前未启用'} />
          <CompactMetric label="Skills 启用" value={String(skillItems.filter((item) => item.enabled).length)} note={`共登记 ${skillItems.length} 个 task`} />
        </div>

        <Surface
          title="治理开关"
          subtitle="学校常用治理策略。"
          actions={<ActionButton onClick={() => void onApplyGovernance()} disabled={busyAction === 'save-governance'}>{busyAction === 'save-governance' ? '保存中...' : '保存治理开关'}</ActionButton>}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ToggleCard title="联网检索" description="学生与教师对话默认允许联网检索。" checked={governanceDraft.web_search_enabled} onChange={(checked) => setGovernanceDraft((current) => ({ ...current, web_search_enabled: checked }))} />
            <ToggleCard title="文件上传" description="允许上传图片、PDF、文档、文本与标记文本。" checked={governanceDraft.file_upload_enabled} onChange={(checked) => setGovernanceDraft((current) => ({ ...current, file_upload_enabled: checked }))} />
            <ToggleCard title="思维审计" description="思维痕迹进入审计通道，教师不可直接查看学生思维。" checked={governanceDraft.think_audit_enabled} onChange={(checked) => setGovernanceDraft((current) => ({ ...current, think_audit_enabled: checked }))} />
            <ToggleCard title="教师发布" description="教师修订后可成为学生默认可见结果。" checked={governanceDraft.teacher_release_required} onChange={(checked) => setGovernanceDraft((current) => ({ ...current, teacher_release_required: checked }))} />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-on-surface-variant">模型策略</div>
              <select className="w-full rounded-xl border border-black/8 bg-[#f8f4ed] px-3 py-3 text-sm text-on-surface outline-none" value={governanceDraft.model_profile} onChange={(event) => setGovernanceDraft((current) => ({ ...current, model_profile: event.target.value as GovernanceDraft['model_profile'] }))}>
                <option value="school-safe">校内稳态优先</option>
                <option value="teacher-priority">教师审校优先</option>
              </select>
            </label>

            <label className="block">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-on-surface-variant">导出策略</div>
              <select className="w-full rounded-xl border border-black/8 bg-[#f8f4ed] px-3 py-3 text-sm text-on-surface outline-none" value={governanceDraft.export_profile} onChange={(event) => setGovernanceDraft((current) => ({ ...current, export_profile: event.target.value as GovernanceDraft['export_profile'] }))}>
                <option value="teacher-confirmed only">仅教师确认样本</option>
                <option value="all audit records">全部审计记录</option>
              </select>
            </label>
          </div>
        </Surface>
      </div>

      <div className="space-y-5 xl:sticky xl:top-6 self-start">
        <Surface
          title="MCP / Skills 状态"
          subtitle="当前 provider 和 task 的运行状态。"
          actions={<ActionButton tone="secondary" onClick={() => void onReload()} disabled={busyAction === 'reload'}>{busyAction === 'reload' ? '刷新中...' : '刷新状态'}</ActionButton>}
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-black/8 bg-[#f8f4ed] px-4 py-4">
              <div className="text-sm font-medium text-primary">MCP providers</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(snapshot?.mcp.providers ?? []).map((provider) => (
                  <Badge key={provider}>{provider}</Badge>
                ))}
                {!snapshot?.mcp.providers.length ? <Badge>暂无 provider</Badge> : null}
              </div>
              <div className="mt-3 text-sm text-on-surface-variant">
                最近 reload：{snapshot?.mcp.last_reload ? formatTime(snapshot.mcp.last_reload) : '暂无'} / hot reload：{snapshot?.mcp.hot_reload ? '开启' : '关闭'}
              </div>
            </div>

            <div className="space-y-2">
              {skillItems.slice(0, 4).map((item) => (
                <div key={item.task_type} className="rounded-xl border border-black/8 bg-[#fbf8f2] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-primary">{item.task_type}</div>
                    <Badge tone={item.enabled ? badgeTone('已确认') : undefined}>{item.enabled ? '已启用' : '已关闭'}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-on-surface-variant">context mode：{item.context_mode}</div>
                  <div className="mt-2 text-sm text-on-surface-variant">{item.last_error ? `最近错误：${item.last_error}` : '最近运行正常。'}</div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <Surface
          title="高级配置"
          subtitle={latestConfig ? `最近一次配置更新时间：${formatTime(latestConfig.updated_at)}` : '仅在排查底层问题时使用。'}
          actions={<ActionButton tone="ghost" onClick={() => setShowAdvanced((current) => !current)}>{showAdvanced ? '收起' : '展开'}</ActionButton>}
        >
          {showAdvanced ? (
            <div className="space-y-4">
              <CodeEditor title="MCP 配置" value={mcpDraft} description="编辑 providers、tool overrides 和 hot reload。" busy={busyAction === 'save-mcp'} onChange={setMcpDraft} onSave={async () => onSaveConfig('mcp')} />
              <CodeEditor title="Skills 配置" value={skillsDraft} description="编辑 task 启用状态和 context mode。" busy={busyAction === 'save-skills'} onChange={setSkillsDraft} onSave={async () => onSaveConfig('skills')} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">展开后可查看底层配置。</div>
          )}
        </Surface>
      </div>
    </div>
  )
}

function DataPanel({
  sampleType,
  setSampleType,
  sampleGroups,
  selectedSample,
  selectedSampleId,
  setSelectedSampleId,
  sampleState,
  onSampleUpdate,
  exportProfile,
  setMessage,
}: {
  sampleType: SampleType
  setSampleType: React.Dispatch<React.SetStateAction<SampleType>>
  sampleGroups: Record<SampleType, SampleRecord[]>
  selectedSample: SampleRecord | null
  selectedSampleId: string
  setSelectedSampleId: React.Dispatch<React.SetStateAction<string>>
  sampleState: Record<string, { status: SampleRecord['status']; reward: SampleRecord['reward'] }>
  onSampleUpdate: (sample: SampleRecord, next: Partial<{ status: SampleRecord['status']; reward: SampleRecord['reward'] }>) => void
  exportProfile: GovernanceDraft['export_profile']
  setMessage: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const activeSamples = sampleGroups[sampleType]

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
      <Surface title="样本类型" subtitle="先选样本类型，再处理列表与详情。" className="xl:sticky xl:top-6 self-start">
        <div className="space-y-3">
          {(Object.entries(SAMPLE_META) as Array<[SampleType, { label: string; note: string }]>).map(([key, meta]) => (
            <button
                key={key}
                type="button"
                onClick={() => setSampleType(key)}
                className={[
                  'w-full rounded-xl border px-4 py-4 text-left transition',
                  sampleType === key ? 'border-[#103848]/16 bg-[#103848] text-white' : 'border-black/8 bg-[#fbf8f2] hover:border-[#103848]/12 hover:bg-white',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{meta.label}</div>
                  <div className={`text-xs ${sampleType === key ? 'text-white/72' : 'text-on-surface-variant'}`}>{sampleGroups[key].length}</div>
                </div>
                <div className={`mt-2 text-xs ${sampleType === key ? 'text-white/72' : 'text-on-surface-variant'}`}>{meta.note}</div>
              </button>
            ))}
          </div>
      </Surface>

      <Surface title={SAMPLE_META[sampleType].label} subtitle={SAMPLE_META[sampleType].note}>
        <div className="max-h-[620px] space-y-3 overflow-auto pr-1">
            {activeSamples.map((item) => {
              const currentStatus = sampleState[item.id]?.status ?? item.status
              const currentReward = sampleState[item.id]?.reward ?? item.reward
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedSampleId(item.id)}
                  className={[
                    'w-full rounded-[18px] border px-4 py-4 text-left transition',
                    selectedSampleId === item.id ? 'border-[#103848]/16 bg-[#103848] text-white' : 'border-black/8 bg-[#fbf8f2] hover:border-[#103848]/12 hover:bg-white',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className={`mt-1 text-xs ${selectedSampleId === item.id ? 'text-white/72' : 'text-on-surface-variant'}`}>{item.summary}</div>
                    </div>
                    <div className={`text-xs ${selectedSampleId === item.id ? 'text-white/72' : 'text-on-surface-variant'}`}>{formatTime(item.createdAt)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={selectedSampleId === item.id ? 'border-white/12 bg-white/10 text-white' : badgeTone(statusLabel(currentStatus))}>{statusLabel(currentStatus)}</Badge>
                    <Badge tone={selectedSampleId === item.id ? 'border-white/12 bg-white/10 text-white' : badgeTone(rewardLabel(currentReward))}>{rewardLabel(currentReward)}</Badge>
                  </div>
                </button>
              )
            })}
        </div>
      </Surface>

      <div className="space-y-5 xl:sticky xl:top-6 self-start">
        <Surface title={selectedSample?.title ?? '未选择样本'} subtitle={selectedSample ? selectedSample.owner : '从中间列表选择样本后，这里显示详情。'}>
          {selectedSample ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {selectedSample.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
              <div className="space-y-3">
                {selectedSample.detail.map((line) => (
                  <div key={line} className="rounded-xl border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm text-on-surface-variant">{line}</div>
                ))}
              </div>
              <div className="space-y-2">
                <ActionButton tone="secondary" onClick={() => onSampleUpdate(selectedSample, { reward: 'positive', status: 'confirmed' })}>标为高价值</ActionButton>
                <ActionButton tone="ghost" onClick={() => onSampleUpdate(selectedSample, { reward: 'neutral', status: 'needs_review' })}>转入复核</ActionButton>
                <ActionButton tone="ghost" onClick={() => onSampleUpdate(selectedSample, { reward: 'negative', status: 'exported' })}>标为拒绝</ActionButton>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">请选择一个样本。</div>
          )}
        </Surface>

        <Surface title="导出入口" subtitle="训练数据导出与批次管理。">
          <div className="space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 px-4 py-3">导出策略：{exportProfile === 'teacher-confirmed only' ? '仅导出教师确认样本' : '导出全部审计记录'}</div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">{selectedSample ? `${selectedSample.title} 已可加入导出批次。` : '选择样本后可加入导出批次。'}</div>
            <ActionButton
              onClick={() => {
                if (!selectedSample) {
                  setMessage('请先选择一个样本。')
                  return
                }
                onSampleUpdate(selectedSample, { status: 'exported' })
                setMessage(`已将 ${selectedSample.title} 加入训练数据导出批次。`)
              }}
            >
              加入导出批次
            </ActionButton>
          </div>
        </Surface>
      </div>
    </div>
  )
}

export function AdminWorkspace({ initialPanel = 'overview', initialSession = '' }: AdminWorkspaceProps) {
  const { token, role, isReady } = useSession()
  const [mounted, setMounted] = useState(false)
  const [activePanel, setActivePanel] = useState<AdminPanel>(initialPanel)
  const [teacherFilter, setTeacherFilter] = useState('all')
  const [manualSelectedSession, setManualSelectedSession] = useState<string | null>(null)
  const [sampleType, setSampleType] = useState<SampleType>('bloom')
  const [selectedSampleId, setSelectedSampleId] = useState('')
  const [sampleState, setSampleState] = useState<Record<string, { status: SampleRecord['status']; reward: SampleRecord['reward'] }>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [mcpDraft, setMcpDraft] = useState('')
  const [skillsDraft, setSkillsDraft] = useState('')
  const [draftsInitialized, setDraftsInitialized] = useState(false)
  const [governanceDraft, setGovernanceDraft] = useState<GovernanceDraft>({
    web_search_enabled: true,
    file_upload_enabled: true,
    think_audit_enabled: true,
    teacher_release_required: true,
    export_profile: 'teacher-confirmed only',
    model_profile: 'school-safe',
  })

  const tracesQuery = useSWR(token && role === 'admin' ? ['admin-traces', token] : null, ([, currentToken]) => listAdminTraces(currentToken))
  const resultsQuery = useSWR(token && role === 'admin' ? ['admin-results', token] : null, ([, currentToken]) => listAdminResults(currentToken))
  const snapshotQuery = useSWR(token && role === 'admin' ? ['admin-skills-snapshot', token] : null, ([, currentToken]) => getAdminSkillsSnapshot(currentToken))
  const teachersQuery = useSWR(token && role === 'admin' ? ['admin-teachers', token] : null, ([, currentToken]) => listTeachers(currentToken))
  const studentsQuery = useSWR(token && role === 'admin' ? ['admin-students', token] : null, ([, currentToken]) => listStudents(currentToken))

  const traces = tracesQuery.data ?? EMPTY_TRACES
  const results = resultsQuery.data ?? EMPTY_RESULTS
  const snapshot = snapshotQuery.data
  const teachers = teachersQuery.data ?? EMPTY_TEACHERS
  const students = studentsQuery.data ?? EMPTY_STUDENTS

  useEffect(() => {
    setActivePanel(initialPanel)
  }, [initialPanel])

  useEffect(() => {
    if (!snapshot || draftsInitialized) return
    const mcpConfig = snapshot.admin_configs.find((item) => item.config_key === 'mcp')
    const skillsConfig = snapshot.admin_configs.find((item) => item.config_key === 'skills')
    const capabilityConfig = snapshot.admin_configs.find((item) => item.config_key === 'capabilities')

    setMcpDraft(prettyJson(sanitizeMcpDraft(mcpConfig?.config_json ?? snapshot.mcp)))
    setSkillsDraft(prettyJson(skillsConfig?.config_json ?? snapshot.skills))
    if (capabilityConfig?.config_json) {
      setGovernanceDraft((current) => ({ ...current, ...(capabilityConfig.config_json as Partial<GovernanceDraft>) }))
    }
    setDraftsInitialized(true)
  }, [draftsInitialized, snapshot])

  const teacherLoad = useMemo(() => buildTeacherLoad(teachers, students), [teachers, students])
  const sampleGroups = useMemo(() => buildSampleRecords(traces, results, teachers, students), [traces, results, teachers, students])
  const filteredTraceIds = useMemo(() => {
    if (teacherFilter === 'all') return new Set(traces.map((item) => item.session_id))
    const ownedStudentIds = new Set(students.filter((item) => item.teacher_id === teacherFilter).map((item) => item.user_id))
    return new Set(
      traces
        .filter((item) => item.user_id === teacherFilter || (item.user_id ? ownedStudentIds.has(item.user_id) : false))
        .map((item) => item.session_id),
    )
  }, [teacherFilter, students, traces])

  const prioritizedTraces = useMemo(() => {
    const items = traces.filter((item) => filteredTraceIds.has(item.session_id))
    return items.sort((left, right) => {
      if (Boolean(left.last_error_code) !== Boolean(right.last_error_code)) return left.last_error_code ? -1 : 1
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })
  }, [filteredTraceIds, traces])
  const overviewTraces = useMemo(() => traces.filter((item) => filteredTraceIds.has(item.session_id)), [filteredTraceIds, traces])

  const selectedSession = manualSelectedSession || initialSession || prioritizedTraces[0]?.session_id || null
  const selectedTrace = prioritizedTraces.find((item) => item.session_id === selectedSession) ?? prioritizedTraces[0] ?? null
  const relatedResults = useMemo(() => results.filter((item) => item.session_id === selectedSession).slice(0, 6), [results, selectedSession])
  const detailQuery = useSWR(token && selectedSession ? ['admin-trace-detail', token, selectedSession] : null, ([, currentToken, sessionId]) => getAdminTraceDetail(currentToken, sessionId))
  const latestConfig = useMemo<AdminConfigItem | null>(() => {
    if (!snapshot?.admin_configs.length) return null
    return snapshot.admin_configs.reduce((latest, item) =>
      new Date(item.updated_at).getTime() > new Date(latest.updated_at).getTime() ? item : latest,
    )
  }, [snapshot?.admin_configs])

  const metricItems = [
    { label: '待处理异常', value: String(overviewTraces.filter((item) => item.last_error_code).length), note: '当前筛选范围内的问题会话' },
    { label: '教师覆盖', value: String(teachers.length), note: students.length ? `当前覆盖 ${students.length} 名学生` : '尚未拉取到学生列表' },
    { label: '范围会话', value: String(overviewTraces.length), note: '当前筛选范围内的会话数量' },
  ]

  const skillItems = Object.values(snapshot?.skills ?? {})
  const activeSamples = sampleGroups[sampleType]
  const selectedSample = activeSamples.find((item) => item.id === selectedSampleId) ?? activeSamples[0] ?? null

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!activeSamples.length) {
      setSelectedSampleId('')
      return
    }
    if (!activeSamples.some((item) => item.id === selectedSampleId)) {
      setSelectedSampleId(activeSamples[0].id)
    }
  }, [activeSamples, selectedSampleId])

  const gate = !mounted ? <section className="flex min-h-[60vh] items-center justify-center text-slate-700">正在加载管理员工作台...</section> : LoadingGate({ isReady, role, token })
  if (gate) return gate

  const handleSaveConfig = async (configKey: 'mcp' | 'skills') => {
    try {
      setBusyAction(`save-${configKey}`)
      setError(null)
      const draft = configKey === 'mcp' ? mcpDraft : skillsDraft
      const parsed = JSON.parse(draft) as Record<string, unknown>
      const response = await upsertAdminConfig(token!, { config_key: configKey, config_json: parsed })
      setMessage(response.message ?? `${configKey} 配置已更新。`)
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '保存配置失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleApplyGovernance = async () => {
    try {
      setBusyAction('save-governance')
      setError(null)
      await upsertAdminConfig(token!, { config_key: 'capabilities', config_json: governanceDraft })
      setMessage('治理开关已保存到演示配置。')
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '保存治理开关失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleReload = async () => {
    try {
      setBusyAction('reload')
      setError(null)
      const response = await reloadAdminSkills(token!)
      setMessage(response.message ?? '系统状态已刷新。')
      await snapshotQuery.mutate((current) => (current ? { ...current, mcp: response.mcp, skills: response.skills } : current), { revalidate: false })
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '刷新系统状态失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleSampleUpdate = (sample: SampleRecord, next: Partial<{ status: SampleRecord['status']; reward: SampleRecord['reward'] }>) => {
    setSampleState((current) => ({
      ...current,
      [sample.id]: {
        status: next.status ?? current[sample.id]?.status ?? sample.status,
        reward: next.reward ?? current[sample.id]?.reward ?? sample.reward,
      },
    }))
    setMessage('样本标签已更新，当前仍为演示态本地标注。')
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-[28px] border border-black/8 bg-[linear-gradient(180deg,#fffaf2_0%,#f5ede2_100%)] px-5 py-4 shadow-[0_24px_56px_rgba(16,56,72,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-[11px] font-semibold tracking-[0.24em] text-on-surface-variant">学校治理工作台</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="font-headline text-[1.9rem] leading-[1.06] text-primary">{PANEL_LABELS[activePanel].title}</h1>
                  <p className="text-sm leading-6 text-on-surface-variant">{PANEL_LABELS[activePanel].note}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SignalPill label="异常会话" value={metricItems[0]?.value ?? '0'} />
                <SignalPill label="范围会话" value={metricItems[2]?.value ?? '0'} />
              </div>
            </div>
          </section>

          {activePanel === 'overview' ? <OverviewPanel metricItems={metricItems} bloomBuckets={buildBloomBuckets(overviewTraces)} traces={overviewTraces} teacherLoad={teacherLoad} teacherFilter={teacherFilter} setTeacherFilter={setTeacherFilter} setActivePanel={setActivePanel} setManualSelectedSession={setManualSelectedSession} /> : null}
          {activePanel === 'audit' ? <AuditPanel traces={prioritizedTraces} selectedTrace={selectedTrace} relatedResults={relatedResults} detail={detailQuery.data} teachers={teachers} students={students} onSelect={setManualSelectedSession} /> : null}
          {activePanel === 'settings' ? <SettingsPanel snapshot={snapshot} skillItems={skillItems} latestConfig={latestConfig} governanceDraft={governanceDraft} setGovernanceDraft={setGovernanceDraft} busyAction={busyAction} onReload={handleReload} onApplyGovernance={handleApplyGovernance} showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced} mcpDraft={mcpDraft} setMcpDraft={setMcpDraft} skillsDraft={skillsDraft} setSkillsDraft={setSkillsDraft} onSaveConfig={handleSaveConfig} /> : null}
          {activePanel === 'data' ? <DataPanel sampleType={sampleType} setSampleType={setSampleType} sampleGroups={sampleGroups} selectedSample={selectedSample} selectedSampleId={selectedSampleId} setSelectedSampleId={setSelectedSampleId} sampleState={sampleState} onSampleUpdate={handleSampleUpdate} exportProfile={governanceDraft.export_profile} setMessage={setMessage} /> : null}
        </div>

        <section className="rounded-[28px] border border-black/8 bg-white/92 px-5 py-5 shadow-[0_18px_40px_rgba(16,56,72,0.06)] backdrop-blur xl:sticky xl:top-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.22em] text-on-surface-variant">工作区</div>
              <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-primary">常用入口</div>
            </div>
            <Link
              href="/accounts"
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-black/8 bg-white px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:border-[#103848]/12 hover:text-primary"
            >
              账号运营
            </Link>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(Object.entries(PANEL_LABELS) as Array<[AdminPanel, { title: string; note: string }]>).map(([panel, meta]) => (
              <TabButton key={panel} active={activePanel === panel} onClick={() => setActivePanel(panel)} title={meta.title} note={meta.note} />
            ))}
          </div>

          {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        </section>
      </div>
    </div>
  )
}
