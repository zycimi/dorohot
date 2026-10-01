/*
 * @Description: 管理后台（/admin）——需登录；概览 + 各管理入口 + 密码/会话
 */
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'

import AdminClient from './admin-client'

import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `管理后台 - ${process.env.NEXT_PUBLIC_APP_NAME || 'doroHot'}`,
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  const session = await getSession()
  if (!session)
    redirect('/login?next=%2Fadmin')
  return <AdminClient username={session.username} />
}
