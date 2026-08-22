// ==========================================
// 类型定义
// ==========================================

/** 主题模式 */
export type ThemeMode = "auto" | "light" | "dark"

/** 受众类型 */
export type AudienceType = "订阅者" | "成员"

/** Telegram 频道/群组受众数据快照（公开可展示，非敏感） */
export type TelegramAudience = {
  /** 归一化后的展示用源标识（@username 或 t.me 链接） */
  source: string
  /** 抓取用的 t.me URL */
  url: string
  /** 频道/群组标题 */
  title: string
  /** 受众人数 */
  audience: number
  /** 千分位格式化后的人数文本 */
  audienceText: string
  /** 受众类型：订阅者 / 成员 */
  audienceType: AudienceType
  /** 头像 URL（可选） */
  avatarURL?: string
  /** 简介（可选） */
  description?: string
  /** 抓取时间戳 */
  fetchedAt: number
}
