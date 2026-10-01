/*
 * @Description: 站点认证（单管理员用户名 + 密码）——服务端实现
 *
 * 设计（2026-10-01）：
 *  - 账号模型：**单管理员**（用户名 + 密码）。密码用 `scrypt` 加盐哈希后落盘，不存明文。
 *  - 存储：项目内 `data/auth.json`（可用 `DOROHOT_AUTH_FILE` 覆盖）。沿用 app-store 的
 *    「保存前 .bak + 原子写」模式；该文件已被 `.gitignore` 的 `/data/` 与打包器 exclude 排除，绝不进交付包/公开仓库。
 *  - 会话：HMAC-SHA256 签名的无状态 token，放在 httpOnly Cookie（`dorohot_session`）。
 *    签名密钥优先取环境变量 `DOROHOT_AUTH_SECRET`，否则用 auth.json 内自动生成的 `secret`。
 *  - 生效范围见 `auth-guard.ts` / 各页面：首页公开，管理页与写配置接口需登录。
 *  - 本模块只在 **Node 运行时** 使用（依赖 node:crypto / node:fs）；不使用 middleware，
 *    避免依赖 Next 的实验性 Node 中间件。
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { cookies } from 'next/headers'

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'dorohot_session'
/** 会话有效期：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthFile {
  /** 管理员用户名 */
  username: string
  /** 口令哈希：scrypt$<saltB64>$<hashB64> */
  passwordHash: string
  /** 会话签名密钥（hex）；若设置了 DOROHOT_AUTH_SECRET 则以环境变量为准 */
  secret: string
  /** 最近更新时间（ISO） */
  updatedAt: string
  /** 该时间点（ms）之前签发的会话全部失效（用于「退出所有设备」/ 改密） */
  revokedBefore: number
}

export interface AdminSession {
  username: string
  /** 签发时间（ms） */
  iat: number
}

function authFilePath(): string {
  return process.env.DOROHOT_AUTH_FILE || join(process.cwd(), 'data', 'auth.json')
}

export function authInfo(): { file: string, initialized: boolean, username: string | null, updatedAt: string | null } {
  const a = readAuth()
  return {
    file: authFilePath(),
    initialized: !!(a?.username && a?.passwordHash),
    username: a?.username ?? null,
    updatedAt: a?.updatedAt ?? null,
  }
}

/** @description: 读配置；不存在/损坏返回 null（调用方按「未初始化」处理） */
export function readAuth(): AuthFile | null {
  try {
    const file = authFilePath()
    if (!existsSync(file))
      return null
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as Partial<AuthFile>
    if (!parsed || typeof parsed !== 'object')
      return null
    return {
      username: typeof parsed.username === 'string' ? parsed.username : '',
      passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '',
      secret: typeof parsed.secret === 'string' ? parsed.secret : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      revokedBefore: typeof parsed.revokedBefore === 'number' ? parsed.revokedBefore : 0,
    }
  }
  catch {
    return null
  }
}

/** @description: 原子写盘（保存前 .bak，与 app-store 一致） */
function writeAuth(next: AuthFile): AuthFile {
  const file = authFilePath()
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

export function isInitialized(): boolean {
  return authInfo().initialized
}

/** scrypt 加盐哈希：scrypt$<saltB64>$<hashB64> */
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt')
    return false
  try {
    const expected = Buffer.from(parts[2], 'base64')
    const actual = scryptSync(password, Buffer.from(parts[1], 'base64'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  catch {
    return false
  }
}

function signingSecret(): string {
  const env = (process.env.DOROHOT_AUTH_SECRET || '').trim()
  if (env)
    return env
  return readAuth()?.secret || ''
}

function signBody(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url')
}

/** @description: 校验用户名 + 密码（常量时间比较；用户名也做长度安全比较） */
export function verifyCredentials(username: string, password: string): boolean {
  const a = readAuth()
  if (!a || !a.username || !a.passwordHash)
    return false
  const u = Buffer.from(username)
  const eu = Buffer.from(a.username)
  const userOk = u.length === eu.length && timingSafeEqual(u, eu)
  const passOk = verifyPassword(password, a.passwordHash)
  return userOk && passOk
}

/** @description: 签发会话 token；密钥缺失（未初始化）返回 null */
export function createSessionToken(username: string): string | null {
  const key = signingSecret()
  if (!key)
    return null
  const now = Date.now()
  const body = Buffer.from(JSON.stringify({ u: username, iat: now, exp: now + SESSION_TTL_MS })).toString('base64url')
  return `${body}.${signBody(body, key)}`
}

/** @description: 校验会话 token；无效/过期/被吊销返回 null */
export function verifySessionToken(token?: string | null): AdminSession | null {
  if (!token)
    return null
  const key = signingSecret()
  if (!key)
    return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0)
    return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expect = signBody(body, key)
  const sb = Buffer.from(sig)
  const eb = Buffer.from(expect)
  if (sb.length !== eb.length || !timingSafeEqual(sb, eb))
    return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: string, iat?: number, exp?: number }
    if (!payload.u || typeof payload.iat !== 'number' || typeof payload.exp !== 'number')
      return null
    if (Date.now() > payload.exp)
      return null
    const a = readAuth()
    if (a && a.revokedBefore && payload.iat < a.revokedBefore)
      return null
    return { username: payload.u, iat: payload.iat }
  }
  catch {
    return null
  }
}

/** @description: 从请求 Cookie 取当前会话（服务端组件 / 路由处理器通用） */
export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}

export interface CookieOptions {
  httpOnly: true
  sameSite: 'lax'
  path: string
  secure: boolean
  maxAge: number
}

/** @description: 会话 Cookie 选项。局域网 http 下 secure 必须为 false，否则浏览器不回传。 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: (process.env.DOROHOT_AUTH_SECURE || '') === '1',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}

/** @description: 初始化管理员（仅在未初始化时由 /api/auth/setup 调用） */
export function setupAdmin(username: string, password: string): AuthFile {
  const next: AuthFile = {
    username,
    passwordHash: hashPassword(password),
    secret: (process.env.DOROHOT_AUTH_SECRET || '').trim() || randomBytes(32).toString('hex'),
    updatedAt: new Date().toISOString(),
    revokedBefore: 0,
  }
  return writeAuth(next)
}

/** @description: 修改密码；同时吊销此前所有会话（调用方需给当前用户补发新 Cookie） */
export function changePassword(password: string): void {
  const a = readAuth()
  if (!a)
    throw new Error('尚未初始化管理员')
  writeAuth({
    ...a,
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString(),
    revokedBefore: Date.now(),
  })
}

/** @description: 吊销所有会话（退出所有设备） */
export function revokeAllSessions(): void {
  const a = readAuth()
  if (!a)
    return
  writeAuth({ ...a, revokedBefore: Date.now(), updatedAt: new Date().toISOString() })
}
