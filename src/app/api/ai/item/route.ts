/*
 * @Description: 单条信息 AI 解析（POST /api/ai/item）
 *  body: { title: string, url?: string, content?: string, source?: string }
 *  - 未提供 content 且给出 url 时，服务端会尽力抓取正文（含 GBK 解码与 SSRF 防护）；
 *    抓取失败不影响返回，结果里会用 contentSource / fetchNote 说明实际依据
 */
import { NextResponse } from 'next/server'

import { addHistory } from '@/lib/ai-history'
import { analyzeItem } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    const url = typeof body?.url === 'string' ? body.url.trim() : ''

    if (!title && !content) {
      return NextResponse.json(
        { code: 400, msg: '请至少提供标题或正文', data: null, timestamp: Date.now() },
        { status: 400 },
      )
    }

    const data = await analyzeItem({ title, url, content, source: body?.source })

    addHistory({
      feature: 'item',
      label: title || url || '（无标题）',
      text: data.text,
      note: `${data.contentSource === 'fetched' ? '已抓取正文' : data.contentSource === 'provided' ? '手动正文' : '仅标题'}${data.cached ? ' · 命中缓存' : ''}`,
      tokens: data.usage,
    })

    return NextResponse.json({ code: 200, msg: '请求成功', data, timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '分析失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}
