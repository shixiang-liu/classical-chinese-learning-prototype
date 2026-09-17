import { AdminWorkspace } from '@/components/dashboard/AdminWorkspace'

type AdminPageProps = {
  searchParams: Promise<{
    panel?: string
    session?: string
  }>
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams
  const resolvedPanel =
    params.panel === 'audit' || params.panel === 'settings' || params.panel === 'data' ? params.panel : 'overview'

  return <AdminWorkspace initialPanel={resolvedPanel} initialSession={params.session ?? ''} />
}
