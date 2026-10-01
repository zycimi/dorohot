/*
 * @Description: AI 能力（摘要 / 简报 / 趋势分析 / 单条解析）
 *
 * 设计要点（2026-09-14 接入，同日改造为可配置模型）：
 *  - **模型可配置**：模型名字 / Base URL / Headers / API 类型 / API Key / 对话模型 六项。
 *      取值优先级：环境变量 > 配置文件 > 旧凭据文件 > 默认值
 *    API 类型支持 Chat Completions(/chat/completions) · Anthropic Messages(/v1/messages)
 *    · Responses(/responses)，三者的端点、鉴权头、请求体与响应结构都不同，见 chat()。
 *    配置文件路径由 `AI_CONFIG_FILE` 指定，默认取项目上一级的 `model-config.json`，
 *    由 `/AiModel` 页的「模型设置」写入（保存前自动 .bak，原子写）。
 *  - **向后兼容**：配置文件里没有 Key 时，回退读旧的 `deepseek-model.json`
 *      （该文件是**无花括号的 JSON 对象体**，字段名不固定，取首个 `sk-` 开头的值）。
 *  - **成本**：同一内容只调一次模型，结果按「内容哈希」落盘缓存（默认 7 天）。
 *  - **降级**：本模块只负责抛错，由 route 转成可读错误；绝不影响热榜本身的抓取与展示。
 */
import { createHash } from 'node:crypto'
import { setDefaultResultOrder } from 'node:dns'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import * as cheerio from 'cheerio'

import { HOT_ITEMS } from '@/enums'

import { authDiagnostics, cookieHeaderFor, sourceIdForHost, sourceLabelOf } from './site-auth'
import { fetchXhhPostDetail, xhhLinkIdFromUrl } from './xhh'

/**
 * 优先 IPv4。
 *
 * 本机没有 IPv6 出网路由，但 DNS 同时返回 A/AAAA；Node 的 fetch(undici) 有时优先连 AAAA，
 * 连接会立刻失败并抛出 "fetch failed"（表现为 AI 对话偶发「fetch failed」）。
 * 全局把解析顺序改成 IPv4 优先即可消除该抖动。重复调用无副作用。
 */
setDefaultResultOrder('ipv4first')

/** 默认值：DeepSeek 的 OpenAI 兼容端点。对话模型**故意不设默认**——由用户在「模型设置」里显式添加 */
export const AI_DEFAULTS = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: '',
}

/** 自建服务自身的地址，用于聚合各数据源（避免 import route 模块） */
const SELF_BASE = process.env.AI_SELF_BASE || 'http://127.0.0.1:3000'


/** 结果缓存：默认项目内 data/model-cache，可用 AI_CACHE_DIR 覆盖（分发版无此目录时自动创建） */
const CACHE_DIR = process.env.AI_CACHE_DIR || join(process.cwd(), 'data', 'model-cache')
const CACHE_TTL = Number(process.env.AI_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000)

// ---------------------------------------------------------------------------
// 配置（模型名字 / Base URL / Headers / API 类型 / API Key / 对话模型）
// ---------------------------------------------------------------------------

/** 支持的 API 类型：决定端点路径、鉴权头、请求体与响应解析方式 */
export type ApiType = 'chat-completions' | 'anthropic-messages' | 'responses'

export const API_TYPES: { value: ApiType, label: string, path: string, hint: string }[] = [
  { value: 'chat-completions', label: 'Chat Completions', path: '/chat/completions', hint: 'OpenAI 兼容（DeepSeek / 通义 / Kimi / 智谱 / vLLM 等）' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages', hint: 'Claude 原生协议（x-api-key 鉴权）' },
  { value: 'responses', label: 'Responses', path: '/responses', hint: 'OpenAI Responses API' },
]

export const DEFAULT_API_TYPE: ApiType = 'chat-completions'

/** 模型用途模式：目前 AI 各项能力都走「文本」，另两个先作为标记存下来 */
export type ModelMode = 'text' | 'image' | 'video'

export const MODEL_MODES: { value: ModelMode, label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

export const DEFAULT_MODEL_MODE: ModelMode = 'text'

function isModelMode(value: unknown): value is ModelMode {
  return MODEL_MODES.some(m => m.value === value)
}

/** 模式是**多选**：接受字符串数组、逗号分隔字符串，也兼容旧的单值写法；去重保序 */
function normalizeModes(value: unknown): ModelMode[] {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : [])
  const out: ModelMode[] = []
  for (const item of raw) {
    const mode = typeof item === 'string' ? item.trim() : ''
    if (isModelMode(mode) && !out.includes(mode))
      out.push(mode)
  }
  return out.length ? out : [DEFAULT_MODEL_MODE]
}

export function isApiType(value: unknown): value is ApiType {
  return API_TYPES.some(t => t.value === value)
}

export interface AiSettings {
  /** 模型名字：仅用于展示与区分，不参与请求 */
  name: string
  baseUrl: string
  /** 自定义请求头，会附加（并覆盖同名默认头）到每次请求 */
  headers: Record<string, string>
  apiType: ApiType
  apiKey: string
  /** 对话模型 ID，即请求体里的 model 字段 */
  model: string
  /** 模型用途模式（多选：文本/图片/视频），当前仅作文档标记 */
  modelModes: ModelMode[]
}

export type SettingSource = 'env' | 'file' | 'legacy' | 'default'

export function configFile(): string {
  return process.env.AI_CONFIG_FILE || join(process.cwd(), '..', 'model-config.json')
}

/**
 * 旧配置文件（2026-09-15 起由 `ai-config.json` 改名为 `model-config.json`）
 *  - **只用于读取兜底**：新文件不存在而旧文件在时，仍按旧文件解析，避免改名后老配置"消失"；
 *    保存时一律写到新文件名，用户下次保存即自动完成迁移。
 */
export function legacyConfigFile(): string {
  return process.env.AI_CONFIG_FILE_LEGACY || join(process.cwd(), '..', 'ai-config.json')
}

/** @description: 实际读到配置的文件（新名优先）；也是 mtime 缓存与 UI 展示的依据 */
export function effectiveConfigFile(): string {
  const file = configFile()
  if (existsSync(file))
    return file
  const legacy = legacyConfigFile()
  return existsSync(legacy) ? legacy : file
}

export function legacyKeyFile(): string {
  return process.env.DEEPSEEK_KEY_FILE || join(process.cwd(), '..', 'deepseek-model.json')
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs
  }
  catch {
    return 0
  }
}

/** 容错 JSON 读取：兼容「无花括号的对象体」写法（旧凭据文件即如此） */
function readJsonLoose(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file))
      return null
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return null
    try {
      return JSON.parse(raw)
    }
    catch {
      return JSON.parse(`{${raw.replace(/,\s*$/, '')}}`)
    }
  }
  catch {
    return null
  }
}

/** 按候选字段名取第一个非空字符串（容忍用户手写配置文件时用不同命名） */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim())
      return value.trim()
  }
  return ''
}

/** 旧凭据文件：字段名不固定，优先取 sk- 开头的值 */
function readLegacyKey(file: string): string {
  const obj = readJsonLoose(file)
  if (!obj)
    return ''
  const values = Object.values(obj).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return (values.find(v => v.startsWith('sk-')) || values[0] || '').trim()
}

// ---------------------------------------------------------------------------
// 供应商库（配置文件里存多份设置，其中一份为「当前使用」）
// ---------------------------------------------------------------------------

/** 配置文件结构；`active` 指向 providers 里正在使用的那份 */

/** Web search integrations compatible with OpenCode's bundled provider set. */
export type WebSearchProvider = 'exa' | 'firecrawl' | 'parallel' | 'tavily' | 'bing-rss' | 'google-cse'
export interface WebSearchSettings {
  enabled: boolean
  provider: WebSearchProvider
  apiKeys: Partial<Record<WebSearchProvider, string>>
  googleCx: string
}

export const WEB_SEARCH_PROVIDERS: { value: WebSearchProvider, label: string, envVar: string }[] = [
  { value: 'bing-rss', label: 'Bing RSS', envVar: '' },
  { value: 'google-cse', label: 'Google CSE', envVar: 'GOOGLE_CSE_API_KEY' },
  { value: 'exa', label: 'Exa', envVar: 'EXA_API_KEY' },
  { value: 'firecrawl', label: 'Firecrawl', envVar: 'FIRECRAWL_API_KEY' },
  { value: 'parallel', label: 'Parallel', envVar: 'PARALLEL_API_KEY' },
  { value: 'tavily', label: 'Tavily', envVar: 'TAVILY_API_KEY' },
]

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  provider: 'bing-rss',
  apiKeys: {},
  googleCx: '',
}

function normalizeWebSearch(raw: unknown): WebSearchSettings {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const provider = WEB_SEARCH_PROVIDERS.some(p => p.value === obj.provider)
    ? obj.provider as WebSearchProvider
    : DEFAULT_WEB_SEARCH_SETTINGS.provider
  const apiKeys = obj.apiKeys && typeof obj.apiKeys === 'object' ? obj.apiKeys as Record<string, unknown> : {}
  // Migrate the first version's single key into the selected provider's slot.
  const legacyKey = typeof obj.apiKey === 'string' ? obj.apiKey.trim() : ''
  return {
    enabled: obj.enabled === true,
    provider,
    googleCx: typeof obj.googleCx === 'string' ? obj.googleCx.trim() : '',
    apiKeys: {
      exa: typeof apiKeys.exa === 'string' ? apiKeys.exa.trim() : (provider === 'exa' ? legacyKey : ''),
      firecrawl: typeof apiKeys.firecrawl === 'string' ? apiKeys.firecrawl.trim() : (provider === 'firecrawl' ? legacyKey : ''),
      parallel: typeof apiKeys.parallel === 'string' ? apiKeys.parallel.trim() : (provider === 'parallel' ? legacyKey : ''),
      tavily: typeof apiKeys.tavily === 'string' ? apiKeys.tavily.trim() : (provider === 'tavily' ? legacyKey : ''),
    },
  }
}

interface ConfigFile {
  active: string
  providers: AiSettings[]
  webSearch: WebSearchSettings
}

function emptyProvider(name = ''): AiSettings {
  return {
    name,
    baseUrl: '',
    headers: {},
    apiType: DEFAULT_API_TYPE,
    apiKey: '',
    model: '',
    modelModes: [DEFAULT_MODEL_MODE],
  }
}

/** 把任意来源的对象规整成一份供应商设置（字段名容错） */
function normalizeProvider(raw: Record<string, unknown>, fallbackName: string): AiSettings {
  const rawApiType = pick(raw, ['apiType', 'api_type', 'type', 'protocol'])
  return {
    name: pick(raw, ['name', 'modelName', 'model_name', 'label', 'title']) || fallbackName,
    baseUrl: pick(raw, ['baseUrl', 'base_url', 'apiBase', 'endpoint', 'URL']),
    headers: pickObject(raw, ['headers', 'header']),
    apiType: isApiType(rawApiType) ? rawApiType : DEFAULT_API_TYPE,
    apiKey: pick(raw, ['apiKey', 'api_key', 'key', 'token']),
    model: pick(raw, ['model', 'chatModel', 'chat_model']),
    modelModes: normalizeModes(raw.modelModes ?? raw.model_modes ?? raw.modelMode ?? raw.model_mode ?? raw.mode),
  }
}

/**
 * @description: 读取配置文件
 *  - 新格式：`{ active, providers: [...] }`
 *  - **兼容旧格式**：早期是「单份扁平设置」，读取时自动迁移成一条供应商，不落盘（等用户保存才写回）
 */
function readConfig(): ConfigFile {
  const raw = readJsonLoose(effectiveConfigFile())
  if (!raw)
    return { active: '', providers: [], webSearch: { ...DEFAULT_WEB_SEARCH_SETTINGS } }

  const webSearch = normalizeWebSearch(raw.webSearch)

  if (Array.isArray(raw.providers)) {
    const providers = raw.providers
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item, index) => normalizeProvider(item, `供应商 ${index + 1}`))
    const active = typeof raw.active === 'string' && providers.some(p => p.name === raw.active)
      ? raw.active
      : (providers[0]?.name ?? '')
    return { active, providers, webSearch }
  }

  // 旧扁平格式 → 迁移
  if (pick(raw, ['baseUrl', 'apiBase', 'apiType', 'api_type', 'model', 'apiKey', 'modelMode'])) {
    const provider = normalizeProvider(raw, AI_DEFAULTS.name)
    if (!provider.name)
      provider.name = AI_DEFAULTS.name
    return { active: provider.name, providers: [provider], webSearch }
  }

  return { active: '', providers: [], webSearch }
}

/** @description: 原子写入配置（保存前备份 .bak），并让缓存立即失效 */
function writeConfig(config: ConfigFile): void {
  const file = configFile()
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))

  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)

  settingsCache = null
}

/** @description: 已保存的供应商名单 */
export function listProviders(): AiSettings[] {
  return readConfig().providers
}

/** @description: 切换当前使用的供应商 */
export function activateProvider(name: string): boolean {
  const config = readConfig()
  if (!config.providers.some(p => p.name === name))
    return false
  writeConfig({ ...config, active: name })
  return true
}

/**
 * @description: 删除一个已保存的供应商（从配置文件移除，不可恢复）
 *  - 若删除的是当前使用的那份，自动切到剩下的第一份；没有剩余则清空 active；
 *  - 由环境变量提供的凭据不受影响（仍在 resolveSettings 里覆盖生效）。
 */
export function deleteProvider(name: string): { ok: boolean, active: string, providers: AiSettings[] } {
  const config = readConfig()
  if (!config.providers.some(p => p.name === name))
    return { ok: false, active: config.active, providers: config.providers }

  const providers = config.providers.filter(p => p.name !== name)
  const active = config.active === name ? (providers[0]?.name ?? '') : config.active
  writeConfig({ ...config, active, providers })
  return { ok: true, active, providers }
}

/** Current web search configuration. */
export function readWebSearchSettings(): WebSearchSettings {
  return readConfig().webSearch
}

/** Public status never exposes the search API key. */
export function getPublicWebSearchSettings() {
  const saved = readWebSearchSettings()
  const apiKeys = Object.fromEntries(WEB_SEARCH_PROVIDERS.map(({ value, envVar }) => {
    const key = (envVar ? process.env[envVar] : '') || saved.apiKeys[value] || ''
    return [value, { hasApiKey: !!key, apiKeyMasked: key ? `${key.slice(0, 3)}•••••` : '', envLocked: !!(envVar && process.env[envVar]) }]
  })) as Record<WebSearchProvider, { hasApiKey: boolean, apiKeyMasked: string, envLocked: boolean }>
  const current = apiKeys[saved.provider]
  const googleCx = process.env.GOOGLE_CSE_CX || saved.googleCx || ''
  return {
    enabled: saved.enabled,
    provider: saved.provider,
    providerOptions: WEB_SEARCH_PROVIDERS.map(({ value, label }) => ({ value, label })),
    hasApiKey: current.hasApiKey,
    apiKeyMasked: current.apiKeyMasked,
    envLocked: current.envLocked,
    googleCx,
    googleCxConfigured: !!googleCx,
    googleCxEnvLocked: !!process.env.GOOGLE_CSE_CX,
    // 所有搜索源（含 Bing RSS）都可作为 AI 对话的检索上下文。
    supportsAiContext: true,
    apiKeys: Object.fromEntries(Object.entries(apiKeys).map(([provider, value]) => [provider, {
      hasApiKey: value.hasApiKey,
      apiKeyMasked: value.apiKeyMasked,
      envLocked: value.envLocked,
    }])),
  }
}

/** Update web search settings, retaining the saved key when the form sends an empty value. */
export function saveWebSearchSettings(patch: { enabled?: boolean, provider?: WebSearchProvider, apiKey?: string, clearApiKey?: boolean, googleCx?: string }): WebSearchSettings {
  const config = readConfig()
  const existing = config.webSearch
  const provider = WEB_SEARCH_PROVIDERS.some(p => p.value === patch.provider)
    ? patch.provider as WebSearchProvider
    : existing.provider
  const submittedKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : ''
  const next: WebSearchSettings = {
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled === true,
    provider,
    googleCx: patch.googleCx === undefined ? existing.googleCx : patch.googleCx.trim(),
    apiKeys: {
      ...existing.apiKeys,
      ...(submittedKey ? { [provider]: submittedKey } : {}),
      ...(patch.clearApiKey ? { [provider]: '' } : {}),
    },
  }
  const selectedEnvName = WEB_SEARCH_PROVIDERS.find(p => p.value === provider)?.envVar || ''
  const selectedEnvKey = selectedEnvName ? process.env[selectedEnvName] : ''
  const hasKeylessProvider = provider === 'bing-rss'
  const googleReady = provider !== 'google-cse' || !!next.googleCx
  if (next.enabled && !((selectedEnvKey || next.apiKeys[provider] || hasKeylessProvider) && googleReady))
    next.enabled = false
  writeConfig({ ...config, webSearch: next })
  return next
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

const WEB_SEARCH_TIMEOUT_MS = 20_000

/** Search the configured provider and normalize its results for model context. */
export async function searchWeb(query: string, limit = 5, options: { forModelContext?: boolean, allowWhenDisabled?: boolean } = {}): Promise<{ provider: string, results: WebSearchResult[] }> {
  const settings = readWebSearchSettings()
  const envName = WEB_SEARCH_PROVIDERS.find(p => p.value === settings.provider)?.envVar || ''
  const apiKey = (envName ? process.env[envName] : '') || settings.apiKeys[settings.provider] || ''
  if (!apiKey && settings.provider !== 'bing-rss')
    throw new Error('联网搜索源未配置 API Key，请前往「设置 → 联网搜索」填写')
  if (settings.provider === 'google-cse' && !settings.googleCx)
    throw new Error('Google CSE 尚未配置搜索引擎 ID（CX），请前往「设置 → 联网搜索」填写')
  const q = query.trim().slice(0, 500)
  if (!q)
    throw new Error('请输入搜索关键词')
  if (!settings.enabled && !options.allowWhenDisabled)
    throw new Error('尚未启用联网搜索，请前往「设置 → 联网搜索」配置')
  const count = Math.max(1, Math.min(8, Math.floor(limit) || 5))
  const request = async (url: string, body: Record<string, unknown>, headers: Record<string, string>) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    })
    if (!response.ok)
      throw new Error(`联网搜索接口返回 HTTP ${response.status}`)
    return response.json() as Promise<Record<string, any>>
  }

  let payload: Record<string, any>
  switch (settings.provider) {
    case 'tavily':
      payload = await request('https://api.tavily.com/search', { query: q, max_results: count, search_depth: 'basic' }, { Authorization: `Bearer ${apiKey}` })
      return { provider: 'Tavily', results: (payload.results ?? []).map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(r.content || '') })).filter((r: WebSearchResult) => r.url) }
    case 'firecrawl': {
      payload = await request('https://api.firecrawl.dev/v2/search', { query: q, limit: count }, { Authorization: `Bearer ${apiKey}` })
      const rows = payload.data?.web ?? payload.data?.results ?? []
      return { provider: 'Firecrawl', results: rows.map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(r.description || r.markdown || '') })).filter((r: WebSearchResult) => r.url) }
    }
    case 'parallel':
      payload = await request('https://api.parallel.ai/v1/search', { objective: q, search_queries: [q], max_chars_total: count * 1200, advanced_settings: { max_results: count, excerpt_settings: { max_chars_per_result: 1200 } } }, { 'x-api-key': apiKey })
      return { provider: 'Parallel', results: (payload.results ?? []).map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(Array.isArray(r.excerpts) ? r.excerpts.join(' ') : r.excerpt || r.snippet || r.content || '') })).filter((r: WebSearchResult) => r.url) }
    case 'exa':
      payload = await request('https://api.exa.ai/search', { query: q, type: 'auto', numResults: count, contents: { highlights: { maxCharacters: 900 } } }, { Authorization: `Bearer ${apiKey}` })
      return { provider: 'Exa', results: (payload.results ?? []).map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(Array.isArray(r.highlights) ? r.highlights.join(' ') : r.text || r.highlight || '') })).filter((r: WebSearchResult) => r.url) }
    case 'google-cse': {
      const cx = process.env.GOOGLE_CSE_CX || settings.googleCx
      if (!cx)
        throw new Error('Google CSE 尚未配置搜索引擎 ID（CX），请前往「设置 → 联网搜索」填写')
      const params = new URLSearchParams({ key: apiKey, cx, q, num: String(Math.min(10, count)) })
      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, { signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS) })
      if (!response.ok)
        throw new Error(`Google CSE 接口返回 HTTP ${response.status}`)
      payload = await response.json()
      return { provider: 'Google CSE', results: (payload.items ?? []).map((r: any) => ({ title: String(r.title || ''), url: String(r.link || ''), snippet: String(r.snippet || '') })).filter((r: WebSearchResult) => r.url) }
    }
    case 'bing-rss': {
      const params = new URLSearchParams({ q, format: 'rss' })
      const response = await fetch(`https://www.bing.com/search?${params}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; doroHot/1.0; +https://dorohot.pi)' },
        signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
      })
      if (!response.ok)
        throw new Error(`Bing RSS 搜索返回 HTTP ${response.status}`)
      const xml = await response.text()
      const decode = (s: string) => s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .trim()
      const tag = (item: string, name: string) => decode(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '')
      const rows = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, count)
      return { provider: 'Bing RSS', results: rows.map(row => ({ title: tag(row[1], 'title'), url: tag(row[1], 'link'), snippet: tag(row[1], 'description') })).filter((r: WebSearchResult) => r.url) }
    }
  }
}

let settingsCache: { stamp: string, settings: AiSettings, sources: Record<keyof AiSettings, SettingSource> } | null = null

/**
 * @description: 解析 Headers 输入——支持 JSON 对象，也支持每行 `Key: Value`
 */
export function parseHeaders(input: string): Record<string, string> {
  const text = (input || '').trim()
  if (!text)
    return {}

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return toStringRecord(parsed)
    }
    catch {
      // JSON 不合法就退回按行解析
    }
  }

  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:#]+?)\s*[:=]\s*(.+?)\s*$/.exec(line)
    if (match)
      out[match[1]] = match[2]
  }
  return out
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined)
      out[key] = String(item)
  }
  return out
}

/** 取对象字段（Headers）：兼容对象与字符串两种写法 */
function pickObject(obj: Record<string, unknown>, keys: string[]): Record<string, string> {
  for (const key of keys) {
    const value = obj[key]
    if (value && typeof value === 'object' && !Array.isArray(value))
      return toStringRecord(value as Record<string, unknown>)
    if (typeof value === 'string' && value.trim())
      return parseHeaders(value)
  }
  return {}
}

/**
 * @description: 解析生效配置（六项）；按文件 mtime 缓存，改文件后无需重启
 */
export function resolveSettings(): { settings: AiSettings, sources: Record<keyof AiSettings, SettingSource> } {
  const cfgFile = effectiveConfigFile()
  const legacy = legacyKeyFile()
  const stamp = `${cfgFile}@${mtimeOf(cfgFile)}|${legacy}@${mtimeOf(legacy)}`
  if (settingsCache && settingsCache.stamp === stamp)
    return { settings: settingsCache.settings, sources: settingsCache.sources }

  const config = readConfig()
  const current = config.providers.find(p => p.name === config.active) || config.providers[0] || null

  // 「文件」这一级指的是**当前供应商**（env 仍可覆盖）
  const fileName = current?.name || ''
  const fileBaseUrl = current?.baseUrl || ''
  const fileHeaders = current?.headers || {}
  const fileApiType = current?.apiType || ''
  const fileApiKey = current?.apiKey || ''
  const fileModel = current?.model || ''
  const fileModelModes = current?.modelModes || []
  const legacyKey = readLegacyKey(legacy)

  const envName = process.env.AI_NAME || ''
  const envBaseUrl = process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || ''
  const envApiType = process.env.AI_API_TYPE || ''
  const envHeaders = parseHeaders(process.env.AI_HEADERS || '')
  const envApiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
  const envModel = process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || ''
  const envModelModes = process.env.AI_MODEL_MODE || process.env.AI_MODES || ''

  // Headers 取并集，环境变量优先
  const headers = { ...fileHeaders, ...envHeaders }
  const hasEnvHeaders = Object.keys(envHeaders).length > 0
  const hasFileHeaders = Object.keys(fileHeaders).length > 0

  const envApiTypeValid = isApiType(envApiType)
  const fileApiTypeValid = isApiType(fileApiType)

  const settings: AiSettings = {
    name: envName || fileName || AI_DEFAULTS.name,
    baseUrl: envBaseUrl || fileBaseUrl || AI_DEFAULTS.baseUrl,
    headers,
    apiType: envApiTypeValid ? envApiType : fileApiTypeValid ? fileApiType : DEFAULT_API_TYPE,
    apiKey: envApiKey || fileApiKey || legacyKey,
    model: envModel || fileModel || AI_DEFAULTS.model,
    modelModes: normalizeModes(envModelModes || fileModelModes),
  }

  const sources: Record<keyof AiSettings, SettingSource> = {
    name: envName ? 'env' : fileName ? 'file' : 'default',
    baseUrl: envBaseUrl ? 'env' : fileBaseUrl ? 'file' : 'default',
    headers: hasEnvHeaders ? 'env' : hasFileHeaders ? 'file' : 'default',
    apiType: envApiTypeValid ? 'env' : fileApiTypeValid ? 'file' : 'default',
    apiKey: envApiKey ? 'env' : fileApiKey ? 'file' : legacyKey ? 'legacy' : 'default',
    model: envModel ? 'env' : fileModel ? 'file' : 'default',
    modelModes: envModelModes ? 'env' : fileModelModes.length ? 'file' : 'default',
  }

  settingsCache = { stamp, settings, sources }
  return { settings, sources }
}

export function getSettings(): AiSettings {
  return resolveSettings().settings
}

/**
 * @description: 按 API 类型拼出完整端点
 *  - base 已包含目标路径时原样返回，避免出现 /v1/v1 之类的重复段
 */
export function apiEndpoint(baseUrl: string, apiType: ApiType = DEFAULT_API_TYPE): string {
  const base = ((baseUrl || '').trim() || AI_DEFAULTS.baseUrl).replace(/\/+$/, '')
  const path = (API_TYPES.find(t => t.value === apiType) || API_TYPES[0]).path

  if (base.toLowerCase().endsWith(path.toLowerCase()))
    return base
  // base 以 /v1 结尾而目标路径也以 /v1 开头 → 只补后半段
  if (path.startsWith('/v1/') && base.toLowerCase().endsWith('/v1'))
    return base + path.slice(3)

  return base + path
}

/** @description: Key 掩码（沿用项目 cookies 页「前 3 位 + 5 圆点」的约定） */
export function maskKey(key: string): string {
  return key ? `${key.slice(0, 3)}•••••` : ''
}

/** @description: 对外暴露的配置状态（**不含明文 Key**） */
export function getPublicSettings() {
  const { settings, sources } = resolveSettings()
  // 展示"实际读到配置的那个文件"：仍在用旧文件名时 UI 会提示保存一次即可迁移
  const cfgFile = effectiveConfigFile()
  const legacy = legacyKeyFile()
  const config = readConfig()
  return {
    /** 当前使用的供应商；providers 只含掩码与元信息，绝不下发明文 Key */
    active: config.active,
    providers: config.providers.map(p => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiType: p.apiType,
      model: p.model,
      modelModes: p.modelModes,
      hasApiKey: !!p.apiKey,
      apiKeyMasked: maskKey(p.apiKey),
      headerCount: Object.keys(p.headers).length,
    })),
    name: settings.name,
    baseUrl: settings.baseUrl,
    apiType: settings.apiType,
    headers: Object.keys(settings.headers).length ? JSON.stringify(settings.headers, null, 2) : '',
    headerCount: Object.keys(settings.headers).length,
    model: settings.model,
    /** 当前供应商选中的模式（多选） */
    modelModes: settings.modelModes,
    /** 可选的模式清单 */
    modelModeOptions: MODEL_MODES,
    endpoint: apiEndpoint(settings.baseUrl, settings.apiType),
    apiTypes: API_TYPES,
    apiKeyMasked: maskKey(settings.apiKey),
    hasApiKey: !!settings.apiKey,
    configured: !!settings.apiKey, // 兼容旧字段名
    sources,
    defaults: AI_DEFAULTS,
    configFile: cfgFile,
    configFileExists: existsSync(cfgFile),
    /** 写入目标（永远是新的文件名） */
    configFileTarget: configFile(),
    /** 仍在读旧文件名 `ai-config.json`（保存一次即迁移到新名） */
    usingLegacyConfigFile: cfgFile !== configFile(),
    legacyKeyFile: legacy,
    legacyKeyExists: existsSync(legacy),
    /** 被环境变量锁定的项：UI 上应提示「以环境变量为准」 */
    envLocked: {
      name: !!process.env.AI_NAME,
      baseUrl: !!(process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL),
      headers: !!process.env.AI_HEADERS,
      apiType: !!process.env.AI_API_TYPE,
      apiKey: !!(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY),
      model: !!(process.env.AI_MODEL || process.env.DEEPSEEK_MODEL),
      modelModes: !!(process.env.AI_MODEL_MODE || process.env.AI_MODES),
    },
      cacheDir: CACHE_DIR,
      cacheTtlDays: Math.round(CACHE_TTL / 86400000),
    webSearch: getPublicWebSearchSettings(),
      /** 抓正文鉴权：哪些站点会带哪份凭据（只报 host 与条数，不含凭据值） */
      siteAuth: authDiagnostics(),
    }
  }

/** 保存入参：API 类型与 Headers 允许传字符串（来自表单） */
export interface SettingsPatch {
  name?: string
  baseUrl?: string
  headers?: string | Record<string, string>
  apiType?: string
  apiKey?: string
  model?: string
  /** 多选模式：数组或逗号分隔字符串 */
  modelModes?: string[] | string
}

/**
 * @description: 保存配置（只写传入字段；apiKey 为空或原样回传掩码时保留旧值）
 */
/**
 * @description: 保存一份供应商（按名字 upsert）并把它设为当前使用
 *  - apiKey 为空、或原样回传掩码时，保留该供应商已存的 Key
 */
export function saveProvider(patch: SettingsPatch): AiSettings {
  const config = readConfig()
  const name = (patch.name ?? '').trim() || AI_DEFAULTS.name
  const existing = config.providers.find(p => p.name === name)

  const submitted = (patch.apiKey ?? '').trim()
  // 前端回显的是掩码，原样回传视为「不修改」
  const keepKey = !submitted || /^.{1,4}•+$/.test(submitted) || submitted === maskKey(existing?.apiKey ?? '')

  const rawApiType = (patch.apiType ?? '').trim()
  const headers = patch.headers === undefined
    ? (existing?.headers ?? {})
    : (typeof patch.headers === 'string' ? parseHeaders(patch.headers) : patch.headers)

  const next: AiSettings = {
    name,
    baseUrl: (patch.baseUrl ?? existing?.baseUrl ?? '').trim(),
    headers,
    apiType: isApiType(rawApiType) ? rawApiType : (existing?.apiType ?? DEFAULT_API_TYPE),
    apiKey: keepKey ? (existing?.apiKey ?? '') : submitted,
    model: (patch.model ?? existing?.model ?? '').trim(),
    modelModes: patch.modelModes === undefined ? (existing?.modelModes ?? [DEFAULT_MODEL_MODE]) : normalizeModes(patch.modelModes),
  }

  const providers = existing
    ? config.providers.map(p => (p.name === name ? next : p))
    : [...config.providers, next]

  writeConfig({ ...config, active: name, providers })
  return next
}


// ---------------------------------------------------------------------------
// 模型调用
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 说明：maxTokens 是输出上限（按实际生成计费，调高不额外花钱），
 * 给得偏宽是为了兼容推理模型——它们会先消耗大量 token 在 reasoning 上，
 * 上限太小会导致 output 里只有思考过程、没有正文。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  system?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

/** @description: 按 API 类型生成鉴权头（对话与列模型共用）；自定义 Headers 最后合并，可覆盖 */
function baseHeaders(settings: AiSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (settings.apiType === 'anthropic-messages') {
    headers['x-api-key'] = settings.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  else {
    headers.Authorization = `Bearer ${settings.apiKey}`
  }

  return { ...headers, ...settings.headers }
}

/**
 * @description: 按 API 类型构造请求（端点 / 鉴权头 / 请求体三者都不同）
 *  - Chat Completions：Bearer 鉴权，system 放在 messages 里
 *  - Anthropic Messages：x-api-key 鉴权，system 是顶层参数，max_tokens 必填
 *  - Responses：Bearer 鉴权，system 走 instructions，输入走 input，上限字段是 max_output_tokens
 */
function buildRequest(
  settings: AiSettings,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  stream = false,
  includeUsage = false,
): { url: string, headers: Record<string, string>, body: Record<string, unknown> } {
  const url = apiEndpoint(settings.baseUrl, settings.apiType)
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const conversation = messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))
  let body: Record<string, unknown>

  if (settings.apiType === 'anthropic-messages') {
    body = {
      model: settings.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: conversation,
      temperature,
      ...(stream ? { stream: true } : {}),
    }
  }
  else if (settings.apiType === 'responses') {
    // Responses 的 input 支持字符串；多轮对话压成带角色的文本，避免不同网关对 messages 数组支持不一致
    body = {
      model: settings.model,
      input: conversation.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n\n'),
      ...(system ? { instructions: system } : {}),
      max_output_tokens: maxTokens,
      temperature,
      ...(stream ? { stream: true } : {}),
    }
  }
  else {
    body = {
      model: settings.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...conversation,
      ],
      temperature,
      max_tokens: maxTokens,
      stream,
      // 让流式最后一个 chunk 带 usage；部分网关不支持该字段，会在流式入口自动退回一次
      ...(stream && includeUsage ? { stream_options: { include_usage: true } } : {}),
    }
  }

  return { url, headers: baseHeaders(settings), body }
}

/** @description: 按 API 类型从响应里取出正文（失败返回空串，由调用方判定） */
export function extractText(apiType: ApiType, json: unknown): string {
  if (!json || typeof json !== 'object')
    return ''
  const payload = json as Record<string, any>

  if (apiType === 'anthropic-messages') {
    // { content: [{ type: 'text', text }] }
    if (Array.isArray(payload.content)) {
      return payload.content
        .filter((block: any) => block && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('')
        .trim()
    }
    return ''
  }

  if (apiType === 'responses') {
    // 只认 message 项里的正文。
    // 推理模型（如实测的 deepseek-flash）会先输出 reasoning/reasoning_text 项，
    // 若 max_output_tokens 被推理耗尽，则整份 output 里**只有 reasoning、没有 message**——
    // 这种情况下必须返回空串让上层报错，绝不能回退去读 reasoning（那会把思考过程当正文）。
    const messages = (Array.isArray(payload.output) ? payload.output : [])
      .filter((item: any) => item && item.type === 'message')

    const outputText = messages
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .filter((part: any) => part && typeof part.text === 'string' && (part.type === undefined || part.type === 'output_text'))
      .map((part: any) => part.text)
      .join('')
      .trim()

    if (outputText)
      return outputText

    // 部分网关直接给 output_text 便利字段
    if (typeof payload.output_text === 'string' && payload.output_text.trim())
      return payload.output_text.trim()

    return ''
  }

  // chat/completions
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string')
    return content.trim()
  // 少数实现把正文放在 parts 数组里
  if (Array.isArray(content))
    return content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('').trim()
  return ''
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 推理模型单独统计的思考 token（Responses 协议才有） */
  reasoningTokens?: number
}

export interface ChatResult {
  text: string
  usage: ChatUsage
}

/** @description: 按 API 类型取出用量（三种协议字段名不同），取不到就返回 0 */
export function extractUsage(apiType: ApiType, json: unknown): ChatUsage {
  const u = (json && typeof json === 'object' ? (json as Record<string, any>).usage : null) || {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

  // Anthropic 用 input_tokens / output_tokens；OpenAI 系用 prompt_tokens / completion_tokens
  const promptTokens = num(u.prompt_tokens) || num(u.input_tokens)
  const completionTokens = num(u.completion_tokens) || num(u.output_tokens)
  const totalTokens = num(u.total_tokens) || promptTokens + completionTokens
  const reasoningTokens = num(u.output_tokens_details?.reasoning_tokens) || num(u.completion_tokens_details?.reasoning_tokens)

  return reasoningTokens
    ? { promptTokens, completionTokens, totalTokens, reasoningTokens }
    : { promptTokens, completionTokens, totalTokens }
}

/**
 * @description: 底层多轮请求（失败重试一次；超时用 AbortSignal），返回正文与用量
 */
async function requestChat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const { settings } = resolveSettings()
  if (!settings.apiKey)
    throw new Error('未配置 API Key，请到「模型设置」页填写')
  if (!settings.model)
    throw new Error('未配置对话模型，请在「模型设置」里点「读取模型」选择后保存')

  const { temperature = 0.3, maxTokens = 4000, timeoutMs = 90_000 } = opts
  const request = buildRequest(settings, messages, temperature, maxTokens)

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`模型接口 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
      }

      const payload = await response.json()
      const text = extractText(settings.apiType, payload)
      if (text)
        return { text, usage: extractUsage(settings.apiType, payload) }

      // 推理模型常把 max_output_tokens 先花在 reasoning 上，导致没有正文
      if (payload && typeof payload === 'object' && (payload as Record<string, any>).status === 'incomplete')
        throw new Error('模型输出被 max_output_tokens 截断（推理模型会先消耗大量 token）。建议换用非推理模型，或改用 Chat Completions 类型')
      throw new Error('模型返回了空内容')
    }
    catch (error) {
      lastError = error
      if (attempt === 0)
        await sleep(1200)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** @description: 单轮对话内部使用：把 system + user 拼成消息数组 */
async function chat(prompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
  return requestChat([
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    { role: 'user' as const, content: prompt },
  ], opts)
}

/** @description: 多轮会话调用（前端 Chat 模式使用） */
export async function chatConversation(
  messages: Array<{ role: 'user' | 'assistant', content: string }>,
  opts: ChatOptions = {},
): Promise<ChatResult> {
  return requestChat([
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ], opts)
}

export interface ChatStreamChunk {
  /** 本段新增正文（增量） */
  delta?: string
  /** 累计用量（部分网关只在流结束时才给） */
  usage?: ChatUsage
  done?: boolean
}

function numOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** @description: 合并流式过程中分段到达的 usage（Anthropic 会分 message_start / message_delta 两段给） */
function mergeStreamUsage(current: ChatUsage | undefined, apiType: ApiType, payload: any): ChatUsage | undefined {
  const raw = apiType === 'responses'
    ? (payload?.response?.usage ?? payload?.usage)
    : (payload?.usage ?? payload?.message?.usage)
  if (!raw || typeof raw !== 'object')
    return current

  const base: ChatUsage = current ? { ...current } : { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const prompt = numOr0(raw.prompt_tokens) || numOr0(raw.input_tokens)
  const completion = numOr0(raw.completion_tokens) || numOr0(raw.output_tokens)
  const total = numOr0(raw.total_tokens)
  const reasoning = numOr0(raw.output_tokens_details?.reasoning_tokens) || numOr0(raw.completion_tokens_details?.reasoning_tokens)
  if (prompt)
    base.promptTokens = prompt
  if (completion)
    base.completionTokens = completion
  if (total)
    base.totalTokens = total
  if (reasoning)
    base.reasoningTokens = reasoning
  if (!base.totalTokens)
    base.totalTokens = base.promptTokens + base.completionTokens
  return base.totalTokens || base.promptTokens || base.completionTokens ? base : current
}

/** @description: 按 API 类型从单个流式事件里取增量正文 / 结束标记 */
function extractStreamPiece(apiType: ApiType, payload: any): { text?: string, done?: boolean } {
  if (!payload || typeof payload !== 'object')
    return {}

  if (apiType === 'anthropic-messages') {
    if (payload.type === 'content_block_delta' && typeof payload.delta?.text === 'string')
      return { text: payload.delta.text }
    if (payload.type === 'message_stop')
      return { done: true }
    if (payload.type === 'error')
      throw new Error(payload.error?.message || '模型流式返回错误')
    return {}
  }

  if (apiType === 'responses') {
    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string')
      return { text: payload.delta }
    if (payload.type === 'response.completed')
      return { done: true }
    if (payload.type === 'response.failed' || payload.type === 'error')
      throw new Error(payload.response?.error?.message || payload.error?.message || payload.message || '模型流式返回失败')
    return {}
  }

  // chat/completions
  const delta = payload.choices?.[0]?.delta?.content
  if (typeof delta === 'string')
    return { text: delta }
  if (Array.isArray(delta)) {
    const text = delta.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
    if (text)
      return { text }
  }
  return {}
}

/** @description: 把 SSE 文本缓冲区切分为完整的事件 data 负载数组 */
function splitSsePayloads(buffer: string): { payloads: string[], rest: string } {
  const payloads: string[] = []
  let rest = buffer
  let index: number
  while ((index = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (data)
      payloads.push(data)
  }
  return { payloads, rest }
}

/**
 * @description: 多轮流式调用。逐块 yield 正文增量，结束时给 done 与累计 usage。
 *  - chat/completions、anthropic-messages、responses 三种协议的 SSE 都支持；
 *  - 若网关忽略 stream 返回整段 JSON，则退化为一次性输出；
 *  - includeUsage 被网关拒绝（400）且尚未产出正文时，自动退回不带该字段重试一次。
 */
export async function* streamChatConversation(
  messages: Array<{ role: 'user' | 'assistant', content: string }>,
  opts: ChatOptions = {},
): AsyncGenerator<ChatStreamChunk> {
  const { settings } = resolveSettings()
  if (!settings.apiKey)
    throw new Error('未配置 API Key，请到「模型设置」页填写')
  if (!settings.model)
    throw new Error('未配置对话模型，请在「模型设置」里点「读取模型」选择后保存')

  const { temperature = 0.3, maxTokens = 4000, timeoutMs = 90_000 } = opts
  const allMessages: ChatMessage[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    let emitted = false
    try {
      const request = buildRequest(settings, allMessages, temperature, maxTokens, true, attempt === 0)
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`模型接口 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
      }

      const contentType = response.headers.get('content-type') || ''
      // 网关忽略 stream：退化为整段 JSON
      if (!response.body || !contentType.includes('event-stream')) {
        const payload = await response.json()
        const text = extractText(settings.apiType, payload)
        if (!text)
          throw new Error('模型返回了空内容')
        emitted = true
        yield { delta: text, usage: extractUsage(settings.apiType, payload) }
        yield { done: true }
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usage: ChatUsage | undefined
      let done = false

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone)
          break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        const { payloads, rest } = splitSsePayloads(buffer)
        buffer = rest
        for (const raw of payloads) {
          if (raw === '[DONE]') {
            done = true
            break
          }
          let payload: any
          try {
            payload = JSON.parse(raw)
          }
          catch {
            continue
          }
          usage = mergeStreamUsage(usage, settings.apiType, payload) ?? usage
          const piece = extractStreamPiece(settings.apiType, payload)
          if (piece.text) {
            emitted = true
            yield { delta: piece.text }
          }
          if (piece.done) {
            done = true
            break
          }
        }
      }

      if (usage)
        yield { usage }
      yield { done: true }
      return
    }
    catch (error) {
      lastError = error
      // 只有「一段正文都没产出」时才重试：常见于网关不支持 stream_options
      if (!emitted && attempt === 0) {
        await sleep(600)
        continue
      }
      // 流式始终失败且一个字都没产出：部分网关/网络对流式支持不好（典型表现就是 undici 抛 "fetch failed"）。
      // 退回一次性（非流式）调用，把整段正文当成一个 delta 发出去，保证对话仍能拿到回复。
      if (!emitted) {
        try {
          const fallback = await chatConversation(messages, opts)
          if (fallback.text) {
            yield { delta: fallback.text }
            if (fallback.usage)
              yield { usage: fallback.usage }
            yield { done: true }
            return
          }
        }
        catch (fallbackError) {
          lastError = fallbackError
        }
      }
      throw (lastError instanceof Error ? lastError : new Error(String(lastError)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** @description: 用当前配置做一次最小调用，验证 Base URL / Key / 模型 / API 类型是否可用 */
export async function testConnection() {
  const { settings } = resolveSettings()
  const started = Date.now()
  const { text: reply, usage } = await chat('请只回复两个字：正常', { temperature: 0, maxTokens: 800, timeoutMs: 30_000 })
  return {
    ok: true,
    reply,
    name: settings.name,
    model: settings.model,
    apiType: settings.apiType,
    endpoint: apiEndpoint(settings.baseUrl, settings.apiType),
    elapsedMs: Date.now() - started,
    usage,
  }
}

// ---------------------------------------------------------------------------
// 拉取可用模型列表
// ---------------------------------------------------------------------------

/** 拉取模型时的可选覆盖：来自设置页表单，未填的项沿用已保存配置 */
export interface ModelListOverride {
  baseUrl?: string
  apiType?: string
  headers?: string | Record<string, string>
  apiKey?: string
}

/** 用表单值覆盖已保存配置（apiKey 为空、或仍是掩码时保留原值） */
function withOverrides(patch: ModelListOverride): AiSettings {
  const { settings } = resolveSettings()
  const submitted = (patch.apiKey ?? '').trim()
  const keepKey = !submitted || /^.{1,4}•+$/.test(submitted)

  return {
    ...settings,
    baseUrl: (patch.baseUrl ?? '').trim() || settings.baseUrl,
    apiType: isApiType(patch.apiType) ? patch.apiType : settings.apiType,
    headers: patch.headers === undefined
      ? settings.headers
      : (typeof patch.headers === 'string' ? parseHeaders(patch.headers) : patch.headers),
    apiKey: keepKey ? settings.apiKey : submitted,
  }
}

/**
 * @description: 列模型的候选端点
 *  - 各家路径不统一：DeepSeek 用 `/models`，OpenAI 必须 `/v1/models`，Anthropic 是 `/v1/models`
 *    → 按顺序尝试，取第一个能返回模型列表的（三种 API 类型的候选是同一组）
 */
export function modelsEndpointCandidates(baseUrl: string): string[] {
  const base = ((baseUrl || '').trim() || AI_DEFAULTS.baseUrl).replace(/\/+$/, '')
  const out: string[] = []
  const push = (url: string) => {
    if (!out.includes(url))
      out.push(url)
  }

  if (/\/v\d+$/i.test(base)) {
    push(`${base}/models`)
  }
  else {
    push(`${base}/models`)
    push(`${base}/v1/models`)
  }

  return out
}

/** @description: 从各种返回结构里取出模型 ID（OpenAI / Anthropic / 各类网关） */
export function extractModelIds(json: unknown): string[] {
  if (!json)
    return []
  const payload = json as Record<string, any>
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : []

  const ids = list.map((item: any) => {
    if (typeof item === 'string')
      return item.trim()
    if (item && typeof item === 'object') {
      const value = item.id ?? item.name ?? item.model ?? item.slug
      return typeof value === 'string' ? value.trim() : ''
    }
    return ''
  }).filter(Boolean)

  return [...new Set(ids)].sort()
}

/**
 * @description: 拉取当前 API Key 可用的模型列表
 *  - 用表单里**尚未保存**的值优先，方便填完 Key 就点一下看看有哪些模型
 */
export async function listModels(patch: ModelListOverride = {}) {
  const settings = withOverrides(patch)
  if (!settings.apiKey)
    throw new Error('未配置 API Key，请先填写')

  const candidates = modelsEndpointCandidates(settings.baseUrl)
  const tried: string[] = []

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: baseHeaders(settings),
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        tried.push(`${url} → HTTP ${response.status}`)
        continue
      }

      const models = extractModelIds(await response.json())
      if (models.length)
        return { models, endpoint: url, tried: [...tried, `${url} → 200`] }

      tried.push(`${url} → 200 但未解析出模型`)
    }
    catch (error) {
      tried.push(`${url} → ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`未能获取模型列表。已尝试：${tried.join('；')}`)
}

// ---------------------------------------------------------------------------
// 磁盘缓存（键 = 内容哈希，避免同一内容重复计费）
// ---------------------------------------------------------------------------

function cacheFile(key: string): string {
  return join(CACHE_DIR, `${createHash('sha1').update(key).digest('hex')}.json`)
}

/**
 * 把「哪套配置产出的」并进缓存键。
 * 否则换了模型/端点后仍会命中旧模型的结果（最长 CACHE_TTL），
 * 看起来就像新模型输出与旧模型完全一致。
 */
function providerTag(): string {
  const { settings } = resolveSettings()
  return `${settings.apiType}|${settings.baseUrl}|${settings.model}`
}

async function cached<T>(key: string, produce: () => Promise<T>, ttl = CACHE_TTL): Promise<{ value: T, cached: boolean }> {
  const file = cacheFile(`${providerTag()}|${key}`)
  try {
    if (Date.now() - statSync(file).mtimeMs < ttl) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && parsed.value !== undefined)
        return { value: parsed.value as T, cached: true }
    }
  }
  catch {
    // 缓存缺失/损坏 → 重新生成
  }

  const value = await produce()

  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ ts: Date.now(), value }), 'utf8')
    renameSync(tmp, file) // 原子写，避免半截文件
  }
  catch {
    // 落盘失败不影响本次返回
  }

  return { value, cached: false }
}

/** @description: 简单并发池，避免一次打满上游 */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// 数据源聚合（自请求本机 REST 接口）
// ---------------------------------------------------------------------------

export interface AiSourceItem {
  title: string
  url?: string
  desc?: string
  /** 榜单热度（部分源提供，如微博的 num） */
  hot?: number | string
  source?: string
}

/** alias → 中文名（取自 HOT_ITEMS 枚举；未知 alias 原样返回） */
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  HOT_ITEMS.items.map(i => [String(i.value), i.raw.label]),
)

export function sourceLabel(alias: string): string {
  return SOURCE_LABELS[alias] || alias
}

/**
 * 服务端榜单缓存：与首页卡片客户端缓存同为 10 分钟 TTL。
 * 让「同一轮里多次聚合」以及短时间内的重复问题复用同一份数据，避免每次回源上游。
 */
const SOURCE_CACHE_TTL_MS = 10 * 60 * 1000
const sourceCache = new Map<string, { items: AiSourceItem[], at: number }>()

/** @description: 取单个数据源（复用自身 REST 接口；命中 10 分钟缓存则直接返回，失败时回退到过期缓存） */
export async function fetchSource(alias: string, timeoutMs = 10_000): Promise<AiSourceItem[]> {
  const hit = sourceCache.get(alias)
  if (hit && Date.now() - hit.at < SOURCE_CACHE_TTL_MS)
    return hit.items

  try {
    const response = await fetch(`${SELF_BASE}/api/${alias}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!response.ok)
      return hit?.items ?? []
    const json = await response.json()
    if (!Array.isArray(json?.data))
      return hit?.items ?? []
    const items = json.data
      .filter((it: any) => it && typeof it.title === 'string' && it.title.trim())
      .map((it: any) => ({ title: String(it.title).trim(), url: it.url, desc: it.desc, hot: it.hot }))
    if (items.length)
      sourceCache.set(alias, { items, at: Date.now() })
    return items.length ? items : (hit?.items ?? [])
  }
  catch {
    // 上游失败时用过期缓存兜底，总比没有数据好
    return hit?.items ?? []
  }
}

/** @description: 并发聚合多个数据源 */
export async function collectSources(
  aliases: string[],
  { concurrency = 8, perSource = 8 }: { concurrency?: number, perSource?: number } = {},
): Promise<{ label: string, alias: string, items: AiSourceItem[] }[]> {
  return pool(aliases, concurrency, async (alias) => {
    const label = sourceLabel(alias)
    const items = (await fetchSource(alias)).slice(0, perSource).map(it => ({ ...it, source: label }))
    return { label, alias, items }
  })
}

/**
 * @description: 从用户问题里识别「想看的榜单来源」。
 *  - 命中具体来源名（如「微博热搜」「知乎热榜」）→ 返回对应 alias；
 *  - 只泛泛提到「热搜/热榜/榜单/热点」→ 返回一组头部来源；
 *  - 没有相关意图 → 返回空数组。
 * 用于把站内**实时抓取**的榜单数据注入对话，避免模型只拿到无关的联网搜索结果。
 */
export function detectHotSources(text: string): string[] {
  const raw = (text || '').trim()
  if (!raw)
    return []
  const lower = raw.toLowerCase()
  const found: string[] = []
  for (const item of HOT_ITEMS.items) {
    const value = String(item.value)
    const label = String(item.raw.label)
    // 短的英文 alias（qq/lol/xhh…）容易误命中，只认长度 >= 4 的；中文名一律按 label 匹配
    if (raw.includes(label) || (value.length >= 4 && lower.includes(value.toLowerCase())))
      found.push(value)
  }
  if (found.length)
    return [...new Set(found)]
  if (/(热搜|热榜|榜单|热点|热门|排行)/.test(raw))
    return ['weibo', 'zhihu', 'baidu', 'toutiao']
  return []
}

// ---------------------------------------------------------------------------
// 三项 AI 能力
// ---------------------------------------------------------------------------

/**
 * 四项能力共用的写作纪律。针对「输出只是把标题重新排版一遍」的问题，核心是两条：
 *  1. 每条都必须给出标题之外的增量信息（背景/因果/影响/后续/不同立场）
 *  2. 允许补充背景知识，但必须与给定内容显式区分，且不得编造具体数字、日期、人名
 */
const WRITING_RULES = [
  '写作纪律（务必遵守）：',
  '1. 禁止只复述或改写标题——每一条都要给出标题之外的增量信息：背景、因果、影响、后续或不同立场。',
  '2. 严格区分两类信息：来自给定【标题/正文】的，与你自己补充的【背景知识】。后者必须标注「背景补充：」，且只写常识性、有把握的内容。',
  '3. 不得编造具体数字、日期、人名、机构、引语；不确定就写「不确定」或「标题未说明」。',
  '4. 中文输出，用 Markdown；不要寒暄、不要复述本段要求、不要写与结构无关的开场白。',
].join('\n')

const SUMMARY_SYSTEM = '你是资深编辑，擅长用两句话让读者判断一条资讯值不值得点开。'

/** 摘要专用规则：它是表格里的一行速读，不能像多条目分析那样要求标注「背景补充：」，否则会写不完 */
const SUMMARY_RULES = [
  '要求：',
  '1. 不要照抄或改写标题——第 2 句必须给出标题里没有的增量（影响、争议、前提或背景）。',
  '2. 背景知识可以写，但直接融进句子里即可，不要加「背景补充：」这类标签。',
  '3. 不得编造具体数字、日期、人名、机构；不确定就写「不确定」。',
  '4. 严格控制在两句以内，不要小标题、不要换行、不要任何前缀。',
].join('\n')

/** @description: 逐条摘要 */
export async function summarizeItems(
  items: AiSourceItem[],
  { concurrency = 4 }: { concurrency?: number } = {},
): Promise<{ rows: { title: string, url?: string, source?: string, summary: string, cached: boolean, error?: string }[], usage: ChatUsage }> {
  const results = await pool(items, concurrency, async (item) => {
    const prompt = [
      '为下面这条热榜内容写一段中文速读，**恰好两句**、合计 60-140 字：',
      '第 1 句——说清发生了什么（点出主体与事件，不要照抄标题用词）；',
      '第 2 句——给看点：为什么值得点开、可能的影响或争议点、或需要留意的前提。',
      '',
      `【来源】${item.source || '未知'}`,
      `【标题】${item.title}`,
      `【补充】${item.desc?.trim() || '无'}`,
      '',
      SUMMARY_RULES,
    ].join('\n')

    try {
      const { value, cached: fromCache } = await cached(`summary:v3:${item.source || ''}:${item.title}`, () =>
        chat(prompt, { system: SUMMARY_SYSTEM, temperature: 0.3, maxTokens: 6000 }))
      return {
        title: item.title,
        url: item.url,
        source: item.source,
        summary: value.text,
        cached: fromCache,
        usage: value.usage,
      }
    }
    catch (error) {
      return {
        title: item.title,
        url: item.url,
        source: item.source,
        summary: '',
        cached: false,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // 逐条调用的用量累加；失败条目不计
  const usage = results.reduce<ChatUsage>((acc, r) => {
    const u = r.usage
    if (!u)
      return acc
    return {
      promptTokens: acc.promptTokens + u.promptTokens,
      completionTokens: acc.completionTokens + u.completionTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
      ...(acc.reasoningTokens || u.reasoningTokens
        ? { reasoningTokens: (acc.reasoningTokens || 0) + (u.reasoningTokens || 0) }
        : {}),
    }
  }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 })


  return {
    rows: results.map(({ usage: _drop, ...rest }) => rest),
    usage,
  }
}

const BRIEFING_SYSTEM = '你是资讯主编，负责把多平台热榜整理成一份有信息增量的当日简报：既要提炼焦点，也要给出标题之外的背景、关联与走向。'

/** @description: 跨源每日简报 */
export async function buildBriefing(
  sources: { label: string, items: AiSourceItem[] }[],
  { maxTokens = 14000 }: { maxTokens?: number } = {},
): Promise<{ text: string, cached: boolean, usedSources: number, usedItems: number, usage: ChatUsage }> {
  const usable = sources.filter(s => s.items.length)
  const usedItems = usable.reduce((n, s) => n + s.items.length, 0)
  const body = usable
    .map(s => `## ${s.label}\n${s.items.map(it => `- ${it.title}`).join('\n')}`)
    .join('\n\n')

  // 缓存键只取内容本身，标题变动会自然失效
  const { value, cached: fromCache } = await cached(`briefing:v3:${body}`, () =>
    chat(
      [
        '下面是各平台热榜的标题集合。请生成一份当日中文简报，用 Markdown 输出，按以下结构展开：',
        '',
        '### 今日焦点',
        '3-5 条。每条写成：**【事件】一句话说清发生了什么** → **为何重要**：一句标题之外的判断（影响面、争议点或后续走向），末尾用括号标注来源（如「微博/知乎」）。',
        '',
        '### 跨源共振与差异',
        '- 哪些话题在多个来源同时出现（说明是真正的大事）',
        '- 同一事件在不同来源的标题侧重有何差异，能看出什么',
        '若没有跨源话题就写「本期无明显跨源共振」。',
        '',
        '### 分领域动态',
        '按 科技/AI、财经、社会民生、游戏娱乐、国际 等归类（只写实际有内容的类别），每类 2-4 条。每条除了事项本身，再补一句背景或影响。',
        '',
        '### 趋势与脉络',
        '2-4 条更大的趋势：这批热榜整体反映了什么变化？哪些是相对以往的新动向？标注是你的判断。',
        '',
        '### 值得留意',
        '指出信息量不足、疑似营销/抽奖/灌水、或标题可能夸张误导的条目；没有则写「未发现明显噪声」。',
        '',
        '### 一句话总结',
        '用一句话概括今天热榜的整体气质。',
        '',
        WRITING_RULES,
        '',
        body,
      ].join('\n'),
      { system: BRIEFING_SYSTEM, temperature: 0.6, maxTokens, timeoutMs: 180_000 },
    ))

  return { text: value.text, cached: fromCache, usedSources: usable.length, usedItems, usage: value.usage }
}

/** @description: 趋势/主题分析 */
export async function analyze(
  items: AiSourceItem[],
  { label, focus, maxTokens = 12000 }: { label: string, focus?: string, maxTokens?: number },
): Promise<{ text: string, cached: boolean, usedItems: number, usage: ChatUsage }> {
  const body = items.map(it => `- ${it.title}`).join('\n')
  const prompt = [
    `以下是「${label}」当前的热榜条目。请做一份有信息增量的中文分析，用 Markdown 输出，按以下结构展开：`,
    '',
    '### 主题分布',
    '归纳热度集中在哪几个话题簇，定性给出大致比重（不要编造精确比例），并点明每个簇的代表条目。',
    '',
    '### 热度结构',
    '- 热度是集中在少数话题，还是分散在长尾？',
    '- 哪些条目更像短期噪音（一次性、情绪化），哪些有持续发酵的潜力？给出理由。',
    '',
    '### 单条深读',
    '挑出信息量最大的 3 条，每条写：**它是什么**（一句）→ **为什么值得点开**（一句）→ **可能的背景或前因**（标注「背景补充：」）。',
    '',
    '### 趋势与脉络',
    '2-4 条这批条目共同反映的更大趋势或变化，并标注这是你的判断。',
    '',
    '### 噪声与重复',
    '指出疑似广告、抽奖、灌水或互相重复的条目；没有则写「未发现明显噪声」。',
    '',
    '### 只点三条的话',
    '如果读者只有时间点开三条，应该是哪三条？各用半句话说明理由。',
    focus ? `\n### 特别关注\n额外围绕「${focus}」展开分析。` : '',
    '',
    WRITING_RULES,
    '',
    body,
  ].filter(Boolean).join('\n')

  const { value, cached: fromCache } = await cached(`analyze:v3:${label}:${focus || ''}:${body}`, () =>
    chat(prompt, { system: BRIEFING_SYSTEM, temperature: 0.5, maxTokens, timeoutMs: 180_000 }))

  return { text: value.text, cached: fromCache, usedItems: items.length, usage: value.usage }
}

// ---------------------------------------------------------------------------
// 单条解析（标题 + 链接）
// ---------------------------------------------------------------------------

/** 拒绝内网/回环/链路本地地址：本接口会由服务端发起请求，须防 SSRF */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return false

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (host.includes(':'))
      return false // IPv6 直接拒绝，绕过规则太多
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
      return false

    const parts = host.split('.')
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      const [a, b] = parts.map(Number)
      if (a === 0 || a === 10 || a === 127 || a >= 224)
        return false
      if (a === 169 && b === 254)
        return false
      if (a === 172 && b >= 16 && b <= 31)
        return false
      if (a === 192 && b === 168)
        return false
    }
    return true
  }
  catch {
    return false
  }
}

/** 正文提取时先移除的非内容容器 */
const STRIP_SELECTORS = 'script,style,noscript,iframe,svg,header,footer,nav,aside,form,button,figure'
const CHARSET_RE = /charset\s*=\s*["']?([\w-]+)/i
const MAX_CONTENT = 6000

/** 跟跳上限（短链一般 1-2 跳；超过就是异常或循环） */
const MAX_REDIRECTS = 5

/**
 * 抓取失败的**类型**：调用方据此给出可操作的提示，而不是一句「抓取失败」。
 *  - `need-login`：站点需要登录态，且我们**有**这个源的凭据（多半是 cookie 过期）
 *  - `blocked`   ：站点拒绝访问，而我们**没有**对应凭据（纯匿名被拦）
 *  - `no-content`：拿到了 200，但正文抽不出来（JS 渲染 / 空页）
 *  - `network`   ：超时、DNS、5xx 等
 *  - `redirect`  ：跳转异常（缺 Location / 次数过多 / 跳到非公开地址）
 */
export type FetchFailureKind = 'need-login' | 'blocked' | 'no-content' | 'network' | 'redirect'

export class FetchError extends Error {
  kind: FetchFailureKind
  status?: number
  sourceId?: string | null
  label?: string

  constructor(kind: FetchFailureKind, message: string, opts: { status?: number, sourceId?: string | null, label?: string } = {}) {
    super(message)
    this.name = 'FetchError'
    this.kind = kind
    this.status = opts.status
    this.sourceId = opts.sourceId ?? null
    this.label = opts.label
  }
}

/** @description: 把抓取失败翻译成给用户看的一句话（含下一步动作） */
export function describeFetchFailure(error: unknown): string {
  if (!(error instanceof FetchError))
    return `正文抓取失败（${error instanceof Error ? error.message : String(error)}），以下结论仅依据标题`

  switch (error.kind) {
    case 'need-login':
      return `${error.message}；可到 /cookies 页点「检测登录态」确认，或直接把正文粘贴到下面`
    case 'blocked':
      return `${error.message}；可在 /cookies 页为该站点加凭据，或改为手动粘贴正文`
    case 'no-content':
      return error.message
    default:
      return `${error.message}，以下结论仅依据标题`
  }
}

export interface FetchPageResult {
  text: string
  title: string
  /** 实际取到正文那一跳所用的凭据源（匿名抓取为 null） */
  authSourceId: string | null
  authLabel: string
  /** 最终落地地址（经过跳转后） */
  finalUrl: string
  /** 跟跳次数（0 表示没跳） */
  redirects: number
}

/**
 * @description: 尽力抓取页面正文（失败即抛 FetchError，由调用方降级）
 *  - 许多中文站点是 GBK，按 content-type / meta 声明解码（NGA 就是 GBK）
 *  - 只取前 MAX_CONTENT 字，避免把整页塞进上下文
 *  - **逐跳鉴权**：手动跟跳而不是 `redirect:'follow'`，因为（实测）undici 会在跨源跳转时
 *    剥掉手写的 Cookie 头——子域跳转（bbs.nga.cn→ngabbs.com）与短链（t.cn→weibo.com）
 *    都会因此丢掉登录态。自己跟跳才能「每一跳按该跳的 host 重新决定带哪份凭据」。
 *  - **逐跳 SSRF 复核**：手动跟跳后必须每跳都过一遍 isPublicHttpUrl，
 *    否则一个公开地址可以 302 到内网地址把我们当跳板（原 `redirect:'follow'` 也有这个问题）。
 */
/**
 * @description: 小黑盒帖子正文走官方签名接口（SPA 页面直接抓 HTML 只有空壳）。
 *  - 匿名可用、不需要 cookie；失败抛 FetchError，由调用方降级为「仅按标题分析」
 *  - 正文优先 link.text（JSON 块数组），纯图片帖 text 为空时退回 description
 */
async function fetchXhhPageText(linkId: string): Promise<FetchPageResult> {
  let post: Awaited<ReturnType<typeof fetchXhhPostDetail>>
  try {
    post = await fetchXhhPostDetail(linkId)
  }
  catch (error) {
    throw new FetchError('no-content', `小黑盒帖子正文抓取失败（${error instanceof Error ? error.message : String(error)}），以下结论仅依据标题`)
  }

  const text = (post.text || '').trim()
  if (text.length <= 120)
    throw new FetchError('no-content', '小黑盒帖子正文过短（可能是纯图片帖），以下结论仅依据标题')

  return {
    text: text.slice(0, MAX_CONTENT),
    title: post.title,
    authSourceId: null,
    authLabel: '',
    finalUrl: `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`,
    redirects: 0,
  }
}

export async function fetchPageText(rawUrl: string, timeoutMs = 9000): Promise<FetchPageResult> {
  // 小黑盒帖子页是前端渲染的 SPA（实测直接抓 HTML 可见正文约 13 字），
  // 改走官方签名接口拿详情（与 /api/xhh 共用同一套签名，匿名可用）。
  const xhhLinkId = xhhLinkIdFromUrl(rawUrl)
  if (xhhLinkId)
    return fetchXhhPageText(xhhLinkId)

  let url = rawUrl
  let redirects = 0

  for (;;) {
    if (!isPublicHttpUrl(url))
      throw new FetchError('redirect', '链接不是公开的 http(s) 地址（或跳转到了内网地址），已中止抓取')

    // 每一跳都重新决策：只在 host 属于某个凭据源（或其条目的域名）时才带 cookie
    const auth = cookieHeaderFor(url)
    const origin = (() => {
      try {
        return `${new URL(url).origin}/`
      }
      catch {
        return ''
      }
    })()

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          // 注意：部分站点（如雷峰网）对完整 Chrome UA 更敏感，这里保持简短
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(origin ? { Referer: origin } : {}),
          ...(auth.header ? { Cookie: auth.header } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      })
    }
    catch (error) {
      throw new FetchError('network', `网络请求失败（${error instanceof Error ? error.message : String(error)}）`)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location)
        throw new FetchError('redirect', `页面返回 ${response.status} 但没有跳转地址`)
      if (redirects >= MAX_REDIRECTS)
        throw new FetchError('redirect', `跳转次数超过 ${MAX_REDIRECTS} 次，疑似循环跳转`)
      try {
        url = new URL(location, url).toString()
      }
      catch {
        throw new FetchError('redirect', `跳转地址无法解析：${location.slice(0, 80)}`)
      }
      redirects++
      continue
    }

    if (!response.ok) {
      const status = response.status
      // 403/401 要区分三种情况：有凭据但被拒（多半过期）/ 该站要登录但这次没带凭据 / 纯匿名被拦
      if (status === 401 || status === 403) {
        // 开关关闭或 cookie 为空时 auth.sourceId 是 null，所以这里单独再判一次 host 归属
        const matchedId = auth.sourceId || sourceIdForHost(url)
        if (matchedId) {
          const label = auth.label || sourceLabelOf(matchedId)
          throw new FetchError(
            'need-login',
            auth.header
              ? `${label} 需要登录态，带凭据访问仍返回 HTTP ${status}（cookie 可能已过期）`
              : `${label} 需要登录态，但本次未携带凭据（抓取开关已关闭，或该源 cookie 为空）`,
            { status, sourceId: matchedId, label },
          )
        }
        throw new FetchError('blocked', `页面拒绝访问（HTTP ${status}），该站点需要登录或有反爬限制`, { status })
      }
      if (status === 429)
        throw new FetchError('blocked', '请求过于频繁（HTTP 429），稍后再试', { status })
      throw new FetchError('network', `页面返回 HTTP ${status}`, { status })
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const head = buffer.subarray(0, 2048).toString('latin1')
    const declared = (CHARSET_RE.exec(response.headers.get('content-type') || '')?.[1]
      || CHARSET_RE.exec(head)?.[1]
      || 'utf-8').toLowerCase()

    let html: string
    try {
      html = new TextDecoder(declared === 'gb2312' ? 'gbk' : declared).decode(buffer)
    }
    catch {
      html = buffer.toString('utf8') // 编码名不认识时兜底
    }

    const $ = cheerio.load(html)
    const title = ($('title').first().text() || '').trim()
    $(STRIP_SELECTORS).remove()

    const text = ($('article').text() || $('main').text() || $('body').text() || '')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()

    if (text.length <= 120) {
      throw new FetchError('no-content', auth.sourceId && auth.header
        ? `已带${auth.label}凭据，但正文过短（可能命中登录墙、反爬或纯前端渲染），以下结论仅依据标题`
        : '正文过短（可能命中登录墙、反爬或纯前端渲染），以下结论仅依据标题')
    }

    return {
      text: text.slice(0, MAX_CONTENT),
      title,
      authSourceId: auth.sourceId,
      authLabel: auth.label,
      finalUrl: url,
      redirects,
    }
  }
}

const ITEM_SYSTEM = '你是资讯分析助手，既要讲清这一条本身，也要把它放回背景里解释；事实与背景补充必须分开标注，不编造细节。'

export interface ItemAnalysisInput {
  title: string
  url?: string
  /** 用户手动粘贴的正文（优先于抓取） */
  content?: string
  source?: string
}

export interface ItemAnalysisResult {
  text: string
  cached: boolean
  /** 正文来源：用户提供 / 抓取成功 / 只有标题 */
  contentSource: 'provided' | 'fetched' | 'title-only'
  contentLength: number
  fetchNote: string
  pageTitle: string
  /** 取到正文时所用的凭据源（匿名抓取、或没抓到正文时为 null） */
  authSourceId: string | null
  /** 凭据源的展示名（如「微博」） */
  authLabel: string
  usage: ChatUsage
  /** 本次是否注入了记忆上下文（记忆未启用/无命中/不可用时为 false） */
}

/** @description: 分析单独一条信息（标题 + 链接，正文尽力抓取） */
export async function analyzeItem(input: ItemAnalysisInput): Promise<ItemAnalysisResult> {
  const title = (input.title || '').trim()
  const provided = (input.content || '').trim()

  if (!title && !provided)
    throw new Error('请至少填写标题或正文')

  let body = provided
  let contentSource: ItemAnalysisResult['contentSource'] = provided ? 'provided' : 'title-only'
  let fetchNote = ''
  let pageTitle = ''
  let authSourceId: string | null = null
  let authLabel = ''

  if (!body && input.url) {
    if (!isPublicHttpUrl(input.url)) {
      fetchNote = '链接不是公开的 http(s) 地址，已跳过正文抓取'
    }
    else {
      try {
        const page = await fetchPageText(input.url)
        pageTitle = page.title
        authSourceId = page.authSourceId
        authLabel = page.authLabel
        body = page.text
        contentSource = 'fetched'
      }
      catch (error) {
        // 带类型的失败会给出「该去哪修」的提示（见 describeFetchFailure）
        fetchNote = describeFetchFailure(error)
        if (error instanceof FetchError) {
          authSourceId = error.sourceId ?? null
          authLabel = error.label ?? ''
        }
      }
    }
  }


  const prompt = [
    '请分析下面这**一条**热榜信息，用 Markdown 输出，按以下结构展开：',
    '',
    '### 一句话概括',
    '不超过 40 字，点出主体与事件，不要照抄标题用词。',
    '',
    '### 关键信息',
    '3-5 条要点。若没有正文，每条都要标注「仅凭标题推断」。',
    '',
    '### 背景与延伸',
    '- **来龙去脉**：这件事可能的前因，或它属于什么更大的脉络',
    '- **概念/主体补充**：标题里出现的人物、产品、事件是什么（标注「背景补充：」）',
    '- **后续看点**：2-3 条接下来值得关注的走向',
    '没有把握的部分写「信息不足」，不要硬凑。',
    '',
    '### 多方视角',
    '这件事可能存在哪些不同立场或争议？各方的理由是什么？若确实没有争议，写「无明显对立观点」。',
    '',
    '### 可信度提示',
    '判断它是新闻、观点、求助还是娱乐灌水；指出标题里可能存在的夸张、诱导或断章取义；说明事实与观点各占多少。',
    '',
    '### 延伸阅读方向',
    '2-3 个可自行搜索的关键词或方向，用于进一步了解。',
    '',
    WRITING_RULES,
    '',
    `【来源】${input.source || '未知'}`,
    `【标题】${title || '（无）'}`,
    input.url ? `【链接】${input.url}` : '',
    body ? `\n【正文节选】\n${body}` : '\n（未取得正文，请仅依据标题分析）',
  ].filter(Boolean).join('\n')

  const { value, cached: fromCache } = await cached(
    // 键里并入鉴权来源：同一 URL 匿名抓到的残缺正文与带凭据抓到的完整正文不能互相复用
    `item:v4:auth:${authSourceId || 'none'}:${input.source || ''}:${title}:${input.url || ''}:${body}`,
    () => chat(prompt, { system: ITEM_SYSTEM, temperature: 0.4, maxTokens: 8000, timeoutMs: 180_000 }),
  )


  return {
    text: value.text,
    cached: fromCache,
    contentSource,
    contentLength: body.length,
    fetchNote,
    pageTitle,
    authSourceId,
    authLabel,
    usage: value.usage,
  }
}
