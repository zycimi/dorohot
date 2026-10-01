/**
 * NGA 板块热帖抓取共享逻辑。
 *
 * Cookie 复用外置 NGA 抓取服务导出的 nga_cookies.json（单一来源，env
 * NGA_COOKIES_PATH 可覆盖）；GBK 解码用 Node 内置 TextDecoder。
 */
import { join } from 'node:path'

import * as cheerio from 'cheerio'

import { cookieHeaderFromFile } from '@/lib/site-auth'

import type { HotListItem } from '@/types'

const NGA_HOST = 'https://ngabbs.com'
const TIMEOUT_MS = 20_000

/** NGA 凭据文件：默认取项目同级的 ngabbs-scraper-node，可用环境变量 NGA_COOKIES_PATH 覆盖 */
const COOKIES_PATH
  = process.env.NGA_COOKIES_PATH
    || join(process.cwd(), '..', 'ngabbs-scraper-node', 'nga_cookies.json')

const UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const GBK_RE = /charset\s*=\s*(gbk|gb2312|gb18030)/i

/**
 * 标题黑名单：过滤 NGA 版头置顶、官方公告、广告、水楼等非内容帖。
 * NGA 的列表页对这些帖没有可靠的结构标记，只能按标题特征过滤。
 * 想加/删规则直接改这个数组（正则，不分大小写）。
 */
const TITLE_BLOCKLIST: RegExp[] = [
  /恩基爱|客户端闪退|iOS\s*客户端/, // NGA 官方 App 公告（各版置顶）
  /版务公告|版面版规|申请徽章|精华帖补分|优质内容推荐/, // 版务/版规
  /水楼/, // 各版置顶水楼
  /Torncity|佛系挂机/, // 已知广告安利
  /\broll\b/i, // roll 帖（dorohot-rule.md §二）
  /抽奖|截图抽/, // 抽奖帖（列表标题截断时以「截图抽」结尾，按此兜底）
  /送码|送key|送cdk|送会员|送月卡|免费送/i, // 送福利
  /\[活动\]/, // 厂商活动/商业推广帖
  /拼多多五折互助/, // 常驻集中贴（长期霸占榜首）
]

/**
 * 累计回复数达到此值视为常驻巨楼（交易楼/互助集中贴等，常年霸榜头部），
 * 从榜单剔除，让 Top20 聚焦近期活跃帖。观测：巨楼 ≥5000，正常帖 ≤350。
 */
const MEGA_THREAD_REPLIES = 3000

function isBlocked(title: string): boolean {
  return TITLE_BLOCKLIST.some(re => re.test(title))
}

function detectCharset(buf: Buffer): string | null {
  const head = buf.toString('utf-8', 0, Math.min(buf.length, 4096))
  const m = head.match(/<meta\s+charset\s*=\s*["']?([^"'>\s]+)/i)
    || head.match(/<meta[^>]+Content-Type[^>]+charset\s*=\s*([^"'\s;]+)/i)
  return m ? m[1].toLowerCase() : null
}

function decodeBody(buf: Buffer, contentType: string): string {
  const enc = GBK_RE.test(contentType) ? 'gbk' : detectCharset(buf)
  if (enc && enc !== 'utf-8') {
    try {
      return new TextDecoder(enc).decode(buf)
    }
    catch {
      // TextDecoder 不认识该编码时退回 utf-8
    }
  }
  return buf.toString('utf-8')
}

function loadCookieHeader(): string {
  // 读文件 + 拼头的实现统一在 lib/site-auth.ts（AI 抓正文走同一套），这里只负责定位文件
  return cookieHeaderFromFile(COOKIES_PATH)
}

function clean(t: string | undefined | null): string {
  if (!t)
    return ''
  return t
    .replace(/\u200b/g, '')
    .replace(/显示图片\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getParam(url: string, p: string): string | null {
  try {
    return new URL(url, NGA_HOST).searchParams.get(p)
  }
  catch {
    return null
  }
}

async function fetchBoardTopics(fid: string, cookieHeader: string): Promise<HotListItem[]> {
  const res = await fetch(`${NGA_HOST}/thread.php?fid=${encodeURIComponent(fid)}`, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': `${NGA_HOST}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok)
    throw new Error(`NGA HTTP ${res.status}（fid=${fid}）`)

  const buf = Buffer.from(await res.arrayBuffer())
  const html = decodeBody(buf, res.headers.get('content-type') || '')
  const $ = cheerio.load(html)

  // 每行 topicrow 后随 commonui.topicArg.add(...) 脚本：第9参=tid，第14参=最后回复 Unix 秒。
  // 板块页按最后回复排序，该时间戳用于跨板块合并时保持全局「最新活跃」序。
  const lastReplyTs = new Map<string, number>()
  for (const m of html.matchAll(/commonui\.topicArg\.add\(([^)]*)\)/g)) {
    const args = splitQuoted(m[1])
    const tid = args[8]
    const ts = Number(args[13])
    if (tid && Number.isFinite(ts) && ts > 0)
      lastReplyTs.set(tid, ts)
  }

  const items: Array<HotListItem & { ts: number }> = []
  $('tr.topicrow').each((_, el) => {
    const $el = cheerio.load(el)
    const tl = $el('td.c2 a[href*="read.php"]').first()
    const href = tl.attr('href') || ''
    const tid = getParam(href, 'tid')
    const title = clean(tl.text())
    if (!tid || !title)
      return

    const replies = Number.parseInt($el('td.c1').text().replace(/[^\d]/g, ''), 10)
    const author = clean($el('td.c3 a.author').first().text())
    const lastReplyer = clean($el('td.c4 span.replyer').first().text())

    items.push({
      id: tid,
      title,
      url: `${NGA_HOST}/read.php?tid=${tid}`,
      mobileUrl: `https://ngabbs.com/read.php?tid=${tid}`,
      hot: Number.isNaN(replies) ? 0 : replies,
      desc: [author && `楼主: ${author}`, lastReplyer && `最后回复: ${lastReplyer}`].filter(Boolean).join(' · '),
      ts: lastReplyTs.get(tid) ?? 0,
    })
  })
  return items
}

/** 按「,」切分但忽略引号内的逗号，去掉引号（commonui.topicArg.add 参数解析用） */
function splitQuoted(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of s) {
    if (ch === '\'') {
      inQuote = !inQuote
      continue
    }
    if (ch === ',' && !inQuote) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

/**
 * 抓取多个 NGA 板块，合并去重后按最后回复时间降序取前 topN 条（贴近浏览器板块序）。
 * 标题黑名单 + 常驻巨楼（累计回复 ≥ MEGA_THREAD_REPLIES）剔除后再排序；
 * hot 字段仍保留累计回复数供前端展示。
 * 多板块请求间加 500ms 限速；单个板块失败抛错由调用方统一处理。
 */
export async function fetchNgaHot(fids: string[], topN = 20): Promise<HotListItem[]> {
  const cookieHeader = loadCookieHeader()
  const all: Array<HotListItem & { ts: number }> = []
  for (let i = 0; i < fids.length; i++) {
    if (i > 0)
      await new Promise(r => setTimeout(r, 500))
    const list = await fetchBoardTopics(fids[i], cookieHeader)
    all.push(...list)
  }

  const seen = new Set<string>()
  return all
    .filter(v => !isBlocked(v.title))
    .filter(v => (typeof v.hot === 'number' ? v.hot : 0) < MEGA_THREAD_REPLIES)
    .filter(v => (seen.has(String(v.id)) ? false : (seen.add(String(v.id)), true)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, topN)
}
