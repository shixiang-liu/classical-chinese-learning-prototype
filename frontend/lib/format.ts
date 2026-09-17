import { BLOOM_LABELS, ROLE_LABELS, TASK_TYPE_LABELS } from '@/lib/constants'
import type { BloomLevel, Role, TaskType } from '@/lib/types'

export function formatTime(value: string | null | undefined): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function formatBloom(level: string | null | undefined): string {
  if (!level) return '未推断'
  return BLOOM_LABELS[level as BloomLevel] ?? level
}

export function formatRole(role: Role | null | undefined): string {
  if (!role) return '访客'
  return ROLE_LABELS[role]
}

export function formatTaskType(taskType: string | null | undefined): string {
  if (!taskType) return '未指定任务'
  return TASK_TYPE_LABELS[taskType as TaskType] ?? taskType
}

export function toBoolean(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1
}

export function parseQuestionPayload(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }
  if (typeof value === 'string') {
    return [value]
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map((item) => String(item))
  }
  return []
}
