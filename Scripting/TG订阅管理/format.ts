// ==========================================
// 数字与时间格式化
// ==========================================

const numberFormatter = new Intl.NumberFormat("zh-CN")

/** 人数千分位格式化，例如 12345 → "12,345" */
export function formatAudience(count: number): string {
  return numberFormatter.format(count)
}

/** 抓取时间格式化为 HH:mm */
export function formatUpdateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}
