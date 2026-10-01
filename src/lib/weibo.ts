/**
 * 微博关注流共享抓取逻辑（doroHot 数据源用）。
 *
 * 微博列表页 feed 不返回 created_at 时间字段，需用 /ajax/statuses/show?id={mid}
 * 逐条取时间；Cookie 复用外置微博抓取服务导出的 weibo_cookies.json 与
 * weibo_config.json（list_id），单一来源。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cookieHeaderFromFile } from '@/lib/site-auth'

import type { HotListItem } from '@/types'

const TIMEOUT_MS = 15_000

/**
 * 转发博文的最低互动总量（转发+评论+赞）。低于此值的转发视为噪音
 * （典型如「转发微博」纯搬运、纯表情转发），直接剔除；
 * 带实质评论且有一定互动的转发（如转5评11赞17）保留。
 */
const RETWEET_MIN_INTERACTIONS = 10

/** 微博凭据目录：默认取项目同级的 weibo-scraper-node，可用环境变量 WEIBO_DIR 覆盖 */
const WEIBO_DIR = process.env.WEIBO_DIR || join(process.cwd(), '..', 'weibo-scraper-node')

const UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function readJson(fp: string): any {
  try {
    return JSON.parse(readFileSync(fp, 'utf-8'))
  }
  catch {
    return null
  }
}

export function loadWeiboCookieHeader(): string {
  // 读文件 + 拼头的实现统一在 lib/site-auth.ts（AI 抓正文走同一套），这里只负责定位文件
  return cookieHeaderFromFile(`${WEIBO_DIR}/weibo_cookies.json`)
}

export function loadWeiboListId(): string {
  const cfg = readJson(`${WEIBO_DIR}/weibo_config.json`) as { list_id?: string } | null
  return cfg?.list_id || ''
}

interface WeiboStatus {
  id: string
  title: string
  created_at: string
  timestamp: number
  author: string
  authorUid: string
  reposts: number
  comments: number
  likes: number
}

async function weiboFetchJson(url: string, cookieHeader: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://weibo.com/',
      'Accept': 'application/json',
      'Cookie': cookieHeader,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok)
    throw new Error(`微博 HTTP ${res.status}`)
  return res.json()
}

/** 微博 RFC2822 时间（"Thu Sep 03 14:46:07 +0800 2026"）→ 毫秒；失败返回 null */
function parseWeiboTime(createdAt: string | undefined | null): number | null {
  if (!createdAt)
    return null
  const ts = Date.parse(createdAt)
  return Number.isNaN(ts) ? null : ts
}

export async function fetchWeiboFriends(): Promise<Array<HotListItem & { ts: number }>> {
  const cookieHeader = loadWeiboCookieHeader()
  const listId = loadWeiboListId()
  if (!cookieHeader || !listId)
    throw new Error('微博 cookie / list_id 缺失（weibo-scraper-node 配置）')

  const feed = await weiboFetchJson(
    `https://weibo.com/ajax/feed/friendstimeline?list_id=${listId}&fid=${listId}&refresh=4&count=50&since_id=0`,
    cookieHeader,
  )
  if (feed?.ok !== 1)
    throw new Error('微博 Cookie 无效或过期')

  const rawList: any[] = Array.isArray(feed?.statuses)
    ? feed.statuses
    : Array.isArray(feed?.data)
      ? feed.data.filter((it: any) => it.mblog).map((it: any) => it.mblog)
      : []

  const items: Array<HotListItem & { ts: number }> = []
  const now = Date.now()
  const parsedTimeCache = new Map<string, number>()

  // 逐条用详情接口取时间（feed 列表不带时间），失败则不采用该条
  for (const s of rawList) {
    if (items.length >= 30)
      break
    const mid = String(s.id ?? s.mid ?? '')
    if (!mid)
      continue

    const reposts = s.reposts_count ?? 0
    const comments = s.comments_count ?? 0
    const likes = s.attitudes_count ?? s.likes_count ?? 0

    // 低互动转发先剔除（feed 自带互动数，不必浪费详情接口调用）
    if (s.retweeted_status && reposts + comments + likes < RETWEET_MIN_INTERACTIONS)
      continue

    let ts = parsedTimeCache.get(mid)
    if (ts === undefined) {
      try {
        // 详情接口把微博对象直接放顶层（data 不在其内）
        const detail = await weiboFetchJson(
          `https://weibo.com/ajax/statuses/show?id=${mid}`,
          cookieHeader,
        )
        ts = parseWeiboTime(detail?.created_at) ?? 0
      }
      catch {
        ts = 0
      }
      parsedTimeCache.set(mid, ts)
    }
    if (ts === 0)
      continue
    const ageMs = now - ts
    // 只收 6 小时以内（调用方再按 3h→6h 规则截断）；超过则整体认为没有更新内容
    if (ageMs > 6 * 3_600_000 || ageMs < 0)
      continue

    const title = (s.text_raw ?? s.text ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!title)
      continue

    items.push({
      id: mid,
      title,
      url: `https://weibo.com/${s.user?.idstr ?? s.user?.id ?? ''}/${mid}`,
      // 移动端不再走 m.weibo.cn：统一用 weibo.com（2026-09-15 用户要求），与桌面同一个域名
      mobileUrl: `https://weibo.com/${s.user?.idstr ?? s.user?.id ?? ''}/${mid}`,
      hot: likes, // 展示热度用点赞数
      // ts 为内部字段（发布时间毫秒），route 层按 3h/6h 窗口截断后剔除
      ts,
      desc: `${s.user?.screen_name ?? ''} · ${Math.max(1, Math.round(ageMs / 60_000))}分钟前 · 转发${reposts} 评论${comments} 赞${likes}`,
    })
  }
  return items
}
