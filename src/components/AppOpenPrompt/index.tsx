/*
 * @Description: 「用 App 打开」提示（移动端点击链接时弹出）
 *
 * 只在移动端由 OverflowDetector 触发：某个源有对应 App 时先问一句，而不是直接跳浏览器。
 *  - 两个出口：用 App 打开 / 在浏览器打开；另有「记住我的选择」（全局，可在热榜设置里改）
 *  - 唤起 App 用的是自定义 scheme，**没装 App 时浏览器不会有反馈**，
 *    所以唤起后 1.6s 仍停在页面上就切到「没打开？用浏览器打开」的提示态
 *  - 挂载点走 portalHost()：弹层打开时不能挂 body（会被 React Aria 标成 inert）
 */
'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { getAppOpenPref, launchApp, setAppOpenPref } from '@/lib/app-links'
import { portalHost } from '@/lib/portal-host'
import { useAppOpenStore } from '@/store/useAppOpenStore'

export default function AppOpenPrompt() {
  const target = useAppOpenStore(state => state.target)
  const failed = useAppOpenStore(state => state.failed)
  const markFailed = useAppOpenStore(state => state.markFailed)
  const close = useAppOpenStore(state => state.close)

  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  // Esc 关闭（与"点空白关闭"一致：不跳转，标题可再点）
  useEffect(() => {
    if (!target)
      return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])
  // 每次新目标出现时复位勾选
  useEffect(() => {
    setRemember(getAppOpenPref() !== 'ask')
    setBusy(false)
  }, [target])

  if (!mounted || !target)
    return null

  const openInBrowser = () => {
    if (remember)
      setAppOpenPref('browser')
    close()
    window.open(target.url, '_blank', 'noopener,noreferrer')
  }

  const openInApp = async () => {
    if (remember)
      setAppOpenPref('app')
    setBusy(true)
    const notOpened = await launchApp(target.href)
    setBusy(false)
    if (notOpened)
      markFailed()
    else
      close()
  }

  return createPortal(
    <>
      {/* 点空白处 = 什么都不做（标题还能再点），避免误跳 */}
      <div
        className="fixed inset-0 bg-overlay/30"
        style={{ zIndex: 'calc(var(--z-index-overlay, 100000) + 3)' }}
        onClick={close}
      />
      <div
        className="fixed inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ zIndex: 'calc(var(--z-index-overlay, 100000) + 4)' }}
        role="dialog"
        aria-label="选择打开方式"
      >
        <div className="mx-auto max-w-md rounded-2xl border border-default bg-surface shadow-2xl p-4">
          {failed
            ? (
                <>
                  <p className="text-sm font-medium">没打开「{target.appName}」</p>
                  <p className="mt-1 text-xs text-muted">
                    可能没装这个 App，或被浏览器拦下了。用浏览器打开这条？
                  </p>
                </>
              )
            : (
                <>
                  <p className="text-sm font-medium">用「{target.appName}」App 打开这条？</p>
                  <p className="mt-1 text-xs text-muted">
                    装了 App 可直接跳过去；没装的话会留在浏览器。
                  </p>
                </>
              )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={openInApp}
              disabled={busy}
              className={`flex-1 rounded-xl px-3 py-2 text-sm cursor-pointer disabled:opacity-60 ${
                failed
                  ? 'border border-default hover:bg-surface-tertiary'
                  : 'bg-accent text-accent-foreground'
              }`}
            >
              {busy ? '正在唤起…' : (failed ? '再试一次' : '用 App 打开')}
            </button>
            <button
              type="button"
              onClick={openInBrowser}
              className={`rounded-xl border border-default px-3 py-2 text-sm cursor-pointer hover:bg-surface-tertiary ${failed ? 'flex-1 bg-accent text-accent-foreground border-accent' : 'flex-1'}`}
            >
              在浏览器打开
            </button>
          </div>

          {!failed && (
            <label className="mt-3 flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              记住我的选择（可在「热榜设置」里修改）
            </label>
          )}
        </div>
      </div>
    </>,
    portalHost(),
  )
}
