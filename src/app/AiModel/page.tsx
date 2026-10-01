/*
 * @Description: 旧 AI 助手页面地址 —— 服务端 302 回首页悬浮抽屉
 *
 * 原 `/AiModel` 现在由首页右下角 AiAssistant 承载，这里保留路由做深链兼容：
 * 把 `?tab/summary...&title=...&url=...` 原样搬到首页，并补 `ai=1` 触发抽屉。
 */
import { redirect } from 'next/navigation'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AiPage({ searchParams }: Props) {
  const params = await searchParams
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value)
        query.append(key, item)
    }
    else if (value !== undefined) {
      query.set(key, value)
    }
  }

  query.set('ai', '1')
  redirect(`/?${query.toString()}`)
}
