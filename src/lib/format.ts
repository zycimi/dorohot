/*
 * @Description: 时间显示工具
 *
 * 服务端统一用 `new Date().toISOString()` 存 UTC；前端若直接截断 ISO 字符串，
 * 显示出来的就是 UTC（例如本地 20:12 会显示成 12:12）。此函数按**浏览器本地时区**格式化。
 * 无任何依赖，客户端/服务端通用。
 */

/** @description: 把 ISO 时间按本地时区格式化为 `YYYY-MM-DD HH:mm[:ss]`；空值返回 `-` */
export function formatLocalDateTime(iso?: string | null, withSeconds = true): string {
  if (!iso)
    return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime()))
    return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base
}
