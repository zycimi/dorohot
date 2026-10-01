/*
 * @Description: /settings 设置页客户端壳（左侧导航 + 右侧分区）
 *
 * 分区：模型设置 / 邮件订阅 / 导航设置 / 联网搜索。
 * 用 display 切换而不是卸载，切分区不会丢掉未保存的表单内容。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Drawer } from '@heroui/react'
import { useRouter } from 'next/navigation'

import { StatusBar } from '@/components/AiAssistant/status-bar'
import { ChannelsSettings } from '@/components/Settings/channels-settings'
import { McpSettings } from '@/components/Settings/mcp-settings'
import { ModelSettings } from '@/components/Settings/model-settings'
import { NavSettings } from '@/components/Settings/nav-settings'
import { SubscriptionSettings } from '@/components/Settings/subscription-settings'
import { WebSearchSettings } from '@/components/Settings/web-search-settings'
import { useNotify } from '@/lib/ai-client'
import { useDeviceKind } from '@/hooks/use-device-kind'
import { useAppStore } from '@/store/useAppStore'

import type { AiConfig } from '@/lib/ai-client'

type SectionKey = 'model' | 'subscription' | 'navigation' | 'web-search' | 'mcp' | 'channels'

const SECTIONS: { key: SectionKey, label: string, hint: string }[] = [
  { key: 'model', label: '模型设置', hint: '供应商 / 模型 / API Key' },
  { key: 'subscription', label: '邮件订阅', hint: '热榜定时推送到邮箱' },
  { key: 'navigation', label: '导航设置', hint: '导航位置（桌面端 / 手机端各一套）' },
  { key: 'web-search', label: '联网搜索', hint: 'Exa / Firecrawl / Parallel / Tavily / Bing RSS / Google CSE' },
  { key: 'mcp', label: 'MCP 接入', hint: '把本站作为 MCP 服务端，供外部客户端接入' },
  { key: 'channels', label: '远程接入', hint: '飞书 / 钉钉 / 企业微信群机器人推送' },
]

export default function SettingsClient() {
  const router = useRouter()
  const device = useDeviceKind()
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [active, setActive] = useState<SectionKey>('model')
  const activeMeta = SECTIONS.find(s => s.key === active) ?? SECTIONS[0]
  const { toast, notify } = useNotify()
  /** 桌面端 / 手机端各一套首页配置；这里编辑 editDevice 选中的那一端 */
  const editDevice = useAppStore(state => state.editDevice)
  const setEditDevice = useAppStore(state => state.setEditDevice)

  // 导航设置始终按当前视口编辑对应配置，不提供切换到另一端的入口。
  useEffect(() => {
    if (editDevice !== device)
      setEditDevice(device)
  }, [device, editDevice, setEditDevice])

  const loadConfig = useCallback(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(j => setConfig(j?.data ?? null))
      .catch(() => setConfig(null))
  }, [])

  useEffect(loadConfig, [loadConfig])

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get('section')
    if (section && SECTIONS.some(item => item.key === section))
      setActive(section as SectionKey)
  }, [])

  return (
    <div className="ai-wrap">
      <h1>设置</h1>
      <div className="ai-sub">模型设置、邮件订阅、导航设置、联网搜索、MCP 接入与远程接入。</div>

      <StatusBar config={config} />

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="设置分区">
          {SECTIONS.map(section => (
            <button
              key={section.key}
              type="button"
              className={`settings-nav-item ${active === section.key ? 'on' : ''}`}
              onClick={() => setActive(section.key)}
              aria-current={active === section.key ? 'page' : undefined}
            >
              <span className="settings-nav-label">{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          <div className="settings-panel-head">{activeMeta.hint}</div>

          <div style={{ display: active === 'model' ? undefined : 'none' }}>
            <ModelSettings config={config} notify={notify} onSaved={loadConfig} />
          </div>

          <div style={{ display: active === 'subscription' ? undefined : 'none' }}>
            <SubscriptionSettings notify={notify} />
          </div>

          <div style={{ display: active === 'navigation' ? undefined : 'none' }}>
            <NavSettings device={device} />
          </div>

          <div style={{ display: active === 'web-search' ? undefined : 'none' }}>
            <WebSearchSettings initial={config?.webSearch} notify={notify} onChanged={loadConfig} />
          </div>

          <div style={{ display: active === 'mcp' ? undefined : 'none' }}>
            <McpSettings notify={notify} />
          </div>

          <div style={{ display: active === 'channels' ? undefined : 'none' }}>
            <ChannelsSettings notify={notify} />
          </div>

        </div>
      </div>

      {toast && <div className={`ai-toast ${toast.ok ? 'ok' : 'err'}`}>{toast.msg}</div>}

      <div className="settings-mobile-nav">
        <Drawer>
          <Drawer.Trigger className="settings-mobile-nav-trigger" aria-label="打开设置导航">
            <span>☰</span>
            <span>设置导航</span>
          </Drawer.Trigger>
          <Drawer.Backdrop>
            <Drawer.Content placement="left">
              <Drawer.Dialog className="settings-mobile-drawer">
                <Drawer.CloseTrigger />
                <Drawer.Header>
                  <Drawer.Heading>设置导航</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <nav className="settings-mobile-nav-list" aria-label="设置分区">
                    {SECTIONS.map(section => (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => {
                          setActive(section.key)
                          router.replace(`/settings?section=${section.key}`, { scroll: false })
                        }}
                        aria-current={active === section.key ? 'page' : undefined}
                      >
                        {section.label}
                      </button>
                    ))}
                  </nav>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      </div>
    </div>
  )
}
