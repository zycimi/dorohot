/*
 * @Description: 抓取鉴权——「给定一个 URL，该带哪份凭据」
 *
 * 背景：AI「单条分析」会抓帖子正文，但 `fetchPageText` 原本不带任何 cookie，
 * 于是 NGA（匿名 403）、微博、小黑盒这类需要登录态的站点只能拿到标题。
 *
 * 设计要点：
 *  - **按 host 匹配凭据源**：只用目标 host 是否属于某个源（`site` 及其子域 + `aliases`）来决定，
 *    命中就带该源的**整套** cookie。**不做逐条 domain 过滤**——实测踩过：cookie 条目里的 `domain`
 *    可能与内容实际所在域名不一致（从旧域导出、内容已迁到新域），按条目 domain 过滤会把 cookie
 *    过滤成空、功能静默失效。条目 domain 只用于「检测」页展示与过期提示。
 *  - **绝不"有凭据就给所有请求带上"**：`analyzeItem` 抓的是用户随手粘贴的任意 URL，
 *    不乱发令牌是硬约束（见 AI抓取鉴权方案.md §6）。
 *  - **失败可用环境变量一键关闭**：`AI_FETCH_COOKIES=0` 时本模块恒返回空，便于出问题时立即停用。
 *  - 本模块只做「决策」，不发请求；带不带、怎么带由调用方（lib/ai.ts 的 fetchPageText）决定。
 */
import { readFileSync } from 'node:fs'

import { COOKIE_SOURCES, readEntries } from './cookies-admin'

import type { CookieEntry, CookieSource } from './cookies-admin'

/** 额外认的 host（逗号分隔），给自建镜像/测试用：SITE_AUTH_EXTRA_HOSTS=foo.example.com */
function extraHosts(): string[] {
  return (process.env.SITE_AUTH_EXTRA_HOSTS || '')
    .split(',')
    .map(item => normalizeHost(item.trim()))
    .filter(Boolean)
}

/** 取 host：小写、去端口、去 www.（www.xiaoheihe.cn 与 xiaoheihe.cn 视为同一家） */
export function normalizeHost(input: string): string {
  if (!input)
    return ''
  let host = input.trim().toLowerCase()
  // 允许直接传 URL
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    }
    catch {
      return ''
    }
  }
  host = host.split(':')[0].replace(/^www\./, '')
  return host
}

/** @description: 一个凭据源认领的所有 host（site 自身 + aliases，均去 www.） */
export function hostsOfSource(src: CookieSource): string[] {
  const list = [src.site, ...(src.aliases || [])]
    .map(item => normalizeHost(item))
    .filter(Boolean)
  return [...new Set(list)]
}

/**
 * @description: host 是否属于某个 domain——相等或为其子域
 *  子域必须严格匹配（`a.ngabbs.com` 命中 `ngabbs.com`，但 `xngabbs.com` 不命中）
 */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/** @description: 该 host 命中哪个凭据源（没命中返回 null） */
export function sourceIdForHost(hostOrUrl: string): string | null {
  const host = normalizeHost(hostOrUrl)
  if (!host)
    return null

  for (const [id, src] of Object.entries(COOKIE_SOURCES)) {
    if (hostsOfSource(src).some(domain => hostMatches(host, domain)))
      return id
  }

  // 仅用于自建镜像/测试：显式列出的 host 也算命中（第一个有凭据的源）
  if (extraHosts().some(domain => hostMatches(host, domain))) {
    const first = Object.keys(COOKIE_SOURCES)[0]
    return first || null
  }
  return null
}

export interface SiteAuth {
  /** 命中的凭据源 id（未命中为 null） */
  sourceId: string | null
  /** 该源的展示名（如「微博」） */
  label: string
  /** 可直接放进 Cookie 请求头的字符串（未命中/无凭据/已关闭时为空串） */
  header: string
  /** 参与拼接的条目数（用于诊断，不含凭据值） */
  count: number
}

/** @description: 抓取是否允许携带凭据（`AI_FETCH_COOKIES=0` 可一键关闭） */
export function fetchCookiesEnabled(): boolean {
  return process.env.AI_FETCH_COOKIES !== '0'
}

/**
 * 与既有爬虫（lib/nga.ts / lib/weibo.ts）保持**同一套编码方式**：
 * 两边都做过 encodeURIComponent，且线上一直可用；换编码可能改变某些值（如含 `+/=` 的令牌）。
 */
function toHeader(entries: CookieEntry[]): string {
  return entries
    .filter(e => e?.name && e?.value)
    .map(e => `${encodeURIComponent(String(e.name))}=${encodeURIComponent(String(e.value))}`)
    .join('; ')
}

/**
 * @description: 读某个 cookie 文件并拼成 Cookie 头
 *  各爬虫模块（nga/weibo）保留自己解析路径的 env 语义，但「读文件 → 拼头」这一步统一走这里，
 *  避免出现第四份实现。读不到/不是合法 JSON/为空都返回空串，不抛错（调用方按匿名处理）。
 */
export function cookieHeaderFromFile(file: string): string {
  if (!file)
    return ''
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? toHeader(parsed as CookieEntry[]) : ''
  }
  catch {
    return ''
  }
}

/** @description: 解析某个源当前的 Cookie 头（读文件失败/为空都返回空串，不抛错） */
export function cookieHeaderOfSource(sourceId: string): string {
  const src = COOKIE_SOURCES[sourceId]
  if (!src)
    return ''
  // 走 readEntries 是为了复用「文件不存在也有明确行为」的既有语义
  try {
    return toHeader(readEntries(src))
  }
  catch {
    return cookieHeaderFromFile(src.file)
  }
}

/** @description: 源的展示名 */
export function sourceLabelOf(sourceId: string | null | undefined): string {
  if (!sourceId)
    return ''
  return COOKIE_SOURCES[sourceId]?.label || sourceId
}

/**
 * @description: 给这个 URL 决定要不要带凭据、带哪份
 *  - 关闭开关 / 未命中凭据源 / 文件缺失或为空 → header 为空串，调用方照常匿名请求
 */
export function cookieHeaderFor(url: string): SiteAuth {
  const empty: SiteAuth = { sourceId: null, label: '', header: '', count: 0 }
  if (!fetchCookiesEnabled())
    return empty

  const sourceId = sourceIdForHost(url)
  if (!sourceId)
    return empty

  const src = COOKIE_SOURCES[sourceId]
  const header = cookieHeaderOfSource(sourceId)
  if (!header)
    return { sourceId, label: src?.label || sourceId, header: '', count: 0 }

  return {
    sourceId,
    label: src?.label || sourceId,
    header,
    count: header.split('; ').filter(Boolean).length,
  }
}

/** @description: 状态展示用（不含任何凭据值）：有哪些源、各自认领哪些 host */
export function authDiagnostics() {
  return {
    enabled: fetchCookiesEnabled(),
    sources: Object.entries(COOKIE_SOURCES).map(([id, src]) => ({
      id,
      label: src.label,
      hosts: hostsOfSource(src),
      /** 该源当前是否真的有可用 cookie（只报条数） */
      entries: (() => {
        try {
          return readEntries(src).length
        }
        catch {
          return 0
        }
      })(),
    })),
    extraHosts: extraHosts(),
  }
}
