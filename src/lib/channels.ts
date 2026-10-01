/*
 * @Description: 远程接入 · 消息推送渠道（飞书 / 钉钉 / 企业微信群机器人）
 *
 * 参考开源社区通行做法（各家自定义机器人的官方协议）：
 *  - 飞书：POST https://open.feishu.cn/open-apis/bot/v2/hook/<token>
 *      body { msg_type:'text', content:{ text } }；开启签名时附带
 *      timestamp(秒) 与 sign = base64(HMAC-SHA256(key = `${timestamp}\n${secret}`, data = ''))
 *  - 钉钉：POST https://oapi.dingtalk.com/robot/send?access_token=<token>
 *      body { msgtype:'text', text:{ content } }；开启加签时在 URL 追加
 *      timestamp(毫秒) 与 sign = urlencode(base64(HMAC-SHA256(key = secret, data = `${timestamp}\n${secret}`)))
 *  - 企业微信：POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>
 *      body { msgtype:'markdown', markdown:{ content } }（markdown 上限 4096 字节，故做截断）
 *
 * 存储：项目内 `data/channels.json`（可用 `DOROHOT_CHANNELS_FILE` 覆盖），原子写 + .bak；
 * 已被 .gitignore 与打包器 exclude 排除。Webhook 与 secret 属敏感信息，接口只回掩码。
 */
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ChannelId = 'feishu' | 'dingtalk' | 'wecom'

export interface ChannelConfig {
  enabled: boolean
  /** 机器人 Webhook 完整地址（含 token/key） */
  webhook: string
  /** 签名密钥（飞书签名校验 / 钉钉加签） */
  secret: string
  /** 是否随「邮件订阅」定时任务一起推送 */
  withSubscription: boolean
}

export type ChannelsStore = Record<ChannelId, ChannelConfig>

export interface ChannelPublic {
  enabled: boolean
  hasWebhook: boolean
  webhookMasked: string
  hasSecret: boolean
  withSubscription: boolean
}

export interface PushResult {
  id: ChannelId
  ok: boolean
  error?: string
}

export const CHANNEL_META: { id: ChannelId, label: string, needsSecret: boolean, secretLabel: string, hint: string }[] = [
  {
    id: 'feishu',
    label: '飞书群机器人',
    needsSecret: true,
    secretLabel: '签名密钥（可选）',
    hint: '飞书群 → 设置 → 群机器人 → 添加「自定义机器人」，复制 Webhook 地址；若开了「签名校验」再填密钥。',
  },
  {
    id: 'dingtalk',
    label: '钉钉群机器人',
    needsSecret: true,
    secretLabel: '加签密钥（可选）',
    hint: '钉钉群 → 智能群助手 → 添加机器人「自定义」，安全设置里选「加签」时把密钥填这里（URL 里已含 access_token）。',
  },
  {
    id: 'wecom',
    label: '企业微信群机器人',
    needsSecret: false,
    secretLabel: '',
    hint: '企业微信群 → 群机器人 → 添加「新机器人」，复制 Webhook（形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx）。',
  },
]

const CHANNEL_IDS: ChannelId[] = ['feishu', 'dingtalk', 'wecom']

function channelFile(): string {
  return process.env.DOROHOT_CHANNELS_FILE || join(process.cwd(), 'data', 'channels.json')
}

export function channelsFilePath(): string {
  return channelFile()
}

function emptyChannel(): ChannelConfig {
  return { enabled: false, webhook: '', secret: '', withSubscription: false }
}

export function emptyChannels(): ChannelsStore {
  return { feishu: emptyChannel(), dingtalk: emptyChannel(), wecom: emptyChannel() }
}

export function readChannels(): ChannelsStore {
  try {
    const file = channelFile()
    if (!existsSync(file))
      return emptyChannels()
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return emptyChannels()
    const parsed = JSON.parse(raw) as Partial<Record<ChannelId, Partial<ChannelConfig>>>
    const out = emptyChannels()
    for (const id of CHANNEL_IDS) {
      const c = parsed?.[id]
      if (!c || typeof c !== 'object')
        continue
      out[id] = {
        enabled: c.enabled === true,
        webhook: typeof c.webhook === 'string' ? c.webhook.trim() : '',
        secret: typeof c.secret === 'string' ? c.secret.trim() : '',
        withSubscription: c.withSubscription === true,
      }
    }
    return out
  }
  catch {
    return emptyChannels()
  }
}

function writeChannels(next: ChannelsStore): ChannelsStore {
  const file = channelFile()
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

/** 掩码：只露结尾几位，够识别即可（Webhook 泄露等于把群发言权交出去） */
function maskWebhook(url: string): string {
  if (!url)
    return ''
  if (url.length <= 10)
    return '••••'
  return `…${url.slice(-6)}`
}

export function maskChannels(store: ChannelsStore = readChannels()): Record<ChannelId, ChannelPublic> {
  const out = {} as Record<ChannelId, ChannelPublic>
  for (const id of CHANNEL_IDS) {
    const c = store[id]
    out[id] = {
      enabled: c.enabled,
      hasWebhook: !!c.webhook,
      webhookMasked: maskWebhook(c.webhook),
      hasSecret: !!c.secret,
      withSubscription: c.withSubscription,
    }
  }
  return out
}

/**
 * @description: 合并保存（按渠道逐个 merge）
 *  - webhook / secret 传空字符串 = 保持原值（与「API Key 留空不改」一致）
 *  - 传 `clearWebhook` / `clearSecret` 可显式清空
 */
export function updateChannels(patch: Partial<Record<ChannelId, Partial<ChannelConfig> & { clearWebhook?: boolean, clearSecret?: boolean }>>): ChannelsStore {
  const store = readChannels()
  for (const id of CHANNEL_IDS) {
    const p = patch?.[id]
    if (!p || typeof p !== 'object')
      continue
    const cur = store[id]
    const webhook = p.clearWebhook ? '' : (typeof p.webhook === 'string' && p.webhook.trim() ? p.webhook.trim() : cur.webhook)
    const secret = p.clearSecret ? '' : (typeof p.secret === 'string' && p.secret.trim() ? p.secret.trim() : cur.secret)
    store[id] = {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : cur.enabled,
      webhook,
      secret,
      withSubscription: typeof p.withSubscription === 'boolean' ? p.withSubscription : cur.withSubscription,
    }
  }
  return writeChannels(store)
}

// ---------------------------------------------------------------------------
// 发送
// ---------------------------------------------------------------------------

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? JSON.parse(text) : {}
  }
  catch {
    json = { raw: text }
  }
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`)
  return json
}

/** 企业微信 markdown 上限 4096 字节，中文约 3 字节/字，按字符截断留余量 */
function truncateForWecom(text: string, maxChars = 1300): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（内容过长已截断）` : text
}

async function sendFeishu(cfg: ChannelConfig, text: string): Promise<void> {
  const body: Record<string, unknown> = { msg_type: 'text', content: { text } }
  if (cfg.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const sign = createHmac('sha256', `${timestamp}\n${cfg.secret}`).update('').digest('base64')
    body.timestamp = timestamp
    body.sign = sign
  }
  const json = await postJson(cfg.webhook, body)
  const code = (json.code ?? json.StatusCode ?? json.status_code) as number | undefined
  if (code !== undefined && code !== 0)
    throw new Error(`飞书返回 code=${code} msg=${json.msg ?? json.StatusMessage ?? ''}`)
}

async function sendDingtalk(cfg: ChannelConfig, text: string): Promise<void> {
  let url = cfg.webhook
  if (cfg.secret) {
    const timestamp = Date.now().toString()
    const sign = encodeURIComponent(createHmac('sha256', cfg.secret).update(`${timestamp}\n${cfg.secret}`).digest('base64'))
    url += `${url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${sign}`
  }
  const json = await postJson(url, { msgtype: 'text', text: { content: text } })
  const code = json.errcode as number | undefined
  if (code !== undefined && code !== 0)
    throw new Error(`钉钉返回 errcode=${code} errmsg=${json.errmsg ?? ''}`)
}

async function sendWecom(cfg: ChannelConfig, text: string): Promise<void> {
  const json = await postJson(cfg.webhook, { msgtype: 'markdown', markdown: { content: truncateForWecom(text) } })
  const code = json.errcode as number | undefined
  if (code !== undefined && code !== 0)
    throw new Error(`企业微信返回 errcode=${code} errmsg=${json.errmsg ?? ''}`)
}

/** @description: 发送到指定渠道集合（未配置 webhook 的跳过并标记失败原因） */
export async function sendToChannels(text: string, ids: ChannelId[] = CHANNEL_IDS, store: ChannelsStore = readChannels()): Promise<PushResult[]> {
  const targets = ids.filter(id => store[id]?.enabled)
  return Promise.all(targets.map(async (id): Promise<PushResult> => {
    const cfg = store[id]
    if (!cfg.webhook)
      return { id, ok: false, error: '未配置 Webhook' }
    try {
      if (id === 'feishu')
        await sendFeishu(cfg, text)
      else if (id === 'dingtalk')
        await sendDingtalk(cfg, text)
      else
        await sendWecom(cfg, text)
      return { id, ok: true }
    }
    catch (e) {
      return { id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }))
}

/** @description: 随邮件订阅定时推送的渠道 id */
export function subscriptionChannelIds(store: ChannelsStore = readChannels()): ChannelId[] {
  return CHANNEL_IDS.filter(id => store[id]?.enabled && store[id]?.withSubscription)
}

export function channelLabel(id: ChannelId): string {
  return CHANNEL_META.find(m => m.id === id)?.label || id
}

// ---------------------------------------------------------------------------
// 摘要文本（三家通用：纯文本对飞书/钉钉 text 与企微 markdown 都能正常显示）
// ---------------------------------------------------------------------------

export interface DigestSource {
  label: string
  items: { title: string, url?: string, desc?: string }[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDigestTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * @description: 组装推送用的热榜摘要
 *  - titlesOnly=true 时只给标题（用于订阅定时推送，控制长度）
 *  - aiAnalysis 截断到 ~600 字，避免超过企微 markdown 上限
 */
export function formatChannelDigest(
  sources: DigestSource[],
  analysis: string,
  ts: number,
  { test = false, titlesOnly = false }: { test?: boolean, titlesOnly?: boolean } = {},
): string {
  const used = sources.filter(s => s.items.length)
  const total = used.reduce((n, s) => n + s.items.length, 0)
  const lines: string[] = []
  lines.push(`${test ? '[测试] ' : ''}doroHot 热榜 · ${formatDigestTime(ts)}`)
  lines.push(`共 ${used.length} 个源 / ${total} 条`)
  lines.push('')
  for (const block of used) {
    lines.push(`【${block.label}】`)
    block.items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`)
      if (!titlesOnly && item.url)
        lines.push(`   ${item.url}`)
    })
    lines.push('')
  }
  if (analysis) {
    const brief = analysis.length > 600 ? `${analysis.slice(0, 600)}…` : analysis
    lines.push('-- AI 分析 --', brief, '')
  }
  lines.push('由 doroHot 远程接入推送')
  return lines.join('\n')
}
