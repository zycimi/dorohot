/*
 * @Description: AI 助手四项能力的共享状态（模块级 store）
 *
 * 为什么需要它：四项能力现在住在**首页的悬浮抽屉**里（HeroUI Drawer = 模态），
 * 抽屉关闭会卸载内容 —— 组件本地 state（输入、结果、以及"正在生成中"）全都会丢。
 * 搬到模块级 store 后：
 *  - 关闭/重开抽屉，输入与结果都还在；
 *  - 生成中的请求由 store 发起，即使关闭抽屉也会跑完并把结果写回（重开即可见），
 *    完成时还会弹一条 toast（toast 由外壳渲染，抽屉关着也看得到）；
 *  - 与原来"整页常驻挂载"的效果等价。
 *
 * Chat 切片优先保存到服务端 `data/ai-chat.json`（见 CHAT_HISTORY_URL），多浏览器/设备共享；
 * `localStorage` 只作缓存与离线兜底。刷新页面后由外壳的 `hydrateChat()` 先拉服务端，失败再回退本地。
 *
 * 注意：选择器只取切片对象本身（引用稳定，仅在 patch 时替换），不要在选择器里 new 数组/对象。
 */
'use client'

import { create } from 'zustand'

import { HOT_ITEMS } from '@/enums'
import { post, postEnvelope } from '@/lib/ai-client'

import type { AiHistoryTokens, AnalyzeResult, BriefingData, ChatContext, ChatMessage, ChatReply, ChatSession, ItemResult, Notify, SummaryRow } from '@/lib/ai-client'

/** 可选数据源（四项能力共用的下拉数据） */
export const SOURCES = HOT_ITEMS.items.map(i => ({ value: i.value as string, label: i.raw.label, tip: i.raw.tip }))

/** 抽屉 tab：`item`/`subscription` 为历史深链标识，运行时统一归一到 `chat` */
export type AiFeature = 'chat' | 'item' | 'summary' | 'briefing' | 'analyze'

interface ItemSlice {
  title: string
  url: string
  content: string
  loading: boolean
  data: ItemResult | null
}

interface SummarySlice {
  alias: string
  limit: number
  loading: boolean
  rows: SummaryRow[]
}

interface BriefingSlice {
  selected: Set<string>
  perSource: number
  loading: boolean
  data: BriefingData | null
}

interface AnalyzeSlice {
  alias: string
  focus: string
  limit: number
  loading: boolean
  data: AnalyzeResult | null
}

/** `/订阅 …` 解析出的可编辑订阅字段（与 /api/ai/subscription/parse 的 patch 对齐；**永不含 SMTP**） */
export interface SubscriptionPatch {
  enabled: boolean
  email: string
  interval: number
  unit: 'minute' | 'hour' | 'day'
  sources: string[]
  perSource: number
  aiAnalysis: boolean
  dailyAtEnabled: boolean
  dailyAt: string
  weeklyEnabled: boolean
  weekDays: number[]
  weeklyAt: string
  monthlyEnabled: boolean
  monthDays: number[]
  monthlyAt: string
  windowEnabled: boolean
  windowStart: string
  windowEnd: string
}

/** `/订阅 …` 命令解析出、等用户确认的订阅改动（只活在当前页面，不落盘、不进服务端会话） */
export interface PendingSubscription {
  /** 确认卡锚定的 assistant 消息 id */
  messageId: string
  /** 所属会话；切到别的会话时卡片不显示 */
  sessionId: string | null
  patch: SubscriptionPatch
  /** 中文「将修改」列表（空表示没识别到变化） */
  summary: string[]
  /** 保存后规则的整句人话描述 */
  ruleText: string
  /** 缺邮箱 / 缺 SMTP 等提醒（保存前提示） */
  warnings: string[]
  /** 正在提交保存 */
  applying?: boolean
}

/** @description: `/订阅` 命令前缀（`/订阅 …` 走配置流程，不转给模型） */
export const SUBSCRIPTION_CMD_RE = /^\/(订阅|subscribe)(\s|$)/i
const SUBSCRIPTION_CMD_USAGE = [
  '`/订阅` 是一条**配置命令**：把后面那句话解析成邮件订阅设置，先给你一张确认卡，点「应用并保存」才落盘。',
  '',
  '用法示例：',
  '- `/订阅 每天早上9点把微博和知乎热榜发到 me@qq.com`',
  '- `/订阅 早上9点至下午18点，每隔60分钟发一次，每源8条`',
  '- `/订阅 暂停订阅`',
  '',
  'SMTP 密码只认「设置 → 邮件订阅」里手填，不会经过 AI。',
].join('\n')

const SUBSCRIPTION_UNIT_LABEL: Record<SubscriptionPatch['unit'], string> = { minute: '分钟', hour: '小时', day: '天（24 小时）' }

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** @description: 把 patch 说成一句「保存后规则」（日历定点优先级 monthly > weekly > dailyAt > 按间隔） */
function describeSubscriptionRule(patch: SubscriptionPatch, minutes: number): string {
  if (patch.monthlyEnabled && patch.monthDays.length)
    return `每月 ${patch.monthDays.join('、')} 号 ${patch.monthlyAt} 定点发送`
  if (patch.weeklyEnabled && patch.weekDays.length)
    return `每${patch.weekDays.map(d => WEEKDAY_LABEL[d] ?? '').join('、')} ${patch.weeklyAt} 定点发送`
  if (patch.dailyAtEnabled)
    return `每天 ${patch.dailyAt} 定点发送`
  const base = `每 ${patch.interval} ${SUBSCRIPTION_UNIT_LABEL[patch.unit] || patch.unit}发送一次${minutes ? `（= ${minutes} 分钟）` : ''}`
  return patch.windowEnabled ? `${base}，仅在 ${patch.windowStart}–${patch.windowEnd} 之间发送` : base
}

interface ChatSlice {
  /** 服务端共享的全部会话（历史对话） */
  sessions: ChatSession[]
  /** 当前正在看的会话 id */
  activeId: string | null
  /** 上一次查看的会话 id，用于底部「还原对话」 */
  previousActiveId: string | null
  messages: ChatMessage[]
  input: string
  loading: boolean
  /** 从热榜右键附着的一条内容；只在下一轮请求时带给服务端一次 */
  context: ChatContext | null
  /** context 是否已随某轮成功请求发送；后续追问只带 messages */
  contextUsed: boolean
  error: string | null
  /** 本轮是否显式请求联网搜索（仅随当轮请求发送，不写入会话消息） */
  webSearch: boolean
  /** `/订阅 …` 命令解析出、等用户确认的订阅改动（纯前端态，不落盘） */
  pendingSubscription: PendingSubscription | null
}

interface AiAssistantState {
  /** 抽屉开关（首页深链需要从外部打开，所以放 store） */
  open: boolean
  tab: AiFeature
  /** 由外壳注入的 toast 函数（抽屉关着也能提示） */
  notify: Notify | null
  /** 各功能的"历史需要刷新"计数：生成成功后 +1，组件据此重新拉历史（subscription 供设置页感知 `/订阅` 保存） */
  historyTick: Record<AiFeature | 'subscription', number>
  item: ItemSlice
  chat: ChatSlice
  summary: SummarySlice
  briefing: BriefingSlice
  analyze: AnalyzeSlice

  setNotify: (notify: Notify | null) => void
  setOpen: (open: boolean) => void
  setTab: (tab: AiFeature) => void
  /** 设置「联网搜索」开关（粘性：持久化，跨新对话/刷新保持，直到手动关闭） */
  setWebSearch: (value: boolean) => void
  /** 联网搜索是否可用（外壳从 /api/ai/status 注入；右键「分析此条」自动带上搜索） */
  webSearchAvailable: boolean
  setWebSearchAvailable: (value: boolean) => void
  /** 从深链打开：选定 tab、回填条目并立刻分析一次 */
  openWith: (input: { tab?: string, title?: string, url?: string, source?: string }) => void
  patchItem: (patch: Partial<ItemSlice>) => void
  patchChat: (patch: Partial<ChatSlice> & { title?: string }) => void
  sendChat: (text?: string) => Promise<void>
  /** 生成失败后重试：找到最后一条用户消息，从它开始重新生成 */
  retryChat: () => Promise<void>
  /** AI对话里的 `/订阅 …` 命令：解析成订阅 patch 并挂出确认卡（不保存） */
  sendSubscriptionCommand: (text: string) => Promise<void>
  /** 确认卡「应用并保存」：把 patch 提交到 /api/subscription */
  applyChatSubscription: () => Promise<void>
  /** 确认卡「取消」：丢弃 patch（不保存） */
  cancelChatSubscription: () => void
  /** 新建一个空会话（保留旧会话在历史对话中） */
  newChat: () => void
  selectChat: (id: string) => void
  /** 删除会话；返回删除前的完整会话（供「撤销删除」原样插回） */
  deleteChat: (id: string) => Promise<ChatSession | null>
  /** 确保某会话的完整 messages 已加载：已在内存直接返回，否则拉远端 detail */
  ensureChatLoaded: (id: string) => Promise<ChatSession | null>
  /** 撤销删除：把会话重新插回列表（makeActive 时切回该会话） */
  reinsertChatSession: (session: ChatSession, makeActive?: boolean) => void
  /** 还原上一次查看的会话 */
  restoreLastChat: () => void
  /** 编辑一条 user 消息并从该处重新生成 */
  editChatMessage: (id: string, content: string) => Promise<void>
  /** 客户端挂载后优先从服务端恢复会话，失败再回退 localStorage */
  hydrateChat: () => Promise<void>
  /** 重命名一个会话 */
  renameChat: (id: string, title: string) => void
  /** 置顶 / 取消置顶一个会话 */
  togglePinChat: (id: string) => void
  /** 轮询服务端会话变化（实时多设备同步） */
  pollChat: () => Promise<void>
  startChatPolling: () => void
  stopChatPolling: () => void
  patchSummary: (patch: Partial<SummarySlice>) => void
  patchBriefing: (patch: Partial<BriefingSlice>) => void
  patchAnalyze: (patch: Partial<AnalyzeSlice>) => void

  runItem: (override?: { title?: string, url?: string }) => Promise<void>
  runSummary: () => Promise<void>
  runBriefing: () => Promise<void>
  runAnalyze: () => Promise<void>
}

const DEFAULT_ALIAS = SOURCES[0]?.value || ''

function newMessageId(role: string) {
  return `chat-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 读取「联网搜索」偏好（本地持久化；默认关闭） */
function loadWebSearchPref(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(WEB_SEARCH_PREF_KEY) === '1'
  }
  catch {
    return false
  }
}

/** 保存「联网搜索」偏好 */
function saveWebSearchPref(value: boolean): void {
  try {
    if (typeof window !== 'undefined')
      localStorage.setItem(WEB_SEARCH_PREF_KEY, value ? '1' : '0')
  }
  catch {
    // localStorage 不可用时只影响跨刷新保持，不影响当前会话
  }
}

const CHAT_STORAGE_KEY = 'dorohot-ai-chat-v2'
const LEGACY_CHAT_STORAGE_KEY = 'dorohot-ai-chat-v1'
/** 联网搜索开关的用户偏好：开启后跨新对话 / 刷新保持，直到手动关闭 */
const WEB_SEARCH_PREF_KEY = 'dorohot-ai-websearch'
const CHAT_HISTORY_URL = '/api/ai/chat/history'
const MAX_CHAT_MESSAGES = 50
const MAX_CHAT_SESSIONS = 60
let chatSyncTimer: ReturnType<typeof setTimeout> | null = null
const CHAT_POLL_MS = 4000
let chatPollTimer: ReturnType<typeof setInterval> | null = null
/** 最近一次已知的服务端 updatedAt（null = 尚未与服务端对齐过） */
let lastRemoteUpdatedAt: number | null = null
/** 当前正在进行的 Chat 生成；切换会话/新建/删除时会被 abort，避免旧生成串到新会话 */
let activeChatRun: { controller: AbortController } | null = null
/** 会话流版本号：切换会话或开启新一轮时 +1，让在途的轮询/生成结果作废 */
let chatFlowSeq = 0

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError'
}

/** @description: 开始一轮生成：中止上一轮并登记新的一轮 */
function beginChatRun(): { controller: AbortController } {
  activeChatRun?.controller.abort()
  const run = { controller: new AbortController() }
  activeChatRun = run
  chatFlowSeq++
  return run
}

/** @description: 取消在途生成（切换会话、新建、删除时调用），并让在途轮询结果作废 */
function cancelChatRun() {
  chatFlowSeq++
  activeChatRun?.controller.abort()
  activeChatRun = null
}

/** @description: 置顶优先、其次按更新时间倒序（与服务端 ai-chat-store 保持一致） */
function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.updatedAt - a.updatedAt))
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object')
    return false
  const message = value as Partial<ChatMessage>
  return (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && typeof message.at === 'number'
}

function normalizeContext(value: unknown): ChatContext | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const context: ChatContext = {
    title: str(raw.title),
    url: str(raw.url),
    content: str(raw.content),
    source: str(raw.source),
  }
  return context.title || context.url || context.content || context.source ? context : null
}

function normalizeMessage(value: unknown, index: number): ChatMessage | null {
  if (!isChatMessage(value))
    return null
  const message: ChatMessage = {
    id: typeof value.id === 'string' && value.id ? value.id.slice(0, 120) : newMessageId(value.role === 'assistant' ? 'a' : 'u'),
    role: value.role,
    content: value.content.slice(0, 20000),
    at: value.at,
  }
  if (value.usage && typeof value.usage === 'object')
    message.usage = value.usage
  return message
}

/** @description: 会话摘要预览：最近一条消息压缩空白后截断 80 字（与服务端一致） */
function previewOf(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]
  return last ? last.content.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
}

function normalizeSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as Record<string, unknown>
  const now = Date.now()
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map((m, index) => normalizeMessage(m, index))
    .filter((m): m is ChatMessage => !!m)
    .slice(-MAX_CHAT_MESSAGES)
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 120) : newMessageId('chat')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 40) : deriveTitle(messages)
  // 本地快照里可能存的是摘要（messagesLoaded:false）；显式 false 才保留，其余视为完整会话
  const messagesLoaded = raw.messagesLoaded !== false
  return {
    id,
    title,
    messages,
    input: typeof raw.input === 'string' ? raw.input.slice(0, 8000) : '',
    context: normalizeContext(raw.context),
    contextUsed: !!raw.contextUsed,
    pinned: !!raw.pinned,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    messagesLoaded,
    messageCount: typeof raw.messageCount === 'number' && Number.isFinite(raw.messageCount) ? raw.messageCount : messages.length,
    preview: typeof raw.preview === 'string' && raw.preview ? raw.preview : previewOf(messages),
  }
}

/** @description: 把列表接口的摘要对象转成 ChatSession（不含 messages，需要时再拉 detail） */
function normalizeSummary(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as Record<string, unknown>
  const now = Date.now()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 120) : newMessageId('chat'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 40) : '未命名对话',
    messages: [],
    input: '',
    context: null,
    contextUsed: false,
    pinned: !!raw.pinned,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    messagesLoaded: false,
    messageCount: typeof raw.messageCount === 'number' && Number.isFinite(raw.messageCount) ? raw.messageCount : 0,
    preview: typeof raw.preview === 'string' ? raw.preview : '',
  }
}

function normalizeSessions(value: unknown): ChatSession[] {
  return sortSessions(
    (Array.isArray(value) ? value : [])
      .map(normalizeSession)
      .filter((s): s is ChatSession => !!s),
  ).slice(0, MAX_CHAT_SESSIONS)
}

function normalizeSummaries(value: unknown): ChatSession[] {
  return sortSessions(
    (Array.isArray(value) ? value : [])
      .map(normalizeSummary)
      .filter((s): s is ChatSession => !!s),
  ).slice(0, MAX_CHAT_SESSIONS)
}

function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.content || ''
  const title = first.replace(/\s+/g, ' ').trim().slice(0, 24)
  return title || '未命名对话'
}

function activeSessionOf(chat: ChatSlice): ChatSession | null {
  return chat.sessions.find(s => s.id === chat.activeId)
    || chat.sessions[0]
    || null
}

/**
 * @description: 把 chat.messages / input / context 回写进 sessions 里对应的会话。
 * 流式生成期间只更新了 chat.messages；若不回写，flushChatSync 落盘的是「空占位」版本，
 * 历史对话里就只剩 user 消息、看不到完整回复。
 */
function syncActiveSession(chat: ChatSlice): ChatSlice {
  const active = activeSessionOf(chat)
  if (!active)
    return chat
  const messages = chat.messages.slice(-MAX_CHAT_MESSAGES)
  const sessions = sortSessions(chat.sessions.map(s => (s.id === active.id
    ? {
        ...s,
        messages,
        input: chat.input,
        context: chat.context,
        contextUsed: chat.contextUsed,
        messagesLoaded: true,
        messageCount: messages.length,
        preview: previewOf(messages),
        updatedAt: Date.now(),
      }
    : s))).slice(0, MAX_CHAT_SESSIONS)
  return { ...chat, sessions }
}

function snapshot(chat: ChatSlice) {
  return {
    activeId: chat.activeId,
    previousActiveId: chat.previousActiveId,
    // 未加载的会话（摘要）不带 messages 字段：整包同步时后端据此从磁盘补齐，避免清空消息
    sessions: chat.sessions.slice(0, MAX_CHAT_SESSIONS).map(s => (s.messagesLoaded === false ? { ...s, messages: undefined } : s)),
  }
}

function chatSliceFromData(data: { activeId?: unknown, previousActiveId?: unknown, sessions?: unknown } | null | undefined): Partial<ChatSlice> {
  const sessions = normalizeSessions(data?.sessions)
  const activeId = typeof data?.activeId === 'string' && sessions.some(s => s.id === data.activeId)
    ? data.activeId
    : (sessions[0]?.id ?? null)
  const previousActiveId = typeof data?.previousActiveId === 'string'
    && data.previousActiveId !== activeId
    && sessions.some(s => s.id === data.previousActiveId)
    ? data.previousActiveId
    : null
  const active = sessions.find(s => s.id === activeId) || null
  return {
    sessions,
    activeId,
    previousActiveId,
    messages: active?.messages ?? [],
    input: active?.input ?? '',
    context: active?.context ?? null,
    contextUsed: active?.contextUsed ?? false,
    loading: false,
    error: null,
  }
}

function isLocalChatData(value: unknown): value is { activeId?: string | null, sessions: unknown[] } {
  return !!value && typeof value === 'object' && Array.isArray((value as any).sessions)
}

function saveLocalChatData(chat: ChatSlice) {
  if (typeof window === 'undefined')
    return
  try {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot(chat)))
  }
  catch {
    // 隐私模式/配额满时忽略，服务端仍是主存储
  }
}

function loadLocalChatData(): Partial<ChatSlice> | null {
  if (typeof window === 'undefined')
    return null
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY) || window.localStorage.getItem(LEGACY_CHAT_STORAGE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw)
    if (isLocalChatData(parsed)) {
      const data = chatSliceFromData(parsed)
      if (data.sessions?.length || data.input || data.context)
        return data
      return null
    }
    // 旧版单会话：{ messages, input, context, contextUsed }
    const legacySession = normalizeSession({
      ...parsed,
      id: typeof parsed?.id === 'string' ? parsed.id : newMessageId('legacy'),
      title: deriveTitle(Array.isArray(parsed?.messages) ? parsed.messages : []),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    if (!legacySession || (!legacySession.messages.length && !legacySession.input && !legacySession.context))
      return null
    return chatSliceFromData({ activeId: legacySession.id, sessions: [legacySession] })
  }
  catch {
    return null
  }
}

function sessionPayload(session: ChatSession) {
  return {
    id: session.id,
    title: session.title,
    messages: session.messages.slice(-MAX_CHAT_MESSAGES),
    input: session.input,
    context: session.context,
    contextUsed: session.contextUsed,
    pinned: !!session.pinned,
  }
}

function recordServerUpdatedAt(json: any) {
  const at = json?.data?.updatedAt
  if (typeof at === 'number' && at > 0)
    lastRemoteUpdatedAt = at
}

/** @description: 把完整会话写回 sessions；若它是当前会话，同步 active 的 messages/input/context */
function applyDetail(chat: ChatSlice, detail: ChatSession): ChatSlice {
  const sessions = sortSessions(chat.sessions.map(s => (s.id === detail.id
    ? { ...s, ...detail, messagesLoaded: true, messageCount: detail.messages.length, preview: previewOf(detail.messages) }
    : s))).slice(0, MAX_CHAT_SESSIONS)
  const isActive = chat.activeId === detail.id
  return {
    ...chat,
    sessions,
    messages: isActive ? detail.messages : chat.messages,
    input: isActive ? detail.input : chat.input,
    context: isActive ? detail.context : chat.context,
    contextUsed: isActive ? detail.contextUsed : chat.contextUsed,
  }
}

/** @description: 在摘要列表上决定 active/previousActive：优先保留 preferId（若仍存在） */
function pickActive(
  sessions: ChatSession[],
  remoteActiveId: unknown,
  remotePreviousActiveId: unknown,
  preferId: string | null,
): { activeId: string | null, previousActiveId: string | null } {
  const activeId = preferId && sessions.some(s => s.id === preferId)
    ? preferId
    : (typeof remoteActiveId === 'string' && sessions.some(s => s.id === remoteActiveId) ? remoteActiveId : (sessions[0]?.id ?? null))
  const previousActiveId = typeof remotePreviousActiveId === 'string'
    && remotePreviousActiveId !== activeId
    && sessions.some(s => s.id === remotePreviousActiveId)
    ? remotePreviousActiveId
    : null
  return { activeId, previousActiveId }
}

interface ChatSummaryPayload {
  activeId: string | null
  previousActiveId: string | null
  sessions: unknown
  updatedAt: number
}

/** @description: 拉会话摘要列表（不含 messages）；失败返回 null */
async function fetchChatSummary(): Promise<ChatSummaryPayload | null> {
  if (typeof window === 'undefined')
    return null
  try {
    const response = await fetch(CHAT_HISTORY_URL, { cache: 'no-store' })
    const json = await response.json().catch(() => null)
    if (json?.code !== 200 || !json.data)
      return null
    return {
      activeId: typeof json.data.activeId === 'string' ? json.data.activeId : null,
      previousActiveId: typeof json.data.previousActiveId === 'string' ? json.data.previousActiveId : null,
      sessions: json.data.sessions,
      updatedAt: typeof json.data.updatedAt === 'number' ? json.data.updatedAt : 0,
    }
  }
  catch {
    return null
  }
}

/** @description: 拉单个会话的完整数据；失败/不存在返回 null */
async function fetchChatDetail(id: string): Promise<ChatSession | null> {
  if (typeof window === 'undefined' || !id)
    return null
  try {
    const response = await fetch(`${CHAT_HISTORY_URL}?sessionId=${encodeURIComponent(id)}`, { cache: 'no-store' })
    const json = await response.json().catch(() => null)
    if (json?.code !== 200 || !json.data?.session)
      return null
    return normalizeSession(json.data.session)
  }
  catch {
    return null
  }
}

function pushSessionToServer(session: ChatSession) {
  if (typeof window === 'undefined')
    return
  // 摘要会话（messages 未加载）不能用空 messages 覆盖服务端整会话
  if (session.messagesLoaded === false)
    return
  void fetch(CHAT_HISTORY_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionPayload(session)),
  })
    .then(r => r.json())
    .then(recordServerUpdatedAt)
    .catch(() => {
      // 服务端暂不可用时保留 localStorage 副本，下次 patch 会再试
    })
}

function pushAllToServer(chat: ChatSlice) {
  if (typeof window === 'undefined')
    return
  void fetch(CHAT_HISTORY_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot(chat)),
  })
    .then(r => r.json())
    .then(recordServerUpdatedAt)
    .catch(() => {})
}

function cancelScheduledChatSync() {
  if (chatSyncTimer) {
    clearTimeout(chatSyncTimer)
    chatSyncTimer = null
  }
}

function scheduleChatSync(chat: ChatSlice) {
  saveLocalChatData(chat)
  if (typeof window === 'undefined')
    return
  cancelScheduledChatSync()
  chatSyncTimer = setTimeout(() => {
    chatSyncTimer = null
    const active = activeSessionOf(chat)
    if (active)
      pushSessionToServer(active)
  }, 600)
}

function flushChatSync(chat: ChatSlice) {
  cancelScheduledChatSync()
  saveLocalChatData(chat)
  const active = activeSessionOf(chat)
  if (active)
    pushSessionToServer(active)
}

/**
 * @description: 读取 `POST /api/ai/chat`（stream:true）的 SSE；onDelta 回调拿到的是「累计正文」。
 *  - 事件：{type:'delta',text} / {type:'usage',usage} / {type:'done'} / {type:'error',message}；
 *  - 若服务端没走流式（网关忽略 stream），自动退化为一次性 JSON 结果。
 */
async function streamChatReply(
  payload: { messages: Array<{ role: 'user' | 'assistant', content: string }>, context?: ChatContext, webSearch?: boolean },
  onDelta: (fullText: string) => void,
  signal?: AbortSignal,
): Promise<ChatReply> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  })

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !response.body || !contentType.includes('event-stream')) {
    const json = await response.json().catch(() => null)
    if (!response.ok || !json || json.code !== 200)
      throw new Error(json?.msg || `请求失败（HTTP ${response.status}）`)
    const text = typeof json.data?.text === 'string' ? json.data.text : ''
    if (!text)
      throw new Error('模型返回了空内容')
    onDelta(text)
    return { text, usage: json.data?.usage }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let usage: AiHistoryTokens | undefined

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let index: number
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:'))
            continue
          const data = line.slice(5).trim()
          if (!data)
            continue
          let event: any
          try {
            event = JSON.parse(data)
          }
          catch {
            continue
          }
          if (event.type === 'delta' && typeof event.text === 'string') {
            full += event.text
            onDelta(full)
          }
          else if (event.type === 'usage' && event.usage) {
            usage = event.usage
          }
          else if (event.type === 'error') {
            throw new Error(event.message || '对话失败')
          }
        }
      }
    }
  }
  finally {
    reader.releaseLock()
  }

  if (!full)
    throw new Error('模型返回了空内容')
  return { text: full, usage }
}

export const useAiAssistantStore = create<AiAssistantState>((set, get) => ({
  open: false,
  tab: 'chat',
  notify: null,
  historyTick: { chat: 0, item: 0, summary: 0, briefing: 0, analyze: 0, subscription: 0 },
  item: { title: '', url: '', content: '', loading: false, data: null },
  chat: { sessions: [], activeId: null, previousActiveId: null, messages: [], input: '', loading: false, context: null, contextUsed: false, error: null, webSearch: loadWebSearchPref(), pendingSubscription: null },
  summary: { alias: DEFAULT_ALIAS, limit: 10, loading: false, rows: [] },
  briefing: { selected: new Set(SOURCES.map(s => s.value)), perSource: 8, loading: false, data: null },
  analyze: { alias: DEFAULT_ALIAS, focus: '', limit: 20, loading: false, data: null },

  setNotify: notify => set({ notify }),
  setOpen: open => set({ open }),
  setTab: tab => set({ tab }),
  setWebSearch: (value) => {
    saveWebSearchPref(value)
    set(state => ({ chat: { ...state.chat, webSearch: value } }))
  },
  webSearchAvailable: false,
  setWebSearchAvailable: value => set({ webSearchAvailable: value }),

  openWith: ({ tab, title, url, source }) => {
    const wanted = tab === 'item' ? 'chat' : tab
    // 「邮件订阅」已从抽屉移到 /settings；旧的 tab=subscription 深链一律回落到 AI对话
    const nextTab: AiFeature =
      wanted === 'summary' || wanted === 'briefing' || wanted === 'analyze'
        ? wanted
        : 'chat'

    // 热榜右键「分析此条」：明确把标题 / 来源 / URL 写入用户消息，结构化 context 同时交给服务端抓正文。
    if (title || url) {
      // 若当前会话仍有旧轮在生成，先取消并解除 loading；否则 sendChat 会因 loading 直接 return，
      // 只更新 context 却不发送分析请求（用户看到的正是“没有拿到数据”）。
      cancelChatRun()
      const current = get().chat
      const messages = current.loading
        // Last assistant message is the cancelled stream, whether it has no text or only partial text.
        ? current.messages.filter((message, index) => !(index === current.messages.length - 1 && message.role === 'assistant'))
        : current.messages
      const sourceLabel = source ? SOURCES.find(item => item.value === source)?.label || source : ''
      set({ open: true, tab: 'chat' })
      get().patchChat({
        messages,
        loading: false,
        // 联网搜索是粘性偏好：这里只沿用当前开关（不可用时关闭），不强制开启。
        webSearch: get().chat.webSearch && get().webSearchAvailable,
        context: { title: title || '', url: url || '', source: sourceLabel },
        contextUsed: false,
        error: null,
      })
      const request = [
        '请分析下面这条热榜内容。请优先使用本轮的联网搜索结果与已抓取的正文；若确实无法获取，明确说明并仅依据标题分析，不要猜测正文。',
        title ? `标题：${title}` : '',
        sourceLabel ? `来源：${sourceLabel}` : '',
        url ? `链接：${url}` : '',
      ].filter(Boolean).join('\n')
      void get().sendChat(request)
      return
    }

    set({ open: true, tab: nextTab })
  },

  patchItem: patch => set(state => ({ item: { ...state.item, ...patch } })),
  patchChat: (patch) => {
    chatFlowSeq++
    set((state) => {
      const current = state.chat
      const { title: patchTitle, ...chatPatch } = patch
      const existing = activeSessionOf(current)
      const activeId = current.activeId || existing?.id || newMessageId('session')
      const messages = (chatPatch.messages ?? current.messages).slice(-MAX_CHAT_MESSAGES)
      const input = chatPatch.input ?? current.input
      const context = chatPatch.context !== undefined ? chatPatch.context : current.context
      const contextUsed = chatPatch.contextUsed ?? current.contextUsed
      const now = Date.now()
      // 从热榜右键进入时，历史标题优先用那条热榜的标题，而不是自动发的「请分析这条内容。」
      const contextTitle = (context?.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)

      const session: ChatSession = {
        id: activeId,
        title: patchTitle ?? (
          existing && existing.title && existing.title !== '未命名对话'
            ? existing.title
            : (contextTitle || deriveTitle(messages))
        ),
        messages,
        input,
        context,
        contextUsed,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        messagesLoaded: true,
        messageCount: messages.length,
        preview: previewOf(messages),
      }

      const sessions = sortSessions([session, ...current.sessions.filter(s => s.id !== activeId)])
        .slice(0, MAX_CHAT_SESSIONS)

      const chat: ChatSlice = {
        ...current,
        ...chatPatch,
        sessions,
        activeId,
        messages,
        input,
        context,
        contextUsed,
      }

      scheduleChatSync(chat)
      return { chat }
    })
  },
  patchSummary: patch => set(state => ({ summary: { ...state.summary, ...patch } })),
  patchBriefing: patch => set(state => ({ briefing: { ...state.briefing, ...patch } })),
  patchAnalyze: patch => set(state => ({ analyze: { ...state.analyze, ...patch } })),

  sendChat: async (text) => {
    const { chat, notify, patchChat } = get()
    const content = (text ?? chat.input).trim()
    if (!content || chat.loading)
      return
    // `/订阅 …` 是本地配置命令：解析成订阅 patch → 确认卡 → 用户点了才保存，全程不经过聊天模型
    if (SUBSCRIPTION_CMD_RE.test(content)) {
      await get().sendSubscriptionCommand(content)
      return
    }
    const run = beginChatRun()

    const userMessage: ChatMessage = {
      id: newMessageId('u'),
      role: 'user',
      content,
      at: Date.now(),
    }
    const requestMessages = [...chat.messages, userMessage].slice(-MAX_CHAT_MESSAGES)
    const hasContext = !!chat.context && !chat.contextUsed
    const useWebSearch = chat.webSearch
    const assistantMessage: ChatMessage = {
      id: newMessageId('a'),
      role: 'assistant',
      content: '',
      at: Date.now(),
    }

    // 先落一条空的 assistant 占位，随后把流式增量不断写进这条消息
    // 注意：webSearch 是粘性偏好，发送后不重置（跨新对话保持，直到用户手动关闭）
    patchChat({
      messages: [...requestMessages, assistantMessage].slice(-MAX_CHAT_MESSAGES),
      input: '',
      loading: true,
      error: null,
    })
    flushChatSync(get().chat)

    let acc = ''
    let lastPaint = 0
    const paint = (force = false) => {
      if (activeChatRun !== run)
        return
      const now = Date.now()
      if (!force && now - lastPaint < 60)
        return
      lastPaint = now
      set(state => ({
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === assistantMessage.id ? { ...m, content: acc } : m)),
        },
      }))
    }

    try {
      const reply = await streamChatReply(
        {
          messages: requestMessages.map(m => ({ role: m.role, content: m.content })),
          ...(hasContext ? { context: chat.context ?? undefined } : {}),
          ...(useWebSearch ? { webSearch: true } : {}),
        },
        (full) => {
          acc = full
          paint()
        },
        run.controller.signal,
      )
      // 会话已被切走/取消：丢弃本轮结果，别把旧生成写进新会话
      if (activeChatRun !== run)
        return
      activeChatRun = null
      // 收尾：写入最终正文与 usage；并回写 sessions，保证落盘/落库带完整对话
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === assistantMessage.id
            ? { ...m, content: reply.text, at: Date.now(), usage: reply.usage }
            : m)),
          loading: false,
          contextUsed: hasContext ? true : state.chat.contextUsed,
          error: null,
        }),
      }))
      flushChatSync(get().chat)
    }
    catch (error) {
      // 本轮已被「切换会话 / 新建 / 删除」取消：静默返回，不污染新会话
      if (activeChatRun !== run || isAbortError(error)) {
        if (activeChatRun === run)
          activeChatRun = null
        return
      }
      activeChatRun = null
      const message = error instanceof Error ? error.message : '对话失败'
      // 已经产出部分正文时保留，只有完全为空才移除占位气泡；同样回写 sessions
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.filter(m => m.id !== assistantMessage.id || m.content),
          loading: false,
          error: message,
        }),
      }))
      flushChatSync(get().chat)
      notify?.(message, false)
    }
  },

  /**
   * 「fetch failed」等生成失败后的重试：找到最后一条 user 消息，从它开始重发。
   * 先把它从消息列表里摘掉再交给 sendChat，避免同一条被追加两次（失败的占位/半截回复也一并丢弃）。
   */
  retryChat: async () => {
    const { chat } = get()
    if (chat.loading)
      return
    let index = -1
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') {
        index = i
        break
      }
    }
    if (index < 0)
      return
    const lastUser = chat.messages[index]
    get().patchChat({ messages: chat.messages.slice(0, index), error: null })
    await get().sendChat(lastUser.content)
  },

  sendSubscriptionCommand: async (text) => {
    const { chat, notify, patchChat } = get()
    const args = text.replace(SUBSCRIPTION_CMD_RE, '').trim()
    if (chat.loading)
      return
    const run = beginChatRun()

    const userMessage: ChatMessage = { id: newMessageId('u'), role: 'user', content: text, at: Date.now() }
    const replyMessage: ChatMessage = { id: newMessageId('a'), role: 'assistant', content: '', at: Date.now() }

    patchChat({
      messages: [...chat.messages, userMessage, replyMessage].slice(-MAX_CHAT_MESSAGES),
      input: '',
      loading: true,
      error: null,
      pendingSubscription: null,
    })
    flushChatSync(get().chat)
    const sessionId = get().chat.activeId

    // 收尾：把占位气泡换成最终文案，并挂上 / 清掉确认卡（会话已被切走时整轮丢弃）
    const settle = (body: string, pending: PendingSubscription | null, failed = false) => {
      if (activeChatRun !== run)
        return
      activeChatRun = null
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === replyMessage.id ? { ...m, content: body, at: Date.now(), error: failed || undefined } : m)),
          loading: false,
          pendingSubscription: pending,
        }),
      }))
      flushChatSync(get().chat)
    }

    // 只写命令没写需求：给用法，不调模型
    if (!args) {
      settle(SUBSCRIPTION_CMD_USAGE, null)
      return
    }

    try {
      const response = await fetch('/api/ai/subscription/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: args }),
        signal: run.controller.signal,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json || json.code !== 200)
        throw new Error(json?.msg || `解析失败（HTTP ${response.status}）`)
      if (activeChatRun !== run)
        return

      const patch = json.data?.patch as SubscriptionPatch | undefined
      if (!patch)
        throw new Error('解析结果缺少配置字段，请换个说法')
      const summary: string[] = Array.isArray(json.data?.summary)
        ? json.data.summary.filter((line: unknown): line is string => typeof line === 'string')
        : []
      if (!summary.length) {
        settle('没有识别到需要修改的订阅项，换个说法试试（或到「设置 → 邮件订阅」手工配置）。', null)
        notify?.('没有识别到需要修改的项，换个说法试试', false)
        return
      }

      const ruleText = describeSubscriptionRule(patch, Number(json.data?.intervalMinutes) || 0)

      // 保存前的提醒：只在能读到现有配置时判断 SMTP，读不到就不吓唬用户
      const warnings: string[] = []
      if (!patch.email)
        warnings.push('还没设置收件邮箱，保存后不会发信。')
      try {
        const current = await fetch('/api/subscription', { cache: 'no-store' }).then(r => r.json())
        if (current?.code === 200 && !current.data?.smtp?.host)
          warnings.push('还没填 SMTP 服务器，保存后需要到「设置 → 邮件订阅」补上才会真正发信。')
      }
      catch {
        // 读不到当前配置不影响出确认卡：保存时后端仍会按合并规则处理
      }
      if (activeChatRun !== run)
        return

      settle(
        `解析成订阅配置（**尚未保存**）：\n\n${summary.map(line => `- ${line}`).join('\n')}\n\n保存后规则：${ruleText}`,
        { messageId: replyMessage.id, sessionId, patch, summary, ruleText, warnings },
      )
    }
    catch (error) {
      if (activeChatRun !== run || isAbortError(error))
        return
      settle(`${error instanceof Error ? error.message : '解析失败'}\n\n可以换种说法，或到「设置 → 邮件订阅」手工配置。`, null, true)
    }
  },

  applyChatSubscription: async () => {
    const pending = get().chat.pendingSubscription
    if (!pending || pending.applying)
      return
    const { notify } = get()
    set(state => ({ chat: { ...state.chat, pendingSubscription: { ...pending, applying: true } } }))

    try {
      const response = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.patch),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json || json.code !== 200)
        throw new Error(json?.msg || `保存失败（HTTP ${response.status}）`)

      const notes: string[] = []
      if (!json.data?.email)
        notes.push('⚠️ 还没设置收件邮箱，不会发信。')
      if (!json.data?.smtp?.host)
        notes.push('⚠️ 还没填 SMTP 服务器，需要到「设置 → 邮件订阅」补上才会真正发信。')

      const body = [
        '✅ **已保存**订阅设置：',
        '',
        pending.summary.map(line => `- ${line}`).join('\n'),
        '',
        `当前规则：${pending.ruleText}`,
        ...(notes.length ? ['', notes.join('\n')] : []),
      ].join('\n')

      // 同一条气泡由「尚未保存」翻成「已保存」，确认卡收起
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === pending.messageId ? { ...m, content: body, error: undefined } : m)),
          pendingSubscription: null,
        }),
        historyTick: { ...state.historyTick, subscription: state.historyTick.subscription + 1 },
      }))
      flushChatSync(get().chat)
      notify?.('邮件订阅已保存')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      set(state => ({
        chat: {
          ...state.chat,
          pendingSubscription: state.chat.pendingSubscription ? { ...state.chat.pendingSubscription, applying: false } : null,
          error: message,
        },
      }))
      notify?.(message, false)
    }
  },

  cancelChatSubscription: () => {
    if (!get().chat.pendingSubscription)
      return
    set(state => ({ chat: { ...state.chat, pendingSubscription: null } }))
    get().notify?.('已取消，订阅未改动')
  },

  editChatMessage: async (id, content) => {
    const text = content.trim()
    if (!text)
      return
    const run = beginChatRun()
    const { chat, notify, patchChat } = get()
    const index = chat.messages.findIndex(m => m.id === id && m.role === 'user')
    if (index < 0)
      return

    const edited: ChatMessage = {
      ...chat.messages[index],
      content: text,
      at: Date.now(),
    }
    // 从被编辑的这条 user 消息开始重新生成，后面的旧消息全部丢弃
    const requestMessages = [...chat.messages.slice(0, index), edited].slice(-MAX_CHAT_MESSAGES)
    // 历史已被截断，如果原会话还带着热榜 context，这里重新带给模型一次
    const hasContext = !!chat.context
    const assistantMessage: ChatMessage = {
      id: newMessageId('a'),
      role: 'assistant',
      content: '',
      at: Date.now(),
    }

    patchChat({
      messages: [...requestMessages, assistantMessage].slice(-MAX_CHAT_MESSAGES),
      input: '',
      loading: true,
      error: null,
      contextUsed: false,
      title: deriveTitle(requestMessages),
    })
    flushChatSync(get().chat)

    let acc = ''
    let lastPaint = 0
    const paint = (force = false) => {
      if (activeChatRun !== run)
        return
      const now = Date.now()
      if (!force && now - lastPaint < 60)
        return
      lastPaint = now
      set(state => ({
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === assistantMessage.id ? { ...m, content: acc } : m)),
        },
      }))
    }

    try {
      const reply = await streamChatReply(
        {
          messages: requestMessages.map(m => ({ role: m.role, content: m.content })),
          ...(hasContext ? { context: chat.context ?? undefined } : {}),
        },
        (full) => {
          acc = full
          paint()
        },
        run.controller.signal,
      )
      if (activeChatRun !== run)
        return
      activeChatRun = null
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.map(m => (m.id === assistantMessage.id
            ? { ...m, content: reply.text, at: Date.now(), usage: reply.usage }
            : m)),
          loading: false,
          contextUsed: hasContext ? true : chat.contextUsed,
          error: null,
        }),
      }))
      flushChatSync(get().chat)
    }
    catch (error) {
      if (activeChatRun !== run || isAbortError(error)) {
        if (activeChatRun === run)
          activeChatRun = null
        return
      }
      activeChatRun = null
      const message = error instanceof Error ? error.message : '重新生成失败'
      set(state => ({
        chat: syncActiveSession({
          ...state.chat,
          messages: state.chat.messages.filter(m => m.id !== assistantMessage.id || m.content),
          loading: false,
          error: message,
          contextUsed: true,
        }),
      }))
      flushChatSync(get().chat)
      notify?.(message, false)
    }
  },

  newChat: () => {
    cancelChatRun()
    const now = Date.now()
    const session: ChatSession = {
      id: newMessageId('session'),
      title: '未命名对话',
      messages: [],
      input: '',
      context: null,
      contextUsed: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messagesLoaded: true,
      messageCount: 0,
      preview: '',
    }
    set((state) => {
      const sessions = sortSessions([session, ...state.chat.sessions]).slice(0, MAX_CHAT_SESSIONS)
      const chat: ChatSlice = {
        ...state.chat,
        sessions,
        activeId: session.id,
        previousActiveId: state.chat.activeId,
        messages: [],
        input: '',
        context: null,
        contextUsed: false,
        loading: false,
        error: null,
      }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
  },

  selectChat: (id) => {
    cancelChatRun()
    const session = get().chat.sessions.find(s => s.id === id)
    if (!session)
      return
    const activate = (state: ChatSlice, active: ChatSession): ChatSlice => ({
      ...state,
      activeId: id,
      previousActiveId: state.activeId === id ? state.previousActiveId : state.activeId,
      messages: active.messages,
      input: active.input,
      context: active.context,
      contextUsed: active.contextUsed,
      loading: false,
      error: null,
    })

    // 已加载完整消息：沿用原行为
    if (session.messagesLoaded !== false) {
      set((state) => {
        const target = state.chat.sessions.find(s => s.id === id)
        if (!target)
          return {}
        const chat = activate(state.chat, target)
        saveLocalChatData(chat)
        pushAllToServer(chat)
        return { chat }
      })
      return
    }

    // 摘要会话：先切 active（占位空对话），再异步拉完整会话填充
    set(state => ({ chat: activate(state.chat, session) }))
    const seq = chatFlowSeq
    void fetchChatDetail(id).then((detail) => {
      if (!detail || chatFlowSeq !== seq || get().chat.activeId !== id)
        return
      set((state) => {
        const chat = applyDetail(state.chat, detail)
        saveLocalChatData(chat)
        pushAllToServer(chat)
        return { chat }
      })
    })
  },

  deleteChat: async (id) => {
    cancelChatRun()
    const existing = get().chat.sessions.find(s => s.id === id) ?? null
    let removed = existing
    // 删除前确保拿到完整 messages，供「撤销删除」原样插回
    if (existing && existing.messagesLoaded === false)
      removed = (await fetchChatDetail(id)) ?? existing
    set((state) => {
      const sessions = state.chat.sessions.filter(s => s.id !== id)
      const activeId = state.chat.activeId === id ? (sessions[0]?.id ?? null) : state.chat.activeId
      const previousActiveId = state.chat.previousActiveId === id ? null : state.chat.previousActiveId
      const active = sessions.find(s => s.id === activeId)
      const chat: ChatSlice = {
        ...state.chat,
        sessions,
        activeId,
        previousActiveId,
        messages: active?.messages ?? [],
        input: active?.input ?? '',
        context: active?.context ?? null,
        contextUsed: active?.contextUsed ?? false,
        loading: false,
        error: null,
      }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
    return removed
  },

  ensureChatLoaded: async (id) => {
    const existing = get().chat.sessions.find(s => s.id === id)
    if (existing && existing.messagesLoaded !== false)
      return existing
    const detail = await fetchChatDetail(id)
    if (!detail)
      return null
    if (!get().chat.sessions.some(s => s.id === id))
      return detail
    set((state) => {
      const chat = applyDetail(state.chat, detail)
      saveLocalChatData(chat)
      return { chat }
    })
    return get().chat.sessions.find(s => s.id === id) ?? detail
  },

  reinsertChatSession: (session, makeActive = false) => {
    cancelChatRun()
    set((state) => {
      const rest = state.chat.sessions.filter(s => s.id !== session.id)
      const sessions = sortSessions([session, ...rest]).slice(0, MAX_CHAT_SESSIONS)
      const base = { ...state.chat, sessions }
      const chat: ChatSlice = makeActive
        ? {
            ...base,
            activeId: session.id,
            previousActiveId: state.chat.activeId === session.id ? state.chat.previousActiveId : state.chat.activeId,
            messages: session.messages,
            input: session.input,
            context: session.context,
            contextUsed: session.contextUsed,
            loading: false,
            error: null,
          }
        : { ...base, activeId: state.chat.activeId || session.id }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
  },

  restoreLastChat: () => {
    cancelChatRun()
    set((state) => {
      const targetId = state.chat.previousActiveId
      if (!targetId)
        return {}
      const target = state.chat.sessions.find(s => s.id === targetId)
      if (!target)
        return {}
      const chat: ChatSlice = {
        ...state.chat,
        activeId: targetId,
        previousActiveId: state.chat.activeId,
        messages: target.messages,
        input: target.input,
        context: target.context,
        contextUsed: target.contextUsed,
        loading: false,
        error: null,
      }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
  },

  renameChat: (id, title) => {
    chatFlowSeq++
    const next = title.replace(/\s+/g, ' ').trim().slice(0, 40)
    set((state) => {
      const target = state.chat.sessions.find(s => s.id === id)
      if (!target)
        return {}
      const session: ChatSession = {
        ...target,
        title: next || deriveTitle(target.messages),
        updatedAt: Date.now(),
      }
      const sessions = sortSessions([session, ...state.chat.sessions.filter(s => s.id !== id)])
        .slice(0, MAX_CHAT_SESSIONS)
      const chat: ChatSlice = { ...state.chat, sessions }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
  },

  togglePinChat: (id) => {
    chatFlowSeq++
    set((state) => {
      const target = state.chat.sessions.find(s => s.id === id)
      if (!target)
        return {}
      const session: ChatSession = {
        ...target,
        pinned: !target.pinned,
        updatedAt: Date.now(),
      }
      const sessions = sortSessions([session, ...state.chat.sessions.filter(s => s.id !== id)])
        .slice(0, MAX_CHAT_SESSIONS)
      const chat: ChatSlice = { ...state.chat, sessions }
      saveLocalChatData(chat)
      pushAllToServer(chat)
      return { chat }
    })
  },

  pollChat: async () => {
    if (typeof window === 'undefined')
      return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      return
    // 本地有未落盘改动 / 正在生成时，先不覆盖本地
    if (get().chat.loading || chatSyncTimer)
      return
    const startSeq = chatFlowSeq

    const summary = await fetchChatSummary()
    if (!summary)
      return
    // 请求期间用户切换了会话 / 开了新一轮：丢弃这次远端结果
    if (chatFlowSeq !== startSeq)
      return
    const remoteUpdatedAt = summary.updatedAt
    if (remoteUpdatedAt === lastRemoteUpdatedAt)
      return
    lastRemoteUpdatedAt = remoteUpdatedAt
    // updatedAt 为 0 表示服务端从未初始化，此时不动本地
    if (remoteUpdatedAt === 0)
      return

    const current = get().chat
    // 只拉摘要：用摘要重建 sessions（不含 messages），当前会话按需再拉 detail
    const sessions = normalizeSummaries(summary.sessions)
    const keepActive = !!current.activeId && sessions.some(s => s.id === current.activeId)
    const { activeId, previousActiveId } = pickActive(
      sessions,
      summary.activeId,
      summary.previousActiveId,
      keepActive ? current.activeId : null,
    )
    const summaryActive = sessions.find(s => s.id === activeId) || null
    const localActive = current.sessions.find(s => s.id === activeId) || null
    // 本地 active 已加载且服务端摘要未变：沿用本地内容，无需再拉 detail
    const reuseLocal = !!localActive
      && localActive.messagesLoaded !== false
      && !!summaryActive
      && localActive.updatedAt === summaryActive.updatedAt

    let chat: ChatSlice = {
      ...current,
      sessions: reuseLocal && localActive
        ? sessions.map(s => (s.id === activeId ? localActive : s))
        : sessions,
      activeId,
      previousActiveId,
      messages: reuseLocal && localActive ? localActive.messages : [],
      input: reuseLocal && localActive ? localActive.input : '',
      context: reuseLocal && localActive ? localActive.context : null,
      contextUsed: reuseLocal && localActive ? localActive.contextUsed : false,
      loading: false,
      error: null,
    }

    // active 变了 / 未加载 / 摘要更新了：拉完整会话
    if (activeId && !reuseLocal) {
      const detail = await fetchChatDetail(activeId)
      if (chatFlowSeq !== startSeq)
        return
      if (detail)
        chat = applyDetail(chat, detail)
    }
    saveLocalChatData(chat)
    set({ chat })
  },

  startChatPolling: () => {
    if (typeof window === 'undefined' || chatPollTimer)
      return
    chatPollTimer = setInterval(() => {
      void get().pollChat()
    }, CHAT_POLL_MS)
  },

  stopChatPolling: () => {
    if (chatPollTimer) {
      clearInterval(chatPollTimer)
      chatPollTimer = null
    }
  },

  hydrateChat: async () => {
    const local = loadLocalChatData()

    const summary = await fetchChatSummary()
    if (summary) {
      lastRemoteUpdatedAt = summary.updatedAt
      const summaries = normalizeSummaries(summary.sessions)
      // updatedAt > 0 表示服务端初始化过：即便 sessions 为空，也代表“用户把会话删空了”，
      // 此时绝不能用本地旧缓存反向迁移，否则另一台设备的删除会被旧 localStorage 顶掉。
      const remoteInitialized = summaries.length > 0 || summary.updatedAt > 0

      if (remoteInitialized) {
        const { activeId, previousActiveId } = pickActive(summaries, summary.activeId, summary.previousActiveId, null)
        let chat: ChatSlice = {
          ...get().chat,
          sessions: summaries,
          activeId,
          previousActiveId,
          messages: [],
          input: '',
          context: null,
          contextUsed: false,
          loading: false,
          error: null,
        }
        // 摘要不含 messages：按需拉当前会话的完整内容
        const detail = activeId ? await fetchChatDetail(activeId) : null
        if (detail)
          chat = applyDetail(chat, detail)
        saveLocalChatData(chat)
        set({ chat })
        return
      }

      // 服务端从未初始化且本地有旧会话：把 localStorage 里的会话迁到服务端
      if (local) {
        const localSessions = local.sessions ?? []
        // 本地若是摘要（messagesLoaded:false），逐个拉 detail 补全，避免迁移把消息写空
        const sessions = await Promise.all(localSessions.map(async (s) => {
          if (s.messagesLoaded !== false)
            return s
          return (await fetchChatDetail(s.id)) ?? s
        }))
        const chat = { ...get().chat, ...local, sessions, loading: false, error: null } as ChatSlice
        if (!chat.activeId && chat.sessions.length)
          chat.activeId = chat.sessions[0].id
        if (!chat.messages.length && chat.sessions.length) {
          const active = activeSessionOf(chat)
          chat.messages = active?.messages ?? []
          chat.input = active?.input ?? ''
          chat.context = active?.context ?? null
          chat.contextUsed = active?.contextUsed ?? false
        }
        saveLocalChatData(chat)
        set({ chat })
        pushAllToServer(chat)
        return
      }

      // 两边都空，保持初始状态
      return
    }

    // 网络失败：离线兜底，只把「已加载」的 active 消息当可用，避免用空 messages 覆盖
    if (local) {
      const chat = { ...get().chat, ...local, loading: false, error: null } as ChatSlice
      const active = activeSessionOf(chat)
      if (!active || active.messagesLoaded === false) {
        chat.messages = []
        chat.input = ''
        chat.context = null
        chat.contextUsed = false
      }
      set({ chat })
    }
  },
  runItem: async (override) => {
    const { item, notify, patchItem, historyTick } = get()
    const finalTitle = override?.title ?? item.title
    const finalUrl = override?.url ?? item.url
    if (!finalTitle.trim() && !item.content.trim()) {
      notify?.('请至少填写标题或正文', false)
      return
    }
    patchItem({ loading: true, data: null })
    try {
      const result = await post<ItemResult>('/api/ai/item', { title: finalTitle, url: finalUrl, content: item.content })
      patchItem({ data: result })
      set({ historyTick: { ...historyTick, item: historyTick.item + 1 } })
      notify?.(result.contentSource === 'fetched' ? '已抓取正文并完成分析' : '分析完成')
    }
    catch (e) {
      notify?.((e as Error).message, false)
    }
    finally {
      patchItem({ loading: false })
    }
  },

  runSummary: async () => {
    const { summary, notify, patchSummary, historyTick } = get()
    patchSummary({ loading: true, rows: [] })
    try {
      const label = SOURCES.find(s => s.value === summary.alias)?.label
      const res = await postEnvelope<SummaryRow[]>('/api/ai/summarize', { alias: summary.alias, label, limit: summary.limit })
      const rows = res.data ?? []
      patchSummary({ rows })
      set({ historyTick: { ...historyTick, summary: historyTick.summary + 1 } })
      const failed = rows.filter(r => r.error).length
      notify?.(failed ? `生成 ${rows.length} 条，其中 ${failed} 条失败` : `已生成 ${rows.length} 条摘要`)
    }
    catch (e) {
      notify?.((e as Error).message, false)
    }
    finally {
      patchSummary({ loading: false })
    }
  },

  runBriefing: async () => {
    const { briefing, notify, patchBriefing, historyTick } = get()
    patchBriefing({ loading: true, data: null })
    try {
      const result = await post<BriefingData>('/api/ai/briefing', { aliases: [...briefing.selected], perSource: briefing.perSource })
      patchBriefing({ data: result })
      set({ historyTick: { ...historyTick, briefing: historyTick.briefing + 1 } })
      notify?.(result.cached ? '命中缓存，已载入简报' : '简报已生成')
    }
    catch (e) {
      notify?.((e as Error).message, false)
    }
    finally {
      patchBriefing({ loading: false })
    }
  },

  runAnalyze: async () => {
    const { analyze, notify, patchAnalyze, historyTick } = get()
    if (!analyze.alias) {
      notify?.('请先选择数据源', false)
      return
    }
    patchAnalyze({ loading: true, data: null })
    try {
      const label = SOURCES.find(s => s.value === analyze.alias)?.label
      const result = await post<AnalyzeResult>('/api/ai/analyze', { alias: analyze.alias, label, focus: analyze.focus, limit: analyze.limit })
      patchAnalyze({ data: result })
      set({ historyTick: { ...historyTick, analyze: historyTick.analyze + 1 } })
      notify?.(result.cached ? '命中缓存，已载入分析' : '分析完成')
    }
    catch (e) {
      notify?.((e as Error).message, false)
    }
    finally {
      patchAnalyze({ loading: false })
    }
  },
}))
