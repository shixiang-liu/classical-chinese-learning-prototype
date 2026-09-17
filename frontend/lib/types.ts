export type Role = 'student' | 'teacher' | 'admin'
export type TaskType = 'lesson_outline' | 'question_analysis' | 'guided_explain' | 'general_chat'
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create'
export type ReviewStatus = 'accepted' | 'edited' | 'rejected'
export type HistoryMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type ContentAnchor = {
  content_type: string
  title?: string | null
  confidence: 'high' | 'low' | 'none'
}

export type SessionInfo = {
  session_id: string
  project_id?: string | null
  project_title?: string | null
  project_content_type?: string | null
  role: Role
  status: string
  task_type: string
  context_mode: string
  created_at: string
  prompt_preview?: string | null
}

export type ProjectInfo = {
  project_id: string
  title: string
  content_type: string
  owner_id: string
  owner_role: Role | string
  status: string
  created_at: string
  latest_prompt_preview?: string | null
  latest_session_at?: string | null
  latest_result_at?: string | null
  session_count?: number
  result_count?: number
}

export type User = {
  user_id: string
  username: string
  display_name: string
  role: Role
  teacher_id?: string | null
  session?: {
    user_id: string
    role: Role
    remember_me: boolean
    exp: number
  }
}

export type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: User
}

export type HintLevel = 'hint_1' | 'hint_2' | 'hint_3' | 'answer'

export type GuidedExplainContent = {
  title: string
  bloom_level: BloomLevel
  current_hint_level: HintLevel
  hint_content: string
  next_challenge_hint?: string | null
  evidence_refs: string[]
}

export type QuestionAnalysisContent = {
  title: string
  question_text: string
  analysis_steps: string[]
  hint_ladder: {
    hint_1: string
    hint_2: string
    hint_3: string
    answer: string
  }
  evidence_refs: string[]
}

export type LessonOutlineContent = {
  title: string
  teaching_goals: string[]
  key_points: string[]
  difficult_points: string[]
  activity_flow: Array<{
    step: string | number
    name?: string
    duration?: string
    description: string
  }>
  evidence_refs: string[]
}

export type GeneralChatContent = {
  title: string
  answer: string
  follow_up?: string | null
  evidence_refs: string[]
}

export type ResultContent =
  | GuidedExplainContent
  | QuestionAnalysisContent
  | LessonOutlineContent
  | GeneralChatContent
  | Record<string, unknown>

export type ResultRecord = {
  result_id: string
  session_id: string
  result_type: TaskType
  status: string
  review_status: string
  content_json: ResultContent
  evidence_refs?: string[]
  created_at?: string
}

export type RunTaskResponse = {
  session: SessionInfo
  result: ResultRecord | null
  project?: ProjectInfo | null
  state: {
    content_type?: string
    task_type?: string
    bloom_level?: BloomLevel
    error_code?: string | null
    context_mode?: string
    content_anchor?: ContentAnchor | null
    [key: string]: unknown
  }
}

export type FileExtractResponse = {
  file_name: string
  content_type: string
  text: string
}

export type ExportResponse = {
  format: 'docx' | 'json'
  file_path: string
  fallback_message?: string | null
}

export type SessionDetail = {
  session: SessionInfo & { user_id?: string | null; prompt_preview?: string | null }
  result: ResultRecord | null
  messages?: Array<{
    message_id: string
    role: 'user' | 'assistant'
    text: string
    created_at: string
    poem_title?: string | null
    challenge_preview?: Record<string, unknown> | null
  }>
  active_challenge?: {
    message_id: string
    poem_title: string
    preview: Record<string, unknown>
  } | null
}

export type ProjectDetail = {
  project: ProjectInfo
  sessions: SessionInfo[]
  results: ResultRecord[]
  metrics: {
    session_count: number
    result_count: number
    ready_result_count?: number
    pending_review_count?: number
    latest_session_at?: string | null
    latest_result_at?: string | null
    latest_prompt_preview?: string | null
  }
}

export type TraceSummary = {
  session_id: string
  user_id?: string | null
  user_role: Role
  task_type: string
  context_mode: string
  session_status: string
  result_id?: string | null
  result_type?: string | null
  review_status?: string | null
  event_count: number
  last_event_type?: string | null
  last_error_code?: string | null
  current_bloom_level?: string | null
  pipeline_stages: string[]
  created_at: string
}

export type TraceDetail = {
  session: SessionInfo & { user_id?: string | null }
  result: ResultRecord | null
  events: Array<Record<string, unknown>>
  stage_summary: Array<{
    stage: string
    actor: string
    bloom_level?: string | null
    mastery_status?: string | null
    error_code?: string | null
    created_at: string
  }>
}

export type BloomSnapshot = {
  override_id?: string
  student_id?: string
  teacher_id?: string
  bloom_level: BloomLevel
  mastery_status: string
  note?: string | null
  created_at: string
}

export type ChallengeAttempt = {
  attempt_id: string
  user_id: string
  poem_title: string
  from_level: BloomLevel
  to_level: BloomLevel
  difficulty: string
  question_json: Record<string, unknown> | string[] | string
  rubric_json: string[]
  student_answer: string
  score: number
  passed: number | boolean
  review_needed: number | boolean
  created_at: string
}

export type ChallengePreview = {
  poem_title: string
  from_level: BloomLevel
  to_level: BloomLevel
  difficulty: string
  review_needed: boolean
  question_json: Record<string, unknown>
  rubric_json: string[]
}

export type TeacherMasteryItem = {
  student_id: string
  username: string
  display_name: string
  bloom_level: BloomLevel
  mastery_status: string
  last_error_type?: string | null
  last_inferred_cause?: string | null
  last_challenge_to_level?: string | null
  last_challenge_score?: number | null
  last_review_needed?: number | null
  updated_at?: string | null
}

export type StudentAccount = {
  user_id: string
  username: string
  display_name: string
  role: 'student'
  teacher_id?: string | null
}

export type TeacherAccount = {
  user_id: string
  username: string
  display_name: string
  role: 'teacher'
}

export type BatchCreatedStudent = StudentAccount & {
  initial_password: string
}

export type PasswordResetResponse = {
  student_id: string
  password_reset: boolean
}

export type ChallengeSubmitResponse = {
  attempt: ChallengeAttempt
  current_bloom: BloomSnapshot | null
  review_needed: boolean
  passed: boolean
  error_type?: string | null
  inferred_cause?: string | null
  message?: string | null
}

export type TeacherFeedback = {
  feedback_id: string
  teacher_id: string
  student_id: string
  poem_title?: string | null
  content: string
  is_ai_assisted: boolean | number
  created_at: string
}

export type ReviewableResult = ResultRecord

export type BloomOverrideRecord = BloomSnapshot

export type AdminSkillRegistryItem = {
  task_type: TaskType | string
  enabled: boolean
  context_mode: string
  registered: boolean
  last_error?: string | null
}

export type AdminSkillRegistry = Record<string, AdminSkillRegistryItem>

export type AdminConfigItem = {
  config_key: string
  config_json: Record<string, unknown>
  updated_by: string
  updated_at: string
  version_id?: string | null
  summary?: string | null
  source_version_id?: string | null
}

export type McpStatus = {
  config_key: string
  enabled: boolean
  providers: string[]
  hot_reload: boolean
  updated_by?: string | null
  updated_at?: string | null
  version_id?: string | null
  summary?: string | null
  source_version_id?: string | null
  last_reload?: string | null
  last_error?: string | null
}

export type TemplateVersionItem = {
  version_id: string
  task_type: TaskType | string
  template_text: string
  created_by: string
  created_at: string
  is_active: number | boolean
  summary?: string | null
  source_version_id?: string | null
}

export type AdminSkillsSnapshot = {
  current_template_version?: Record<string, unknown> | null
  template_versions: TemplateVersionItem[]
  admin_configs: AdminConfigItem[]
  skills: AdminSkillRegistry
  mcp: McpStatus
  available_tasks: string[]
  active_versions_by_task: Record<string, TemplateVersionItem>
}

export type AdminConfigResponse = {
  config: AdminConfigItem
  configs: AdminConfigItem[]
  ok: boolean
  message?: string | null
}

export type ProjectMutationResponse = {
  project: ProjectInfo
  ok: boolean
  message?: string | null
}

export type TemplateVersionActionResponse = {
  version: TemplateVersionItem
  versions: TemplateVersionItem[]
  ok: boolean
  message?: string | null
}

export type AdminSkillsActionResponse = {
  snapshot: AdminSkillsSnapshot
  ok: boolean
  message?: string | null
}

export type AdminSkillsReloadResponse = {
  ok: boolean
  message?: string | null
  mcp: McpStatus
  skills: AdminSkillRegistry
}
