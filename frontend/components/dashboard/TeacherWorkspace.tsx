'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import {
  createBloomOverrideEntry,
  createTeacherFeedbackEntry,
  exportResultFile,
  listBloomOverrides,
  listStudents,
  listTeacherFeedback,
  listTeacherMastery,
  listTeacherResults,
  listTeacherStudentSessions,
  reviewTeacherResult,
  runTask,
} from '@/lib/api'
import { BLOOM_OPTIONS, TASK_TYPE_LABELS, TEACHER_TASK_OPTIONS } from '@/lib/constants'
import { formatBloom, formatTaskType, formatTime } from '@/lib/format'
import type { BloomLevel, ResultRecord, SessionInfo, TaskType } from '@/lib/types'

type TeacherWorkspaceProps = {
  mode: 'compose' | 'class' | 'review'
  initialStudent?: string
  initialReviewId?: string
}

type StudentRow = {
  user_id: string
  username: string
  display_name: string
  teacher_id?: string | null
  bloom_level: BloomLevel
  mastery_status: string
  last_error_type: string
  last_inferred_cause: string
}

type ChatMessage = {
  id: string
  role: 'teacher' | 'assistant'
  text: string
  status?: 'running' | 'error'
  result?: ResultRecord | null
  createdAt: string
}

type StudentFilter = 'all' | 'attention' | 'critical' | 'stable'
type QueueFilter = 'all' | TaskType
type ReviewAction = 'accepted' | 'rejected'
type OverviewScope = 'class' | 'school'

const NAV_ITEMS = [
  { mode: 'class', label: '学生总览', href: '/teacher' },
  { mode: 'review', label: '复核队列', href: '/teacher?panel=review' },
  { mode: 'compose', label: '备课生成', href: '/teacher?panel=compose' },
] as const

const COMPOSE_PROMPTS: Record<TaskType, string[]> = {
  question_analysis: [
    '请把《江雪》这道赏析题拆成三步讲给六年级学生。',
    '围绕“春眠不觉晓”设计一组循序渐进的提问。',
    '请把这道古诗文题目的得分路径讲清楚。',
  ],
  lesson_outline: [
    '请为《望庐山瀑布》生成一节二十分钟的课堂提纲。',
    '请围绕“意象”和“情感”设计一节古诗导入课。',
    '请准备一份四年级古诗朗读与理解活动流程。',
  ],
  guided_explain: [
    '请把《夜宿山寺》讲给刚接触古诗的一名学生听。',
    '请针对“借景抒情”做一次循序渐进的引导讲解。',
    '请用教师口吻逐步启发学生理解诗句意思。',
  ],
  general_chat: [],
}

const HINT_LABELS: Record<string, string> = {
  hint_1: '提示一',
  hint_2: '提示二',
  hint_3: '提示三',
  answer: '参考答案',
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function modeMeta(mode: TeacherWorkspaceProps['mode']) {
  if (mode === 'compose') return { eyebrow: '备课与生成', title: '生成讲解、提纲和题解', subtitle: '围绕诗文内容整理课堂讲解、备课提纲和题目解析。' }
  if (mode === 'review') return { eyebrow: '复核队列', title: '处理待复核结果', subtitle: '查看结果内容并完成通过或退回。' }
  return { eyebrow: '教师端', title: '学生总览', subtitle: '切换全校或我班，查看学生状态并处理反馈。' }
}

function previewText(result: ResultRecord | null) {
  if (!result) return '生成后的内容会显示在这里。'
  const content = result.content_json as Record<string, unknown>
  if (typeof content.hint_content === 'string' && content.hint_content.trim()) return content.hint_content
  if (Array.isArray(content.analysis_steps) && content.analysis_steps.length) return content.analysis_steps.join('；')
  if (Array.isArray(content.teaching_goals) && content.teaching_goals.length) return content.teaching_goals.join('；')
  if (typeof content.answer === 'string' && content.answer.trim()) return content.answer
  if (typeof content.question_text === 'string' && content.question_text.trim()) return content.question_text
  return '结果已生成，可在详情区继续查看。'
}

function buildResultTitle(result: ResultRecord | null) {
  if (!result) return '未选择结果'
  const content = result.content_json as Record<string, unknown>
  const title = typeof content.title === 'string' ? content.title.trim() : ''
  return title || TASK_TYPE_LABELS[result.result_type]
}

function resultSections(result: ResultRecord | null): Array<{ title: string; items: string[] }> {
  if (!result) return []
  const content = result.content_json as Record<string, unknown>

  if (result.result_type === 'lesson_outline') {
    const activityFlow = Array.isArray(content.activity_flow)
      ? content.activity_flow
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const entry = item as Record<string, unknown>
            const name = typeof entry.name === 'string' ? entry.name : `步骤 ${String(entry.step ?? '一')}`
            return typeof entry.description === 'string' ? `${name}：${entry.description}` : null
          })
          .filter((item): item is string => Boolean(item))
      : []

    return [
      { title: '教学目标', items: Array.isArray(content.teaching_goals) ? content.teaching_goals.filter((item): item is string => typeof item === 'string') : [] },
      { title: '教学重点', items: Array.isArray(content.key_points) ? content.key_points.filter((item): item is string => typeof item === 'string') : [] },
      { title: '教学难点', items: Array.isArray(content.difficult_points) ? content.difficult_points.filter((item): item is string => typeof item === 'string') : [] },
      { title: '活动流程', items: activityFlow },
    ].filter((section) => section.items.length > 0)
  }

  if (result.result_type === 'question_analysis') {
    const hints = content.hint_ladder && typeof content.hint_ladder === 'object'
      ? ['hint_1', 'hint_2', 'hint_3', 'answer']
          .map((key) => {
            const value = (content.hint_ladder as Record<string, unknown>)[key]
            return typeof value === 'string' ? `${HINT_LABELS[key] ?? key}：${value}` : null
          })
          .filter((item): item is string => Boolean(item))
      : []

    return [
      { title: '解析步骤', items: Array.isArray(content.analysis_steps) ? content.analysis_steps.filter((item): item is string => typeof item === 'string') : [] },
      { title: '分步提示', items: hints },
    ].filter((section) => section.items.length > 0)
  }

  if (result.result_type === 'guided_explain') {
    return [
      { title: '引导讲解', items: typeof content.hint_content === 'string' ? [content.hint_content] : [] },
      { title: '下一步建议', items: typeof content.next_challenge_hint === 'string' ? [content.next_challenge_hint] : [] },
    ].filter((section) => section.items.length > 0)
  }

  if (result.result_type === 'general_chat') {
    return [{ title: '系统回答', items: typeof content.answer === 'string' ? [content.answer] : [] }].filter((section) => section.items.length > 0)
  }

  return []
}

function reviewStatusText(status: string) {
  if (status === 'pending_review') return '待复核'
  if (status === 'accepted') return '已通过'
  if (status === 'rejected') return '已退回'
  if (status === 'edited') return '已修改'
  return status || '未记录'
}

function levelIndex(level: BloomLevel) {
  return BLOOM_OPTIONS.indexOf(level)
}

function taskTypeDescription(taskType: TaskType) {
  if (taskType === 'question_analysis') return '适合把题目拆成路径、提示和答题依据。'
  if (taskType === 'lesson_outline') return '适合快速整理目标、重点和课堂流程。'
  return '适合像教师带学生一样，循序渐进解释知识点。'
}

function formatMasteryStatus(status: string) {
  if (!status) return '暂无记录'
  if (status === 'inferred') return '系统推断'
  if (status === 'confirmed') return '教师确认'
  if (status === 'needs_review') return '待复核'
  return status
}

function isMeaningfulValue(value: string | null | undefined) {
  return Boolean(value) && !['未记录', '未推断', '暂无记录'].includes(value as string)
}

function riskScore(student: StudentRow) {
  let score = Math.max(0, 5 - levelIndex(student.bloom_level))
  if (isMeaningfulValue(student.last_error_type)) score += 2
  if (isMeaningfulValue(student.last_inferred_cause)) score += 2
  if (student.mastery_status.includes('薄弱') || student.mastery_status.includes('待') || student.mastery_status.includes('需')) score += 2
  return score
}

function riskLabel(student: StudentRow) {
  const score = riskScore(student)
  if (score >= 8) return '高关注'
  if (score >= 5) return '需跟进'
  return '稳定'
}

function riskTone(student: StudentRow) {
  const score = riskScore(student)
  if (score >= 8) return 'danger' as const
  if (score >= 5) return 'warning' as const
  return 'success' as const
}

function noteForStudent(student: StudentRow | null) {
  if (!student) return '先从名单中选择一位学生。'
  if (isMeaningfulValue(student.last_inferred_cause)) return student.last_inferred_cause
  if (isMeaningfulValue(student.last_error_type)) return `近期问题：${student.last_error_type}`
  return '当前没有明显风险，可继续观察课堂表现。'
}

function buildSessionTitle(session: SessionInfo) {
  return session.project_title?.trim() || formatTaskType(session.task_type)
}

function SmallTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'ghost' | 'primary' }) {
  const toneClass =
    tone === 'primary' ? 'bg-[#103848] text-white' :
    tone === 'warning' ? 'bg-[#f3e1bf] text-[#6d4b00]' :
    tone === 'danger' ? 'bg-[#f4d4d4] text-[#7a1f1f]' :
    tone === 'success' ? 'bg-[#dcebdc] text-[#245734]' :
    tone === 'ghost' ? 'bg-white/10 text-white' :
    'bg-[#f2ece2] text-on-surface-variant'
  return <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-medium', toneClass)}>{children}</span>
}

function ActionButton({
  children,
  tone = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'secondary' | 'ghost'
}) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center rounded-[18px] border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        tone === 'primary'
          ? 'border-[#103848] bg-[#103848] text-white hover:bg-[#0d3140]'
          : tone === 'secondary'
            ? 'border-[#103848]/10 bg-[#f3ede2] text-primary hover:bg-[#ece3d3]'
            : 'border-black/8 bg-white text-on-surface-variant hover:border-[#103848]/12 hover:text-primary',
        className,
      )}
    >
      {children}
    </button>
  )
}

function SurfacePanel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  compact = false,
}: {
  eyebrow?: string
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <section
      className={cn(
        compact
          ? 'rounded-[24px] border border-black/8 bg-white/94 p-4 shadow-[0_18px_38px_rgba(0,41,65,0.08)]'
          : 'rounded-[26px] border border-black/8 bg-white/92 p-5 shadow-[0_22px_52px_rgba(0,41,65,0.08)]',
        className,
      )}
    >
      {eyebrow || title || description || actions ? (
        <div className={cn('flex flex-col gap-3 md:flex-row md:items-start md:justify-between', compact ? 'mb-4' : 'mb-5')}>
          <div>
            {eyebrow ? <div className="text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">{eyebrow}</div> : null}
            {title ? (
              <h2 className={cn('mt-2 font-headline leading-tight text-primary', compact ? 'text-[1.35rem]' : 'text-[1.8rem]')}>
                {title}
              </h2>
            ) : null}
            {description ? <p className={cn('mt-2 text-on-surface-variant', compact ? 'text-sm leading-6' : 'text-sm leading-7')}>{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-[22px] border border-dashed border-black/10 bg-[#f8f4ed] px-4 py-6 text-sm leading-7 text-on-surface-variant">{text}</div>
}

function ResultDigest({ result }: { result: ResultRecord | null }) {
  const sections = resultSections(result)
  if (!result) return <EmptyState text="当前没有可查看的结果。" />
  return (
    <div className="space-y-4">
      <div className="rounded-[22px] border border-black/8 bg-[#f5efe4] p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
          <span>{formatTaskType(result.result_type)}</span>
          <span>·</span>
          <span>{formatTime(result.created_at)}</span>
          <span>·</span>
          <span>{reviewStatusText(result.review_status)}</span>
        </div>
        <div className="mt-3 text-xl font-semibold text-primary">{buildResultTitle(result)}</div>
        <p className="mt-3 text-sm leading-7 text-on-surface-variant">{previewText(result)}</p>
      </div>
      {sections.map((section) => (
        <div key={section.title} className="rounded-[22px] border border-black/8 bg-white p-5">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">{section.title}</div>
          <div className="mt-3 space-y-2">
            {section.items.map((item, index) => (
              <div key={`${section.title}-${index}`} className="rounded-[18px] bg-[#f7f3eb] px-4 py-3 text-sm leading-7 text-on-surface">{item}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TeacherWorkspace({ mode, initialStudent = '', initialReviewId = '' }: TeacherWorkspaceProps) {
  const { session, token, role, isReady, logout } = useSession()
  const [selectedStudent, setSelectedStudent] = useState(initialStudent)
  const [taskType, setTaskType] = useState<TaskType>('question_analysis')
  const [rawInput, setRawInput] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [showSourceEditor, setShowSourceEditor] = useState(false)
  const [running, setRunning] = useState(false)
  const [latestResult, setLatestResult] = useState<ResultRecord | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [overrideLevel, setOverrideLevel] = useState<BloomLevel>('understand')
  const [overrideNote, setOverrideNote] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [selectedReviewId, setSelectedReviewId] = useState(initialReviewId)
  const [studentKeyword, setStudentKeyword] = useState('')
  const [studentFilter, setStudentFilter] = useState<StudentFilter>('all')
  const [overviewScope, setOverviewScope] = useState<OverviewScope>('school')
  const [reviewKeyword, setReviewKeyword] = useState('')
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')

  const masteryQuery = useSWR(token && role === 'teacher' ? ['teacher-mastery', token, overviewScope] : null, ([, currentToken, scope]) => listTeacherMastery(currentToken, scope))
  const resultsQuery = useSWR(token && role === 'teacher' ? ['teacher-results', token] : null, ([, currentToken]) => listTeacherResults(currentToken))
  const studentsQuery = useSWR(token && role === 'teacher' ? ['teacher-students', token, overviewScope] : null, ([, currentToken, scope]) => listStudents(currentToken, scope))
  const selectedStudentAccount = useMemo(() => (studentsQuery.data ?? []).find((item) => item.user_id === selectedStudent) ?? null, [selectedStudent, studentsQuery.data])
  const canManageSelectedStudent = Boolean(selectedStudentAccount && session?.user.user_id && selectedStudentAccount.teacher_id === session.user.user_id)
  const studentSessionsQuery = useSWR(token && role === 'teacher' && selectedStudent && canManageSelectedStudent ? ['teacher-student-sessions', token, selectedStudent] : null, ([, currentToken, studentId]) => listTeacherStudentSessions(currentToken, studentId))
  const feedbackQuery = useSWR(token && role === 'teacher' && selectedStudent && canManageSelectedStudent ? ['teacher-feedback', token, selectedStudent] : null, ([, currentToken, studentId]) => listTeacherFeedback(currentToken, studentId))
  const overridesQuery = useSWR(token && role === 'teacher' && selectedStudent && canManageSelectedStudent ? ['teacher-overrides', token, selectedStudent] : null, ([, currentToken, studentId]) => listBloomOverrides(currentToken, studentId))

  const resultsData = resultsQuery.data
  const allResults = useMemo(() => resultsData ?? [], [resultsData])
  const pendingResults = useMemo(() => allResults.filter((item) => item.review_status === 'pending_review'), [allResults])
  const reviewedResults = useMemo(() => allResults.filter((item) => item.review_status !== 'pending_review'), [allResults])

  const studentRows: StudentRow[] = useMemo(
    () =>
      (studentsQuery.data ?? []).map((student) => {
        const masteryItem = (masteryQuery.data ?? []).find((item) => item.student_id === student.user_id)
        return {
          ...student,
          bloom_level: masteryItem?.bloom_level ?? 'remember',
          mastery_status: formatMasteryStatus(masteryItem?.mastery_status ?? '暂无记录'),
          last_error_type: masteryItem?.last_error_type ?? '未记录',
          last_inferred_cause: masteryItem?.last_inferred_cause ?? '未推断',
        }
      }),
    [masteryQuery.data, studentsQuery.data],
  )

  const sortedStudents = useMemo(
    () =>
      [...studentRows].sort((left, right) => {
        const riskGap = riskScore(right) - riskScore(left)
        if (riskGap !== 0) return riskGap
        return left.display_name.localeCompare(right.display_name, 'zh-CN')
      }),
    [studentRows],
  )

  const filteredStudents = useMemo(() => {
    const keyword = studentKeyword.trim().toLowerCase()
    return sortedStudents.filter((student) => {
      const matchesKeyword = !keyword || student.display_name.toLowerCase().includes(keyword) || student.username.toLowerCase().includes(keyword) || noteForStudent(student).toLowerCase().includes(keyword)
      if (!matchesKeyword) return false
      const score = riskScore(student)
      if (studentFilter === 'critical') return score >= 8
      if (studentFilter === 'attention') return score >= 5
      if (studentFilter === 'stable') return score < 5
      return true
    })
  }, [sortedStudents, studentFilter, studentKeyword])

  const filteredPendingResults = useMemo(() => {
    const keyword = reviewKeyword.trim().toLowerCase()
    return pendingResults.filter((item) => {
      const matchesType = queueFilter === 'all' || item.result_type === queueFilter
      if (!matchesType) return false
      const haystack = `${buildResultTitle(item)} ${previewText(item)} ${formatTaskType(item.result_type)}`.toLowerCase()
      return !keyword || haystack.includes(keyword)
    })
  }, [pendingResults, queueFilter, reviewKeyword])

  useEffect(() => {
    if (mode === 'compose') return
    if (initialStudent) {
      setSelectedStudent(initialStudent)
      return
    }
    if (!sortedStudents.length) {
      setSelectedStudent('')
      return
    }
    const exists = sortedStudents.some((item) => item.user_id === selectedStudent)
    if (!selectedStudent || !exists) setSelectedStudent(sortedStudents[0].user_id)
  }, [initialStudent, mode, selectedStudent, sortedStudents])

  useEffect(() => {
    if (mode !== 'review') {
      setSelectedReviewId('')
      return
    }
    if (initialReviewId && filteredPendingResults.some((item) => item.result_id === initialReviewId)) {
      setSelectedReviewId(initialReviewId)
      return
    }
    if (!filteredPendingResults.length) {
      setSelectedReviewId('')
      return
    }
    const exists = filteredPendingResults.some((item) => item.result_id === selectedReviewId)
    if (!selectedReviewId || !exists) setSelectedReviewId(filteredPendingResults[0].result_id)
  }, [filteredPendingResults, initialReviewId, mode, selectedReviewId])

  useEffect(() => {
    if (!selectedStudent) return
    const focused = sortedStudents.find((item) => item.user_id === selectedStudent)
    if (focused) setOverrideLevel(focused.bloom_level)
  }, [selectedStudent, sortedStudents])

  if (!isReady) return <section className="flex min-h-[60vh] items-center justify-center rounded-[32px] bg-white text-primary">正在加载教师工作台...</section>

  if (role && role !== 'teacher') {
    return <section className="flex min-h-[60vh] items-center justify-center rounded-[32px] bg-white px-6"><div className="text-center"><h1 className="font-headline text-3xl text-primary">当前账号不是教师身份</h1><p className="mt-3 text-sm text-on-surface-variant">请切换到教师账号，或返回对应角色首页。</p><div className="mt-6"><Link className="rounded-full bg-[#103848] px-5 py-3 text-sm font-semibold text-white" href={role === 'admin' ? '/admin' : '/'}>返回首页</Link></div></div></section>
  }

  if (!token) {
    return <section className="flex min-h-[60vh] items-center justify-center rounded-[32px] bg-white px-6"><div className="text-center"><h1 className="font-headline text-3xl text-primary">请先登录教师账号</h1><div className="mt-6"><Link className="rounded-full bg-[#103848] px-5 py-3 text-sm font-semibold text-white" href="/login">去登录</Link></div></div></section>
  }

  const pageMeta = modeMeta(mode)
  const focusedStudent = sortedStudents.find((item) => item.user_id === selectedStudent) ?? null
  const studentSessions = studentSessionsQuery.data ?? []
  const feedbackItems = feedbackQuery.data ?? []
  const overrideItems = overridesQuery.data ?? []
  const selectedReview = filteredPendingResults.find((item) => item.result_id === selectedReviewId) ?? filteredPendingResults[0] ?? null
  const suggestions = COMPOSE_PROMPTS[taskType]
  const reviewedCount = reviewedResults.length
  const latestGeneratedResult = latestResult ?? [...chatMessages].reverse().find((item) => item.result)?.result ?? null
  const scopeLabel = overviewScope === 'school' ? '全校' : '我班'

  const handleCompose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = rawInput.trim()
    if (!prompt) {
      setMessage('请先写下教学目标或你希望生成的内容。')
      return
    }
    const teacherMessage: ChatMessage = { id: `teacher-${Date.now()}`, role: 'teacher', text: prompt, createdAt: new Date().toISOString() }
    const assistantPlaceholderId = `assistant-${Date.now()}`
    const assistantPlaceholder: ChatMessage = { id: assistantPlaceholderId, role: 'assistant', text: '正在整理内容，请稍候。', status: 'running', createdAt: new Date().toISOString() }
    setRunning(true)
    setMessage(null)
    setChatMessages((current) => [...current, teacherMessage, assistantPlaceholder])
    try {
      const response = await runTask(token, { raw_input: prompt, task_type: taskType, source_text: sourceText.trim() || undefined, web_search_enabled: false })
      setLatestResult(response.result)
      setMessage(response.result ? '内容已生成，可继续调整或导出。' : '本次没有生成结果。')
      setChatMessages((current) => current.map((item) => item.id === assistantPlaceholderId ? { ...item, text: response.result ? `${TASK_TYPE_LABELS[response.result.result_type]}已生成：${buildResultTitle(response.result)}\n\n${previewText(response.result)}` : '这次没有生成内容，请换一种说法再试。', status: undefined, result: response.result, createdAt: new Date().toISOString() } : item))
      setRawInput('')
      await resultsQuery.mutate()
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '生成失败'
      setMessage(nextMessage)
      setChatMessages((current) => current.map((item) => item.id === assistantPlaceholderId ? { ...item, text: nextMessage, status: 'error', createdAt: new Date().toISOString() } : item))
    } finally {
      setRunning(false)
    }
  }

  const handleFeedbackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedStudent) {
      setMessage('请先选择学生，再写反馈。')
      return
    }
    if (!canManageSelectedStudent) {
      setMessage('当前学生不在你的班级，只支持查看。')
      return
    }
    if (!feedback.trim()) {
      setMessage('请先输入反馈内容。')
      return
    }
    try {
      await createTeacherFeedbackEntry(token, { student_id: selectedStudent, content: feedback.trim(), is_ai_assisted: false })
      setFeedback('')
      setMessage('教师反馈已记录。')
      await feedbackQuery.mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存反馈失败')
    }
  }

  const handleOverrideSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedStudent) {
      setMessage('请先选择学生，再调整层级。')
      return
    }
    if (!canManageSelectedStudent) {
      setMessage('当前学生不在你的班级，只支持查看。')
      return
    }
    try {
      await createBloomOverrideEntry(token, { student_id: selectedStudent, bloom_level: overrideLevel, note: overrideNote.trim() || undefined })
      setOverrideNote('')
      setMessage('层级调整已记录。')
      await Promise.all([masteryQuery.mutate(), overridesQuery.mutate()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '记录层级调整失败')
    }
  }

  const handleReview = async (resultId: string, action: ReviewAction) => {
    try {
      await reviewTeacherResult(token, resultId, { review_status: action })
      setMessage(action === 'accepted' ? '结果已通过。' : '结果已退回。')
      await resultsQuery.mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '复核失败')
    }
  }

  const handleExport = async (resultId: string) => {
    try {
      const response = await exportResultFile(token, resultId)
      setMessage(`文件已导出到 ${response.file_path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败')
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6efdf] text-on-surface">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(16,56,72,0.06)_0%,rgba(16,56,72,0)_100%)]" />

      <section className="relative mx-auto max-w-[1480px] px-4 pb-8 pt-5 md:px-6 xl:px-8">
        <header className="rounded-[28px] border border-black/8 bg-white/92 px-5 py-4 text-on-surface shadow-[0_16px_32px_rgba(16,56,72,0.06)] md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold tracking-[0.24em] text-on-surface-variant">{pageMeta.eyebrow}</div>
              <h1 className="mt-2 font-headline text-[2rem] leading-[1.08] text-primary md:text-[2.35rem]">{pageMeta.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant md:text-[15px]">{pageMeta.subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[#f3ebda] p-1.5">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.mode}
                    href={item.href}
                    className={cn(
                      'rounded-[14px] px-4 py-2.5 text-sm font-semibold transition',
                      item.mode === mode ? 'bg-[#103848] text-white shadow-[0_10px_20px_rgba(16,56,72,0.12)]' : 'text-on-surface-variant hover:bg-white hover:text-primary',
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-[14px] border border-black/8 bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition hover:border-[#103848]/12 hover:text-primary"
              >
                退出
              </button>
            </div>
          </div>

        </header>

        {message ? (
          <div className="mt-4 rounded-[22px] border border-[#103848]/10 bg-white/88 px-4 py-3 text-sm text-primary shadow-[0_12px_30px_rgba(0,41,65,0.06)]">
            {message}
          </div>
        ) : null}

        {mode === 'class' ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <SurfacePanel
              compact
              eyebrow="学生清单"
              title="学生列表"
              description={`${scopeLabel}共 ${filteredStudents.length} 名学生`}
            >
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[#f3ebda] p-1.5">
                    {(['school', 'class'] as OverviewScope[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setOverviewScope(value)}
                        className={cn(
                          'rounded-[14px] px-4 py-2 text-sm font-semibold transition',
                          overviewScope === value ? 'bg-[#103848] text-white' : 'text-on-surface-variant hover:bg-white hover:text-primary',
                        )}
                      >
                        {value === 'school' ? '全校' : '我班'}
                      </button>
                    ))}
                  </div>
                  <input
                    className="w-full rounded-[18px] border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm text-on-surface outline-none md:max-w-[280px]"
                    placeholder="搜索学生或账号"
                    value={studentKeyword}
                    onChange={(event) => setStudentKeyword(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'attention', 'critical', 'stable'] as StudentFilter[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStudentFilter(value)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium transition',
                        studentFilter === value ? 'bg-[#103848] text-white' : 'bg-[#f3ebda] text-on-surface-variant hover:bg-[#ece3d3]',
                      )}
                    >
                      {value === 'all' ? '全部' : value === 'attention' ? '需跟进' : value === 'critical' ? '高关注' : '稳定'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-[20px] border border-black/8">
                <div className="hidden grid-cols-[minmax(0,1.2fr)_100px_120px_96px] gap-4 bg-[#f3ebda] px-4 py-3 text-xs font-semibold tracking-[0.08em] text-on-surface-variant md:grid">
                  <div>学生</div>
                  <div>当前层级</div>
                  <div>学习状态</div>
                  <div>风险</div>
                </div>
                <div className="divide-y divide-black/6 bg-white">
                  {filteredStudents.map((student) => (
                    <button
                      key={student.user_id}
                      type="button"
                      onClick={() => setSelectedStudent(student.user_id)}
                      className={cn('w-full px-4 py-4 text-left transition hover:bg-[#fcf8f1]', selectedStudent === student.user_id ? 'bg-[#faf6ee]' : '')}
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_100px_120px_96px] md:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-primary">{student.display_name}</div>
                          <div className="mt-1 text-xs text-on-surface-variant">@{student.username} · {noteForStudent(student)}</div>
                        </div>
                        <div className="text-sm text-on-surface">{formatBloom(student.bloom_level)}</div>
                        <div className="text-sm text-on-surface-variant">{student.mastery_status}</div>
                        <div className="flex md:justify-end">
                          <SmallTag tone={riskTone(student)}>{riskLabel(student)}</SmallTag>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 md:hidden">
                        <SmallTag>{formatBloom(student.bloom_level)}</SmallTag>
                        <SmallTag>{student.mastery_status}</SmallTag>
                      </div>
                    </button>
                  ))}
                  {!filteredStudents.length ? (
                    <div className="p-4">
                      <EmptyState text="当前筛选条件下没有学生。" />
                    </div>
                  ) : null}
                </div>
              </div>
            </SurfacePanel>

            <SurfacePanel
              compact
              eyebrow="学生详情"
              title={focusedStudent?.display_name ?? '未选择学生'}
              description={
                focusedStudent
                  ? canManageSelectedStudent
                    ? `账号 @${focusedStudent.username}`
                    : `账号 @${focusedStudent.username} · 仅查看`
                  : '先从左侧名单中选择一位学生。'
              }
              className="xl:sticky xl:top-5 xl:self-start"
            >
              {focusedStudent ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] bg-[#f8f4ed] px-3 py-3">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">当前层级</div>
                      <div className="mt-2 text-lg font-semibold text-primary">{formatBloom(focusedStudent.bloom_level)}</div>
                    </div>
                    <div className="rounded-[18px] bg-[#f8f4ed] px-3 py-3">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">学习状态</div>
                      <div className="mt-2 text-lg font-semibold text-primary">{focusedStudent.mastery_status}</div>
                    </div>
                    <div className="rounded-[18px] bg-[#f8f4ed] px-3 py-3">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">风险级别</div>
                      <div className="mt-2 text-lg font-semibold text-primary">{riskLabel(focusedStudent)}</div>
                    </div>
                    <div className="rounded-[18px] bg-[#f8f4ed] px-3 py-3">
                      <div className="text-[11px] tracking-[0.16em] text-on-surface-variant">最近会话</div>
                      <div className="mt-2 text-lg font-semibold text-primary">{canManageSelectedStudent ? studentSessions.length : '仅查看'}</div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-black/8 bg-[#fbf8f1] px-4 py-4">
                    <div className="text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">当前判断</div>
                    <div className="mt-2 text-sm leading-7 text-on-surface-variant">{noteForStudent(focusedStudent)}</div>
                  </div>

                  {canManageSelectedStudent ? (
                    <>
                      <div>
                        <div className="text-sm font-semibold text-primary">最近一条学习记录</div>
                        <div className="mt-3 space-y-2">
                          {studentSessions.slice(0, 1).map((session) => (
                            <div key={session.session_id} className="rounded-[16px] bg-[#f8f4ed] px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 truncate text-sm font-medium text-on-surface">{buildSessionTitle(session)}</div>
                                <SmallTag>{formatTaskType(session.task_type)}</SmallTag>
                              </div>
                              <div className="mt-2 text-sm leading-6 text-on-surface-variant">{session.prompt_preview || '暂无预览。'}</div>
                              <div className="mt-2 text-xs text-on-surface-variant">{formatTime(session.created_at)}</div>
                            </div>
                          ))}
                          {!studentSessions.length ? <EmptyState text="当前学生还没有可显示的会话。" /> : null}
                        </div>
                      </div>

                      <div className="border-t border-black/8 pt-4">
                        <div className="text-sm font-semibold text-primary">写反馈</div>
                        <form className="mt-3 space-y-3" onSubmit={handleFeedbackSubmit}>
                          <textarea
                            className="h-28 w-full rounded-[18px] border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm leading-7 text-on-surface outline-none"
                            placeholder="写下要给学生的具体反馈。"
                            value={feedback}
                            onChange={(event) => setFeedback(event.target.value)}
                          />
                          <ActionButton type="submit" className="w-full">
                            提交反馈
                          </ActionButton>
                        </form>
                        <div className="mt-3 space-y-2">
                          {feedbackItems.slice(0, 1).map((item) => (
                            <div key={item.feedback_id} className="rounded-[16px] bg-[#f8f4ed] px-3 py-3 text-sm leading-6 text-on-surface">
                              <div className="text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                              <div className="mt-2">{item.content}</div>
                            </div>
                          ))}
                          {!feedbackItems.length ? <EmptyState text="还没有反馈记录。" /> : null}
                        </div>
                      </div>

                      <div className="border-t border-black/8 pt-4">
                        <div className="text-sm font-semibold text-primary">层级调整</div>
                        <form className="mt-3 space-y-3" onSubmit={handleOverrideSubmit}>
                          <select
                            className="w-full rounded-[18px] border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm text-on-surface outline-none"
                            value={overrideLevel}
                            onChange={(event) => setOverrideLevel(event.target.value as BloomLevel)}
                          >
                            {BLOOM_OPTIONS.map((level) => (
                              <option key={level} value={level}>
                                {formatBloom(level)}
                              </option>
                            ))}
                          </select>
                          <textarea
                            className="h-24 w-full rounded-[18px] border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm leading-7 text-on-surface outline-none"
                            placeholder="记录调整原因。"
                            value={overrideNote}
                            onChange={(event) => setOverrideNote(event.target.value)}
                          />
                          <ActionButton type="submit" tone="secondary" className="w-full">
                            记录层级调整
                          </ActionButton>
                        </form>
                        <div className="mt-3 space-y-2">
                          {overrideItems.slice(0, 1).map((item) => (
                            <div key={item.override_id} className="rounded-[16px] bg-[#f8f4ed] px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-primary">{formatBloom(item.bloom_level)}</div>
                                <div className="text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                              </div>
                              <div className="mt-2 text-sm leading-6 text-on-surface-variant">{item.note || '未填写原因。'}</div>
                            </div>
                          ))}
                          {!overrideItems.length ? <EmptyState text="还没有层级调整记录。" /> : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <EmptyState text="当前学生不在你的班级，可在全校视图中查看状态，切换到我班后可继续记录反馈和调整层级。" />
                  )}
                </div>
              ) : (
                <EmptyState text="先从中间名单中选择一位学生。" />
              )}
            </SurfacePanel>
          </div>
        ) : null}

        {mode === 'review' ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
            <SurfacePanel eyebrow="待复核队列" title="待复核结果" description="查看待复核结果并选择通过或退回。">
              <div className="space-y-3">
                <input
                  className="w-full rounded-[18px] border border-black/8 bg-[#f8f4ed] px-4 py-3 text-sm text-on-surface outline-none"
                  placeholder="搜索结果标题或内容"
                  value={reviewKeyword}
                  onChange={(event) => setReviewKeyword(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setQueueFilter('all')}
                    className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition', queueFilter === 'all' ? 'bg-[#103848] text-white' : 'bg-[#f3ede2] text-on-surface-variant')}
                  >
                    全部
                  </button>
                  {TEACHER_TASK_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setQueueFilter(item)}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition', queueFilter === item ? 'bg-[#103848] text-white' : 'bg-[#f3ede2] text-on-surface-variant')}
                    >
                      {formatTaskType(item)}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {filteredPendingResults.map((item) => (
                    <button
                      key={item.result_id}
                      type="button"
                      onClick={() => setSelectedReviewId(item.result_id)}
                      className={cn(
                        'w-full rounded-[20px] border px-4 py-4 text-left transition',
                        selectedReviewId === item.result_id ? 'border-[#103848]/14 bg-[#faf6ee]' : 'border-black/8 bg-white hover:border-[#103848]/12',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-base font-semibold text-primary">{buildResultTitle(item)}</div>
                        <SmallTag tone="warning">{reviewStatusText(item.review_status)}</SmallTag>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-on-surface-variant">{previewText(item)}</div>
                    </button>
                  ))}
                  {!filteredPendingResults.length ? <EmptyState text="当前筛选下没有待复核结果。" /> : null}
                </div>
              </div>
            </SurfacePanel>

            <SurfacePanel
              eyebrow="结果详情"
              title={selectedReview ? buildResultTitle(selectedReview) : '当前没有待复核结果'}
              description={selectedReview ? `${formatTaskType(selectedReview.result_type)} · ${formatTime(selectedReview.created_at)}` : '待复核队列清空后，这里改看最近已处理结果。'}
              actions={
                selectedReview ? (
                  <>
                    <ActionButton tone="secondary" onClick={() => void handleReview(selectedReview.result_id, 'accepted')}>通过</ActionButton>
                    <ActionButton tone="ghost" onClick={() => void handleReview(selectedReview.result_id, 'rejected')}>退回</ActionButton>
                  </>
                ) : null
              }
            >
              {selectedReview ? (
                <>
                  <ResultDigest result={selectedReview} />
                  <div className="mt-4">
                    <ActionButton tone="ghost" onClick={() => void handleExport(selectedReview.result_id)}>导出结果</ActionButton>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {reviewedResults.slice(0, 6).map((item) => (
                    <div key={item.result_id} className="rounded-[18px] border border-black/8 bg-white px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-primary">{buildResultTitle(item)}</div>
                        <SmallTag tone={item.review_status === 'accepted' ? 'success' : 'danger'}>{reviewStatusText(item.review_status)}</SmallTag>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-on-surface-variant">{previewText(item)}</div>
                    </div>
                  ))}
                  {!reviewedResults.length ? <EmptyState text="还没有可显示的处理记录。" /> : null}
                </div>
              )}
            </SurfacePanel>

            <div className="space-y-5">
              <SurfacePanel eyebrow="复核统计" title="教师发布状态" description="查看当前待复核和已处理数量。">
                <div className="space-y-3">
                  <div className="rounded-[20px] bg-[#f7f1e7] px-4 py-4">
                    <div className="text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">待复核</div>
                    <div className="mt-2 text-3xl font-semibold text-primary">{pendingResults.length}</div>
                  </div>
                  <div className="rounded-[20px] bg-[#f7f1e7] px-4 py-4">
                    <div className="text-[11px] font-semibold tracking-[0.18em] text-on-surface-variant">已处理</div>
                    <div className="mt-2 text-3xl font-semibold text-primary">{reviewedCount}</div>
                  </div>
                </div>
              </SurfacePanel>

              <SurfacePanel eyebrow="已处理结果" title="最近处理记录" description="查看最近通过或退回的结果。">
                <div className="space-y-3">
                  {reviewedResults.slice(0, 6).map((item) => (
                    <div key={item.result_id} className="rounded-[18px] border border-black/8 bg-white px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-primary">{buildResultTitle(item)}</div>
                        <SmallTag tone={item.review_status === 'accepted' ? 'success' : 'danger'}>{reviewStatusText(item.review_status)}</SmallTag>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-on-surface-variant">{previewText(item)}</div>
                    </div>
                  ))}
                  {!reviewedResults.length ? <EmptyState text="还没有已处理结果。" /> : null}
                </div>
              </SurfacePanel>
            </div>
          </div>
        ) : null}

        {mode === 'compose' ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_420px]">
            <SurfacePanel eyebrow="任务选择" title="备课与生成" description={taskTypeDescription(taskType)}>
              <div className="grid gap-3 md:grid-cols-3">
                {TEACHER_TASK_OPTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTaskType(item)}
                    className={cn(
                      'rounded-[20px] border px-4 py-4 text-left transition',
                      taskType === item ? 'border-[#103848]/14 bg-[#faf6ee]' : 'border-black/8 bg-white hover:border-[#103848]/12',
                    )}
                  >
                    <div className="text-base font-semibold text-primary">{formatTaskType(item)}</div>
                    <div className="mt-2 text-sm leading-7 text-on-surface-variant">{taskTypeDescription(item)}</div>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {suggestions.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setRawInput(prompt)}
                    className="rounded-full bg-[#f3ede2] px-3 py-1.5 text-xs font-medium text-on-surface-variant transition hover:bg-[#ece3d3]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <form className="mt-5 space-y-4" onSubmit={handleCompose}>
                <textarea
                  className="h-40 w-full rounded-[22px] border border-black/8 bg-[#f8f4ed] px-4 py-4 text-sm leading-7 text-on-surface outline-none"
                  placeholder="描述你要生成的课堂内容、对象年级和重点。"
                  value={rawInput}
                  onChange={(event) => setRawInput(event.target.value)}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setShowSourceEditor((value) => !value)}
                    className="rounded-full bg-[#f3ede2] px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-[#ece3d3]"
                  >
                    {showSourceEditor ? '收起素材' : '展开素材'}
                  </button>
                  <ActionButton type="submit" disabled={running}>{running ? '生成中...' : '开始生成'}</ActionButton>
                </div>

                {showSourceEditor ? (
                  <textarea
                    className="h-36 w-full rounded-[22px] border border-black/8 bg-white px-4 py-4 text-sm leading-7 text-on-surface outline-none"
                    placeholder="可粘贴诗文原文、课堂要求或补充说明。"
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                ) : null}
              </form>
            </SurfacePanel>

            <div className="space-y-5">
              <SurfacePanel eyebrow="生成记录" title="最近一次生成" description="查看最近一次输入和生成内容。">
                <div className="space-y-3">
                  {chatMessages.map((item) => (
                    <div key={item.id} className={cn('rounded-[20px] px-4 py-4', item.role === 'teacher' ? 'bg-[#f7f1e7]' : 'border border-black/8 bg-white')}>
                      <div className="flex items-center justify-between gap-3">
                        <SmallTag tone={item.role === 'teacher' ? 'primary' : item.status === 'error' ? 'danger' : 'success'}>
                          {item.role === 'teacher' ? '教师' : item.status === 'running' ? '生成中' : '系统'}
                        </SmallTag>
                        <div className="text-xs text-on-surface-variant">{formatTime(item.createdAt)}</div>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-on-surface">{item.text}</div>
                    </div>
                  ))}
                  {!chatMessages.length ? <EmptyState text="提交一个任务后，生成过程会出现在这里。" /> : null}
                </div>
              </SurfacePanel>

              <SurfacePanel
                eyebrow="结果对象"
                title={buildResultTitle(latestGeneratedResult)}
                description={latestGeneratedResult ? `${formatTaskType(latestGeneratedResult.result_type)} · ${formatTime(latestGeneratedResult.created_at)}` : '这里展示最近一次生成结果。'}
                actions={latestGeneratedResult ? <ActionButton tone="ghost" onClick={() => void handleExport(latestGeneratedResult.result_id)}>导出结果</ActionButton> : null}
              >
                <ResultDigest result={latestGeneratedResult} />
              </SurfacePanel>
            </div>
          </div>
        ) : null}

      </section>
    </div>
  )
}
