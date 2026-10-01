/*
 * @Description: 登录页客户端——首次访问（未初始化）时切换为「创建管理员」表单
 */
'use client'

import Image from 'next/image'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

function safeNext(): string {
  if (typeof window === 'undefined')
    return '/admin'
  const n = new URLSearchParams(window.location.search).get('next')
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/admin'
}

export default function LoginClient({ initialized: initialInitialized }: { initialized: boolean }) {
  const router = useRouter()
  const [initialized, setInitialized] = useState<boolean | null>(initialInitialized)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then((j) => {
        const data = j?.data ?? {}
        if (data.authenticated) {
          router.replace(safeNext())
          return
        }
        setInitialized(!!data.initialized)
      })
      .catch(() => setInitialized(true))
  }, [router])

  const isSetup = initialized === false

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError('请输入用户名和密码')
      return
    }
    if (isSetup && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(isSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.msg || '操作失败，请重试')
        return
      }
      router.replace(safeNext())
      router.refresh()
    }
    catch {
      setError('网络错误，请重试')
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <Image alt="doroHot" height={28} src="/logo.svg" width={28} />
          <span className="auth-title">{isSetup ? '创建管理员' : '管理登录'}</span>
        </div>
        <p className="auth-sub">
          {isSetup
            ? '首次使用：请设置管理员账号与密码。设置完成后即可进入后台管理。'
            : '请输入管理员账号与密码以进入设置与后台。'}
        </p>

        {isSetup && (
          <div className="auth-hint">
            该站点尚未初始化。公网部署时请尽快完成初始化，避免被他人抢先设置。
          </div>
        )}

        <div className="auth-field">
          <label className="auth-label" htmlFor="username">用户名</label>
          <input
            id="username"
            className="auth-input"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin"
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">密码</label>
          <input
            id="password"
            className="auth-input"
            type="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={isSetup ? '至少 6 位' : ''}
          />
        </div>

        {isSetup && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="confirm">确认密码</label>
            <input
              id="confirm"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
          </div>
        )}

        <div className="auth-error">{error}</div>

        <button className="auth-btn" type="submit" disabled={busy || initialized === null}>
          {busy ? '处理中…' : isSetup ? '创建并登录' : '登录'}
        </button>

        <div className="auth-foot">
          <NextLink href="/">返回首页</NextLink>
        </div>
      </form>
    </div>
  )
}
