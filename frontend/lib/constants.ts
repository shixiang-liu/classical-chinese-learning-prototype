import type { BloomLevel, Role, TaskType } from '@/lib/types'

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000'

export const BLOOM_LABELS: Record<BloomLevel, string> = {
  remember: '识记',
  understand: '理解',
  apply: '应用',
  analyze: '分析',
  evaluate: '评鉴',
  create: '创造',
}

export const ROLE_LABELS: Record<Role, string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
}

export const ROLE_HOME: Record<Role, string> = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin',
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  guided_explain: '引导讲解',
  question_analysis: '题目解析',
  lesson_outline: '备课提纲',
  general_chat: '普通对话',
}

export const STUDENT_TASK_OPTIONS: TaskType[] = ['guided_explain', 'question_analysis']
export const TEACHER_TASK_OPTIONS: TaskType[] = ['question_analysis', 'lesson_outline', 'guided_explain']

export const BLOOM_OPTIONS: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']

export const BLOOM_DESCRIPTIONS: Record<BloomLevel, string> = {
  remember: '认出诗句、作者和字面信息。',
  understand: '能用自己的话说明大意、情感和依据。',
  apply: '能把方法迁移到类似诗句或题目里。',
  analyze: '能拆开意象、手法和表达作用。',
  evaluate: '能比较不同理解并作出判断。',
  create: '能延展表达、改写或形成自己的观点。',
}
