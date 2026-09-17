import { redirect } from 'next/navigation'

export default function AdminTemplatesPage() {
  redirect('/admin?panel=data')
}
