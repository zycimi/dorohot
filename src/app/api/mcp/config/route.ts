/*
 * @Description: MCP 开关与能力配置（需管理员登录）
 *  GET  → { enabled, endpoint, protocolVersions, tools: [{ name, description, enabled }] }
 *  POST → { enabled?: boolean, tools?: { [name]: boolean } } 更新总开关 / 能力开关
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-guard'
import { MCP_PROTOCOL_VERSIONS, MCP_TOOLS } from '@/lib/mcp-server'
import { mcpStoreFilePath, readMcpStore, readToolSettings, setMcpEnabled, setToolSettings } from '@/lib/mcp-store'

export const dynamic = 'force-dynamic'

function snapshot() {
  const tools = readToolSettings()
  return {
    enabled: readMcpStore().enabled,
    file: mcpStoreFilePath(),
    endpoint: '/api/mcp',
    protocolVersions: MCP_PROTOCOL_VERSIONS,
    tools: MCP_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      enabled: tools[t.name] !== false,
    })),
  }
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  return NextResponse.json({ code: 200, msg: '请求成功', data: snapshot(), timestamp: Date.now() })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (typeof body.enabled === 'boolean')
    setMcpEnabled(body.enabled)
  if (body.tools && typeof body.tools === 'object' && !Array.isArray(body.tools))
    setToolSettings(body.tools as Record<string, unknown>)

  return NextResponse.json({ code: 200, msg: '已保存', data: snapshot(), timestamp: Date.now() })
}
