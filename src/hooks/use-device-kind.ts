/*
 * @Description: 当前视口属于「桌面端」还是「手机端」
 *
 * 断点与 `src/styles/ai.css` 里左右导航的媒体查询保持一致（768px）：
 *  ≥768px 视为桌面端，<768px 视为手机端。首页据此选用对应的那套配置
 *  （导航位置 / 排序 / 隐藏源，见 `useAppStore`）。
 */
'use client'

import { useEffect, useState } from 'react'

import type { DeviceKind } from '@/store/useAppStore'

/** 与 CSS 的左右导航断点一致 */
export const DESKTOP_MEDIA = '(min-width: 768px)'

export function useDeviceKind(): DeviceKind {
  // 首帧（含 SSR）按桌面端渲染；page.tsx 会在 mounted 后才真正输出，挂载后立刻校正
  const [device, setDevice] = useState<DeviceKind>('desktop')

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MEDIA)
    const update = () => setDevice(mq.matches ? 'desktop' : 'mobile')
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return device
}
