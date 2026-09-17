import { redirect } from 'next/navigation'

export default async function TeacherReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; result?: string }>
}) {
  const params = await searchParams
  const nextParams = new URLSearchParams({ panel: 'review' })

  if (params.student) nextParams.set('student', params.student)
  if (params.result) nextParams.set('result', params.result)

  redirect(`/teacher?${nextParams.toString()}`)
}
