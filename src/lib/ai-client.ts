/*
 * @Description: AI 相关的前端共用件（类型 + fetch 助手 + toast hook）
 *
 * 2026-09-16 从 `src/app/AiModel/ai-panel.tsx` 抽出：四项能力搬到首页悬浮抽屉、
 * 设置搬到 `/settings`，两处都要用同一套类型与请求助手，不能再从一个页面文件里 import。
 *
 * 只放客户端安全的东西（fetch / React hook / 类型），不要引入 node:fs 之类。
 */
'use client'

import { useCallback, useState } from 'react'

export interface AiHistoryTokens {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens?: number
}

/** 设置项取值来源 */
export type Source = 'env' | 'file' | 'legacy' | 'default'

export interface ApiTypeOption {
  value: string
  label: string
  path: string
  hint: string
}

export type SettingKey = 'name' | 'baseUrl' | 'headers' | 'apiType' | 'apiKey' | 'model' | 'modelModes'

export interface AiConfig {
  name: string
  baseUrl: string
  apiType: string
  headers: string
  headerCount: number
  /** 当前使用的供应商名字 */
  active: string
  /** 已保存的供应商（只含掩码与元信息） */
  providers: {
    name: string
    baseUrl: string
    apiType: string
    model: string
    modelModes: string[]
    hasApiKey: boolean
    apiKeyMasked: string
    headerCount: number
  }[]
  model: string
  /** 当前供应商选中的模式（多选） */
  modelModes: string[]
  /** 可选模式清单 */
  modelModeOptions: ApiTypeOption[]
  endpoint: string
  apiTypes: ApiTypeOption[]
  apiKeyMasked: string
  hasApiKey: boolean
  configured: boolean
  sources: Record<SettingKey, Source>
  defaults: { name: string, baseUrl: string, model: string }
  configFile: string
  configFileExists: boolean
  /** 写入目标（新文件名） */
  configFileTarget: string
  /** 仍在读旧文件名 ai-config.json（保存一次即迁移） */
  usingLegacyConfigFile: boolean
  envLocked: Record<SettingKey, boolean>
  cacheDir: string
  cacheTtlDays: number
  webSearch?: PublicWebSearchSettings
}

export interface PublicWebSearchSettings {
  enabled: boolean
  provider: 'exa' | 'firecrawl' | 'parallel' | 'tavily' | 'bing-rss' | 'google-cse'
  providerOptions: { value: 'exa' | 'firecrawl' | 'parallel' | 'tavily' | 'bing-rss' | 'google-cse', label: string }[]
  hasApiKey: boolean
  apiKeyMasked: string
  envLocked: boolean
  apiKeys: Record<string, { hasApiKey: boolean, apiKeyMasked: string, envLocked: boolean }>
  googleCx: string
  googleCxConfigured: boolean
  googleCxEnvLocked: boolean
  supportsAiContext: boolean
}

export interface SummaryRow {
  title: string
  url?: string
  source?: string
  summary: string
  cached: boolean
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
  usage?: AiHistoryTokens
  error?: boolean
}

export interface ChatReply {
  text: string
  usage?: AiHistoryTokens
}

export interface ChatContext {
  title?: string
  url?: string
  content?: string
  source?: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  input: string
  context: ChatContext | null
  contextUsed: boolean
  /** 置顶：置顶会话排在历史列表最前（多设备共享） */
  pinned?: boolean
  createdAt: number
  updatedAt: number
  /** 完整 messages 是否已拉到本地；列表接口返回的摘要为 false */
  messagesLoaded?: boolean
  /** 会话消息条数（摘要携带，未加载时用于展示） */
  messageCount?: number
  /** 最近一条消息预览（摘要携带，未加载时用于搜索/展示） */
  preview?: string
}

export interface ItemResult {
  text: string
  cached: boolean
  contentSource: 'provided' | 'fetched' | 'title-only'
  contentLength: number
  fetchNote: string
  pageTitle: string
  /** 取到正文时所用的凭据源（匿名抓取为 null） */
  authSourceId?: string | null
  /** 凭据源展示名，如「微博」 */
  authLabel?: string
  /** 从历史记录载入时的时间戳（非本次生成） */
  historyAt?: number
  usage?: AiHistoryTokens
}

export interface AnalyzeResult {
  text: string
  cached: boolean
  usedItems: number
  label: string
  historyAt?: number
  usage?: AiHistoryTokens
}

export interface TestResult {
  ok: boolean
  reply: string
  model: string
  apiType: string
  endpoint: string
  elapsedMs: number
}

export interface ModelsResult {
  models: string[]
  endpoint: string
  tried: string[]
}

export interface BriefingData {
  text: string
  cached: boolean
  usedSources: number
  usedItems: number
  elapsedMs: number
  sources: { label: string, alias: string, count: number }[]
  skipped: string[]
  historyAt?: number
  usage?: AiHistoryTokens
}

/** 泛型化以拿到真实返回类型（否则 json.data 是 any，索引 Record 会报错） */
export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  return (await postEnvelope<T>(url, body)).data
}

/** 需要 data 之外的字段（如 tokens）时用这个，拿到完整响应体 */
export async function postEnvelope<T = unknown>(url: string, body?: unknown): Promise<{ data: T } & Record<string, any>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok || !json || json.code !== 200)
    throw new Error(json?.msg || `请求失败（HTTP ${response.status}）`)
  return json
}

export function useNotify() {
  const [toast, setToast] = useState<{ msg: string, ok: boolean } | null>(null)
  const notify = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }, [])
  return { toast, notify }
}

export type Notify = (msg: string, ok?: boolean) => void
