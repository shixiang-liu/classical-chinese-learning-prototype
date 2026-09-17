import { ROLE_LABELS } from '@/lib/constants'
import type { Role } from '@/lib/types'

export function RoleBadge({ role }: { role: Role }) {
  return <span className="chip chip-soft">{ROLE_LABELS[role]}</span>
}
