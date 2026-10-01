/*
 * @Description: 设置页（模型 / 邮件订阅 / 导航 / 联网搜索）——需登录
 */
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'

import SettingsClient from './settings-client'

import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `设置 - ${process.env.NEXT_PUBLIC_APP_NAME || 'doroHot'}`,
  description: '模型、订阅与站点偏好设置',
  robots: { index: false, follow: false },
}

export default async function SettingsPage() {
  const session = await getSession()
  if (!session)
    redirect('/login?next=%2Fsettings')
  return <SettingsClient />
}
