import type { Color } from "scripting"
import type { ThemeMode } from "./types"

// ==========================================
// 主题 token 与解析
// ==========================================

/** Telegram 品牌蓝 */
export const TELEGRAM_BLUE = "#229ED9"

/** 一套小组件配色（供 WidgetView / 预览复用） */
export type ThemeColors = {
  /** 背景 */
  background: Color
  /** 主文字 */
  text: Color
  /** 次要文字 */
  subText: Color
  /** 强调色（人数、图标） */
  accent: Color
  /** 圆形控件（刷新按钮）的淡色底 —— 贴近 iOS 原生小组件按钮 */
  controlBackground: Color
}

/**
 * 根据主题模式解析出一套颜色。
 * - auto：使用系统语义色，跟随系统深浅色
 * - light / dark：强制固定色值
 */
export function resolveTheme(mode: ThemeMode): ThemeColors {
  if (mode === "dark") {
    return {
      background: "#1C1C1E",
      text: "#FFFFFF",
      subText: "#8E8E93",
      accent: TELEGRAM_BLUE,
      controlBackground: "rgba(255,255,255,0.12)",
    }
  }
  if (mode === "light") {
    return {
      background: "#FFFFFF",
      text: "#000000",
      subText: "#636366",
      accent: TELEGRAM_BLUE,
      controlBackground: "rgba(0,0,0,0.06)",
    }
  }
  // auto：跟随系统语义色
  return {
    background: "systemBackground",
    text: "label",
    subText: "secondaryLabel",
    accent: TELEGRAM_BLUE,
    controlBackground: "quaternarySystemFill",
  }
}
