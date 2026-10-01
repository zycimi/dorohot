/*
 * @Description: AI 配置状态条（首页抽屉 / /settings 页共用）
 */
'use client'

import type { AiConfig } from '@/lib/ai-client'

export function StatusBar({ config }: { config: AiConfig | null }) {
  if (!config)
    return <div className="ai-status"><span className="ai-badge gray">读取配置中…</span></div>

  const ready = config.hasApiKey && !!config.model
  return (
    <div className="ai-status">
      {ready && (
        <span className="ai-badge ok">
          已配置 · 「{config.name || config.active}」({config.model})
        </span>
      )}
      {!config.hasApiKey && <span className="ai-badge bad">未配置 API Key</span>}
      {config.hasApiKey && !config.model && <span className="ai-badge warn">未选对话模型</span>}
      {!ready && (
        <span className="ai-status-detail">
          请到「模型设置」页完成配置，也可直接编辑 <code>{config.configFile}</code>
        </span>
      )}
    </div>
  )
}
