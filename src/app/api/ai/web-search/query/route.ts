/* Search through the configured provider. API credentials never leave the server. */
import { NextResponse } from 'next/server'

import { searchWeb } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const query = typeof body?.query === 'string' ? body.query : ''
    const result = await searchWeb(query, typeof body?.limit === 'number' ? body.limit : 5, { allowWhenDisabled: true })
    return NextResponse.json({ code: 200, msg: '搜索完成', data: { ...result, aiContextAllowed: true }, timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '联网搜索失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}
