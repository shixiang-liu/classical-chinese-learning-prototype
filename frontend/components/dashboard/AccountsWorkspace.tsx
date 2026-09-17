'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { FormEvent, ReactNode, useMemo, useState } from 'react'
import { batchCreateStudents, createStudent, createTeacher, listStudents, listTeachers, resetStudentPassword } from '@/lib/api'
import { useSession } from '@/hooks/useSession'
import type { BatchCreatedStudent, TeacherAccount } from '@/lib/types'

function Section({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[32px] border border-black/8 bg-white/80 px-5 py-5 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? <div className="text-[11px] tracking-[0.22em] text-on-surface-variant">{eyebrow}</div> : null}
          <h2 className="mt-2 font-headline text-3xl text-primary">{title}</h2>
          {description ? <p className="mt-3 max-w-3xl text-sm leading-7 text-on-surface-variant">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}

function ActionButton({
  children,
  tone = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'secondary'
}) {
  return (
    <button
      {...props}
      className={[
        'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary'
          ? 'border-[#103848]/16 bg-[#103848] text-white hover:bg-[#0d3140]'
          : 'border-black/8 bg-[#f8f3e8] text-on-surface hover:border-[#103848]/12 hover:text-primary',
        props.className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Input({
  as = 'input',
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> &
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    as?: 'input' | 'textarea'
  }) {
  const classes = `w-full rounded-[22px] border border-[#103848]/10 bg-[#fbf7ef] px-4 py-3 text-sm text-on-surface outline-none transition focus:border-[#103848]/20 focus:bg-white ${className}`

  if (as === 'textarea') {
    return <textarea {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} className={classes} />
  }

  return <input {...(props as React.InputHTMLAttributes<HTMLInputElement>)} className={classes} />
}

function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-[22px] border border-[#103848]/10 bg-[#fbf7ef] px-4 py-3 text-sm text-on-surface outline-none transition focus:border-[#103848]/20 focus:bg-white ${className}`}
    >
      {children}
    </select>
  )
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[26px] border border-[#103848]/8 bg-[#faf6ee] px-4 py-4">
      <div className="text-[11px] tracking-[0.18em] text-on-surface-variant">{label}</div>
      <div className="mt-2 font-headline text-3xl text-primary">{value}</div>
      <div className="mt-1 text-sm text-on-surface-variant">{note}</div>
    </div>
  )
}

function teacherName(teachers: TeacherAccount[], teacherId?: string | null) {
  if (!teacherId) return '未绑定教师'
  return teachers.find((item) => item.user_id === teacherId)?.display_name ?? '已绑定教师'
}

export function AccountsWorkspace() {
  const { token, role, isReady } = useSession()
  const canManage = role === 'teacher' || role === 'admin'
  const isAdmin = role === 'admin'

  const studentsQuery = useSWR(
    token && canManage ? ['accounts-students', token] : null,
    ([, currentToken]) => listStudents(currentToken),
  )
  const teachersQuery = useSWR(
    token && isAdmin ? ['accounts-teachers', token] : null,
    ([, currentToken]) => listTeachers(currentToken),
  )

  const [singleForm, setSingleForm] = useState({ display_name: '', username: '', password: '', teacher_id: '' })
  const [batchNames, setBatchNames] = useState('')
  const [batchTeacherId, setBatchTeacherId] = useState('')
  const [resetTarget, setResetTarget] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [teacherForm, setTeacherForm] = useState({ display_name: '', username: '', password: '' })
  const [batchResult, setBatchResult] = useState<BatchCreatedStudent[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const teachers = teachersQuery.data ?? []
  const students = studentsQuery.data ?? []
  const defaultTeacherId = isAdmin ? teachers[0]?.user_id ?? '' : ''
  const selectedTeacherId = singleForm.teacher_id || defaultTeacherId
  const selectedBatchTeacherId = batchTeacherId || defaultTeacherId

  const summaryItems = useMemo(
    () => [
      { label: '学生账号', value: String(students.length), note: '当前可管理学生总数' },
      { label: '教师账号', value: String(teachers.length || (role === 'teacher' ? 1 : 0)), note: isAdmin ? '管理员可查看全部教师' : '当前教师上下文' },
      { label: '最近批量开通', value: String(batchResult.length), note: batchResult.length ? '本轮生成的学生账号数量' : '最近还没有批量开通结果' },
    ],
    [batchResult.length, role, students.length, teachers.length, isAdmin],
  )

  if (!isReady) {
    return <section className="flex min-h-[60vh] items-center justify-center text-primary">正在加载账号管理...</section>
  }

  if (!token || !canManage) {
    return (
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-headline text-3xl text-primary">当前身份无权访问账号管理</h1>
          <p className="mt-3 text-sm text-on-surface-variant">请切换到教师或管理员账号。</p>
        </div>
      </section>
    )
  }

  const handleCreateStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      await createStudent(token, {
        display_name: singleForm.display_name,
        username: singleForm.username,
        password: singleForm.password,
        teacher_id: isAdmin ? selectedTeacherId || undefined : undefined,
      })
      setSingleForm((current) => ({ ...current, display_name: '', username: '', password: '' }))
      setMessage('学生账号已创建。')
      await studentsQuery.mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建学生失败')
    }
  }

  const handleBatchCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const names = batchNames
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (!names.length) {
      setMessage('请先输入至少一个学生姓名。')
      return
    }

    try {
      const created = await batchCreateStudents(token, {
        students: names.map((display_name) => ({ display_name })),
        teacher_id: isAdmin ? selectedBatchTeacherId || undefined : undefined,
      })
      setBatchResult(created)
      setBatchNames('')
      setMessage(`已批量创建 ${created.length} 个学生账号。`)
      await studentsQuery.mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量创建失败')
    }
  }

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!resetTarget || !resetPassword.trim()) return

    try {
      await resetStudentPassword(token, resetTarget, { new_password: resetPassword })
      setResetPassword('')
      setMessage('密码已重置。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置密码失败')
    }
  }

  const handleCreateTeacher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      await createTeacher(token, teacherForm)
      setTeacherForm({ display_name: '', username: '', password: '' })
      setMessage('教师账号已创建。')
      await teachersQuery.mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建教师失败')
    }
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[radial-gradient(circle_at_top,rgba(16,56,72,0.12),transparent_32%),linear-gradient(180deg,#fbf7ef_0%,#f2ead9_100%)]">
      <section className="mx-auto max-w-[1280px] space-y-6 px-4 py-8">
        <Section
          eyebrow="ACCOUNT OPERATIONS"
          title="成员与账号运营"
          description="把最常用的成员操作集中到一个工作台里。先看当前成员规模，再按需要创建学生、批量开通、重置密码或新增教师。"
          actions={
            isAdmin ? (
              <Link className="rounded-full border border-black/8 bg-[#f8f3e8] px-4 py-2 text-sm font-medium text-primary transition hover:border-[#103848]/12" href="/admin/skills">
                返回系统管理
              </Link>
            ) : null
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            {summaryItems.map((item) => (
              <SummaryCard key={item.label} label={item.label} value={item.value} note={item.note} />
            ))}
          </div>
          {message ? <div className="mt-5 rounded-[24px] border border-[#103848]/10 bg-[#f8f3e8] px-4 py-4 text-sm text-primary">{message}</div> : null}
        </Section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.06fr)_440px]">
          <Section
            eyebrow="MEMBER LIST"
            title="学生账号"
            description={isAdmin ? '管理员可以查看所有学生及其教师归属。' : '这里仅显示你当前负责的学生。'}
          >
            <div className="space-y-3">
              {students.map((item) => (
                <div key={item.user_id} className="rounded-[26px] border border-black/8 bg-[#faf6ee] px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-on-surface">{item.display_name}</div>
                      <div className="mt-1 text-sm text-on-surface-variant">@{item.username}</div>
                    </div>
                    <div className="rounded-full bg-white px-3 py-2 text-xs text-on-surface-variant">{item.role === 'student' ? '学生' : item.role}</div>
                  </div>
                  <div className="mt-3 text-sm leading-7 text-on-surface-variant">
                    {isAdmin ? `教师归属：${teacherName(teachers, item.teacher_id)}` : '归属：当前教师'}
                  </div>
                </div>
              ))}
              {!students.length ? <div className="rounded-[24px] bg-[#faf6ee] px-4 py-4 text-sm text-on-surface-variant">当前还没有可维护的学生账号。</div> : null}
            </div>

            {batchResult.length ? (
              <div className="mt-6 rounded-[28px] border border-black/8 bg-white px-5 py-5">
                <div className="text-[11px] tracking-[0.2em] text-on-surface-variant">LATEST BATCH</div>
                <div className="mt-2 font-headline text-2xl text-primary">最近批量开通结果</div>
                <div className="mt-4 space-y-3">
                  {batchResult.map((item) => (
                    <div key={item.user_id} className="rounded-[22px] bg-[#faf6ee] px-4 py-4">
                      <div className="text-sm font-medium text-on-surface">
                        {item.display_name} · @{item.username}
                      </div>
                      <div className="mt-2 text-sm text-on-surface-variant">初始密码：{item.initial_password}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>

          <div className="space-y-6">
            <Section eyebrow="OPERATIONS" title="常用操作" description="按实际工作流拆成四组。你不需要在多个页面之间来回切换。">
              <div className="space-y-4">
                <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5">
                  <div className="text-base font-semibold text-on-surface">手动创建学生账号</div>
                  <form className="mt-5 space-y-4" onSubmit={handleCreateStudent}>
                    <Input
                      placeholder="学生姓名"
                      value={singleForm.display_name}
                      onChange={(event) => setSingleForm({ ...singleForm, display_name: event.target.value })}
                    />
                    <Input
                      placeholder="登录用户名"
                      value={singleForm.username}
                      onChange={(event) => setSingleForm({ ...singleForm, username: event.target.value })}
                    />
                    <Input
                      placeholder="初始密码"
                      type="password"
                      value={singleForm.password}
                      onChange={(event) => setSingleForm({ ...singleForm, password: event.target.value })}
                    />
                    {isAdmin ? (
                      <Select value={selectedTeacherId} onChange={(event) => setSingleForm({ ...singleForm, teacher_id: event.target.value })}>
                        <option value="">选择绑定教师</option>
                        {teachers.map((item) => (
                          <option key={item.user_id} value={item.user_id}>
                            {item.display_name}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    <ActionButton
                      disabled={
                        !singleForm.display_name.trim() ||
                        !singleForm.username.trim() ||
                        !singleForm.password.trim() ||
                        (isAdmin && !selectedTeacherId)
                      }
                      type="submit"
                    >
                      创建学生
                    </ActionButton>
                  </form>
                </div>

                <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5">
                  <div className="text-base font-semibold text-on-surface">批量开通学生账号</div>
                  <form className="mt-5 space-y-4" onSubmit={handleBatchCreate}>
                    {isAdmin ? (
                      <Select value={selectedBatchTeacherId} onChange={(event) => setBatchTeacherId(event.target.value)}>
                        <option value="">选择绑定教师</option>
                        {teachers.map((item) => (
                          <option key={item.user_id} value={item.user_id}>
                            {item.display_name}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    <Input
                      as="textarea"
                      className="h-36"
                      placeholder={'每行一个学生姓名，例如：\n李白\n杜甫\n白居易'}
                      value={batchNames}
                      onChange={(event) => setBatchNames(event.target.value)}
                    />
                    <ActionButton disabled={!batchNames.trim() || (isAdmin && !selectedBatchTeacherId)} type="submit" tone="secondary">
                      批量生成
                    </ActionButton>
                  </form>
                </div>

                <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5">
                  <div className="text-base font-semibold text-on-surface">重置学生密码</div>
                  <form className="mt-5 space-y-4" onSubmit={handleResetPassword}>
                    <Select value={resetTarget} onChange={(event) => setResetTarget(event.target.value)}>
                      <option value="">选择学生</option>
                      {students.map((item) => (
                        <option key={item.user_id} value={item.user_id}>
                          {item.display_name} @{item.username}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder="新密码"
                      type="password"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                    />
                    <ActionButton disabled={!resetTarget || !resetPassword.trim()} type="submit" tone="secondary">
                      重置密码
                    </ActionButton>
                  </form>
                </div>

                {isAdmin ? (
                  <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5">
                    <div className="text-base font-semibold text-on-surface">创建教师账号</div>
                    <form className="mt-5 space-y-4" onSubmit={handleCreateTeacher}>
                      <Input
                        placeholder="教师姓名"
                        value={teacherForm.display_name}
                        onChange={(event) => setTeacherForm({ ...teacherForm, display_name: event.target.value })}
                      />
                      <Input
                        placeholder="登录用户名"
                        value={teacherForm.username}
                        onChange={(event) => setTeacherForm({ ...teacherForm, username: event.target.value })}
                      />
                      <Input
                        placeholder="初始密码"
                        type="password"
                        value={teacherForm.password}
                        onChange={(event) => setTeacherForm({ ...teacherForm, password: event.target.value })}
                      />
                      <ActionButton
                        disabled={!teacherForm.display_name.trim() || !teacherForm.username.trim() || !teacherForm.password.trim()}
                        type="submit"
                      >
                        创建教师
                      </ActionButton>
                    </form>
                  </div>
                ) : null}
              </div>
            </Section>
          </div>
        </div>
      </section>
    </div>
  )
}
