/*
 * @Description: 后台客户端——概览 / 管理入口 / 修改密码 / 退出登录
 */
'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { formatLocalDateTime } from '@/lib/format'

import type { FormEvent } from 'react'

interface Overview {
  version: string
  buildId: string | null
  node: string
  uptimeSec: number
  sourceCount: number
  cookieSourceCount: number
  aiConfigured: boolean
  appStoreExists: boolean
  subscriptionExists: boolean
  authFile: string
  authUsername: string | null
  authUpdatedAt: string | null
}

const LINKS: { href: string, t: string, d: string }[] = [
  { href: '/settings?section=model', t: 'AI 模型配置', d: '供应商 / 模型 / API Key' },
  { href: '/settings?section=web-search', t: '联网搜索', d: 'Exa / Firecrawl / Parallel / Tavily / Bing RSS / Google CSE' },
  { href: '/settings?section=subscription', t: '邮件订阅', d: '频率 / 收件邮箱 / SMTP 服务器' },
  { href: '/settings?section=navigation', t: '导航 / 数据源', d: '导航位置、数据源排序与隐藏（按设备）' },
  { href: '/cookies', t: '凭据（Cookies）管理', d: '5 源导入、检测登录态' },
  { href: '/', t: '返回首页', d: '查看热榜与首页设置' },
]

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0)
    return `${d} 天 ${h} 小时`
  if (h > 0)
    return `${h} 小时 ${m} 分`
  return `${m} 分 ${sec % 60} 秒`
}

export default function AdminClient({ username }: { username: string }) {
  const router = useRouter()
  const [ov, setOv] = useState<Overview | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setOv(j?.data ?? null))
      .catch(() => setOv(null))
  }, [])

  useEffect(load, [load])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.replace('/login')
    router.refresh()
  }

  const logoutAll = async () => {
    if (!window.confirm('确定要退出所有设备的登录吗？'))
      return
    await fetch('/api/auth/logout-all', { method: 'POST' }).catch(() => {})
    router.replace('/login')
    router.refresh()
  }

  const changePw = async (e: FormEvent) => {
    e.preventDefault()
    setMsg('')
    setErr('')
    if (!current || !next) {
      setErr('请输入当前密码与新密码')
      return
    }
    if (next !== confirm) {
      setErr('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current, next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(j?.msg || '修改失败')
        return
      }
      setMsg('密码已更新')
      setCurrent('')
      setNext('')
      setConfirm('')
      load()
    }
    catch {
      setErr('网络错误，请重试')
    }
    finally {
      setBusy(false)
    }
  }

  const cards = ov
    ? [
        { k: '版本', v: ov.version },
        { k: '构建 ID', v: ov.buildId ?? '（未构建）' },
        { k: 'Node', v: ov.node },
        { k: '已运行', v: fmtUptime(ov.uptimeSec) },
        { k: '数据源', v: `${ov.sourceCount} 个` },
        { k: '凭据源', v: `${ov.cookieSourceCount} 个` },
        { k: 'AI 配置', v: ov.aiConfigured ? '已配置' : '未配置' },
        { k: '首页配置', v: ov.appStoreExists ? '已保存' : '默认' },
        { k: '邮件订阅', v: ov.subscriptionExists ? '已保存' : '未配置' },
      ]
    : []

  return (
    <div className="admin-page">
      <div className="admin-head">
        <div>
          <h2>管理后台</h2>
          <div className="admin-user">
            当前用户：
            <strong>{username}</strong>
            {ov?.authUpdatedAt ? ` · 凭据更新于 ${formatLocalDateTime(ov.authUpdatedAt)}` : ''}
          </div>
        </div>
        <div className="admin-head-actions">
          <NextLink className="admin-link" style={{ padding: '8px 12px' }} href="/">首页</NextLink>
          <button className="auth-btn secondary" style={{ width: 'auto', padding: '0 14px', marginTop: 0 }} type="button" onClick={logout}>退出登录</button>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-title">运行概览</div>
        <div className="admin-grid">
          {cards.length > 0
            ? cards.map(c => (
                <div className="admin-card" key={c.k}>
                  <div className="k">{c.k}</div>
                  <div className="v">{c.v}</div>
                </div>
              ))
            : <div className="admin-card"><div className="k">加载中…</div></div>}
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-title">管理入口</div>
        <div className="admin-links">
          {LINKS.map(l => (
            <NextLink className="admin-link" key={l.href} href={l.href}>
              <span className="t">{l.t}</span>
              <span className="d">{l.d}</span>
            </NextLink>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-title">修改密码 / 会话</div>
        <div className="admin-panel">
          <form onSubmit={changePw}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="cur">当前密码</label>
              <input id="cur" className="auth-input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="new">新密码</label>
              <input id="new" className="auth-input" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder="至少 6 位" />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="cfm">确认新密码</label>
              <input id="cfm" className="auth-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            <div className="auth-error">{err || (msg ? '' : '')}{msg && <span style={{ color: 'var(--success-foreground)' }}>{msg}</span>}</div>
            <div className="auth-btn-row">
              <button className="auth-btn" style={{ maxWidth: 200 }} type="submit" disabled={busy}>{busy ? '保存中…' : '更新密码'}</button>
              <button className="auth-btn secondary" style={{ maxWidth: 200 }} type="button" onClick={logoutAll}>退出所有设备</button>
            </div>
          </form>
        </div>
      </div>

      {ov && (
        <div className="admin-section">
          <div className="admin-section-title">存储位置（本机）</div>
          <div className="admin-panel" style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all', lineHeight: 1.8 }}>
            <div>认证文件：{ov.authFile}</div>
          </div>
        </div>
      )}
    </div>
  )
}
