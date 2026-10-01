/*
 * @Description: 导航设置（数据源导航位置）
 *
 * 2026-09-28 改版：从 settings-client 的内联纯文字单选，改为「线框瓦片 + 宽屏实时预览 + 便捷脚注」。
 *  - 每个位置给一个迷你视口线框，红色小条标出导航在屏幕的哪条边，一眼可见；
 *  - ≥720px 时右侧显示实时预览（设备框 + 卡片骨架 + 当前导航），选择即变化；
 *  - 底部给「已保存 / 恢复默认 / 在首页查看」，选择后自动保存（沿用 store 的防抖同步）。
 * 导航位置按当前视口（桌面端 / 手机端）各存一套，面板只编辑当前这一端。
 */
'use client'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import NextLink from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '@/store/useAppStore'

import type { DeviceKind, NavPosition } from '@/store/useAppStore'

const OPTIONS: { value: NavPosition, label: string, desc: string }[] = [
  { value: 'left', label: '左侧', desc: '竖排图标轨' },
  { value: 'right', label: '右侧', desc: '竖排图标轨' },
  { value: 'top', label: '顶部', desc: '横向 chip 条' },
  { value: 'bottom', label: '底部', desc: '悬浮 dock' },
]

/** 「恢复默认」指回的位置，与 app-store 的兜底值保持一致 */
const DEFAULT_POSITION: NavPosition = 'top'

/** 迷你视口线框：红色小条标出导航所在边 */
function PositionMini({ value }: { value: NavPosition }) {
  return (
    <span className={`nav-pos-mini nav-pos-mini-${value}`} aria-hidden="true">
      <span className="nav-pos-mini-lines" />
      <span className="nav-pos-mini-bar" />
    </span>
  )
}

/** 宽屏实时预览：设备框 + 首页卡片骨架 + 当前导航位置（位置切换时淡入） */
function PositionPreview({ position, device, reduce }: { position: NavPosition, device: DeviceKind, reduce: boolean }) {
  const chips = device === 'mobile' ? 4 : 5
  const cards = device === 'mobile' ? 3 : 6
  return (
    <div className="nav-preview-wrap">
      <div className={`nav-preview nav-preview-${device}`}>
        <div className="nav-preview-head">
          <span className="nav-preview-logo" />
          <span className="nav-preview-title" />
          <span className="nav-preview-dot" />
        </div>
        <div className="nav-preview-grid">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="nav-preview-card">
              <span className="nav-preview-row" />
              <span className="nav-preview-row short" />
              <span className="nav-preview-row" />
            </div>
          ))}
        </div>
        <div className={`nav-preview-nav pos-${position}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={position}
              className="nav-preview-nav-inner"
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {Array.from({ length: chips }).map((_, i) => <span key={i} className="nav-preview-chip" />)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="nav-preview-cap">预览 · {device === 'mobile' ? '手机端' : '桌面端'}</div>
    </div>
  )
}

export function NavSettings({ device }: { device: DeviceKind }) {
  const reduce = useReducedMotion() ?? false
  const desktop = useAppStore(s => s.desktop)
  const mobile = useAppStore(s => s.mobile)
  const navPosition = (device === 'mobile' ? mobile : desktop).navPosition
  const setNavPosition = useAppStore(s => s.setNavPosition)
  const setEditDevice = useAppStore(s => s.setEditDevice)

  // 保存是 400ms 防抖同步到服务端；这里只做一次短暂的「已保存」反馈
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current)
      clearTimeout(timer.current)
  }, [])

  const choose = (value: NavPosition) => {
    if (value === navPosition)
      return
    // 同步设定写入端，避免刚切换视口时落到上一端
    setEditDevice(device)
    setNavPosition(value)
    setSaved(true)
    if (timer.current)
      clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), 1600)
  }

  return (
    <section className="ai-card nav-settings">
      <div className="nav-settings-head">
        <h2>数据源导航位置</h2>
        <span className="nav-device-chip">正在设置 · {device === 'mobile' ? '手机端' : '桌面端'}</span>
      </div>
      <p className="ai-srcinfo">
        桌面端与手机端分别保存；滚动时导航自动收起，停止滚动后重新显示。选择后自动保存到服务端（多设备共享）。
      </p>

      <div className="nav-settings-body">
        <fieldset className="nav-position-options" aria-label="导航位置">
          {OPTIONS.map(({ value, label, desc }) => (
            <label key={value} className={`nav-position-option ${navPosition === value ? 'on' : ''}`}>
              <input
                type="radio"
                name="nav-position"
                value={value}
                checked={navPosition === value}
                onChange={() => choose(value)}
              />
              <PositionMini value={value} />
              <span className="nav-pos-meta">
                <span className="nav-pos-name">{label}</span>
                <span className="nav-pos-desc">{desc}</span>
                <span className="nav-pos-check" aria-hidden="true">✓</span>
              </span>
            </label>
          ))}
        </fieldset>

        <PositionPreview position={navPosition} device={device} reduce={reduce} />
      </div>

      <div className="nav-settings-foot">
        <span className={`nav-saved ${saved ? 'on' : ''}`}>{saved ? '已保存' : '改动会自动保存'}</span>
        <span className="nav-settings-links">
          <button type="button" className="nav-link" onClick={() => choose(DEFAULT_POSITION)}>
            恢复默认（顶部）
          </button>
          <span className="nav-link-sep">·</span>
          <NextLink className="nav-link" href="/">在首页查看 →</NextLink>
        </span>
      </div>
    </section>
  )
}
