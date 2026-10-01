/*
 * @Description: cookies 管理（NGA/微博/小黑盒/B站/知乎）——读写在各爬虫项目目录的 *_cookies.json
 * 从独立服务 cookies-admin(10195) 并入 doroHot（2026-09-08），逻辑与原 server.mjs 一致：
 * 导入自动识别 JSON / Cookie 头 / TSV-Netscape；保存前自动备份 .bak，原子写入；
 * 条目保留导入原字段，仅追加 createdAt/updatedAt（爬虫只读 name/value，不受影响）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { loadWeiboListId } from '@/lib/weibo'

export interface CookieSource {
  /** 源标识即 COOKIE_SOURCES 的键（如 weibo / bilibili），故不再单列 id 字段 */
  label: string
  file: string
  site: string
  /**
   * 除 site 自身（含其子域）外，还认哪些 host。
   * 用于「抓正文按 host 带凭据」（lib/site-auth.ts）：同一家的站经常跨域/换域名，
   * 例如 NGA 的 cookie 是从 bbs.nga.cn 导出的，但内容现在挂在 ngabbs.com 上。
   */
  aliases?: string[]
  note: string
}

/** cookie 凭据根目录：默认取项目同级目录，可用环境变量 COOKIE_BASE 覆盖 */
const BASE = process.env.COOKIE_BASE || join(process.cwd(), '..')

export const COOKIE_SOURCES: Record<string, CookieSource> = {
  nga: {
    label: 'NGA',
    file: `${BASE}/ngabbs-scraper-node/nga_cookies.json`,
    site: 'https://ngabbs.com',
    aliases: ['nga.cn', 'nga.178.com'],
    note: 'ngabbs-mcp 与 doroHot nga-talk/nga-game 共用；过期表现：接口 403 或返回空',
  },
  weibo: {
    label: '微博',
    file: `${BASE}/weibo-scraper-node/weibo_cookies.json`,
    site: 'https://weibo.com',
    aliases: ['weibo.cn'],
    note: 'weibo-mcp 与 doroHot weibo-friends 共用；过期表现：feed 返回 ok!=1',
  },
  xhh: {
    label: '小黑盒',
    file: `${BASE}/xhhapi-scraper-node/xhhapi_cookies.json`,
    site: 'https://www.xiaoheihe.cn',
    note: 'xhhapi-mcp 使用（注意文件名是 xhhapi_cookies.json）',
  },
  bilibili: {
    label: 'B站',
    file: `${BASE}/bilibili-scraper-node/bilibili_cookies.json`,
    site: 'https://www.bilibili.com',
    aliases: ['b23.tv'],
    note: 'B 站热门榜（/api/bilibili）带登录态用，关键 cookie 是 SESSDATA；过期表现：nav 接口 code=-101',
  },
  zhihu: {
    label: '知乎',
    file: `${BASE}/zhihu-scraper-node/zhihu_cookies.json`,
    site: 'https://www.zhihu.com',
    note: '知乎热榜（/api/zhihu）带登录态用，关键 cookie 是 z_c0；过期表现：/api/v4/me 返回 HTTP 401',
  },
}

type RawEntry = Record<string, unknown> & { name?: unknown, value?: unknown }

export interface CookieEntry {
  name: string
  value: string
  [key: string]: unknown
}

/** 从条目原始字段推导过期时间(ms)，无法确定返回 null */
function expiryMs(entry: CookieEntry): number | null {
  const raw = entry.expirationDate ?? entry.expires
  if (raw === undefined || raw === null || raw === '' || raw === 0)
    return null
  if (typeof raw === 'number')
    return raw < 1e12 ? raw * 1000 : raw // 扩展导出是秒；容错毫秒
  const t = Date.parse(String(raw))
  return Number.isNaN(t) ? null : t
}

export function normalizeEntry(raw: RawEntry, nowIso: string): CookieEntry | null {
  const name = String(raw.name ?? '').trim()
  const value = String(raw.value ?? '')
  if (!name)
    return null
  // 原样保留扩展导出的所有字段（domain/path/secure/httpOnly...），仅补元数据
  const entry: CookieEntry = { ...raw, name, value }
  if (entry.expirationDate === undefined && raw.expires !== undefined) {
    const ms = typeof raw.expires === 'number'
      ? (raw.expires < 1e12 ? raw.expires * 1000 : raw.expires)
      : Date.parse(String(raw.expires))
    if (Number.isFinite(ms)) {
      entry.expirationDate = Math.floor(ms / 1000)
      delete entry.expires
    }
  }
  entry.createdAt = raw.createdAt || nowIso
  entry.updatedAt = nowIso
  return entry
}

export interface ParsedImport {
  format: 'json' | 'tsv' | 'header'
  entries: CookieEntry[]
}

/** 导入文本解析。识别顺序：JSON → Netscape/TSV → Cookie 头字符串 */
export function parseImportText(text: unknown): ParsedImport {
  const trimmed = String(text || '').trim()
  if (!trimmed)
    throw new Error('导入内容为空')

  // 1) JSON（扩展导出数组，或 {cookies:[...]} 包一层）
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let j: unknown
    try {
      j = JSON.parse(trimmed)
    }
    catch {
      j = undefined
    }
    if (j) {
      let arr = Array.isArray(j) ? j : (j as { cookies?: unknown })?.cookies
      if (Array.isArray(arr)) {
        const now = new Date().toISOString()
        const entries = (arr as RawEntry[])
          .map(e => normalizeEntry(e, now))
          .filter((e): e is CookieEntry => !!e)
        if (!entries.length)
          throw new Error('JSON 中没有可识别的 cookie 条目（需要 name/value 字段）')
        return { format: 'json', entries }
      }
    }
  }

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // 2) Netscape 格式（tab 分 7 列）与通用 TSV（name \t value [\t domain [\t path [\t expires]]]）
  const tabLines = lines.filter(l => l.includes('\t'))
  if (tabLines.length) {
    const entries: CookieEntry[] = []
    const now = new Date().toISOString()
    for (const line of tabLines) {
      if (/^#/.test(line))
        continue
      const cols = line.split('\t').map(c => c.trim())
      let e: CookieEntry | null = null
      if (cols.length >= 7 && /^(#HttpOnly_)?\.?[a-z0-9.-]+\t/i.test(line)) {
        // Netscape: domain \t flag \t path \t secure \t expires \t name \t value
        const [domain, , path, secure, exp, name, ...rest] = cols
        e = normalizeEntry({ name, value: rest.join('\t'), domain, path: path || '/', secure: secure === 'TRUE', expires: Number(exp) || null }, now)
      }
      else if (cols.length >= 2 && /^[\w.-]+$/.test(cols[0])) {
        const [name, value, domain, path, exp] = cols
        e = normalizeEntry({ name, value, domain, path, expires: exp || null }, now)
      }
      if (e)
        entries.push(e)
    }
    if (entries.length)
      return { format: 'tsv', entries }
  }

  // 3) Cookie 头字符串: "a=1; b=2"（容忍前缀 "Cookie:"）
  const body = trimmed.replace(/^cookie\s*:\s*/i, '')
  if (!/[{\[\t]/.test(body) && body.includes('=')) {
    const now = new Date().toISOString()
    const entries: CookieEntry[] = []
    for (const pair of body.split(';')) {
      const p = pair.trim()
      if (!p)
        continue
      const eq = p.indexOf('=')
      if (eq <= 0)
        continue
      const e = normalizeEntry({ name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim() }, now)
      if (e)
        entries.push(e)
    }
    if (entries.length)
      return { format: 'header', entries }
  }

  throw new Error('无法识别的格式。支持：JSON 数组 / Cookie 头字符串(a=1; b=2) / Netscape 或 TSV 文本')
}

export function readEntries(src: CookieSource): CookieEntry[] {
  if (!existsSync(src.file))
    return []
  try {
    const j = JSON.parse(readFileSync(src.file, 'utf-8'))
    return Array.isArray(j) ? j : []
  }
  catch (e) {
    throw new Error(`cookie 文件不是合法 JSON：${(e as Error).message}`)
  }
}

export function writeEntries(src: CookieSource, entries: CookieEntry[]): void {
  mkdirSync(dirname(src.file), { recursive: true })
  if (existsSync(src.file))
    copyFileSync(src.file, `${src.file}.bak`)
  const tmp = `${src.file}.tmp`
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n')
  renameSync(tmp, src.file)
}

export function getSource(id: string): CookieSource {
  const src = COOKIE_SOURCES[id]
  if (!src)
    throw new Error(`未知数据源: ${id}（可用: ${Object.keys(COOKIE_SOURCES).join(', ')}）`)
  return src
}

export function publicEntry(entry: CookieEntry, index: number, fileMtimeMs: number) {
  const exp = expiryMs(entry)
  return {
    index,
    name: entry.name,
    value: entry.value,
    domain: String(entry.domain || ''),
    path: String(entry.path || ''),
    expiresAt: exp ? new Date(exp).toISOString() : null,
    expired: exp ? exp < Date.now() : false,
    session: entry.session === true || exp === null,
    createdAt: String(entry.createdAt || new Date(fileMtimeMs).toISOString()),
    updatedAt: String(entry.updatedAt || entry.createdAt || new Date(fileMtimeMs).toISOString()),
  }
}

export function fileMtime(src: CookieSource): number {
  return existsSync(src.file) ? statSync(src.file).mtimeMs : Date.now()
}

/** 合并导入的 key：name(+domain) */
export const entryKey = (e: CookieEntry) => `${e.name}@${e.domain || ''}`

// ---------- 登录态探测 ----------
// 文件里的 expirationDate 是导出时的浏览器快照；微博等站点会对短时令牌（如 WBPSESS）
// 自动续期，快照过期 ≠ 登录失效。真实有效性以此探测为准。

export interface ProbeResult {
  state: 'ok' | 'fail' | 'unsupported'
  detail: string
}

const PROBE_TIMEOUT_MS = 15_000
const PROBE_UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function cookieHeaderOf(src: CookieSource): string {
  return readEntries(src)
    .map(e => `${e.name}=${e.value}`)
    .join('; ')
}

/** 按源实测登录态：weibo 调关注流接口；nga 抓板块页验登录标识；B站/知乎调各自「我是谁」接口；其余暂不支持 */
export async function probeSource(id: string): Promise<ProbeResult> {
  const src = getSource(id)
  const cookieHeader = cookieHeaderOf(src)
  if (!cookieHeader)
    return { state: 'fail', detail: 'cookie 文件为空，无登录态可言' }
  try {
    if (id === 'weibo')
      return await probeWeibo(cookieHeader)
    if (id === 'nga')
      return await probeNga(cookieHeader)
    if (id === 'bilibili')
      return await probeBilibili(cookieHeader)
    if (id === 'zhihu')
      return await probeZhihu(cookieHeader)
    return { state: 'unsupported', detail: '该源接口需签名/无轻量探测口，暂不支持在线检测，请以实际调用为准' }
  }
  catch (e) {
    return { state: 'fail', detail: `探测请求失败：${(e as Error).message}` }
  }
}

/** B站：`nav` 接口匿名返回 code=-101，带有效 SESSDATA 时 isLogin=true */
async function probeBilibili(cookieHeader: string): Promise<ProbeResult> {
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': PROBE_UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': cookieHeader },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!res.ok)
    return { state: 'fail', detail: `nav 接口 HTTP ${res.status}` }
  const j = await res.json().catch(() => null)
  if (j?.data?.isLogin)
    return { state: 'ok', detail: `已登录：${j.data.uname || `mid ${j.data.mid}`}` }
  return { state: 'fail', detail: `未登录（code ${j?.code ?? '—'}${j?.message ? ` · ${j.message}` : ''}），请重新导出并补上 SESSDATA` }
}

/** 知乎：`/api/v4/me` 未登录返回 401，带有效 z_c0 时返回本人信息 */
async function probeZhihu(cookieHeader: string): Promise<ProbeResult> {
  const res = await fetch('https://www.zhihu.com/api/v4/me', {
    headers: { 'User-Agent': PROBE_UA, 'Referer': 'https://www.zhihu.com/', 'Cookie': cookieHeader },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (res.status === 401)
    return { state: 'fail', detail: '未登录（HTTP 401），请重新导出并补上 z_c0' }
  if (!res.ok)
    return { state: 'fail', detail: `me 接口 HTTP ${res.status}` }
  const j = await res.json().catch(() => null)
  return { state: 'ok', detail: `已登录：${j?.name || j?.url_token || '登录态有效'}` }
}

async function probeWeibo(cookieHeader: string): Promise<ProbeResult> {
  const listId = loadWeiboListId()
  if (!listId)
    return { state: 'unsupported', detail: '缺少 list_id（weibo-scraper-node/weibo_config.json），无法探测关注流' }
  const res = await fetch(
    `https://weibo.com/ajax/feed/friendstimeline?list_id=${listId}&fid=${listId}&refresh=4&count=1&since_id=0`,
    {
      headers: { 'User-Agent': PROBE_UA, 'Referer': 'https://weibo.com/', 'Accept': 'application/json', 'Cookie': cookieHeader },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    },
  )
  if (!res.ok)
    return { state: 'fail', detail: `接口 HTTP ${res.status}` }
  const j = await res.json()
  return j?.ok === 1
    ? { state: 'ok', detail: '微博关注流接口返回正常，登录态有效（快照过期的短时令牌会被微博自动续期）' }
    : { state: 'fail', detail: '接口返回 ok!=1，登录 Cookie 可能已失效，请重新导出导入' }
}

async function probeNga(cookieHeader: string): Promise<ProbeResult> {
  const res = await fetch('https://ngabbs.com/thread.php?fid=-7', {
    headers: { 'User-Agent': PROBE_UA, 'Referer': 'https://ngabbs.com/', 'Cookie': cookieHeader },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!res.ok)
    return { state: 'fail', detail: `板块页 HTTP ${res.status}（403 多为 cookie 失效）` }
  const html = new TextDecoder('gbk').decode(Buffer.from(await res.arrayBuffer()))
  return /__CURRENT_UID\s*=\s*parseInt\('\d{3,}'/.test(html)
    ? { state: 'ok', detail: '板块页可访问且带登录标识，登录态有效' }
    : { state: 'fail', detail: '页面可访问但未检测到登录标识，cookie 可能已失效' }
}
