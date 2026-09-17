'use client'

import Link from 'next/link'
import useSWR, { useSWRConfig } from 'swr'
import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import { extractFileText, getMyBloom, getProjectDetail, getSessionDetail, listMyChallenges, listMyTeacherFeedback, previewChallenge, runTask, submitChallenge } from '@/lib/api'
import { BLOOM_DESCRIPTIONS, BLOOM_LABELS, BLOOM_OPTIONS } from '@/lib/constants'
import { formatBloom } from '@/lib/format'
import type {
  BloomLevel,
  ChallengePreview,
  GeneralChatContent,
  GuidedExplainContent,
  HistoryMessage,
  LessonOutlineContent,
  ProjectDetail,
  QuestionAnalysisContent,
  ResultRecord,
  SessionDetail,
  TeacherFeedback,
} from '@/lib/types'

type StudentWorkspaceProps = {
  mode: 'overview' | 'trajectory' | 'challenge'
  initialSession?: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  status?: 'running' | 'error'
  result?: ResultRecord | null
  challengePreview?: ChallengePreview | null
}

type ActiveChallengeState = {
  poemTitle: string
  preview: ChallengePreview
  messageId: string
}

const STARTERS = [
  '把《静夜思》一步一步讲给我听。',
  '我总分不清借景抒情和托物言志，带我判断一下。',
  '如果我要学《望庐山瀑布》，应该先抓住哪几个点？',
]

type ProjectConversationBundle = {
  project: ProjectDetail
  details: SessionDetail[]
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizePoemTitle(value?: string | null) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  const quoted = trimmed.match(/《([^》]+)》/)
  if (quoted?.[1]) return quoted[1].trim()
  return trimmed.replace(/^《|》$/g, '').trim()
}

function displayPoemTitle(value?: string | null) {
  const normalized = normalizePoemTitle(value)
  return normalized ? `《${normalized}》` : '当前主题'
}

function cleanConversationTitle(value?: string | null, maxLength = 18) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}

function isGenericConversationTitle(value?: string | null) {
  const normalized = (value ?? '').trim()
  return !normalized || ['普通对话', '当前主题', '未命名会话'].includes(normalized)
}

function nextBloomLevel(level: BloomLevel) {
  const index = BLOOM_OPTIONS.indexOf(level)
  if (index < 0 || index >= BLOOM_OPTIONS.length - 1) return null
  return BLOOM_OPTIONS[index + 1]
}

function buildStudentRouteStatus(hasProjectContext: boolean, hasConversation: boolean) {
  if (hasProjectContext) {
    return {
      label: '诗文项目',
      detail: '系统已把当前会话归入诗文项目，后续提问会持续积累到同一主题。',
    }
  }
  if (hasConversation) {
    return {
      label: '普通对话',
      detail: '当前会话仍按普通对话处理，还没有归入诗文项目。',
    }
  }
  return {
    label: '待判定',
    detail: '从统一入口开始提问后，系统会判断它是普通对话还是诗文项目。',
  }
}

function filterVisibleFeedback(feedbackItems: TeacherFeedback[], poemTitle: string) {
  const normalizedTitle = normalizePoemTitle(poemTitle)
  if (normalizedTitle) {
    const matched = feedbackItems.filter((item) => normalizePoemTitle(item.poem_title) === normalizedTitle)
    if (matched.length) return matched
  }
  return feedbackItems
}

function isGuidedExplain(content: Record<string, unknown>): content is GuidedExplainContent {
  return typeof content.hint_content === 'string'
}

function isQuestionAnalysis(content: Record<string, unknown>): content is QuestionAnalysisContent {
  return Array.isArray(content.analysis_steps)
}

function isLessonOutline(content: Record<string, unknown>): content is LessonOutlineContent {
  return Array.isArray(content.teaching_goals)
}

function isGeneralChat(content: Record<string, unknown>): content is GeneralChatContent {
  return typeof content.answer === 'string'
}

function buildResultTitle(result: ResultRecord | null) {
  if (!result) return ''
  const title = typeof result.content_json.title === 'string' ? result.content_json.title.trim() : ''
  return title
}

function renderResultText(result: ResultRecord | null) {
  if (!result) return '这次没有拿到有效结果。'
  const content = result.content_json as Record<string, unknown>

  if (isGuidedExplain(content)) {
    return [content.hint_content, content.next_challenge_hint ? `下一步：${content.next_challenge_hint}` : null]
      .filter(Boolean)
      .join('\n\n')
  }

  if (isQuestionAnalysis(content)) {
    return [content.question_text, ...content.analysis_steps].filter(Boolean).join('\n\n')
  }

  if (isLessonOutline(content)) {
    return [
      `学习目标：${content.teaching_goals.join('；')}`,
      `学习重点：${content.key_points.join('；')}`,
      `学习难点：${content.difficult_points.join('；')}`,
    ].join('\n\n')
  }

  if (isGeneralChat(content)) {
    return [content.answer, content.follow_up ? `继续追问：${content.follow_up}` : null].filter(Boolean).join('\n\n')
  }

  return JSON.stringify(content, null, 2)
}


function buildChallengePrompt(preview: ChallengePreview) {
  const payload = preview.question_json as Record<string, unknown>
  const challengeType = typeof payload.challenge_type === 'string' ? payload.challenge_type : 'short_answer'
  const stem = typeof payload.stem === 'string' ? payload.stem.trim() : '请围绕当前主题完成这道挑战。'
  const options = Array.isArray(payload.options) ? payload.options.map((item) => String(item).trim()).filter(Boolean) : []
  const answerFormat = typeof payload.answer_format === 'string' ? payload.answer_format.trim() : '直接在下方作答。'
  const typeLabel =
    challengeType === 'multiple_choice' ? '选择题' : challengeType === 'fill_blank' ? '填空题' : '简答题'

  return [`来一道${formatBloom(preview.to_level)}挑战。`, `${typeLabel}：${stem}`, options.length ? options.join('\n') : null, answerFormat]
    .filter(Boolean)
    .join('\n\n')
}

function getChallengeType(preview: ChallengePreview | null | undefined) {
  const payload = (preview?.question_json ?? {}) as Record<string, unknown>
  return typeof payload.challenge_type === 'string' ? payload.challenge_type : 'short_answer'
}

function getChallengeOptions(preview: ChallengePreview | null | undefined) {
  const payload = (preview?.question_json ?? {}) as Record<string, unknown>
  return Array.isArray(payload.options) ? payload.options.map((item) => String(item).trim()).filter(Boolean) : []
}

function humanizeChallengeFailure(cause: string | null | undefined, challengeType: string | null | undefined) {
  if (challengeType === 'fill_blank') {
    if (cause === 'blank_not_filled' || cause === 'empty_answer') return '还没有把空填完整，先把缺的词补上。'
    if (cause === 'insufficient_support') return '空已经填对了，再补一句你理解到的感受。'
  }
  if (challengeType === 'multiple_choice') {
    if (cause === 'incorrect_option') return '这次选项不对，再看一看诗句再选。'
    if (cause === 'reason_misaligned') return '选项方向接近了，再补一句更贴合诗意的理由。'
  }
  if (cause === 'answer_too_short') return '回答有点短，再展开一点。'
  if (cause === 'empty_answer') return '你还没有提交答案。'
  return '这次还没通过，先把这一层理解再补强一点。'
}

function toHistoryMessages(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((item) => item.status !== 'running')
    .map((item) => ({
      role: item.role,
      text: item.text,
    }))
}

function inferPoemTitle(sessionDetail: SessionDetail | undefined, conversation: ChatMessage[]) {
  const sessionTitle = normalizePoemTitle(sessionDetail?.session.project_title)
  if (sessionTitle) return sessionTitle

  for (const item of [...conversation].reverse()) {
    const fromResult = normalizePoemTitle(buildResultTitle(item.result ?? null))
    if (fromResult) return fromResult
    const fromText = item.text.match(/《([^》]+)》/)
    if (fromText?.[1]) return fromText[1].trim()
  }

  return ''
}

function inferConversationTitle(sessionDetail: SessionDetail | undefined, conversation: ChatMessage[]) {
  const promptPreview = cleanConversationTitle(sessionDetail?.session.prompt_preview)
  if (promptPreview) return promptPreview

  const firstUserMessage = conversation.find((item) => item.role === 'user')
  const fromUserText = cleanConversationTitle(firstUserMessage?.text)
  if (fromUserText) return fromUserText

  for (const item of conversation) {
    const title = buildResultTitle(item.result ?? null)
    if (!isGenericConversationTitle(title)) {
      return cleanConversationTitle(title, 20)
    }
  }

  return '普通对话'
}

function buildMessagesFromSessionDetail(sessionDetail: SessionDetail): ChatMessage[] {
  const nextMessages: ChatMessage[] =
    sessionDetail.messages?.map((item) => ({
      id: item.message_id,
      role: item.role,
      text: item.text,
      createdAt: item.created_at,
      challengePreview: item.challenge_preview as ChallengePreview | null | undefined,
    })) ?? []

  if (nextMessages.length) return nextMessages

  const prompt = sessionDetail.session.prompt_preview?.trim()
  if (prompt) {
    nextMessages.push({
      id: createMessageId('seed-user'),
      role: 'user',
      text: prompt,
      createdAt: sessionDetail.session.created_at,
    })
  }
  if (sessionDetail.result) {
    nextMessages.push({
      id: createMessageId('seed-assistant'),
      role: 'assistant',
      text: renderResultText(sessionDetail.result),
      result: sessionDetail.result,
      createdAt: sessionDetail.result.created_at ?? sessionDetail.session.created_at,
    })
  }
  return nextMessages
}

function buildMessagesFromProjectConversation(bundle: ProjectConversationBundle): ChatMessage[] {
  return bundle.details
    .slice()
    .sort((left, right) => new Date(left.session.created_at).getTime() - new Date(right.session.created_at).getTime())
    .flatMap((detail) => buildMessagesFromSessionDetail(detail))
}

function BloomBadge({ level }: { level: BloomLevel }) {
  return (
    <div className="group relative">
      <div className="rounded-full border border-black/8 bg-white px-3 py-2 text-xs text-on-surface shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
        {`当前层级：${BLOOM_LABELS[level]}`}
      </div>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-10 hidden w-[280px] rounded-[22px] border border-black/8 bg-white/98 p-4 text-left shadow-[0_18px_40px_rgba(15,23,42,0.10)] group-hover:block">
        <div className="text-xs font-semibold tracking-[0.18em] text-on-surface-variant">BLOOM 层级</div>
        <div className="mt-3 space-y-2">
          {BLOOM_OPTIONS.map((item) => (
            <div
              key={item}
              className={[
                'rounded-[16px] px-3 py-2',
                item === level ? 'bg-[#f4ecda] text-primary' : 'bg-[#faf7f1] text-on-surface',
              ].join(' ')}
            >
              <div className="text-sm font-medium">{BLOOM_LABELS[item]}</div>
              <div className="mt-1 text-xs leading-6 text-on-surface-variant">{BLOOM_DESCRIPTIONS[item]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'accent' }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-3 py-2 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.04)]',
        tone === 'accent' ? 'border-[#103848]/12 bg-[#f4ecda] text-primary' : 'border-black/8 bg-white/92 text-on-surface-variant',
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function TeacherFeedbackPanel({ items, poemTitle }: { items: TeacherFeedback[]; poemTitle: string }) {
  if (!items.length) return null

  return (
    <section className="mb-4 rounded-[28px] border border-black/8 bg-white/94 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] tracking-[0.24em] text-on-surface-variant">教师反馈</div>
          <div className="mt-2 font-headline text-2xl text-primary">
            {poemTitle ? `${displayPoemTitle(poemTitle)} 最近批注` : '最近收到的反馈'}
          </div>
        </div>
        <div className="rounded-full border border-black/8 bg-[#f7f4ee] px-3 py-2 text-xs text-on-surface-variant">
          共 {items.length} 条
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {items.slice(0, 2).map((item) => (
          <article key={item.feedback_id} className="rounded-[22px] border border-black/8 bg-[#faf7f1] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <span>{item.is_ai_assisted ? 'AI 辅助批注' : '教师批注'}</span>
              <span>·</span>
              <span>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-on-surface">{item.content}</div>
          </article>
        ))}
      </div>
    </section>
  )
}

function RunningState() {
  return (
    <div className="flex items-center gap-3 text-sm text-on-surface-variant">
      <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-[#103848]/15 border-t-[#103848]" />
      <span>生成中...</span>
    </div>
  )
}

function ResultCard({
  message,
  activeChallenge,
  inlineChallengeDraft,
  onInlineChallengeDraftChange,
  onSubmitInlineChallenge,
  challengeBusy,
}: {
  message: ChatMessage
  activeChallenge?: ActiveChallengeState | null
  inlineChallengeDraft?: string
  onInlineChallengeDraftChange?: (value: string) => void
  onSubmitInlineChallenge?: (value: string) => Promise<void>
  challengeBusy?: boolean
}) {
  const result = message.result
  const isUser = message.role === 'user'
  const isActiveChallengeMessage = Boolean(activeChallenge && activeChallenge.messageId === message.id)
  const effectiveChallengePreview = isActiveChallengeMessage ? activeChallenge?.preview : message.challengePreview
  const challengeType = effectiveChallengePreview ? getChallengeType(effectiveChallengePreview) : null
  const challengeOptions = effectiveChallengePreview ? getChallengeOptions(effectiveChallengePreview) : []
  const assistantText = result ? renderResultText(result) : message.text

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[86%] rounded-[28px] px-5 py-4',
          isUser
            ? 'bg-[#103848] text-white shadow-[0_16px_36px_rgba(16,56,72,0.14)]'
            : 'border border-black/8 bg-white text-on-surface shadow-[0_16px_36px_rgba(15,23,42,0.05)]',
        ].join(' ')}
      >
        {message.status === 'running' && !isUser ? (
          <RunningState />
        ) : (
          <div className={`whitespace-pre-wrap text-sm leading-7 ${isUser ? 'text-white' : 'text-on-surface'}`}>{assistantText}</div>
        )}

        {isActiveChallengeMessage && challengeType === 'multiple_choice' ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {challengeOptions.map((option) => {
              const optionValue = option.split('.')[0]?.trim() || option
              return (
                <button
                  key={option}
                  type="button"
                  disabled={challengeBusy}
                  onClick={() => void onSubmitInlineChallenge?.(optionValue)}
                  className="rounded-full border border-[#103848]/10 bg-[#f7f4ee] px-3 py-2 text-sm text-on-surface transition hover:border-[#103848]/18 hover:bg-[#f4ecda] disabled:opacity-50"
                >
                  {option}
                </button>
              )
            })}
          </div>
        ) : null}

        {isActiveChallengeMessage && challengeType === 'fill_blank' ? (
          <form
            className="mt-4 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void onSubmitInlineChallenge?.(inlineChallengeDraft ?? '')
            }}
          >
            <input
              value={inlineChallengeDraft ?? ''}
              onChange={(event) => onInlineChallengeDraftChange?.(event.target.value)}
              placeholder="直接填空并补一句理解"
              className="min-w-[220px] flex-1 rounded-full border border-black/8 bg-[#faf7f1] px-4 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={challengeBusy || !(inlineChallengeDraft ?? '').trim()}
              className="rounded-full bg-[#103848] px-4 py-2 text-sm text-white transition hover:bg-[#0d3140] disabled:opacity-50"
            >
              提交
            </button>
          </form>
        ) : null}

        {!isUser && message.status === 'error' ? (
          <div className={`mt-3 text-xs ${message.status === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
            这次生成失败
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({ onUsePrompt }: { onUsePrompt: (value: string) => void }) {
  return (
    <section className="flex flex-1 items-center justify-center py-10 md:py-14">
      <div className="mx-auto w-full max-w-[640px]">
        <div className="text-center">
          <h1 className="font-headline text-3xl leading-tight text-primary md:text-[3.1rem]">今天想先弄懂什么？</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-on-surface-variant">输入诗句、题目或者困惑，直接开始。</p>
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap justify-center gap-2">
            {STARTERS.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => onUsePrompt(item)}
                className="rounded-full border border-[#103848]/8 bg-white px-4 py-2 text-sm text-on-surface transition hover:border-[#103848]/16 hover:bg-white"
              >
                {index === 0 ? '讲解《静夜思》' : index === 1 ? '区分手法' : '预习《望庐山瀑布》'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Composer({
  rawInput,
  onInputChange,
  onSubmit,
  onKeyDown,
  onOpenFilePicker,
  onToggleWebSearch,
  running,
  uploadingFile,
  sourceAttached,
  webSearchEnabled,
  placeholder = '输入你的问题',
}: {
  rawInput: string
  onInputChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => Promise<void>
  onOpenFilePicker: () => void
  onToggleWebSearch: (value: boolean) => void
  running: boolean
  uploadingFile: boolean
  sourceAttached: boolean
  webSearchEnabled: boolean
  placeholder?: string
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-[26px] border border-black/8 bg-white/96 px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <textarea
        value={rawInput}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => void onKeyDown(event)}
        placeholder={placeholder}
        rows={2}
        className="min-h-[76px] w-full resize-none rounded-[18px] bg-[#faf7f1] px-4 py-3 text-sm leading-7 outline-none md:text-[15px]"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#f6f2ea] px-3 py-2 text-xs text-on-surface-variant">
            <input type="checkbox" checked={webSearchEnabled} onChange={(event) => onToggleWebSearch(event.target.checked)} />
            <span>联网</span>
          </label>
          <button
            type="button"
            onClick={onOpenFilePicker}
            disabled={running || uploadingFile}
            className="rounded-full border border-black/8 bg-[#f6f2ea] px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary"
          >
            {uploadingFile ? '提取中' : sourceAttached ? '已附材料' : '补充材料'}
          </button>
        </div>
        <button
          disabled={running || rawInput.trim().length === 0}
          type="submit"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#103848] text-white transition hover:bg-[#0d3140] disabled:opacity-40"
        >
          {running ? '…' : '→'}
        </button>
      </div>
    </form>
  )
}

export function StudentWorkspace({ mode, initialSession = '' }: StudentWorkspaceProps) {
  const { token, role, isReady } = useSession()
  const { mutate: globalMutate } = useSWRConfig()
  const [rawInput, setRawInput] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [running, setRunning] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState(initialSession)
  const [hydratedSessionId, setHydratedSessionId] = useState('')
  const [challengeLoading, setChallengeLoading] = useState(false)
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallengeState | null>(null)
  const [challengeComposerActive, setChallengeComposerActive] = useState(false)
  const [inlineChallengeDraft, setInlineChallengeDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const conversationViewportRef = useRef<HTMLDivElement>(null)

  const bloomQuery = useSWR(token && role === 'student' ? ['student-bloom', token] : null, ([, currentToken]) => getMyBloom(currentToken))
  const challengeQuery = useSWR(
    token && role === 'student' ? ['student-challenges', token] : null,
    ([, currentToken]) => listMyChallenges(currentToken),
  )
  const feedbackQuery = useSWR(
    token && role === 'student' ? ['student-feedback', token] : null,
    ([, currentToken]) => listMyTeacherFeedback(currentToken),
  )
  const sessionDetailQuery = useSWR(
    token && role === 'student' && activeSessionId ? ['student-session-detail', token, activeSessionId] : null,
    ([, currentToken, sessionId]) => getSessionDetail(currentToken, sessionId),
  )
  const activeProjectId = sessionDetailQuery.data?.session.project_id ?? ''
  const projectConversationQuery = useSWR(
    token && role === 'student' && activeProjectId ? ['student-project-conversation', token, activeProjectId] : null,
    async ([, currentToken, projectId]): Promise<ProjectConversationBundle> => {
      const project = await getProjectDetail(currentToken, projectId)
      const details = await Promise.all(
        project.sessions
          .slice()
          .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
          .map((session) => getSessionDetail(currentToken, session.session_id)),
      )
      return { project, details }
    },
  )

  useEffect(() => {
    setActiveSessionId(initialSession)
    setConversation([])
    setResultError(null)
    setHydratedSessionId('')
    setActiveChallenge(null)
    setChallengeComposerActive(false)
  }, [initialSession])

  useEffect(() => {
    if (!activeSessionId || !sessionDetailQuery.data || hydratedSessionId === activeSessionId || conversation.length > 0) return
    if (sessionDetailQuery.data.session.project_id && !projectConversationQuery.data) return

    const nextMessages = sessionDetailQuery.data.session.project_id && projectConversationQuery.data
      ? buildMessagesFromProjectConversation(projectConversationQuery.data)
      : buildMessagesFromSessionDetail(sessionDetailQuery.data)

    setConversation(nextMessages)
    const activeChallengeSource =
      projectConversationQuery.data?.details.find((detail) => detail.session.session_id === activeSessionId && detail.active_challenge?.preview)
        ?.active_challenge ?? sessionDetailQuery.data.active_challenge

    if (activeChallengeSource?.preview && activeChallengeSource.poem_title) {
      setActiveChallenge({
        poemTitle: activeChallengeSource.poem_title,
        preview: activeChallengeSource.preview as ChallengePreview,
        messageId: activeChallengeSource.message_id,
      })
      setChallengeComposerActive(false)
    } else {
      setActiveChallenge(null)
      setChallengeComposerActive(false)
    }
    setHydratedSessionId(activeSessionId)
  }, [activeSessionId, conversation.length, hydratedSessionId, projectConversationQuery.data, sessionDetailQuery.data])

  useLayoutEffect(() => {
    if (!conversation.length) return
    const viewport = conversationViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [activeSessionId, conversation.length])

  const currentBloom = (bloomQuery.data?.bloom_level ?? 'understand') as BloomLevel
  const nextLevel = nextBloomLevel(currentBloom)
  const activePoemTitle = useMemo(() => {
    const projectTitle = projectConversationQuery.data?.project.project.title
    if (projectTitle) return normalizePoemTitle(projectTitle)
    return inferPoemTitle(sessionDetailQuery.data, conversation)
  }, [conversation, projectConversationQuery.data, sessionDetailQuery.data])
  const conversationTitle = useMemo(
    () => inferConversationTitle(sessionDetailQuery.data, conversation),
    [conversation, sessionDetailQuery.data],
  )
  const hasProjectContext = Boolean(activeProjectId || activePoemTitle)
  const routeStatus = buildStudentRouteStatus(hasProjectContext, conversation.length > 0)
  const visibleFeedback = useMemo(
    () => filterVisibleFeedback(feedbackQuery.data ?? [], activePoemTitle),
    [activePoemTitle, feedbackQuery.data],
  )
  const resourceLabel = sourceText.trim() ? '已附材料' : webSearchEnabled ? '联网检索' : ''

  const canChallenge = currentBloom !== 'create'
  const hasConversation = conversation.length > 0
  const showEmptyState = !hasConversation && !running && !resultError
  const studentHeaderSummary = activeChallenge
    ? `当前层级是 ${BLOOM_LABELS[currentBloom]}，可以直接继续这道面向 ${BLOOM_LABELS[activeChallenge.preview.to_level]} 的挑战。`
    : nextLevel
      ? `当前层级是 ${BLOOM_LABELS[currentBloom]}，下一步建议朝 ${BLOOM_LABELS[nextLevel]} 推进。`
      : `当前已经达到 Bloom 最高层级，可以继续沉淀自己的表达。`

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (!token) return

    try {
      setUploadingFile(true)
      setResultError(null)
      const extracted = await extractFileText(token, file)
      setSourceText(extracted.text)
    } catch (error) {
      setResultError(error instanceof Error ? error.message : '材料提取失败')
    } finally {
      setUploadingFile(false)
    }
  }

  const requestChallengeInConversation = useCallback(async () => {
    if (!token || !canChallenge) return
    const poemTitle = activePoemTitle.trim()
    if (!poemTitle) {
      setConversation((current) => [
        ...current,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          text: '先围绕一首具体诗目聊几轮，我再基于当前主题给你出进阶挑战。',
          createdAt: new Date().toISOString(),
        },
      ])
      return
    }

    setChallengeLoading(true)
    try {
      const preview = await previewChallenge(token, { poem_title: poemTitle, session_id: activeSessionId || undefined })
      const challengeMessageId = createMessageId('assistant')
      setActiveChallenge({ poemTitle, preview, messageId: challengeMessageId })
      setChallengeComposerActive(false)
      setInlineChallengeDraft('')
      setConversation((current) => [
        ...current,
        {
          id: challengeMessageId,
          role: 'assistant',
          text: buildChallengePrompt(preview),
          createdAt: new Date().toISOString(),
          challengePreview: preview,
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : '挑战生成失败'
      setConversation((current) => [
        ...current,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          text: message,
          createdAt: new Date().toISOString(),
          status: 'error',
        },
      ])
    } finally {
      setChallengeLoading(false)
    }
  }, [activePoemTitle, activeSessionId, canChallenge, token])

  useEffect(() => {
    if (mode === 'challenge' && token && hasConversation && !activeChallenge && !challengeLoading) {
      void requestChallengeInConversation()
    }
  }, [activeChallenge, challengeLoading, hasConversation, mode, requestChallengeInConversation, token])

  const submitChallengeAnswer = useCallback(
    async (answerText: string) => {
      if (!token || !activeChallenge || !answerText.trim()) return
      const userText = answerText.trim()
      const userMessage: ChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        text: userText,
        createdAt: new Date().toISOString(),
      }

      setConversation((current) => [...current, userMessage])
      setRawInput('')
      setInlineChallengeDraft('')
      setChallengeLoading(true)
      setResultError(null)
      try {
        const response = await submitChallenge(token, {
          poem_title: activeChallenge.poemTitle,
          session_id: activeSessionId || undefined,
          from_level: currentBloom,
          student_answer: userText,
        })
        const challengeType = getChallengeType(activeChallenge.preview)

        const summary =
          response.message ??
          (response.passed
            ? `挑战通过，当前层级提升到 ${formatBloom(response.current_bloom?.bloom_level ?? currentBloom)}。`
            : humanizeChallengeFailure(response.inferred_cause, challengeType))

        setConversation((current) => [
          ...current,
          {
            id: createMessageId('challenge-feedback'),
            role: 'assistant',
            text: summary,
            createdAt: new Date().toISOString(),
          },
        ])
        setActiveChallenge(null)
        setChallengeComposerActive(false)
        await Promise.all([challengeQuery.mutate(), bloomQuery.mutate()])
      } catch (error) {
        const message = error instanceof Error ? error.message : '挑战提交失败'
        setConversation((current) => [
          ...current,
          {
            id: createMessageId('challenge-feedback'),
            role: 'assistant',
            text: message,
            createdAt: new Date().toISOString(),
            status: 'error',
          },
        ])
      } finally {
        setChallengeLoading(false)
      }
    },
    [activeChallenge, activeSessionId, bloomQuery, challengeQuery, currentBloom, token],
  )

  const submitTask = async () => {
    if (!token || !rawInput.trim()) return
    const userText = rawInput.trim()
    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      text: userText,
      createdAt: new Date().toISOString(),
    }

    if (activeChallenge && challengeComposerActive) {
      await submitChallengeAnswer(userText)
      return
    }

    const pendingId = createMessageId('assistant')
    const pendingMessage: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      text: '正在整理结果…',
      createdAt: new Date().toISOString(),
      status: 'running',
    }

    setConversation((current) => [...current, userMessage, pendingMessage])
    setRawInput('')
    setRunning(true)
    setResultError(null)

    try {
      const response = await runTask(token, {
        raw_input: userText,
        session_id: activeSessionId || undefined,
        source_text: sourceText.trim() || undefined,
        history_messages: toHistoryMessages([...conversation, userMessage]),
        web_search_enabled: webSearchEnabled,
      })
      const nextSessionId = response.result?.session_id ?? response.session.session_id
      setSourceText('')
      setActiveSessionId(nextSessionId)
      setChallengeComposerActive(false)
      setConversation((current) =>
        current.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                text: renderResultText(response.result),
                status: undefined,
                result: response.result,
                createdAt: response.result?.created_at ?? new Date().toISOString(),
              }
            : item,
        ),
      )

      await Promise.all([
        bloomQuery.mutate(),
        challengeQuery.mutate(),
        globalMutate(['shell-student-history', token]),
        globalMutate(['student-session-detail', token, nextSessionId]),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : '提问失败'
      setResultError(message)
      setConversation((current) =>
        current.map((item) => (item.id === pendingId ? { ...item, text: message, status: 'error' } : item)),
      )
    } finally {
      setRunning(false)
    }
  }

  const handleSubmitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitTask()
  }

  const handlePromptKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      await submitTask()
    }
  }

  if (isReady && role && role !== 'student') {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">当前账号不是学生身份</h1>
          <div className="mt-6">
            <Link className="text-sm font-medium text-primary" href={role === 'teacher' ? '/teacher?panel=review' : '/admin?panel=audit'}>
              返回首页
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className={showEmptyState ? 'mx-auto w-full max-w-[880px]' : 'mx-auto w-full max-w-[1180px]'}>
      <input type="file" ref={fileInputRef} onChange={(event) => void handleFileUpload(event)} className="hidden" accept=".txt,.md,.mdx,.csv,.pdf,.docx" />
      <div className="flex h-[calc(100dvh-6.5rem)] min-h-[680px] flex-col">
        {!showEmptyState ? (
          <>
            <section className="mb-4 rounded-[28px] border border-black/8 bg-white/94 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] tracking-[0.24em] text-on-surface-variant">{hasProjectContext ? '当前主题' : '当前会话'}</div>
                  <div className="mt-2 font-headline text-2xl text-primary md:text-[2.2rem]">
                    {hasProjectContext ? displayPoemTitle(activePoemTitle) : conversationTitle}
                  </div>
                  {hasProjectContext ? <p className="mt-3 max-w-3xl text-sm leading-7 text-on-surface-variant">{studentHeaderSummary}</p> : null}
                </div>
                {hasProjectContext ? (
                  <div className="flex items-center gap-2">
                    <BloomBadge level={currentBloom} />
                    <button
                      type="button"
                      onClick={() => {
                        if (activeChallenge) {
                          setChallengeComposerActive(true)
                          return
                        }
                        void requestChallengeInConversation()
                      }}
                      disabled={!canChallenge || challengeLoading || running}
                      className="rounded-full border border-black/8 bg-[#f4ecda] px-4 py-2 text-sm font-medium text-primary transition hover:border-[#103848]/14"
                    >
                      {challengeLoading ? '正在出题…' : activeChallenge ? '进入答题' : nextLevel ? '发起进阶挑战' : '已到最高层级'}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill label={routeStatus.label} tone="accent" />
                {hasProjectContext ? <StatusPill label={`当前 ${BLOOM_LABELS[currentBloom]}`} /> : null}
                {hasProjectContext ? <StatusPill label={nextLevel ? `推荐 ${BLOOM_LABELS[nextLevel]}` : '已到创造层'} /> : null}
                {resourceLabel ? <StatusPill label={resourceLabel} /> : null}
                {hasProjectContext && visibleFeedback.length ? <StatusPill label={`教师反馈 ${visibleFeedback.length}`} /> : null}
              </div>
            </section>

            {hasProjectContext ? <TeacherFeedbackPanel items={visibleFeedback} poemTitle={activePoemTitle} /> : null}
          </>
        ) : null}

        <div ref={conversationViewportRef} data-student-conversation-viewport="true" className="min-h-0 flex-1 overflow-y-auto pr-1">
          {showEmptyState ? <EmptyState onUsePrompt={setRawInput} /> : null}

          {resultError && !conversation.length ? (
            <div className="rounded-[24px] border border-error/10 bg-error-container/60 px-4 py-4 text-sm text-error">{resultError}</div>
          ) : null}

          {conversation.length ? (
            <section className="space-y-4 pb-6">
              {conversation.map((message) => {
                return (
                  <ResultCard
                    key={message.id}
                    message={message}
                    activeChallenge={activeChallenge}
                    inlineChallengeDraft={inlineChallengeDraft}
                    onInlineChallengeDraftChange={setInlineChallengeDraft}
                    onSubmitInlineChallenge={submitChallengeAnswer}
                    challengeBusy={challengeLoading}
                  />
                )
              })}
            </section>
          ) : null}
        </div>

        <div className="mt-4 border-t border-black/6 bg-[#f7f4ee]/96 pb-2 pt-3">
          <div className="mx-auto max-w-[1180px]">
            <Composer
              rawInput={rawInput}
              onInputChange={setRawInput}
              onSubmit={handleSubmitTask}
              onKeyDown={handlePromptKeyDown}
              onOpenFilePicker={() => fileInputRef.current?.click()}
              onToggleWebSearch={setWebSearchEnabled}
              running={running}
              uploadingFile={uploadingFile}
              sourceAttached={Boolean(sourceText.trim())}
              webSearchEnabled={webSearchEnabled}
              placeholder={challengeComposerActive ? `继续回答这道${formatBloom(activeChallenge?.preview.to_level ?? currentBloom)}挑战` : '输入你的问题'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
