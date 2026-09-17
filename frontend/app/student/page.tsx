import { StudentWorkspace } from '@/components/dashboard/StudentWorkspace'

type StudentPageProps = {
  searchParams: Promise<{
    panel?: string
    session?: string
  }>
}

function resolveStudentMode(panel?: string): 'overview' | 'trajectory' | 'challenge' {
  if (panel === 'history' || panel === 'trajectory') return 'trajectory'
  if (panel === 'challenge') return 'challenge'
  return 'overview'
}

export default async function StudentPage({ searchParams }: StudentPageProps) {
  const params = await searchParams

  return <StudentWorkspace mode={resolveStudentMode(params.panel)} initialSession={params.session ?? ''} />
}
