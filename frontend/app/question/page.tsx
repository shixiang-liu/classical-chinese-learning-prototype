import { redirect } from 'next/navigation'

export default function QuestionPage() {
  redirect('/teacher?panel=compose')
}
