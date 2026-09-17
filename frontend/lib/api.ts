import { API_BASE_URL } from '@/lib/constants'
import { clearSessionWithBroadcast } from '@/lib/storage'
import {
  adminConfigItemSchema,
  adminConfigResponseSchema,
  adminSkillsReloadResponseSchema,
  adminSkillsSnapshotSchema,
  batchCreatedStudentSchema,
  bloomSnapshotSchema,
  challengeAttemptSchema,
  challengePreviewSchema,
  challengeSubmitResponseSchema,
  exportResponseSchema,
  fileExtractResponseSchema,
  loginResponseSchema,
  passwordResetResponseSchema,
  projectDetailSchema,
  projectListSchema,
  projectMutationResponseSchema,
  resultRecordSchema,
  runTaskResponseSchema,
  sessionDetailSchema,
  sessionDeleteResponseSchema,
  sessionInfoSchema,
  studentAccountSchema,
  teacherAccountSchema,
  teacherFeedbackSchema,
  teacherMasteryItemSchema,
  templateVersionActionResponseSchema,
  traceDetailSchema,
  traceSummarySchema,
  userSchema,
} from '@/lib/validators'
import type {
  AdminConfigItem,
  AdminConfigResponse,
  AdminSkillsReloadResponse,
  AdminSkillsSnapshot,
  BatchCreatedStudent,
  BloomLevel,
  BloomOverrideRecord,
  BloomSnapshot,
  ChallengeAttempt,
  ChallengePreview,
  ChallengeSubmitResponse,
  ExportResponse,
  FileExtractResponse,
  LoginResponse,
  PasswordResetResponse,
  ProjectDetail,
  ProjectInfo,
  ProjectMutationResponse,
  ReviewStatus,
  ReviewableResult,
  RunTaskResponse,
  SessionDetail,
  SessionInfo,
  StudentAccount,
  TeacherAccount,
  TeacherFeedback,
  TeacherMasteryItem,
  TemplateVersionActionResponse,
  TraceDetail,
  TraceSummary,
  User,
} from '@/lib/types'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  token?: string | null
  body?: unknown
}

type TeacherStudentScope = 'class' | 'school'

let isHandlingUnauthorized = false

export class ApiError extends Error {
  status: number
  fallback?: string

  constructor(status: number, message: string, fallback?: string) {
    super(message)
    this.status = status
    this.fallback = fallback
  }
}

function handleUnauthorized() {
  if (typeof window === 'undefined') return
  if (isHandlingUnauthorized) return
  isHandlingUnauthorized = true
  clearSessionWithBroadcast()
  const onLoginPage = window.location.pathname === '/' || window.location.pathname === '/login'
  if (!onLoginPage) {
    window.location.replace('/login')
    return
  }
  window.setTimeout(() => {
    isHandlingUnauthorized = false
  }, 0)
}

async function request<T>(path: string, schema: { parse: (value: unknown) => unknown }, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.message ?? payload?.detail ?? payload?.error ?? 'request failed'
    if (response.status === 401) {
      handleUnauthorized()
      throw new ApiError(response.status, '登录状态已失效，请重新登录。', payload?.fallback)
    }
    throw new ApiError(response.status, message, payload?.fallback)
  }
  return schema.parse(payload) as T
}

export function login(username: string, password: string, remember_me: boolean): Promise<LoginResponse> {
  return request('/auth/login', loginResponseSchema, {
    method: 'POST',
    body: { username, password, remember_me },
  })
}

export function getMe(token: string): Promise<User> {
  return request('/me', userSchema, { token })
}

export function runTask(
  token: string,
  body: {
    raw_input: string
    task_type?: string
    project_id?: string | null
    session_id?: string | null
    history_messages?: Array<{ role: 'user' | 'assistant'; text: string }>
    source_text?: string | null
    web_search_enabled: boolean
  },
): Promise<RunTaskResponse> {
  return request('/tasks/run', runTaskResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export async function extractFileText(token: string, file: File): Promise<FileExtractResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/files/extract-text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : detail?.message ?? payload?.message ?? payload?.error ?? 'request failed'
    throw new ApiError(response.status, message)
  }
  return fileExtractResponseSchema.parse(payload) as FileExtractResponse
}

export function listSessions(token: string): Promise<SessionInfo[]> {
  return request('/sessions', sessionInfoSchema.array(), { token })
}

export function getSessionDetail(token: string, sessionId: string): Promise<SessionDetail> {
  return request(`/sessions/${sessionId}`, sessionDetailSchema, { token })
}

export function listProjects(token: string): Promise<ProjectInfo[]> {
  return request<{ projects: ProjectInfo[] }>('/projects', projectListSchema, { token }).then((payload) => payload.projects)
}

export function getProjectDetail(token: string, projectId: string): Promise<ProjectDetail> {
  return request(`/projects/${projectId}`, projectDetailSchema, { token })
}

export function resolveProject(
  token: string,
  body: { session_id: string; title: string; content_type: 'poem' | 'classical_prose' },
): Promise<ProjectMutationResponse> {
  return request('/projects/resolve', projectMutationResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function deleteSession(token: string, sessionId: string): Promise<{ deleted: boolean; session_id: string }> {
  return request(`/sessions/${sessionId}`, sessionDeleteResponseSchema, {
    method: 'DELETE',
    token,
  })
}

export function exportResultFile(token: string, resultId: string): Promise<ExportResponse> {
  return request(`/exports/result/${resultId}`, exportResponseSchema, {
    method: 'POST',
    token,
  })
}

export function exportSessionFile(token: string, sessionId: string): Promise<ExportResponse> {
  return request(`/exports/session/${sessionId}`, exportResponseSchema, {
    method: 'POST',
    token,
  })
}

export function listAdminTraces(token: string): Promise<TraceSummary[]> {
  return request('/admin/traces', traceSummarySchema.array(), { token })
}

export function getAdminTraceDetail(token: string, sessionId: string): Promise<TraceDetail> {
  return request(`/admin/trace/sessions/${sessionId}`, traceDetailSchema, { token })
}

export function listAdminResults(token: string): Promise<ReviewableResult[]> {
  return request('/admin/results', resultRecordSchema.array(), { token })
}

export function getMyBloom(token: string): Promise<BloomSnapshot | null> {
  return request('/students/me/bloom', bloomSnapshotSchema.nullable(), { token })
}

export function listMyChallenges(token: string): Promise<ChallengeAttempt[]> {
  return request('/students/me/challenges', challengeAttemptSchema.array(), { token })
}

export function listMyTeacherFeedback(token: string): Promise<TeacherFeedback[]> {
  return request('/students/me/feedback', teacherFeedbackSchema.array(), { token })
}

export function previewChallenge(token: string, body: { poem_title: string; session_id?: string | null }): Promise<ChallengePreview> {
  return request('/students/me/challenges/preview', challengePreviewSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function listTeacherMastery(token: string, scope: TeacherStudentScope = 'class'): Promise<TeacherMasteryItem[]> {
  return request(`/teacher/mastery?scope=${scope}`, teacherMasteryItemSchema.array(), { token })
}

export function listStudents(token: string, scope: TeacherStudentScope = 'class'): Promise<StudentAccount[]> {
  return request(`/users/students?scope=${scope}`, studentAccountSchema.array(), { token })
}

export function listTeachers(token: string): Promise<TeacherAccount[]> {
  return request('/users/teachers', teacherAccountSchema.array(), { token })
}

export function createStudent(
  token: string,
  body: { display_name: string; username: string; password: string; teacher_id?: string | null },
): Promise<StudentAccount> {
  return request('/users/students', studentAccountSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function batchCreateStudents(
  token: string,
  body: { students: Array<{ display_name: string }>; teacher_id?: string | null },
): Promise<BatchCreatedStudent[]> {
  return request('/users/students/batch', batchCreatedStudentSchema.array(), {
    method: 'POST',
    token,
    body,
  })
}

export function createTeacher(token: string, body: { display_name: string; username: string; password: string }): Promise<TeacherAccount> {
  return request('/users/teachers', teacherAccountSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function resetStudentPassword(token: string, studentId: string, body: { new_password: string }): Promise<PasswordResetResponse> {
  return request(`/users/students/${studentId}/reset-password`, passwordResetResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function submitChallenge(
  token: string,
  body: { poem_title: string; session_id?: string | null; from_level: BloomLevel; student_answer: string },
): Promise<ChallengeSubmitResponse> {
  return request('/students/me/challenges', challengeSubmitResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function listTeacherResults(token: string): Promise<ReviewableResult[]> {
  return request('/teacher/results', resultRecordSchema.array(), { token })
}

export function reviewTeacherResult(token: string, resultId: string, body: { review_status: ReviewStatus; content?: Record<string, unknown> | null }): Promise<ReviewableResult> {
  return request(`/review/results/${resultId}`, resultRecordSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function listTeacherStudentSessions(token: string, studentId: string): Promise<SessionInfo[]> {
  return request(`/teacher/students/${studentId}/sessions`, sessionInfoSchema.array(), { token })
}

export function listTeacherFeedback(token: string, studentId: string): Promise<TeacherFeedback[]> {
  return request(`/teacher/feedback/${studentId}`, teacherFeedbackSchema.array(), { token })
}

export function createTeacherFeedbackEntry(
  token: string,
  body: { student_id: string; content: string; poem_title?: string | null; is_ai_assisted: boolean },
): Promise<TeacherFeedback> {
  return request('/teacher/feedback', teacherFeedbackSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function listBloomOverrides(token: string, studentId: string): Promise<BloomOverrideRecord[]> {
  return request(`/teacher/bloom-overrides/${studentId}`, bloomSnapshotSchema.array(), { token })
}

export function createBloomOverrideEntry(
  token: string,
  body: { student_id: string; bloom_level: BloomLevel; note?: string | null },
): Promise<BloomOverrideRecord> {
  return request('/teacher/bloom-overrides', bloomSnapshotSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function getAdminSkillsSnapshot(token: string): Promise<AdminSkillsSnapshot> {
  return request('/admin/skills', adminSkillsSnapshotSchema, { token })
}

export function upsertAdminConfig(
  token: string,
  body: { config_key: string; config_json: Record<string, unknown> },
): Promise<AdminConfigResponse> {
  return request('/admin/configs', adminConfigResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function listAdminConfigVersions(token: string, configKey: string): Promise<AdminConfigItem[]> {
  return request(`/admin/configs/${configKey}/versions`, adminConfigItemSchema.array(), { token })
}

export function createAdminTemplateVersion(
  token: string,
  body: { task_type: string; template_text: string; activate?: boolean },
): Promise<TemplateVersionActionResponse> {
  return request('/admin/templates', templateVersionActionResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function activateAdminTemplateVersion(token: string, body: { version_id: string }): Promise<TemplateVersionActionResponse> {
  return request('/admin/templates/activate', templateVersionActionResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function rollbackAdminTemplateVersion(token: string, body: { version_id: string }): Promise<TemplateVersionActionResponse> {
  return request('/admin/templates/rollback', templateVersionActionResponseSchema, {
    method: 'POST',
    token,
    body,
  })
}

export function reloadAdminSkills(token: string): Promise<AdminSkillsReloadResponse> {
  return request('/admin/skills/reload', adminSkillsReloadResponseSchema, {
    method: 'POST',
    token,
  })
}
