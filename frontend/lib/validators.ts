import { z } from 'zod'

export const userSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
  teacher_id: z.string().nullable().optional(),
  session: z.object({
    user_id: z.string(),
    role: z.enum(['student', 'teacher', 'admin']),
    remember_me: z.boolean(),
    exp: z.number(),
  }).optional(),
})

export const contentAnchorSchema = z.object({
  content_type: z.string(),
  title: z.string().nullable().optional(),
  confidence: z.enum(['high', 'low', 'none']),
})

export const loginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('bearer').default('bearer'),
  user: userSchema,
})

export const sessionInfoSchema = z.object({
  session_id: z.string(),
  project_id: z.string().nullable().optional(),
  project_title: z.string().nullable().optional(),
  project_content_type: z.string().nullable().optional(),
  role: z.enum(['student', 'teacher', 'admin']),
  status: z.string(),
  task_type: z.string(),
  context_mode: z.string(),
  created_at: z.string(),
  prompt_preview: z.string().nullable().optional(),
})

export const projectInfoSchema = z.object({
  project_id: z.string(),
  title: z.string(),
  content_type: z.string(),
  owner_id: z.string(),
  owner_role: z.string(),
  status: z.string(),
  created_at: z.string(),
  latest_prompt_preview: z.string().nullable().optional(),
  latest_session_at: z.string().nullable().optional(),
  latest_result_at: z.string().nullable().optional(),
  session_count: z.number().optional(),
  result_count: z.number().optional(),
})

export const resultRecordSchema = z.object({
  result_id: z.string(),
  session_id: z.string(),
  result_type: z.enum(['lesson_outline', 'question_analysis', 'guided_explain', 'general_chat']),
  status: z.string(),
  review_status: z.string(),
  content_json: z.record(z.string(), z.unknown()),
  evidence_refs: z.array(z.string()).optional(),
  created_at: z.string().optional(),
})

export const sessionTranscriptMessageSchema = z.object({
  message_id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  created_at: z.string(),
  poem_title: z.string().nullable().optional(),
  challenge_preview: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const runTaskResponseSchema = z.object({
  session: sessionInfoSchema,
  result: resultRecordSchema.nullable(),
  project: projectInfoSchema.nullable().optional(),
  state: z.record(z.string(), z.unknown()).and(
    z.object({
      content_anchor: contentAnchorSchema.nullable().optional(),
    }),
  ),
})

export const fileExtractResponseSchema = z.object({
  file_name: z.string(),
  content_type: z.string(),
  text: z.string(),
})

export const exportResponseSchema = z.object({
  format: z.enum(['docx', 'json']),
  file_path: z.string(),
  fallback_message: z.string().nullable().optional(),
})

export const sessionDetailSchema = z.object({
  session: sessionInfoSchema.extend({
    user_id: z.string().nullable().optional(),
    prompt_preview: z.string().nullable().optional(),
  }),
  result: resultRecordSchema.nullable(),
  messages: z.array(sessionTranscriptMessageSchema).optional(),
  active_challenge: z
    .object({
      message_id: z.string(),
      poem_title: z.string(),
      preview: z.record(z.string(), z.unknown()),
    })
    .nullable()
    .optional(),
})

export const projectDetailSchema = z.object({
  project: projectInfoSchema,
  sessions: sessionInfoSchema.array(),
  results: resultRecordSchema.array(),
  metrics: z.object({
    session_count: z.number(),
    result_count: z.number(),
    ready_result_count: z.number().optional(),
    pending_review_count: z.number().optional(),
    latest_session_at: z.string().nullable().optional(),
    latest_result_at: z.string().nullable().optional(),
    latest_prompt_preview: z.string().nullable().optional(),
  }),
})

export const projectListSchema = z.object({
  projects: projectInfoSchema.array(),
  total: z.number(),
  owner_role: z.string().optional(),
  owner_id: z.string().optional(),
})

export const projectMutationResponseSchema = z.object({
  project: projectInfoSchema,
  ok: z.boolean(),
  message: z.string().nullable().optional(),
})

export const sessionDeleteResponseSchema = z.object({
  deleted: z.boolean(),
  session_id: z.string(),
})

export const traceSummarySchema = z.object({
  session_id: z.string(),
  user_id: z.string().nullable().optional(),
  user_role: z.enum(['student', 'teacher', 'admin']),
  task_type: z.string(),
  context_mode: z.string(),
  session_status: z.string(),
  result_id: z.string().nullable().optional(),
  result_type: z.string().nullable().optional(),
  review_status: z.string().nullable().optional(),
  event_count: z.number(),
  last_event_type: z.string().nullable().optional(),
  last_error_code: z.string().nullable().optional(),
  current_bloom_level: z.string().nullable().optional(),
  pipeline_stages: z.array(z.string()),
  created_at: z.string(),
})

export const traceDetailSchema = z.object({
  session: sessionInfoSchema.extend({
    user_id: z.string().nullable().optional(),
  }),
  result: resultRecordSchema.nullable(),
  events: z.array(z.record(z.string(), z.unknown())),
  stage_summary: z.array(
    z.object({
      stage: z.string(),
      actor: z.string(),
      bloom_level: z.string().nullable().optional(),
      mastery_status: z.string().nullable().optional(),
      error_code: z.string().nullable().optional(),
      created_at: z.string(),
    }),
  ),
})

export const bloomSnapshotSchema = z.object({
  override_id: z.string().optional(),
  student_id: z.string().optional(),
  teacher_id: z.string().optional(),
  bloom_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  mastery_status: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string(),
})

export const challengeAttemptSchema = z.object({
  attempt_id: z.string(),
  user_id: z.string(),
  poem_title: z.string(),
  from_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  to_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  difficulty: z.string(),
  question_json: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.string()),
    z.string(),
  ]),
  rubric_json: z.array(z.string()),
  student_answer: z.string(),
  score: z.number(),
  passed: z.union([z.boolean(), z.number()]),
  review_needed: z.union([z.boolean(), z.number()]),
  created_at: z.string(),
})

export const challengePreviewSchema = z.object({
  poem_title: z.string(),
  from_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  to_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  difficulty: z.string(),
  review_needed: z.boolean(),
  question_json: z.record(z.string(), z.unknown()),
  rubric_json: z.array(z.string()),
})

export const teacherMasteryItemSchema = z.object({
  student_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  bloom_level: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  mastery_status: z.string(),
  last_error_type: z.string().nullable().optional(),
  last_inferred_cause: z.string().nullable().optional(),
  last_challenge_to_level: z.string().nullable().optional(),
  last_challenge_score: z.number().nullable().optional(),
  last_review_needed: z.number().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const studentAccountSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.literal('student'),
  teacher_id: z.string().nullable().optional(),
})

export const teacherAccountSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.literal('teacher'),
})

export const batchCreatedStudentSchema = studentAccountSchema.extend({
  initial_password: z.string(),
})

export const passwordResetResponseSchema = z.object({
  student_id: z.string(),
  password_reset: z.boolean(),
})

export const challengeSubmitResponseSchema = z.object({
  attempt: challengeAttemptSchema,
  current_bloom: bloomSnapshotSchema.nullable(),
  review_needed: z.boolean(),
  passed: z.boolean(),
  error_type: z.string().nullable().optional(),
  inferred_cause: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
})

export const teacherFeedbackSchema = z.object({
  feedback_id: z.string(),
  teacher_id: z.string(),
  student_id: z.string(),
  poem_title: z.string().nullable().optional(),
  content: z.string(),
  is_ai_assisted: z.union([z.boolean(), z.number()]),
  created_at: z.string(),
})

export const adminSkillRegistryItemSchema = z.object({
  task_type: z.string(),
  enabled: z.boolean(),
  context_mode: z.string(),
  registered: z.boolean(),
  last_error: z.string().nullable().optional(),
})

export const adminConfigItemSchema = z.object({
  config_key: z.string(),
  config_json: z.record(z.string(), z.unknown()),
  updated_by: z.string(),
  updated_at: z.string(),
  version_id: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  source_version_id: z.string().nullable().optional(),
})

export const mcpStatusSchema = z.object({
  config_key: z.string(),
  enabled: z.boolean(),
  providers: z.array(z.string()),
  hot_reload: z.boolean(),
  updated_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  version_id: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  source_version_id: z.string().nullable().optional(),
  last_reload: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
})

export const templateVersionItemSchema = z.object({
  version_id: z.string(),
  task_type: z.string(),
  template_text: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  is_active: z.union([z.boolean(), z.number()]),
  summary: z.string().nullable().optional(),
  source_version_id: z.string().nullable().optional(),
})

export const adminSkillsSnapshotSchema = z.object({
  current_template_version: z.record(z.string(), z.unknown()).nullable().optional(),
  template_versions: templateVersionItemSchema.array(),
  admin_configs: adminConfigItemSchema.array(),
  skills: z.record(z.string(), adminSkillRegistryItemSchema),
  mcp: mcpStatusSchema,
  available_tasks: z.array(z.string()),
  active_versions_by_task: z.record(z.string(), templateVersionItemSchema),
})

export const adminConfigResponseSchema = z.object({
  config: adminConfigItemSchema,
  configs: adminConfigItemSchema.array(),
  ok: z.boolean(),
  message: z.string().nullable().optional(),
})

export const templateVersionActionResponseSchema = z.object({
  version: templateVersionItemSchema,
  versions: templateVersionItemSchema.array(),
  ok: z.boolean(),
  message: z.string().nullable().optional(),
})

export const adminSkillsActionResponseSchema = z.object({
  snapshot: adminSkillsSnapshotSchema,
  ok: z.boolean(),
  message: z.string().nullable().optional(),
})

export const adminSkillsReloadResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().nullable().optional(),
  mcp: mcpStatusSchema,
  skills: z.record(z.string(), adminSkillRegistryItemSchema),
})
