/*
 * @Description: AI Chat 多会话远端存储（GET / PUT / DELETE /api/ai/chat/history）
 *  GET    → 无 sessionId/id：{ activeId, previousActiveId, sessions: 摘要[], updatedAt }
 *           带 sessionId/id：在摘要基础上附 { session: 完整会话 }；找不到返回 404
 *  PUT    → 传 { id?, title?, messages?, input?, context?, contextUsed? } 新增/更新一个会话；
 *           也支持传 { sessions, activeId } 整包覆盖（用于 local→server 迁移；摘要会从磁盘补齐 messages）
 *  DELETE ?id=xxx → 删除指定会话；不传 id → 清空全部
 *
 * 文件：`data/ai-chat.json`（可用 `AI_CHAT_FILE` 覆盖），已加入打包器 exclude。
 */
import { NextResponse } from 'next/server'

import { chatFilePath, deleteChatSession, readChatSession, readChatSummary, upsertChatSession, writeChatDataAll } from '@/lib/ai-chat-store'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('id')
  if (sessionId) {
    const session = readChatSession(sessionId)
    if (!session) {
      return NextResponse.json(
        { code: 404, msg: '会话不存在', data: null },
        { status: 404 },
      )
    }
    return NextResponse.json({
      code: 200,
      msg: '请求成功',
      data: { ...readChatSummary(), session },
      file: chatFilePath(),
      timestamp: Date.now(),
    })
  }
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: readChatSummary(),
    file: chatFilePath(),
    timestamp: Date.now(),
  })
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const saved = Array.isArray(body?.sessions)
      ? writeChatDataAll({ sessions: body.sessions, activeId: body?.activeId, previousActiveId: body?.previousActiveId })
      : upsertChatSession({
          id: body?.id,
          title: body?.title,
          messages: body?.messages,
          input: body?.input,
          context: body?.context,
          contextUsed: body?.contextUsed,
        })
    return NextResponse.json({
      code: 200,
      msg: '已保存',
      data: saved,
      file: chatFilePath(),
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '保存失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || undefined
  return NextResponse.json({
    code: 200,
    msg: id ? '已删除会话' : '已清空',
    data: deleteChatSession(id),
    file: chatFilePath(),
    timestamp: Date.now(),
  })
}
