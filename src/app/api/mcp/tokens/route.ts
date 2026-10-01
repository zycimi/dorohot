/*
 * @Description: MCP 访问令牌管理（需管理员登录）
 *  GET    → { enabled, tokens: [...] }（含 revokedAt，供前端区分「有效 / 已吊销」）
 *  POST   → { name } 新建，返回明文 token（仅此一次）
 *  PATCH  → { id, action: 'revoke' | 'restore' } 软吊销 / 恢复
 *  DELETE → ?id=xxx 删除——**仅允许删除已吊销的令牌**（有效令牌返回 409）
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-guard'
import { createToken, deleteToken, listTokens, mcpStoreFilePath, readMcpStore, restoreToken, revokeToken } from '@/lib/mcp-store'

export const dynamic = 'force-dynamic'

const ok = (data: unknown, msg = '请求成功') => NextResponse.json({ code: 200, msg, data, timestamp: Date.now() })
const bad = (status: number, msg: string, data: unknown = null) => NextResponse.json({ code: status, msg, data, timestamp: Date.now() }, { status })

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  return ok({ enabled: readMcpStore().enabled, tokens: listTokens(), file: mcpStoreFilePath() })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '未命名令牌'
  const { token, info } = createToken(name)
  return ok({ token, info }, '令牌已创建（请立即复制，之后不再显示）')
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!id)
    return bad(400, '缺少 id')

  if (action === 'revoke') {
    const found = readMcpStore().tokens.some(t => t.id === id)
    if (!found)
      return bad(404, '未找到该令牌')
    revokeToken(id)
    return ok({ tokens: listTokens() }, '已吊销（可恢复或删除）')
  }
  if (action === 'restore') {
    const restored = restoreToken(id)
    if (!restored)
      return bad(400, '该令牌不是已吊销状态，无法恢复')
    return ok({ tokens: listTokens() }, '已恢复')
  }
  return bad(400, `不支持的操作：${action || '(空)'}`)
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const id = new URL(request.url).searchParams.get('id') || ''
  if (!id)
    return bad(400, '缺少 id')

  const result = deleteToken(id)
  if (result === 'not-found')
    return bad(404, '未找到该令牌')
  if (result === 'not-revoked')
    return bad(409, '只能删除已吊销的令牌，请先吊销')
  return ok({ tokens: listTokens() }, '已删除')
}
