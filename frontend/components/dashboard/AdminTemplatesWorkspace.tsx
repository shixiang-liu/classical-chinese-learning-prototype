'use client'

import useSWR from 'swr'
import { FormEvent, useMemo, useState } from 'react'
import {
  activateAdminTemplateVersion,
  createAdminTemplateVersion,
  getAdminSkillsSnapshot,
  rollbackAdminTemplateVersion,
} from '@/lib/api'
import { formatTaskType, formatTime } from '@/lib/format'
import { useSession } from '@/hooks/useSession'

export function AdminTemplatesWorkspace() {
  const { token, role, isReady } = useSession()
  const [taskType, setTaskType] = useState('guided_explain')
  const [templateText, setTemplateText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState('')

  const snapshotQuery = useSWR(
    token && role === 'admin' ? ['admin-template-snapshot', token] : null,
    ([, currentToken]) => getAdminSkillsSnapshot(currentToken),
  )

  const snapshot = snapshotQuery.data
  const templateGroups = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof snapshot>['template_versions']>()
    for (const item of snapshot?.template_versions ?? []) {
      const current = grouped.get(item.task_type) ?? []
      current.push(item)
      grouped.set(item.task_type, current)
    }
    return Array.from(grouped.entries())
  }, [snapshot?.template_versions])

  const activeTemplate = snapshot?.active_versions_by_task[taskType]

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || !templateText.trim()) return
    try {
      setBusyAction('create')
      setError(null)
      const response = await createAdminTemplateVersion(token, {
        task_type: taskType,
        template_text: templateText.trim(),
        activate: true,
      })
      setMessage(response.message ?? '模板已创建并生效。')
      setTemplateText('')
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '创建模板失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleActivate = async (versionId: string) => {
    if (!token) return
    try {
      setBusyAction(versionId)
      setError(null)
      const response = await activateAdminTemplateVersion(token, { version_id: versionId })
      setMessage(response.message ?? '模板已切换。')
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '切换模板失败')
    } finally {
      setBusyAction('')
    }
  }

  const handleRollback = async (versionId: string) => {
    if (!token) return
    try {
      setBusyAction(`rollback-${versionId}`)
      setError(null)
      const response = await rollbackAdminTemplateVersion(token, { version_id: versionId })
      setMessage(response.message ?? '模板已回滚。')
      await snapshotQuery.mutate()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '回滚模板失败')
    } finally {
      setBusyAction('')
    }
  }

  if (!isReady) {
    return <section className="flex min-h-[60vh] items-center justify-center text-primary">正在加载模板中心…</section>
  }

  if (role && role !== 'admin') {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">当前账号不是管理员身份</h1>
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
    <div className="space-y-6">
      <section className="rounded-[34px] border border-black/8 bg-white/84 px-6 py-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] tracking-[0.24em] text-on-surface-variant">PROMPT CONTROL</div>
            <h1 className="mt-2 font-headline text-3xl text-primary md:text-4xl">模板管理</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-on-surface-variant">
              这里只管模板版本，不混入运行配置。按任务类型维护当前生效模板，支持新建、切换和回滚。
            </p>
          </div>
          <div className="rounded-[24px] bg-[#103848] px-5 py-5 text-white shadow-[0_20px_42px_rgba(16,56,72,0.18)]">
            <div className="text-[11px] tracking-[0.22em] text-white/55">ACTIVE</div>
            <div className="mt-2 font-headline text-2xl">{formatTaskType(taskType)}</div>
            <div className="mt-2 text-sm text-white/72">
              {activeTemplate ? `当前版本：${activeTemplate.version_id.slice(0, 8)}` : '当前还没有活动模板'}
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-[24px] border border-error/10 bg-error-container/60 px-4 py-4 text-sm text-error">{error}</div> : null}
      {message ? <div className="rounded-[24px] border border-black/8 bg-[#f8f3e8] px-4 py-4 text-sm text-primary">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section className="rounded-[32px] border border-black/8 bg-white/84 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <div className="text-[11px] tracking-[0.22em] text-on-surface-variant">CREATE</div>
          <div className="mt-2 text-xl font-semibold text-primary">新建活动模板</div>
          <form onSubmit={handleCreate} className="mt-5 space-y-4">
            <select
              value={taskType}
              onChange={(event) => setTaskType(event.target.value)}
              className="w-full rounded-[18px] bg-[#fbf7ef] px-4 py-3 text-sm outline-none"
            >
              {(snapshot?.available_tasks ?? []).map((item) => (
                <option key={item} value={item}>
                  {formatTaskType(item)}
                </option>
              ))}
            </select>

            <textarea
              value={templateText}
              onChange={(event) => setTemplateText(event.target.value)}
              className="h-72 w-full rounded-[24px] bg-[#fbf7ef] px-4 py-4 font-mono text-sm leading-7 outline-none"
              placeholder="输入新的模板内容。创建后默认直接激活。"
            />

            <button
              disabled={busyAction === 'create' || templateText.trim().length === 0}
              type="submit"
              className="rounded-full bg-[#103848] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0d3140] disabled:opacity-40"
            >
              {busyAction === 'create' ? '创建中…' : '创建并激活'}
            </button>
          </form>
        </section>

        <section className="rounded-[32px] border border-black/8 bg-white/84 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <div className="text-[11px] tracking-[0.22em] text-on-surface-variant">VERSIONS</div>
          <div className="mt-2 text-xl font-semibold text-primary">版本列表</div>
          <div className="mt-5 space-y-6">
            {templateGroups.map(([groupTaskType, items]) => (
              <section key={groupTaskType} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-on-surface">{formatTaskType(groupTaskType)}</div>
                  <div className="text-xs text-on-surface-variant">{items.length} 个版本</div>
                </div>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.version_id} className="rounded-[24px] border border-black/8 bg-[#faf6ee] px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-on-surface">{item.version_id.slice(0, 8)}</div>
                          <div className="mt-1 text-xs text-on-surface-variant">{formatTime(item.created_at)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {Boolean(item.is_active) ? <span className="rounded-full bg-[#d8eadc] px-3 py-2 text-xs text-secondary">当前生效</span> : null}
                          <button
                            type="button"
                            disabled={Boolean(item.is_active) || busyAction === item.version_id}
                            onClick={() => void handleActivate(item.version_id)}
                            className="rounded-full border border-black/8 bg-white px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary disabled:opacity-40"
                          >
                            启用
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === `rollback-${item.version_id}`}
                            onClick={() => void handleRollback(item.version_id)}
                            className="rounded-full border border-black/8 bg-white px-3 py-2 text-xs text-on-surface-variant transition hover:border-[#103848]/14 hover:text-primary disabled:opacity-40"
                          >
                            回滚复制
                          </button>
                        </div>
                      </div>
                      <pre className="mt-4 overflow-auto rounded-[18px] bg-white px-4 py-4 text-xs leading-6 text-on-surface-variant">
                        {item.template_text}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!templateGroups.length ? <div className="text-sm text-on-surface-variant">当前还没有模板版本。</div> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
