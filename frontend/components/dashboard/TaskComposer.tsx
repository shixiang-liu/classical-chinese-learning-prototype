'use client'

import { FormEvent, useMemo, useState } from 'react'
import { exportResultFile, exportSessionFile, runTask } from '@/lib/api'
import { TASK_TYPE_LABELS } from '@/lib/constants'
import type { ResultRecord, TaskType } from '@/lib/types'

type ResultState = 'loading' | 'error' | 'empty' | 'result' | 'review_pending' | 'exported'

type TaskComposerProps = {
  title: string
  description: string
  token: string
  defaultTaskType: TaskType
  taskOptions: TaskType[]
  onResult: (payload: { status: ResultState; error?: string | null; result?: ResultRecord | null; exportPath?: string | null }) => void
}

export function TaskComposer({
  title,
  description,
  token,
  defaultTaskType,
  taskOptions,
  onResult,
}: TaskComposerProps) {
  const [rawInput, setRawInput] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [taskType, setTaskType] = useState<TaskType>(defaultTaskType)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [running, setRunning] = useState(false)
  const [latestResult, setLatestResult] = useState<ResultRecord | null>(null)
  const [exporting, setExporting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const taskLabel = useMemo(() => TASK_TYPE_LABELS[taskType], [taskType])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRunning(true)
    onResult({ status: 'loading' })
    try {
      const response = await runTask(token, {
        raw_input: rawInput,
        task_type: taskType,
        source_text: sourceText.trim() || undefined,
        web_search_enabled: webSearchEnabled,
      })

      const nextStatus: ResultState =
        response.result?.status === 'exported'
          ? 'exported'
          : response.result?.review_status === 'pending_review'
            ? 'review_pending'
            : 'result'

      setLatestResult(response.result)
      onResult({
        status: response.result ? nextStatus : 'empty',
        result: response.result,
      })
    } catch (error) {
      onResult({
        status: 'error',
        error: error instanceof Error ? error.message : '任务执行失败',
      })
    } finally {
      setRunning(false)
    }
  }

  const handleExport = async (kind: 'result' | 'session') => {
    if (!latestResult) return
    setExporting(true)
    try {
      const response =
        kind === 'result'
          ? await exportResultFile(token, latestResult.result_id)
          : await exportSessionFile(token, latestResult.session_id)
      onResult({
        status: 'exported',
        result: latestResult,
        exportPath: response.file_path,
      })
    } catch (error) {
      onResult({
        status: 'error',
        error: error instanceof Error ? error.message : '导出失败',
        result: latestResult,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="composer-shell">
      <div className="composer-heading">
        <span className="panel-kicker">{title}</span>
        <h2 className="composer-title">输入你想学习或处理的内容</h2>
        <p className="composer-subtitle">{description}</p>
      </div>

      <form className="composer-card" onSubmit={handleSubmit}>
        <textarea
          className="composer-input"
          placeholder="输入诗词、文言文、题目，或直接说明你希望得到什么帮助。"
          rows={6}
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
        />

        <div className="composer-toolbar">
          <div className="composer-pills">
            <label className="pill-select">
              <span>{taskLabel}</span>
              <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)}>
                {taskOptions.map((option) => (
                  <option key={option} value={option}>
                    {TASK_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <button className="pill-button" onClick={() => setShowAdvanced((value) => !value)} type="button">
              {showAdvanced ? '收起补充信息' : '补充信息'}
            </button>
            <label className={`pill-button ${webSearchEnabled ? 'pill-button-active' : ''}`}>
              <input checked={webSearchEnabled} onChange={(event) => setWebSearchEnabled(event.target.checked)} type="checkbox" />
              <span>联网查证</span>
            </label>
          </div>

          <button className="composer-send" disabled={running || rawInput.trim().length === 0} type="submit">
            {running ? '生成中' : '开始处理'}
          </button>
        </div>

        {showAdvanced ? (
          <div className="composer-advanced">
            <label className="field">
              <span className="field-label">补充信息</span>
              <textarea
                className="textarea"
                placeholder="可选：补充原文、课堂背景、学习要求或参考材料。"
                rows={4}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
              />
            </label>

            <div className="action-row">
              <button
                className="button button-secondary"
                disabled={exporting || !latestResult}
                onClick={() => handleExport('result')}
                type="button"
              >
                {exporting ? '导出中' : '导出当前结果'}
              </button>
              <button
                className="button button-ghost"
                disabled={exporting || !latestResult}
                onClick={() => handleExport('session')}
                type="button"
              >
                导出本次会话
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  )
}
