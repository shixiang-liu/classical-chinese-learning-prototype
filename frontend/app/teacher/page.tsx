import { TeacherWorkspace } from '@/components/dashboard/TeacherWorkspace'

type TeacherPageProps = {
  searchParams: Promise<{
    panel?: string
    student?: string
    result?: string
  }>
}

function resolveTeacherMode(panel?: string): 'compose' | 'class' | 'review' {
  if (panel === 'compose') return 'compose'
  if (panel === 'review') return 'review'
  return 'class'
}

export default async function TeacherPage({ searchParams }: TeacherPageProps) {
  const params = await searchParams

  return (
    <TeacherWorkspace
      initialReviewId={params.result ?? ''}
      initialStudent={params.student ?? ''}
      mode={resolveTeacherMode(params.panel)}
    />
  )
}
