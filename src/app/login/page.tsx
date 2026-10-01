/*
 * @Description: 登录 / 首次初始化（/login）
 */
import type { Metadata } from 'next'

import { isInitialized } from '@/lib/auth'

import LoginClient from './login-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `登录 - ${process.env.NEXT_PUBLIC_APP_NAME || 'doroHot'}`,
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  // 把「是否已初始化」透传，首屏即显示正确文案（未初始化 → 创建管理员），避免客户端切换闪烁
  return <LoginClient initialized={isInitialized()} />
}
