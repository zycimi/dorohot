/*
 * @Description: Next.js instrumentation —— 服务启动时拉起邮箱订阅调度器
 *  仅在 Node runtime 执行（Edge/构建阶段跳过）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs')
    return
  try {
    const { ensureSubscriptionScheduler } = await import('./lib/subscription-scheduler')
    ensureSubscriptionScheduler()
  }
  catch (error) {
    console.error('[instrumentation] 订阅调度器启动失败：', error instanceof Error ? error.message : error)
  }
}
