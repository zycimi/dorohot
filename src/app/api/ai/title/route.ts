/*
 * @Description: 为一段对话生成简短标题（POST /api/ai/title）
 *  body: { text: string }
 *  用于「历史对话」重命名弹窗里的「自动命名」按钮。
 */
import { NextResponse } from 'next/server'

import { chatConversation } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = '你是起标题助手。只输出标题本身，不要任何解释、引号或标点。'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 3000) : ''
    if (!text) {
      return NextResponse.json(
        { code: 400, msg: '缺少对话内容', data: null, timestamp: Date.now() },
        { status: 400 },
      )
    }

    const result = await chatConversation(
      [{ role: 'user', content: `请为下面这段对话起一个中文标题：不超过 12 个字，概括主题，只输出标题本身。\n\n${text}` }],
      { system: SYSTEM, temperature: 0.3, maxTokens: 200, timeoutMs: 30_000 },
    )

    const title = result.text
      .replace(/[\r\n]+/g, ' ')
      .replace(/^[\s"'“”「」『』《》【】#*\-]+/, '')
      .replace(/[\s"'“”「」『』《》【】。，,.!！?？#*\-]+$/, '')
      .trim()
      .slice(0, 20)

    if (!title)
      throw new Error('模型没有返回有效标题')

    return NextResponse.json({ code: 200, msg: '请求成功', data: { title }, timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '自动命名失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}
