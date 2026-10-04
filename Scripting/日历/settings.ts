/**
 * settings.ts — 用户偏好（一周起始、时间制式、主题色、提醒）的持久化。
 *
 * 外观不在这里 —— 恒跟随系统，见 theme.ts 的 `applyAppearance`。
 * Storage 是 Scripting 的全局 API，不需要 import。
 */

import { DEFAULT_ACCENT_ID } from "./theme"
import { normalizeWidgetSize, type WidgetSize } from "./widget_views"

/** 一周起始日：0 = 周日，1 = 周一 */
export type WeekStart = 0 | 1

export type Settings = {
  weekStart: WeekStart
  /** true = 24 小时制，false = 12 小时制（上午 / 下午） */
  use24Hour: boolean
  /** 主题色 id（见 theme.ts 的 ACCENT_THEMES） */
  accent: string
  /** 小组件预览用的尺寸（只影响设置页预览，真机上由系统尺寸决定） */
  widgetSize: WidgetSize
  /** 日子提醒提前量（分钟），-1 = 不提醒 */
  remindMinutes: number
  /** 日程会前提醒提前量（分钟），-1 = 不提醒 */
  eventLeadMinutes: number
}

const SETTINGS_KEY = "calendar.settings.v1"

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 1,
  use24Hour: true,
  accent: DEFAULT_ACCENT_ID,
  widgetSize: "medium",
  remindMinutes: -1,
  eventLeadMinutes: -1,
}

export function loadSettings(): Settings {
  try {
    const raw = Storage.get<string>(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      weekStart: parsed.weekStart === 0 ? 0 : 1,
      use24Hour: typeof parsed.use24Hour === "boolean" ? parsed.use24Hour : DEFAULT_SETTINGS.use24Hour,
      accent: typeof parsed.accent === "string" ? parsed.accent : DEFAULT_SETTINGS.accent,
      widgetSize: normalizeWidgetSize(parsed.widgetSize),
      remindMinutes:
        typeof parsed.remindMinutes === "number" ? parsed.remindMinutes : DEFAULT_SETTINGS.remindMinutes,
      eventLeadMinutes:
        typeof parsed.eventLeadMinutes === "number"
          ? parsed.eventLeadMinutes
          : DEFAULT_SETTINGS.eventLeadMinutes,
    }
  } catch (e) {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): boolean {
  try {
    Storage.set(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch (e) {
    return false
  }
}

/**
 * 当前生效的偏好快照。
 *
 * 让深层组件（如时间标签、月历网格）能直接读取，避免 props 一层层往下传。
 * 修改设置后由 App 调用 `applyRuntime()` 刷新，并借整体重渲染使其生效。
 */
export const runtime = {
  use24Hour: DEFAULT_SETTINGS.use24Hour,
  weekStart: DEFAULT_SETTINGS.weekStart as WeekStart,
}

export function applyRuntime(settings: Settings): void {
  runtime.use24Hour = settings.use24Hour
  runtime.weekStart = settings.weekStart
}

/** 按当前偏好格式化时间：`HH:mm` 或 `上午/下午 h:mm` */
export function formatClock(date: Date): string {
  const h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, "0")
  if (runtime.use24Hour) return `${String(h).padStart(2, "0")}:${m}`
  const suffix = h < 12 ? "上午" : "下午"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${suffix} ${h12}:${m}`
}
