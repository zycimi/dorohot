/* GET public search settings (without secrets), POST updates provider configuration. */

import { NextResponse } from 'next/server'

import { getPublicWebSearchSettings, saveWebSearchSettings } from '@/lib/ai'
import type { WebSearchProvider } from '@/lib/ai'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  return NextResponse.json({ code: 200, msg: '请求成功', data: getPublicWebSearchSettings(), timestamp: Date.now() })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined
    const allowed = ['exa', 'firecrawl', 'parallel', 'tavily', 'bing-rss', 'google-cse']
    const provider = allowed.includes(body?.provider) ? body.provider as WebSearchProvider : undefined
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined
    const googleCx = typeof body?.googleCx === 'string' ? body.googleCx : undefined
    const clearApiKey = body?.clearApiKey === true
    saveWebSearchSettings({ enabled, provider, apiKey, googleCx, clearApiKey })
    return NextResponse.json({ code: 200, msg: '联网搜索设置已保存', data: getPublicWebSearchSettings(), timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '保存联网搜索设置失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}
