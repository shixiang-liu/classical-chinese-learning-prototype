import './globals.css'
import { Suspense } from 'react'
import { AppShell } from '@/components/shared/AppShell'
import { SessionProvider } from '@/hooks/useSession'

export const metadata = {
  title: '古诗文教学工作台',
  description: '面向学生、教师与管理员的学校场景 AI 教学工作台。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionProvider>
          <Suspense fallback={<main className="min-h-screen bg-surface" />}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </SessionProvider>
      </body>
    </html>
  )
}
