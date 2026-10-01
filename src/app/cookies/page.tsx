/*
 * @Description: Cookies 管理子页面（/cookies）——需登录
 */
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'

import CookiesManager from './cookies-manager'

import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Cookies 管理 - ${process.env.NEXT_PUBLIC_APP_NAME || 'doroHot'}`,
  robots: { index: false, follow: false },
}

export default async function CookiesPage() {
  const session = await getSession()
  if (!session)
    redirect('/login?next=%2Fcookies')
  return <CookiesManager />
}
