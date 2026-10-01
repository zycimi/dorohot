/*
 * @Description: MCP 服务端点（Streamable HTTP，JSON-RPC 2.0）
 *
 * 认证：`Authorization: Bearer <令牌>`（令牌在「设置 → MCP」里创建）。
 * 用法：MCP 客户端把本地址作为 HTTP MCP server 接入，例如 https://<站点>/api/mcp
 */
import { NextResponse } from 'next/server'

import { handleMcpMessage } from '@/lib/mcp-server'
import { readToolSettings, verifyToken } from '@/lib/mcp-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: '未认证：请提供有效的 Bearer 令牌' } },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="dorohot-mcp"' } },
  )
}

export async function POST(request: Request) {
  const meta = verifyToken(bearerToken(request))
  if (!meta)
    return unauthorized()

  let payload: unknown
  try {
    payload = await request.json()
  }
  catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }

  // JSON-RPC 批量
  if (Array.isArray(payload)) {
    const results: unknown[] = []
    const tools = readToolSettings()
    for (const item of payload) {
      const { body } = await handleMcpMessage(item as Parameters<typeof handleMcpMessage>[0], { tools })
      if (body)
        results.push(body)
    }
    return NextResponse.json(results)
  }

  const { body, notification } = await handleMcpMessage(
    payload as Parameters<typeof handleMcpMessage>[0],
    { tools: readToolSettings() },
  )
  if (notification)
    return new Response(null, { status: 202 }) // 通知无需响应
  return NextResponse.json(body)
}

/** 本实现不提供服务端主动推送（SSE），GET/DELETE 一律 405（符合 Streamable HTTP 的可选行为） */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
