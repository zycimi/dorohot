/*
 * @Description: 小黑盒（heybox）社区热帖共享抓取逻辑（doroHot 数据源用）
 *
 * 取数形态：**纯 JSON 接口 + 自定义签名**（与 nga 的 HTML 解析、weibo 的 JSON 接口都不同）。
 *  - 接口：`GET https://api.xiaoheihe.cn/bbs/app/topic/feeds`
 *    参数 `topic_id=7214`（盒友杂谈，社区综合大版）+ `sort_filter=hot-rank`（官方文案「智能排序」）
 *    + 公共参数（os_type / x_app / version …）+ 签名三件套 `hkey/_time/nonce`
 *  - **签名是唯一门槛**：缺少 `_time` 返回「缺少必要参数[_time]」、`hkey` 不对返回「非法请求」。
 *    算法不能"理解后重写"——这是 GF(2) 上 4 字节混淆 + 自定义字符集映射，差一位就非法，
 *    因此下面 `sign()` 一段是从上游参考实现 **逐字移植**（含负 slice、无掩码的 `e << 1` 等语义细节）。
 *  - **匿名可用**：实测不带任何 cookie 也返回 `status: ok`（登录只是让结果变成个性化推荐），
 *    所以本模块不读凭据文件——也就没有"cookie 过期导致卡片空白"的问题。
 *  - **HTTP 状态码无意义**：出错也是 200 + `status:"failed"`，必须判 `status`（见 fetchXhhHot）。
 *  - 时间敏感：`hkey/_time/nonce` 每次请求都要重算，不能缓存复用。
 */
import CryptoJS from 'crypto-js'

import type { HotListItem } from '@/types'

/** MD5（小写 32 位 hex，与源项目用的 js-md5 输出一致） */
function md5(input: string): string {
  return CryptoJS.MD5(input).toString()
}

// ── 以下 sign() 及其依赖函数逐字移植自上游参考实现 ──────────────

/** 注意：取反分支按位与 255，正分支**没有**掩码——这是原实现的语义，别"修正" */
function f3(e: number): number {
  return e & 128 ? (e << 1 ^ 27) & 255 : e << 1
}
function Ic(e: number): number { return f3(e) ^ e }
function wf(e: number): number { return Ic(f3(e)) }
function Dh(e: number): number { return wf(Ic(f3(e))) }
function ag(e: number): number { return Dh(e) ^ wf(e) ^ Ic(e) }

function mwe(e: number[]): number[] {
  const t = [0, 0, 0, 0]
  t[0] = ag(e[0]) ^ Dh(e[1]) ^ wf(e[2]) ^ Ic(e[3])
  t[1] = Ic(e[0]) ^ ag(e[1]) ^ Dh(e[2]) ^ wf(e[3])
  t[2] = wf(e[0]) ^ Ic(e[1]) ^ ag(e[2]) ^ Dh(e[3])
  t[3] = Dh(e[0]) ^ wf(e[1]) ^ Ic(e[2]) ^ ag(e[3])
  e[0] = t[0]
  e[1] = t[1]
  e[2] = t[2]
  e[3] = t[3]
  return e
}

const CHARSET = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89'

/** n 为负数时 charset.slice(0, n) 即"去掉末尾 |n| 个字符"（原实现靠 JS slice 的负索引语义） */
function MM(s: string, charset: string, n: number): string {
  const o = charset.slice(0, n)
  let r = ''
  for (let i = 0; i < s.length; i++)
    r += o[s.charCodeAt(i) % o.length]
  return r
}

function PM(s: string, charset: string): string {
  let r = ''
  for (let i = 0; i < s.length; i++)
    r += charset[s.charCodeAt(i) % charset.length]
  return r
}

/** 多路交织（round-robin）拼接 */
function vwe(parts: string[]): string {
  let r = ''
  const maxLen = Math.max(...parts.map(p => p.length))
  for (let i = 0; i < maxLen; i++) {
    for (const p of parts) {
      if (i < p.length)
        r += p[i]
    }
  }
  return r
}

function gwe(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}

/** 路径签名：只对 path 签名（不含 query），并先把 path 规范成 `/a/b/` */
function Tr(path: string, t: number | string, nonce: string): string {
  const normalized = `/${path.split('/').filter(f => f).join('/')}/`
  const o = MM(String(t), CHARSET, -2)
  const a = PM(normalized, CHARSET)
  const s = PM(nonce, CHARSET)
  const i = vwe([o, a, s]).slice(0, 20)
  const l = md5(i)
  const chars = l.slice(-6).split('').map(c => c.charCodeAt(0))
  mwe(chars)
  let u = String(gwe(chars) % 100)
  if (u.length < 2)
    u = `0${u}`
  const c = MM(l.substring(0, 5), CHARSET, -4)
  return c + u
}

/** 签名三件套；`hkey` 用的是 `t + 1`（原实现如此），`_time` 是 `t` */
function sign(path: string): { hkey: string, _time: number, nonce: string } {
  const t = Math.floor(Date.now() / 1000)
  const nonce = md5(`${t}${Date.now()}${Math.random().toString()}g`).toUpperCase()
  const hkey = Tr(path, t + 1, nonce)
  return { hkey, _time: t, nonce }
}

/** 公共参数（照抄原实现；实测少几个也能用，但保持一致最稳） */
function defaultParams(): Record<string, string> {
  return {
    os_type: 'web',
    version: '999.0.4',
    x_app: 'heybox',
    x_client_type: 'web',
    x_client_version: '999.999.999',
    heybox_id: '0',
    x_os_type: 'Mac',
    app: 'heybox',
  }
}

// ── 取数 ─────────────────────────────────────────────────────────────────────

const API_HOST = 'https://api.xiaoheihe.cn'
/** 盒友杂谈：社区综合大版（社区里最接近"全站热帖"的板块） */
export const XHH_TOPIC_ID = '7214'
const TIMEOUT_MS = 15_000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** 清洗描述里的表情码与多余空白 */
function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/\[cube_[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function requestJson(path: string, params: Record<string, string | number>): Promise<any> {
  const query = new URLSearchParams({
    ...defaultParams(),
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ...sign(path) as unknown as Record<string, string>,
  })
  // 签名里的 _time 是数字，URLSearchParams 已在上一步统一转字符串
  const response = await fetch(`${API_HOST}${path}?${query}`, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.xiaoheihe.cn/app/bbs',
      'Origin': 'https://www.xiaoheihe.cn',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`小黑盒接口 HTTP ${response.status}`)

  const body = await response.json().catch(() => null)
  // 出错也是 200，必须看 status（字符串）
  if (!body || body.status !== 'ok')
    throw new Error(`小黑盒接口返回失败：${body?.msg || '未知原因'}`)
  return body.result ?? {}
}

/**
 * @description: 取小黑盒某板块的热帖（默认盒友杂谈、按官方「智能排序」）
 *  - 实测该接口**遵守 limit**，一次请求即可拿满
 */
export async function fetchXhhHot(topicId = XHH_TOPIC_ID, limit = 20): Promise<HotListItem[]> {
  const result = await requestJson('/bbs/app/topic/feeds', {
    topic_id: topicId,
    offset: 0,
    limit,
    lastval: '',
    sort_filter: 'hot-rank',
    dw: 604,
  })

  const links: any[] = Array.isArray(result.links) ? result.links : []
  const mapped = links.map((item): HotListItem | null => {
      const linkId = item?.linkid ?? item?.link_id
      if (!linkId || !item?.title)
        return null
      // 帖子页：SPA 直接支持数字 linkid
      const url = `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`
      // ⚠️ 这里**不要**设 `label`：卡片行左侧的方块在有 label 时会显示「label 首字」而不是名次
      // （微博的 热/沸/新/爆 就是那个用法）。小黑盒每条都属于「盒友杂谈」，设了就会让每行都显示
      // 一个「盒」字、名次全被顶掉。板块名改放 desc。
      const topics = Array.isArray(item?.topics) ? item.topics : []
      const hashtags = Array.isArray(item?.hashtags) ? item.hashtags : []
      const topic = clean(topics[0]?.name || hashtags[0]?.name)

      return {
        id: String(linkId),
        title: clean(item.title),
        // 描述里带上作者与时间（卡片折叠时只看得到标题，展开后有上下文）
        desc: [topic, clean(item?.user?.username), clean(item.create_str), clean(item.description)].filter(Boolean).join(' · '),
        // 没有现成的"热度"字段，取评论数（比点赞更能代表讨论度）
        hot: Number(item.comment_num) || 0,
        url,
        mobileUrl: url,
      }
    })

  return mapped
    .filter((item): item is HotListItem => item !== null)
    // 按评论数降序，保证榜单头部稳定（接口的"智能排序"本身不是纯分数序）
    .sort((a, b) => Number(b.hot ?? 0) - Number(a.hot ?? 0))
    .slice(0, limit)
}

// ── 帖子详情：「分析此条」抓正文用 ────────────────────────────────────────────
// 帖子页 https://www.xiaoheihe.cn/app/bbs/link/{id} 是前端渲染的 SPA，直接抓 HTML
// 只能拿到空壳（实测可见正文约 13 字），因此这里走官方签名接口取详情：
//  - 旧端点 /bbs/web/link/detail 已被官方下线（非 APP 请求返回「请使用APP查看」）
//  - 现行端点 /bbs/app/link/tree/backend，详情在 result.link 中，字段与旧接口一致
//  - 实测**匿名可用**（不带 cookie 也 status=ok），所以本模块仍不读凭据文件
// 详见上游故障记录（get_post_detail 字段变更）

export interface XhhPostDetail {
  linkId: string
  title: string
  /** 正文（优先 link.text，纯图片帖退回 description） */
  text: string
  shareUrl?: string
}

/** @description: 从 URL 取小黑盒帖子 linkId（仅认 xiaoheihe.cn 及其子域；非小黑盒返回 null） */
export function xhhLinkIdFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== 'xiaoheihe.cn' && !host.endsWith('.xiaoheihe.cn'))
      return null

    // /app/bbs/link/190761173 或 /bbs/link/190761173
    const fromPath = /\/(?:bbs\/)?link\/(\d{5,})/.exec(u.pathname)
    if (fromPath)
      return fromPath[1]

    // 分享链接：/v3/bbs/app/api/web/share?link_id=190761173
    for (const key of ['link_id', 'linkid', 'linkId']) {
      const value = u.searchParams.get(key)
      if (value && /^\d{5,}$/.test(value))
        return value
    }
    return null
  }
  catch {
    return null
  }
}

/** @description: 把详情接口的 text 字段转成纯文本（它是 JSON 块数组，如 [{"text":"..."}]） */
function textFromBlocks(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value)
    return ''
  if (!value.startsWith('[') && !value.startsWith('{'))
    return value

  try {
    const parsed: unknown = JSON.parse(value)
    const blocks = Array.isArray(parsed) ? parsed : [parsed]
    return blocks
      .map((block) => {
        if (typeof block === 'string')
          return block
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string')
          return (block as { text: string }).text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .replace(/\[cube_[^\]]*\]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  catch {
    return value
  }
}

/** @description: 取小黑盒帖子详情（签名接口，匿名可用；出错会 throw） */
export async function fetchXhhPostDetail(linkId: string): Promise<XhhPostDetail> {
  const result = await requestJson('/bbs/app/link/tree/backend', {
    link_id: linkId,
    is_first: 1,
    page: 1,
    index: 1,
    limit: 1,
  })
  const link = result?.link
  if (!link)
    throw new Error('小黑盒接口未返回帖子详情（帖子可能已删除，或接口有变动）')

  return {
    linkId,
    title: clean(link.title),
    text: textFromBlocks(link.text) || clean(link.description),
    shareUrl: typeof link.share_url === 'string' ? link.share_url : undefined,
  }
}
