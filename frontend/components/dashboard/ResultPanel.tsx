'use client'

import { formatBloom, formatTime } from '@/lib/format'
import type {
  GuidedExplainContent,
  LessonOutlineContent,
  QuestionAnalysisContent,
  ResultRecord,
} from '@/lib/types'

type ResultState = 'loading' | 'error' | 'empty' | 'result' | 'review_pending' | 'exported'

type ResultPanelProps = {
  status: ResultState
  error?: string | null
  result?: ResultRecord | null
  exportPath?: string | null
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

export function ResultPanel({ status, error, result, exportPath }: ResultPanelProps) {
  if (status === 'loading') {
    return (
      <section className="panel panel-state">
        <span className="panel-kicker">处理中</span>
        <h3 className="panel-title">正在生成内容</h3>
        <p className="panel-copy">请稍候，结果生成后会显示在这里。</p>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="panel panel-state panel-danger">
        <span className="panel-kicker">请求失败</span>
        <h3 className="panel-title">这次没有成功生成内容</h3>
        <p className="panel-copy">{error ?? '请检查输入内容，或稍后再试。'}</p>
      </section>
    )
  }

  if (status === 'empty' || !result) {
    return (
      <section className="panel panel-state">
        <span className="panel-kicker">结果区</span>
        <h3 className="panel-title">结果会显示在这里</h3>
        <p className="panel-copy">提交问题后，你可以在这里查看生成内容，并在需要时导出文件。</p>
      </section>
    )
  }

  const content = result.content_json as Record<string, unknown>
  const title = typeof content.title === 'string' ? content.title : '未命名内容'
  const badgeText = status === 'review_pending' ? '待复核' : status === 'exported' ? '已导出' : '已生成'

  return (
    <section className="panel panel-result">
      <div className="panel-topline">
        <span className="chip chip-primary">{badgeText}</span>
        {'bloom_level' in content && typeof content.bloom_level === 'string' ? (
          <span className="chip chip-soft">{formatBloom(content.bloom_level)}</span>
        ) : null}
        {result.review_status ? <span className="chip chip-soft">状态：{result.review_status}</span> : null}
      </div>

      <div className="panel-heading">
        <h3 className="panel-title">{title}</h3>
        <p className="panel-copy">
          内容类型：{result.result_type} · 生成时间：{formatTime(result.created_at)}
        </p>
      </div>

      {isGuidedExplain(content) ? (
        <div className="content-stack">
          <div className="content-block">
            <span className="field-label">当前提示层级</span>
            <p>{content.current_hint_level}</p>
          </div>
          <div className="content-block">
            <span className="field-label">讲解内容</span>
            <p>{content.hint_content}</p>
          </div>
          {content.next_challenge_hint ? (
            <div className="content-block">
              <span className="field-label">下一步建议</span>
              <p>{content.next_challenge_hint}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {isQuestionAnalysis(content) ? (
        <div className="content-stack">
          {content.question_text ? (
            <div className="content-block">
              <span className="field-label">题目</span>
              <p>{content.question_text}</p>
            </div>
          ) : null}
          <div className="content-block">
            <span className="field-label">分析步骤</span>
            <ol className="ordered-list">
              {content.analysis_steps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
          <div className="content-grid">
            {Object.entries(content.hint_ladder).map(([key, value]) => (
              <div className="content-block compact" key={key}>
                <span className="field-label">{key}</span>
                <p>{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isLessonOutline(content) ? (
        <div className="content-stack">
          <div className="content-grid">
            <div className="content-block compact">
              <span className="field-label">教学目标</span>
              <ul className="plain-list">
                {content.teaching_goals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="content-block compact">
              <span className="field-label">教学重点</span>
              <ul className="plain-list">
                {content.key_points.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="content-block compact">
            <span className="field-label">教学难点</span>
            <ul className="plain-list">
              {content.difficult_points.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="content-block">
            <span className="field-label">活动流程</span>
            <ol className="ordered-list">
              {content.activity_flow.map((item, index) => (
                <li key={`${index}-${item.description}`}>
                  <strong>{item.name ?? `步骤 ${item.step ?? index + 1}`}</strong>
                  <span className="list-subcopy">{item.duration ? `${item.duration} · ` : ''}{item.description}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {!isGuidedExplain(content) && !isQuestionAnalysis(content) && !isLessonOutline(content) ? (
        <div className="content-block">
          <span className="field-label">原始内容</span>
          <pre className="code-block">{JSON.stringify(content, null, 2)}</pre>
        </div>
      ) : null}

      {(result.evidence_refs?.length ?? 0) > 0 ? (
        <div className="content-block compact">
          <span className="field-label">引用材料</span>
          <ul className="plain-list">
            {result.evidence_refs?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {exportPath ? (
        <div className="inline-notice">
          文件已导出到本地：<code>{exportPath}</code>
        </div>
      ) : null}
    </section>
  )
}
