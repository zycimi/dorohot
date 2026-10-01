/*
 * @Description: 邮箱订阅配置（服务端落盘 `data/subscription.json`，可用 SUBSCRIPTION_FILE 覆盖）
 *
 *  - 订阅间隔按 分钟 / 小时 / 天 三档设计；**一天固定按 24 小时 = 1440 分钟**计算
 *  - SMTP 密码只落本机文件，接口只回掩码；保存时提交空/掩码则保留原密码
 *  - 原子写 + 保存前 .bak，与 site-config / app-store 一致；该文件不进交付包
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SubscriptionUnit = 'minute' | 'hour' | 'day'

export interface SubscriptionSmtp {
  host: string
  port: number
  /** true = 直接 SSL（一般 465）；false = 明文/STARTTLS（一般 25/587） */
  secure: boolean
  user: string
  pass: string
  /** 发件人；留空则用用户名 */
  from: string
}

export interface SubscriptionConfig {
  enabled: boolean
  email: string
  /** 间隔数量（>=1） */
  interval: number
  unit: SubscriptionUnit
  /** 选中的数据源 alias；空数组 = 全部 */
  sources: string[]
  perSource: number
  /** 是否在邮件里附带 AI 自动分析 */
  aiAnalysis: boolean
  /** 是否按「每天定点 HH:MM」发送（优先于间隔与时间窗口） */
  dailyAtEnabled: boolean
  /** 每天定点发送时刻（HH:MM，24 小时制） */
  dailyAt: string
  /** 每周定点：是否启用（与 monthly/dailyAt/interval 择一；调度优先级 monthly > weekly > dailyAt > 按间隔） */
  weeklyEnabled: boolean
  /** 每周几，0=周日 … 6=周六，去重升序，取值 0-6 */
  weekDays: number[]
  /** 每周定点的时刻 HH:MM */
  weeklyAt: string
  /** 每月定点：是否启用 */
  monthlyEnabled: boolean
  /** 每月几号，去重升序，取值 1-31（当月无该日则跳过，顺延到下个有该日的月份） */
  monthDays: number[]
  /** 每月定点的时刻 HH:MM */
  monthlyAt: string
  /** 是否只在每天的时间窗口内发送（仅「按间隔」模式生效；日历定点模式忽略） */
  windowEnabled: boolean
  /** 时间窗口起（HH:MM，24 小时制，含） */
  windowStart: string
  /** 时间窗口止（HH:MM，24 小时制，含；起=止 视为全天） */
  windowEnd: string
  smtp: SubscriptionSmtp
  lastSentAt: number
  lastStatus: string
}

/** 一天固定 24 小时（= 1440 分钟） */
export const MINUTES_PER_DAY = 24 * 60
const UNIT_MINUTES: Record<SubscriptionUnit, number> = { minute: 1, hour: 60, day: MINUTES_PER_DAY }
const MAX_INTERVAL = 10080 // 7 天，避免写出荒谬值

export function isSubscriptionUnit(value: unknown): value is SubscriptionUnit {
  return value === 'minute' || value === 'hour' || value === 'day'
}

/** @description: 间隔换算成分钟（day 按 1440 分钟） */
export function intervalMinutes(interval: unknown, unit: SubscriptionUnit): number {
  const n = Math.min(MAX_INTERVAL, Math.max(1, Math.floor(Number(interval) || 1)))
  return n * UNIT_MINUTES[unit]
}

export function subscriptionFilePath(): string {
  return process.env.SUBSCRIPTION_FILE || join(process.cwd(), 'data', 'subscription.json')
}

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n))
    return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * @description: 规整「周几 / 几号」列表：仅接受数组，元素取整后落在 [min,max]，去重升序并限长
 *  - 非数组（含 undefined）沿用 base；空数组视为「未选」，由调用方按未启用处理
 */
function dayList(value: unknown, base: number[], min: number, max: number): number[] {
  if (!Array.isArray(value))
    return base
  const out = new Set<number>()
  for (const item of value) {
    const n = Math.floor(Number(item))
    if (Number.isFinite(n) && n >= min && n <= max)
      out.add(n)
  }
  return [...out].sort((a, b) => a - b).slice(0, max - min + 1)
}

export function defaultSubscription(): SubscriptionConfig {
  return {
    enabled: false,
    email: '',
    interval: 1,
    unit: 'hour',
    sources: [],
    perSource: 6,
    aiAnalysis: false,
    dailyAtEnabled: false,
    dailyAt: '09:00',
    weeklyEnabled: false,
    weekDays: [],
    weeklyAt: '09:00',
    monthlyEnabled: false,
    monthDays: [],
    monthlyAt: '09:00',
    windowEnabled: false,
    windowStart: '09:00',
    windowEnd: '18:00',
    smtp: { host: '', port: 465, secure: true, user: '', pass: '', from: '' },
    lastSentAt: 0,
    lastStatus: '',
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** @description: 解析 HH:MM 为「当天第几分钟」 */
function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** @description: 校验并规整 HH:MM（非法则回退） */
export function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && TIME_RE.test(value.trim()) ? value.trim() : fallback
}

/** @description: now 是否落在时间窗口内（含起止；起=止 视为全天；支持跨夜窗口） */
export function inWindow(config: Pick<SubscriptionConfig, 'windowEnabled' | 'windowStart' | 'windowEnd'>, now = Date.now()): boolean {
  if (!config.windowEnabled)
    return true
  const start = hmToMinutes(config.windowStart)
  const end = hmToMinutes(config.windowEnd)
  if (start === end)
    return true
  const d = new Date(now)
  const m = d.getHours() * 60 + d.getMinutes()
  return start < end ? (m >= start && m <= end) : (m >= start || m <= end)
}

/** @description: ts 之后（含）最近一次窗口开启时刻；已在窗口内则原样返回 */
function clampToWindow(config: Pick<SubscriptionConfig, 'windowEnabled' | 'windowStart' | 'windowEnd'>, ts: number): number {
  if (inWindow(config, ts))
    return ts
  const start = hmToMinutes(config.windowStart)
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  let next = d.getTime() + start * 60_000
  if (next <= ts)
    next += MINUTES_PER_DAY * 60_000
  return next
}

function normalizeSmtp(raw: unknown, base: SubscriptionSmtp): SubscriptionSmtp {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  return {
    host: input.host === undefined ? base.host : str(input.host, 200),
    port: input.port === undefined ? base.port : int(input.port, base.port, 1, 65535),
    secure: input.secure === undefined ? base.secure : !!input.secure,
    user: input.user === undefined ? base.user : str(input.user, 200),
    pass: input.pass === undefined ? base.pass : str(input.pass, 400),
    from: input.from === undefined ? base.from : str(input.from, 200),
  }
}

export function normalizeSubscription(raw: unknown, base: SubscriptionConfig = defaultSubscription()): SubscriptionConfig {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const sources = Array.isArray(input.sources)
    ? [...new Set(input.sources.map(s => str(s, 40)).filter(Boolean))].slice(0, 60)
    : base.sources
  return {
    enabled: input.enabled === undefined ? base.enabled : !!input.enabled,
    email: input.email === undefined ? base.email : str(input.email, 200),
    interval: input.interval === undefined ? base.interval : int(input.interval, base.interval, 1, MAX_INTERVAL),
    unit: isSubscriptionUnit(input.unit) ? input.unit : base.unit,
    sources,
    perSource: input.perSource === undefined ? base.perSource : int(input.perSource, base.perSource, 1, 20),
    aiAnalysis: input.aiAnalysis === undefined ? base.aiAnalysis : !!input.aiAnalysis,
    dailyAtEnabled: input.dailyAtEnabled === undefined ? base.dailyAtEnabled : !!input.dailyAtEnabled,
    dailyAt: input.dailyAt === undefined ? base.dailyAt : normalizeTime(input.dailyAt, base.dailyAt),
    weeklyEnabled: input.weeklyEnabled === undefined ? base.weeklyEnabled : !!input.weeklyEnabled,
    weekDays: dayList(input.weekDays, base.weekDays, 0, 6),
    weeklyAt: input.weeklyAt === undefined ? base.weeklyAt : normalizeTime(input.weeklyAt, base.weeklyAt),
    monthlyEnabled: input.monthlyEnabled === undefined ? base.monthlyEnabled : !!input.monthlyEnabled,
    monthDays: dayList(input.monthDays, base.monthDays, 1, 31),
    monthlyAt: input.monthlyAt === undefined ? base.monthlyAt : normalizeTime(input.monthlyAt, base.monthlyAt),
    windowEnabled: input.windowEnabled === undefined ? base.windowEnabled : !!input.windowEnabled,
    windowStart: input.windowStart === undefined ? base.windowStart : normalizeTime(input.windowStart, base.windowStart),
    windowEnd: input.windowEnd === undefined ? base.windowEnd : normalizeTime(input.windowEnd, base.windowEnd),
    smtp: normalizeSmtp(input.smtp, base.smtp),
    lastSentAt: input.lastSentAt === undefined ? base.lastSentAt : Math.max(0, Math.floor(Number(input.lastSentAt) || 0)),
    lastStatus: input.lastStatus === undefined ? base.lastStatus : str(input.lastStatus, 300),
  }
}

export function readSubscription(): SubscriptionConfig {
  try {
    const file = subscriptionFilePath()
    if (!existsSync(file))
      return defaultSubscription()
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return defaultSubscription()
    return normalizeSubscription(JSON.parse(raw))
  }
  catch {
    return defaultSubscription()
  }
}

/** @description: 合并写入（只覆盖传入字段）；`smtp.pass` 提交空/掩码时保留原密码 */
export function writeSubscription(patch: Record<string, unknown>): SubscriptionConfig {
  const file = subscriptionFilePath()
  const current = readSubscription()
  const next = normalizeSubscription(patch, current)

  const incomingSmtp = (patch.smtp && typeof patch.smtp === 'object' ? patch.smtp : null) as { pass?: unknown } | null
  if (incomingSmtp && (incomingSmtp.pass === undefined || incomingSmtp.pass === '' || /^•+$/.test(String(incomingSmtp.pass))))
    next.smtp.pass = current.smtp.pass

  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))

  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

/**
 * @description: 从今天零点起逐日扫描，找到第一个「匹配日 + at 时刻」且满足锚点条件的时间戳（0 = 找不到）
 *  - at = HH:MM 换算成当天第几分钟；扫描上限 800 天（约 2 年，足以覆盖任何月/周组合）
 *  - lastSentAt > 0：只接受严格晚于上次发送的时刻，保证不重发
 *  - lastSentAt === 0（从未发过）：当天该点即使已过也立即补发（与 dailyAt 的语义一致）
 */
function nextCalendarOccurrence(
  lastSentAt: number,
  matchesDay: (d: Date) => boolean,
  at: string,
  now: number,
): number {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const atMinutes = hmToMinutes(at)
  for (let i = 0; i <= 800; i++) {
    const d = new Date(startOfToday)
    d.setDate(d.getDate() + i)
    if (!matchesDay(d))
      continue
    const ts = d.getTime() + atMinutes * 60_000
    if (lastSentAt > 0 ? ts > lastSentAt : ts >= startOfToday.getTime())
      return ts
  }
  return 0
}

/**
 * @description: 是否处于「日历 / 每天定点」模式（与 nextSendAt 的优先级判定完全一致）
 *  - 空 weekDays / monthDays 不算启用，会落到下一档；`isDue` 必须用同一判据，否则会错误地忽略时间窗口
 */
export function isCalendarMode(
  config: Pick<SubscriptionConfig, 'dailyAtEnabled' | 'weeklyEnabled' | 'weekDays' | 'monthlyEnabled' | 'monthDays'>,
): boolean {
  if (config.monthlyEnabled && config.monthDays.length)
    return true
  if (config.weeklyEnabled && config.weekDays.length)
    return true
  return config.dailyAtEnabled
}

/**
 * @description: 计算下次发送时间（ms；0 = 未启用）
 *  - 日历定点优先级：每月 > 每周 > 每天定点 > 按间隔（日历/每天定点模式下忽略 interval 与时间窗口）
 *  - 按间隔：基础时刻 = lastSentAt + 间隔；未排期时用 now（表示立即）
 *  - 开了时间窗口时，把基础时刻夹进窗口：窗口内原样，窗口外顺延到下一个窗口开启时刻
 */
export function nextSendAt(config: SubscriptionConfig, now = Date.now()): number {
  if (!config.enabled)
    return 0
  // 「每月几号」优先：空数组视为未启用，落到下一档
  if (config.monthlyEnabled && config.monthDays.length) {
    return nextCalendarOccurrence(
      config.lastSentAt,
      d => config.monthDays.includes(d.getDate()),
      config.monthlyAt,
      now,
    )
  }
  // 「每周几」
  if (config.weeklyEnabled && config.weekDays.length) {
    return nextCalendarOccurrence(
      config.lastSentAt,
      d => config.weekDays.includes(d.getDay()),
      config.weeklyAt,
      now,
    )
  }
  // 「每天定点」优先：今天该点还没发过就今天，发过就明天
  if (config.dailyAtEnabled) {
    const at = hmToMinutes(config.dailyAt)
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    let candidate = d.getTime() + at * 60_000
    if (config.lastSentAt && config.lastSentAt >= candidate)
      candidate += MINUTES_PER_DAY * 60_000
    return candidate
  }
  const base = config.lastSentAt
    ? config.lastSentAt + intervalMinutes(config.interval, config.unit) * 60_000
    : now
  return clampToWindow(config, base)
}

/**
 * @description: 是否到期该发
 *  - 需要至少一个投递目标：邮件（email + smtp.host）或**远程接入渠道**（调用方用 `channelReady` 告知）
 *  - 首次 lastSentAt=0 时，窗口内立即到期，窗口外等下一个窗口；日历/定点模式到点即发，忽略窗口
 */
export function isDue(config: SubscriptionConfig, now = Date.now(), opts: { channelReady?: boolean } = {}): boolean {
  if (!config.enabled)
    return false
  const hasEmail = !!config.email && !!config.smtp.host
  if (!hasEmail && !opts.channelReady)
    return false
  // 时间窗口只约束「按间隔」模式；每天/每周/每月定点都忽略窗口
  if (!isCalendarMode(config) && !inWindow(config, now))
    return false
  const next = nextSendAt(config, now)
  return next > 0 && now >= next
}

/** @description: 给前端的视图（不回密码，只告诉有没有设置过） */
export function publicSubscription(config: SubscriptionConfig) {
  const minutes = intervalMinutes(config.interval, config.unit)
  return {
    ...config,
    smtp: { ...config.smtp, pass: '', hasPass: !!config.smtp.pass },
    intervalMinutes: minutes,
    nextSendAt: nextSendAt(config),
    configured: !!(config.email && config.smtp.host),
    file: subscriptionFilePath(),
  }
}
