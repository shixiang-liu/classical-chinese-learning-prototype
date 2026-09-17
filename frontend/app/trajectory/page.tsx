import { StudentWorkspace } from '@/components/dashboard/StudentWorkspace'

export default async function TrajectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const params = await searchParams
  return <StudentWorkspace initialSession={params.session ?? ''} mode="trajectory" />
}
