/*
 * @Description: AI Chat 会话服务端存储（data/ai-chat.json）
 *
 * 设计目标：与现有 `data/ai-history.json` 一致 —— 项目内文件、原子写、保存前 `.bak`，
 * 支持多浏览器/多设备共享。当前支持**多个会话**（历史列表），每个会话最多保留 50 条消息。
 * 该文件已加入打包器 exclude，不会进交付包。
 *
 * 兼容旧格式：若读取到旧版单会话 `{ messages, input, context, contextUsed }`，
 * 会自动迁移成一个 legacy 会话，不丢历史。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoredChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens?: number
}

export interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
  usage?: StoredChatUsage
}

export interface StoredChatContext {
  title?: string
  url?: string
  content?: string
  source?: string
}

export interface StoredChatSession {
  id: string
  title: string
  messages: StoredChatMessage[]
  input: string
  context: StoredChatContext | null
  contextUsed: boolean
  /** 置顶：置顶会话排在历史列表最前 */
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface StoredChatData {
  activeId: string | null
  /** 上一个激活的会话 id，用于「还原对话」 */
  previousActiveId: string | null
  sessions: StoredChatSession[]
  /** 服务端数据最后写入时间；0 表示从未初始化过（用于判断“空”是“从没用过”还是“被用户删空”） */
  updatedAt: number
}

/** 会话摘要：列表接口返回，不含 messages，前端按需再拉完整会话 */
export interface StoredChatSessionSummary {
  id: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  preview: string
}

export interface StoredChatSummary {
  activeId: string | null
  previousActiveId: string | null
  sessions: StoredChatSessionSummary[]
  updatedAt: number
}

const MAX_MESSAGES = 50
const MAX_SESSIONS = 60

function chatFile(): string {
  return process.env.AI_CHAT_FILE || join(process.cwd(), 'data', 'ai-chat.json')
}

function emptyData(): StoredChatData {
  return { activeId: null, previousActiveId: null, sessions: [], updatedAt: 0 }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function cleanUsage(value: unknown): StoredChatUsage | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const raw = value as Record<string, unknown>
  const usage: StoredChatUsage = {
    promptTokens: num(raw.promptTokens),
    completionTokens: num(raw.completionTokens),
    totalTokens: num(raw.totalTokens),
  }
  if (typeof raw.reasoningTokens === 'number' && Number.isFinite(raw.reasoningTokens))
    usage.reasoningTokens = raw.reasoningTokens
  return usage
}

function cleanContext(value: unknown): StoredChatContext | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8000) : undefined)
  const context: StoredChatContext = {
    title: str(raw.title),
    url: str(raw.url),
    content: str(raw.content),
    source: str(raw.source),
  }
  return context.title || context.url || context.content || context.source ? context : null
}

function cleanMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value))
    return []
  const now = Date.now()
  return value
    .map((item, index): StoredChatMessage | null => {
      if (!item || typeof item !== 'object')
        return null
      const raw = item as Record<string, unknown>
      const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null
      const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, 20000) : ''
      if (!role || !content)
        return null
      const message: StoredChatMessage = {
        id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 120) : `msg-${index}-${now}`,
        role,
        content,
        at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : now,
      }
      const usage = cleanUsage(raw.usage)
      if (usage)
        message.usage = usage
      return message
    })
    .filter((m): m is StoredChatMessage => !!m)
    .slice(-MAX_MESSAGES)
}

function deriveTitle(messages: StoredChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.content || ''
  const title = first.replace(/\s+/g, ' ').trim().slice(0, 24)
  return title || '未命名对话'
}

/** @description: 会话摘要预览：最近一条消息压缩空白后截断 80 字 */
function previewOf(messages: StoredChatMessage[]): string {
  const last = messages[messages.length - 1]
  return last ? last.content.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
}

function toSummary(session: StoredChatSession): StoredChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: previewOf(session.messages),
  }
}

function cleanSession(value: unknown, fallbackId?: string): StoredChatSession | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as Record<string, unknown>
  const messages = cleanMessages(raw.messages)
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 120) : (fallbackId || newId('chat'))
  const now = Date.now()
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 40) : deriveTitle(messages)
  return {
    id,
    title,
    messages,
    input: typeof raw.input === 'string' ? raw.input.slice(0, 8000) : '',
    context: cleanContext(raw.context),
    contextUsed: !!raw.contextUsed,
    pinned: !!raw.pinned,
    createdAt,
    updatedAt,
  }
}

/** @description: 置顶优先、其次按更新时间倒序（客户端与服务端必须一致） */
export function sortChatSessions(sessions: StoredChatSession[]): StoredChatSession[] {
  return sessions.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt))
}

function cleanData(value: unknown): StoredChatData {
  if (!value || typeof value !== 'object')
    return emptyData()
  const raw = value as Record<string, unknown>

  // 旧版单会话格式：{ messages, input, context, contextUsed, updatedAt }
  if (!Array.isArray(raw.sessions) && Array.isArray(raw.messages)) {
    const legacy = cleanSession({
      ...raw,
      id: typeof raw.id === 'string' ? raw.id : newId('legacy'),
      createdAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    })
    if (!legacy || (!legacy.messages.length && !legacy.input && !legacy.context))
      return emptyData()
    return { activeId: legacy.id, previousActiveId: null, sessions: [legacy], updatedAt: legacy.updatedAt || Date.now() }
  }

  const sessions = sortChatSessions(
    (Array.isArray(raw.sessions) ? raw.sessions : [])
      .map(item => cleanSession(item))
      .filter((s): s is StoredChatSession => !!s),
  ).slice(0, MAX_SESSIONS)

  const activeId = typeof raw.activeId === 'string' && sessions.some(s => s.id === raw.activeId)
    ? raw.activeId
    : (sessions[0]?.id ?? null)

  const previousActiveId = typeof raw.previousActiveId === 'string'
    && raw.previousActiveId !== activeId
    && sessions.some(s => s.id === raw.previousActiveId)
    ? raw.previousActiveId
    : null

  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
    ? raw.updatedAt
    : (sessions.length ? sessions[0].updatedAt : 0)

  return { activeId, previousActiveId, sessions, updatedAt }
}

/** @description: 读会话列表；文件不存在/损坏时返回空数据 */
export function readChatData(): StoredChatData {
  try {
    const file = chatFile()
    if (!existsSync(file))
      return emptyData()
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return emptyData()
    return cleanData(JSON.parse(raw))
  }
  catch {
    return emptyData()
  }
}

/** @description: 读会话摘要列表（不含 messages）；排序与 sortChatSessions 一致 */
export function readChatSummary(): StoredChatSummary {
  const data = readChatData()
  return {
    activeId: data.activeId,
    previousActiveId: data.previousActiveId,
    sessions: data.sessions.map(toSummary),
    updatedAt: data.updatedAt,
  }
}

/** @description: 读单个会话的完整数据；找不到返回 null */
export function readChatSession(id: string): StoredChatSession | null {
  if (!id)
    return null
  return readChatData().sessions.find(s => s.id === id) ?? null
}

function writeChatData(data: Omit<StoredChatData, 'updatedAt'> & { updatedAt?: number }): StoredChatData {
  const file = chatFile()
  const next = cleanData({ ...data, updatedAt: data.updatedAt && data.updatedAt > 0 ? data.updatedAt : Date.now() })

  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))

  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)

  return next
}

/**
 * @description: 覆盖写入整个会话数据（用于完整同步/迁移）。
 * 传入会话带 `messages` 字段（即使空数组）视为权威；不带（摘要对象）则从磁盘旧会话
 * 按 id 补齐 messages/input/context/contextUsed，磁盘不存在用空值 —— 避免整包同步清空消息。
 */
export function writeChatDataAll(data: Partial<StoredChatData>): StoredChatData {
  const current = readChatData()
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.map((item: unknown): unknown => {
        if (!item || typeof item !== 'object')
          return item
        const raw = item as Record<string, unknown>
        if ('messages' in raw)
          return raw
        const old = typeof raw.id === 'string' ? current.sessions.find(s => s.id === raw.id) : undefined
        return {
          ...raw,
          messages: old?.messages ?? [],
          input: old?.input ?? '',
          context: old?.context ?? null,
          contextUsed: old?.contextUsed ?? false,
        }
      })
    : undefined
  return writeChatData({
    activeId: data.activeId ?? current.activeId,
    previousActiveId: data.previousActiveId !== undefined ? data.previousActiveId : current.previousActiveId,
    sessions: (sessions ?? current.sessions) as StoredChatSession[],
  })
}

/** @description: 新增或更新一个会话，并把该会话设为 active */
export function upsertChatSession(patch: Partial<StoredChatSession> & { id?: string }): StoredChatData {
  const current = readChatData()
  const id = patch.id && patch.id.trim() ? patch.id.trim().slice(0, 120) : newId('chat')
  const existing = current.sessions.find(s => s.id === id)
  const session = cleanSession({
    ...existing,
    ...patch,
    id,
    createdAt: existing?.createdAt ?? patch.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  })
  if (!session)
    throw new Error('无效的会话数据')

  if (!session.title || session.title === '未命名对话')
    session.title = deriveTitle(session.messages)

  const sessions = sortChatSessions([session, ...current.sessions.filter(s => s.id !== id)])
    .slice(0, MAX_SESSIONS)

  return writeChatData({ activeId: id, previousActiveId: current.previousActiveId, sessions })
}

/** @description: 删除一个会话；不传 id 则清空全部 */
export function deleteChatSession(id?: string): StoredChatData {
  const current = readChatData()
  if (!id)
    return writeChatData(emptyData())

  const sessions = current.sessions.filter(s => s.id !== id)
  const activeId = current.activeId === id ? (sessions[0]?.id ?? null) : current.activeId
  const previousActiveId = current.previousActiveId === id ? null : current.previousActiveId
  return writeChatData({ activeId, previousActiveId, sessions })
}

export function chatFilePath(): string {
  return chatFile()
}
