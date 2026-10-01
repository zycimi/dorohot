/*
 * @Description: MCP 接入配置与访问令牌存储
 *
 * 存储：项目内 `data/mcp.json`（可用 `DOROHOT_MCP_FILE` 覆盖），沿用「保存前 .bak + 原子写」。
 * 该文件已被 `.gitignore` 与打包器 exclude 排除，绝不进交付包/公开仓库。
 *
 * 令牌只存 **sha256 哈希**（`tokenHash`）与展示用前缀（`prefix`），明文仅在创建时返回一次。
 * 生命周期（2026-10-01 起）：`吊销` = 软吊销（打 `revokedAt`，保留记录）；已吊销可 `恢复` 或 `删除`；
 * **只有已吊销的令牌才能删除**，有效令牌不能删除。
 *
 * 能力开关：`tools` 记录每个工具是否启用（缺省视为启用）；`false` 表示关闭。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface McpToken {
  id: string
  name: string
  /** sha256(明文令牌) 的 hex */
  tokenHash: string
  /** 明文前缀，仅用于列表展示（如 mcp_AbC123…） */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  /** 软吊销时间；null/缺失 = 有效 */
  revokedAt: string | null
}

export interface McpStore {
  enabled: boolean
  tokens: McpToken[]
  /** 工具开关：键为工具名，false = 关闭（缺省 = 启用） */
  tools: Record<string, boolean>
}

/** 对外暴露的令牌信息（不含哈希） */
export type McpTokenInfo = Omit<McpToken, 'tokenHash'>

function storeFile(): string {
  return process.env.DOROHOT_MCP_FILE || join(process.cwd(), 'data', 'mcp.json')
}

export function mcpStoreFilePath(): string {
  return storeFile()
}

function emptyStore(): McpStore {
  return { enabled: true, tokens: [], tools: {} }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

export function readMcpStore(): McpStore {
  try {
    const file = storeFile()
    if (!existsSync(file))
      return emptyStore()
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return emptyStore()
    const parsed = JSON.parse(raw) as Partial<McpStore>
    const tokens = Array.isArray(parsed?.tokens)
      ? parsed!.tokens.filter((t): t is McpToken => !!t && typeof t.id === 'string' && typeof t.tokenHash === 'string')
          .map(t => ({
            id: t.id,
            name: typeof t.name === 'string' ? t.name : '',
            tokenHash: t.tokenHash,
            prefix: typeof t.prefix === 'string' ? t.prefix : '',
            createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
            lastUsedAt: typeof t.lastUsedAt === 'string' ? t.lastUsedAt : null,
            revokedAt: typeof t.revokedAt === 'string' ? t.revokedAt : null,
          }))
      : []
    const tools: Record<string, boolean> = {}
    if (parsed?.tools && typeof parsed.tools === 'object') {
      for (const [key, value] of Object.entries(parsed.tools as Record<string, unknown>)) {
        if (typeof value === 'boolean')
          tools[key] = value
      }
    }
    return { enabled: parsed?.enabled !== false, tokens, tools }
  }
  catch {
    return emptyStore()
  }
}

function writeMcpStore(next: McpStore): McpStore {
  const file = storeFile()
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

const strip = ({ tokenHash, ...rest }: McpToken): McpTokenInfo => rest

/** @description: 对外信息（不含哈希）；按创建时间倒序 */
export function listTokens(): McpTokenInfo[] {
  return readMcpStore().tokens
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(strip)
}

export function isMcpEnabled(): boolean {
  return readMcpStore().enabled
}

export function setMcpEnabled(enabled: boolean): McpStore {
  const store = readMcpStore()
  return writeMcpStore({ ...store, enabled })
}

/** @description: 工具开关表（缺省视为启用） */
export function readToolSettings(): Record<string, boolean> {
  return readMcpStore().tools
}

/** @description: 批量更新工具开关（只接受布尔值；`true` 会写为显式启用） */
export function setToolSettings(patch: Record<string, unknown>): Record<string, boolean> {
  const store = readMcpStore()
  const tools = { ...store.tools }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'boolean')
      tools[key] = value
  }
  writeMcpStore({ ...store, tools })
  return tools
}

/** @description: 新建令牌；返回明文（仅此一次）与展示信息 */
export function createToken(name: string): { token: string, info: McpTokenInfo } {
  const store = readMcpStore()
  const token = `mcp_${randomBytes(24).toString('base64url')}`
  const entry: McpToken = {
    id: randomBytes(8).toString('hex'),
    name: (name || '未命名令牌').slice(0, 60),
    tokenHash: sha256(token),
    prefix: `mcp_${token.slice(4, 10)}…`,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  }
  writeMcpStore({ ...store, enabled: true, tokens: [...store.tokens, entry] })
  return { token, info: strip(entry) }
}

/** @description: 软吊销（保留记录，可恢复） */
export function revokeToken(id: string): boolean {
  const store = readMcpStore()
  const found = store.tokens.find(t => t.id === id)
  if (!found)
    return false
  if (found.revokedAt)
    return true // 已吊销
  const next = { ...found, revokedAt: new Date().toISOString() }
  writeMcpStore({ ...store, tokens: store.tokens.map(t => (t.id === id ? next : t)) })
  return true
}

/** @description: 恢复已吊销的令牌 */
export function restoreToken(id: string): boolean {
  const store = readMcpStore()
  const found = store.tokens.find(t => t.id === id)
  if (!found || !found.revokedAt)
    return false
  const next = { ...found, revokedAt: null }
  writeMcpStore({ ...store, tokens: store.tokens.map(t => (t.id === id ? next : t)) })
  return true
}

export type DeleteResult = 'deleted' | 'not-found' | 'not-revoked'

/** @description: 删除令牌——**仅允许删除已吊销的令牌** */
export function deleteToken(id: string): DeleteResult {
  const store = readMcpStore()
  const found = store.tokens.find(t => t.id === id)
  if (!found)
    return 'not-found'
  if (!found.revokedAt)
    return 'not-revoked'
  writeMcpStore({ ...store, tokens: store.tokens.filter(t => t.id !== id) })
  return 'deleted'
}

/**
 * @description: 校验 Bearer 令牌——未启用 / 不匹配 / 已吊销返回 null；命中则（节流）更新 lastUsedAt
 */
export function verifyToken(token: string): McpTokenInfo | null {
  if (!token)
    return null
  const store = readMcpStore()
  if (!store.enabled)
    return null
  const target = Buffer.from(sha256(token))
  const found = store.tokens.find((t) => {
    const buf = Buffer.from(t.tokenHash)
    return buf.length === target.length && timingSafeEqual(buf, target)
  })
  if (!found || found.revokedAt)
    return null

  // 节流写盘：距上次使用超过 5 分钟才更新，避免每次请求都写文件
  const now = Date.now()
  const last = found.lastUsedAt ? Date.parse(found.lastUsedAt) : 0
  if (!last || now - last > 5 * 60 * 1000) {
    const next = { ...found, lastUsedAt: new Date(now).toISOString() }
    writeMcpStore({ ...store, tokens: store.tokens.map(t => (t.id === found.id ? next : t)) })
  }
  return strip(found)
}
