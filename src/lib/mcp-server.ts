/*
 * @Description: doroHot MCP 服务端（Streamable HTTP，JSON-RPC 2.0）
 *
 * 对外提供工具：数据源列表 / 热榜查询 / AI 摘要·简报·分析 / 联网搜索 / 站点状态 / 邮件订阅。
 * 认证由路由层用 Bearer 令牌完成（见 `mcp-store.ts` / `api/mcp/route.ts`）。
 * 手写协议实现（不引入 @modelcontextprotocol/sdk 依赖）：仅支持 tools 能力，无状态。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { analyze, buildBriefing, collectSources, fetchSource, searchWeb, sourceLabel, summarizeItems } from '@/lib/ai'
import { publicSubscription, readSubscription, writeSubscription } from '@/lib/subscription'
import { HOT_ITEMS } from '@/enums'
import pkg from '#/package.json'

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'] as const
const LATEST_PROTOCOL = '2025-06-18'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_sources',
    description: '列出本站全部热榜数据源（source 为标识，name 为中文名，tip 为榜单类型）。',
    inputSchema: obj({}),
  },
  {
    name: 'get_hot_list',
    description: '获取指定数据源的当前热榜条目。source 用 list_sources 返回的标识（如 weibo / zhihu / bilibili）。',
    inputSchema: obj({
      source: { type: 'string', description: '数据源标识，例如 weibo' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 20' },
    }, ['source']),
  },
  {
    name: 'ai_summarize',
    description: '对某数据源的热榜条目逐条生成中文速读摘要（站内 AI）。',
    inputSchema: obj({
      source: { type: 'string', description: '数据源标识，例如 weibo' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: '摘要条数上限，默认 10' },
    }, ['source']),
  },
  {
    name: 'ai_briefing',
    description: '把多个数据源的榜单汇总成一份中文每日简报（站内 AI）。',
    inputSchema: obj({
      sources: { type: 'array', items: { type: 'string' }, description: '数据源标识列表，默认 weibo/zhihu/baidu/toutiao' },
    }),
  },
  {
    name: 'ai_analyze',
    description: '对某数据源的榜单做趋势/主题分析，输出 Markdown（站内 AI）。',
    inputSchema: obj({
      source: { type: 'string', description: '数据源标识，例如 zhihu' },
      focus: { type: 'string', description: '可选的分析侧重点' },
    }, ['source']),
  },
  {
    name: 'web_search',
    description: '用站点已配置的联网搜索源检索网页。',
    inputSchema: obj({
      query: { type: 'string', description: '搜索词' },
      limit: { type: 'integer', minimum: 1, maximum: 10, description: '结果条数，默认 5' },
    }, ['query']),
  },
  {
    name: 'site_status',
    description: '站点运行状态：版本、构建、数据源数量、运行时长等。',
    inputSchema: obj({}),
  },
  {
    name: 'subscription_get',
    description: '读取当前邮件订阅配置（SMTP 密码不回传）。',
    inputSchema: obj({}),
  },
  {
    name: 'subscription_update',
    description: '更新邮件订阅配置（传入与设置页一致的 patch：enabled / interval / unit / email / subject / 时间窗口 / 日历 等）。',
    inputSchema: obj({
      patch: { type: 'object', description: '要合并保存的字段（与 POST /api/subscription 的 body 相同）', additionalProperties: true },
    }, ['patch']),
  },
]

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n))
    return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function readBuildId(): string | null {
  try {
    const file = join(process.cwd(), '.next', 'BUILD_ID')
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
  }
  catch {
    return null
  }
}

const jsonText = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``

/** @description: 执行工具，返回给 MCP 客户端的文本内容 */
async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_sources': {
      const items = HOT_ITEMS.items.map(i => ({ source: String(i.value), name: i.raw.label, tip: i.raw.tip }))
      return jsonText({ count: items.length, sources: items })
    }

    case 'get_hot_list': {
      const source = asString(args.source)
      if (!source)
        throw new Error('缺少参数 source')
      const limit = asInt(args.limit, 20, 1, 50)
      const items = (await fetchSource(source)).slice(0, limit)
      if (!items.length)
        return `未获取到「${sourceLabel(source)}」的数据（源标识可能不正确，或上游暂时失败）。`
      return jsonText({
        source,
        label: sourceLabel(source),
        count: items.length,
        items: items.map(it => ({ title: it.title, url: it.url, desc: it.desc, hot: it.hot })),
      })
    }

    case 'ai_summarize': {
      const source = asString(args.source)
      if (!source)
        throw new Error('缺少参数 source')
      const limit = asInt(args.limit, 10, 1, 20)
      const items = (await fetchSource(source)).slice(0, limit)
      if (!items.length)
        return `未获取到「${sourceLabel(source)}」的数据，无法摘要。`
      const { rows } = await summarizeItems(items)
      const body = rows
        .map((r, i) => `${i + 1}. **${r.title}**${r.url ? `（[链接](${r.url})）` : ''}\n   ${r.error ? `摘要失败：${r.error}` : r.summary}`)
        .join('\n\n')
      return `# ${sourceLabel(source)} · 前 ${items.length} 条速读\n\n${body}`
    }

    case 'ai_briefing': {
      const requested = Array.isArray(args.sources) ? args.sources.map(asString).filter(Boolean) : []
      const sources = requested.length ? requested.slice(0, 8) : ['weibo', 'zhihu', 'baidu', 'toutiao']
      const collected = await collectSources(sources, { perSource: 8 })
      const usable = collected.filter(c => c.items.length)
      if (!usable.length)
        return '未获取到任何榜单数据，无法生成简报。'
      const { text } = await buildBriefing(usable.map(c => ({ label: c.label, items: c.items })))
      return text
    }

    case 'ai_analyze': {
      const source = asString(args.source)
      if (!source)
        throw new Error('缺少参数 source')
      const focus = asString(args.focus) || undefined
      const items = await fetchSource(source)
      if (!items.length)
        return `未获取到「${sourceLabel(source)}」的数据，无法分析。`
      const { text } = await analyze(items, { label: sourceLabel(source), focus })
      return text
    }

    case 'web_search': {
      const query = asString(args.query)
      if (!query)
        throw new Error('缺少参数 query')
      const limit = asInt(args.limit, 5, 1, 10)
      const { provider, results } = await searchWeb(query, limit, { allowWhenDisabled: true })
      if (!results.length)
        return `联网搜索「${query}」无结果（provider: ${provider}）。可检查设置页的联网搜索配置。`
      const body = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet || ''}`).join('\n')
      return `# 联网搜索：${query}\n（provider: ${provider}）\n\n${body}`
    }

    case 'site_status': {
      return jsonText({
        name: 'doroHot',
        version: pkg.version,
        buildId: readBuildId(),
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        sourceCount: [...HOT_ITEMS.values].length,
        mcpEndpoint: '/api/mcp',
      })
    }

    case 'subscription_get': {
      return jsonText(publicSubscription(readSubscription()))
    }

    case 'subscription_update': {
      const patch = args.patch
      if (!patch || typeof patch !== 'object')
        throw new Error('缺少参数 patch（对象）')
      const next = writeSubscription(patch as Record<string, unknown>)
      return jsonText(publicSubscription(next))
    }

    default:
      throw new Error(`未知工具：${name}`)
  }
}

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/**
 * @description: 处理单条 JSON-RPC 消息。
 *  - `opts.tools` 为工具开关（缺省视为启用），据此过滤 `tools/list` 并拒绝未启用工具的调用；
 *  - 返回 { body }：需要回给客户端的 JSON；
 *  - 返回 { notification: true }：通知（无 id），HTTP 层回 202 空体。
 */
export async function handleMcpMessage(
  msg: JsonRpcRequest,
  opts: { tools?: Record<string, boolean> } = {},
): Promise<{ body?: unknown, notification?: boolean }> {
  const method = typeof msg?.method === 'string' ? msg.method : ''
  const id = msg?.id ?? null
  const params = (msg?.params ?? {}) as Record<string, unknown>
  const isToolEnabled = (name: string) => opts.tools?.[name] !== false

  // 通知：不需要响应
  if (!method || (msg.id === undefined && method.startsWith('notifications/')))
    return { notification: true }

  if (method === 'initialize') {
    const requested = asString(params.protocolVersion)
    const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL
    return {
      body: ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dorohot', title: 'doroHot MCP', version: pkg.version },
        instructions: 'doroHot 热榜聚合站 MCP。可查询各数据源热榜、生成 AI 摘要/简报/分析、联网搜索、读取站点状态与邮件订阅配置。',
      }),
    }
  }

  if (method === 'ping')
    return { body: ok(id, {}) }

  if (method === 'tools/list')
    return { body: ok(id, { tools: MCP_TOOLS.filter(t => isToolEnabled(t.name)) }) }

  if (method === 'tools/call') {
    const name = asString(params.name)
    const args = (params.arguments && typeof params.arguments === 'object') ? params.arguments as Record<string, unknown> : {}
    const tool = MCP_TOOLS.find(t => t.name === name)
    if (!tool)
      return { body: fail(id, -32602, `未知工具：${name}`) }
    if (!isToolEnabled(name))
      return { body: fail(id, -32602, `工具未启用：${name}（可在「设置 → MCP 接入」中开启）`) }
    try {
      const text = await runTool(name, args)
      return { body: ok(id, { content: [{ type: 'text', text }], isError: false }) }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败'
      return { body: ok(id, { content: [{ type: 'text', text: `工具执行失败：${message}` }], isError: true }) }
    }
  }

  return { body: fail(id, -32601, `不支持的方法：${method}`) }
}
