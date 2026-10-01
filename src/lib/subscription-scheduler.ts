/*
 * @Description: 邮箱订阅调度器（进程内定时器，每 60 秒检查一次是否到期）
 *  - 由 src/instrumentation.ts 在服务启动时注册；`/api/subscription` GET 也会兜底启动
 *  - 单进程内用 running 旗标防重入；发完写回 lastSentAt，不会重复发送
 */
import { subscriptionChannelIds } from './channels'
import { isDue, readSubscription, writeSubscription } from './subscription'
import { sendSubscriptionEmail, sendSubscriptionToChannels } from './subscription-runner'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function tick() {
  if (running)
    return
  const config = readSubscription()
  const channelIds = subscriptionChannelIds()
  if (!isDue(config, Date.now(), { channelReady: channelIds.length > 0 }))
    return
  running = true
  try {
    const hasEmail = !!config.email && !!config.smtp.host
    if (hasEmail) {
      const result = await sendSubscriptionEmail(config)
      console.log(`[subscription] 已发送订阅邮件：${result.usedItems} 条（附带渠道 ${channelIds.length} 个）`)
    }
    else {
      // 未配置邮箱：只推送到「随订阅推送」的远程接入渠道
      const result = await sendSubscriptionToChannels(config)
      const ok = result.results.filter(r => r.ok).length
      console.log(`[subscription] 未配置邮箱，已推送远程渠道 ${ok}/${result.results.length} 个 · ${result.usedItems} 条`)
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[subscription] 发送失败：', message)
    writeSubscription({ lastStatus: `失败 · ${message.slice(0, 200)}` })
  }
  finally {
    running = false
  }
}

/** @description: 启动订阅调度器（幂等） */
export function ensureSubscriptionScheduler() {
  if (timer)
    return
  timer = setInterval(() => {
    void tick()
  }, 60_000)
  // 不阻塞进程退出（dev / build 场景）
  ;(timer as unknown as { unref?: () => void }).unref?.()
  console.log('[subscription] 调度器已启动（每 60s 检查一次）')
}

/** @description: 仅测试用：立即跑一次检查 */
export async function runSubscriptionTickNow() {
  await tick()
}
