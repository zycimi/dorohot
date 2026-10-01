/*
 * @Description: 「用 App 打开」支持表（2026-09-15 新增，2026-09-16 按实证重写）
 *
 * 场景：手机上装了微博/B站/小黑盒等 App，点热榜里的标题时希望直接进 App。
 * 网页唤起 App 靠自定义 scheme，**没装 App 时浏览器不会有反馈**，
 * 所以调用方必须配回落（见 launchApp 的返回值）与「用浏览器打开」的出口。
 *
 * ⚠️ 三条硬经验（都是踩出来的）：
 *  1. **scheme 必须带路径**：裸 `sinaweibo://` 在真机上唤不起（用户实测"点了没反应"），
 *     要像官方分享/H5 那样带 host 或参数 —— `sinaweibo://searchall?q=…`、`sinaweibo://userinfo?uid=…`。
 *  2. **取值要有出处，别凭印象填**。下表每条都注明来源：
 *     - 微博 / B站 / 知乎 / 抖音 / 豆瓣：公开的 URL Scheme 收集（gist `chufeng/00213c049f92f82f966308a349d0da23`）
 *     - 小黑盒：从 xiaoheihe.cn 的 SPA 包里挖出的原样构造（`protocol_type:"openLink"`、`link_tag: 11`、
 *       `open_source:"/bbs/post_share"`，页面全局 `LINK_TAG = 11`）
 *  3. 表里**没有**的源（小红书/快手/头条/贴吧/虎扑/网易云/微信读书 等）**不弹提示**、直接走浏览器 ——
 *     没有可信的带参 scheme 时硬填多半"点了没反应"，不如不做。
 *     要加某个 App：从它的网页代码里挖出带参写法，再往表里加一行。
 */

export interface AppLinkContext {
  /** 该条目在站内的浏览器地址 */
  url: string
  /** 条目标题（用于只能按关键词跳转的 App） */
  title: string
}

interface AppLinkDef {
  /** 提示文案里展示的 App 名 */
  appName: string
  /** 由链接/标题拼出 App 内地址；拼不出返回 null（调用方就不弹提示） */
  build: (ctx: AppLinkContext) => string | null
}

/** 从 URL 里安全取 query 参数 */
function queryOf(url: string, key: string): string {
  try {
    return new URL(url).searchParams.get(key) || ''
  }
  catch {
    return ''
  }
}

/** 从 B 站链接里取 BV 号 */
function bvOf(url: string): string {
  const m = /(BV[0-9A-Za-z]{10})/.exec(url)
  return m ? m[1] : ''
}

/** 从微博帖链接里取作者 uid（https://weibo.com/{uid}/{mid}） */
function weiboUidOf(url: string): string {
  const m = /weibo\.com\/(\d{5,})\/\d+/.exec(url)
  return m ? m[1] : ''
}

/** 从小黑盒链接里取数字 linkid */
function xhhLinkIdOf(url: string): string {
  const m = /\/bbs\/link\/(\d+)/.exec(url)
  return m ? m[1] : ''
}

const APP_LINKS: Record<string, AppLinkDef> = {
  // 热搜榜的链接本身就是 s.weibo.com 的搜索页，直接把关键词交给 App 的搜索
  'weibo': {
    appName: '微博',
    build: ({ url, title }) => {
      const kw = queryOf(url, 'q') || title
      return kw ? `sinaweibo://searchall?q=${encodeURIComponent(kw)}` : null
    },
  },
  // 关注流是具体帖子（weibo.com/uid/mid）。微博没有公开的"看某条微博"scheme，
  // 落到作者主页（`userinfo?uid=`，写法同样出自那份 gist）；拼不出 uid 时退回按标题搜索
  'weibo-friends': {
    appName: '微博',
    build: ({ url, title }) => {
      const uid = weiboUidOf(url)
      if (uid)
        return `sinaweibo://userinfo?uid=${uid}`
      return title ? `sinaweibo://searchall?q=${encodeURIComponent(title)}` : null
    },
  },
  'bilibili': {
    appName: '哔哩哔哩',
    build: ({ url, title }) => {
      const bv = bvOf(url)
      if (bv)
        return `bilibili://video/${bv}`
      return title ? `bilibili://search?keyword=${encodeURIComponent(title)}` : null
    },
  },
  'zhihu': {
    appName: '知乎',
    build: ({ title }) => (title ? `zhihu://search?q=${encodeURIComponent(title)}` : null),
  },
  'douyin': {
    appName: '抖音',
    build: ({ title }) => (title ? `snssdk1128://search/tabs?keyword=${encodeURIComponent(title)}` : null),
  },
  'douban-movic': {
    appName: '豆瓣',
    build: ({ title }) => (title ? `douban:///search?q=${encodeURIComponent(title)}` : null),
  },
  // 小黑盒：scheme + URL 编码的协议 JSON（照抄站内分享按钮的构造）
  'xhh': {
    appName: '小黑盒',
    build: ({ url }) => {
      const linkId = xhhLinkIdOf(url)
      if (!linkId)
        return null
      const protocol = {
        protocol_type: 'openLink',
        link: { link_tag: 11, linkid: Number(linkId), use_concept_type: 0, has_video: 0 },
        open_source: '/bbs/post_share',
        page_identifier: JSON.stringify({ link_id: Number(linkId) }),
      }
      return `heybox://${encodeURIComponent(JSON.stringify(protocol))}`
    },
  },
}

/** 该数据源有没有可用的 App 唤起方式；没有就返回 null（调用方直接走浏览器） */
export function appLinkFor(sourceValue: string, url: string, title = ''): { appName: string, href: string } | null {
  const entry = APP_LINKS[sourceValue]
  if (!entry)
    return null
  const href = entry.build({ url, title })
  if (!href)
    return null
  return { appName: entry.appName, href }
}

// ── 打开偏好（全局，可在「热榜设置」里改） ──────────────────────────────────────

export type AppOpenPref = 'ask' | 'app' | 'browser'

export const APP_OPEN_PREF_OPTIONS: { value: AppOpenPref, label: string }[] = [
  { value: 'ask', label: '每次询问' },
  { value: 'app', label: '优先 App' },
  { value: 'browser', label: '只用浏览器' },
]

const PREF_KEY = 'app-open-pref'

export function getAppOpenPref(): AppOpenPref {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (raw === 'app' || raw === 'browser' || raw === 'ask')
      return raw
  }
  catch {
    // 隐私模式等场景读不到 localStorage，按默认处理
  }
  return 'ask'
}

export function setAppOpenPref(pref: AppOpenPref): void {
  try {
    localStorage.setItem(PREF_KEY, pref)
  }
  catch {
    // 写不进去也不影响本次会话
  }
}

/**
 * @description: 尝试唤起 App
 *  - 返回 `true` 表示**大概率没唤起成功**（页面仍可见），调用方据此给出"用浏览器打开"的回落
 *  - 没装 App 时浏览器既不报错也不跳转，只能在超时后靠页面可见性判断
 *
 * ⚠️ **必须是顶层导航（`location.href`），不能用隐藏 iframe**：
 * 手机浏览器只认「用户手势触发的顶层导航」来唤起外部 App，**iframe 发起的唤起会被静默忽略**——
 * 表现就是点了没反应、只能看到回落提示。上面那句"iframe 更安全"的说法只在无头浏览器里成立
 * （那里 `location.href` 会让 CDP 输入事件停摆，是测试环境的假象，真机不受影响）。
 * 本函数由点击处理器**同步调用**，手势尚未失效，因此顶层导航是被允许的。
 */
export function launchApp(href: string, waitMs = 1600): Promise<boolean> {
  if (typeof window === 'undefined')
    return Promise.resolve(true)

  let leftPage = false
  const markLeft = () => {
    leftPage = true
  }
  document.addEventListener('visibilitychange', markLeft, { once: true })
  window.addEventListener('pagehide', markLeft, { once: true })

  try {
    window.location.href = href
  }
  catch {
    // 少数浏览器对未知 scheme 会抛错，按"没唤起"处理
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      document.removeEventListener('visibilitychange', markLeft)
      window.removeEventListener('pagehide', markLeft)
      resolve(!leftPage && document.visibilityState === 'visible')
    }, waitMs)
  })
}
