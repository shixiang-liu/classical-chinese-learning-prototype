import { redirect } from 'next/navigation'

export default async function AdminTracesPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams({ panel: 'audit' })
  if (params.session) query.set('session', params.session)
  redirect(`/admin?${query.toString()}`)
}
