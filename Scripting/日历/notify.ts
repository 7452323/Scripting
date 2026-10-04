/**
 * notify.ts — 本地通知调度
 *
 * 通知全部由本机发出，不依赖网络。
 * Scripting 只允许脚本管理自己的通知，所以重排前统一用
 * `removeAllPendingsOfCurrentScript()` 清空，避免旧通知堆积重复。
 *
 * 用 `Notification.schedule` + `CalendarNotificationTrigger` 定时刻触发。
 */

import { Notification } from "scripting"
import type { AgendaItem, DayItem } from "./data"
import { resolveDayDate } from "./data"
import { startOfDay } from "./lunar"
import { formatClock } from "./settings"

/** 日子提醒的默认时刻：当天上午 9:00 */
const DAY_HOUR = 9
const DAY_MINUTE = 0

/** 用 CalendarNotificationTrigger 在指定时刻触发一次 */
function triggerAt(date: Date): CalendarNotificationTrigger {
  const dc = new DateComponents()
  dc.year = date.getFullYear()
  dc.month = date.getMonth() + 1
  dc.day = date.getDate()
  dc.hour = date.getHours()
  dc.minute = date.getMinutes()
  return new CalendarNotificationTrigger({ dateMatching: dc, repeats: false })
}

/** 发一条测试通知（立即送达） */
export async function sendTestNotification(): Promise<boolean> {
  try {
    return await Notification.schedule({
      title: "日历",
      body: "如果你看到这条通知，说明通知已正常工作 🎉",
      trigger: null,
    })
  } catch (e) {
    return false
  }
}

/** 清空本脚本所有待发通知 */
export async function clearAllPending(): Promise<void> {
  try {
    await Notification.removeAllPendingsOfCurrentScript()
  } catch (e) {
    // 无权限时忽略
  }
}

/**
 * 给「日子」排下一次发生的提醒。
 *
 * @param days 全部日子
 * @param leadMinutes 全局提前量（分钟），-1 表示不提醒
 * @returns 实际排入的通知条数
 */
export async function scheduleDayReminders(days: DayItem[], leadMinutes: number): Promise<number> {
  if (leadMinutes < 0) return 0
  const now = Date.now()
  const today = startOfDay(new Date())
  let count = 0

  for (const day of days) {
    // -1 = 用户显式选「不提醒」；-2 / undefined = 跟随设置页的全局提前量
    if (day.remindDays === -1) continue

    let occurrence: Date
    try {
      occurrence = resolveDayDate(day, today)
    } catch (e) {
      continue
    }

    // 单个日子的「提前 N 天 / 当天」优先于全局的分钟级提前量
    const leadMs =
      typeof day.remindDays === "number" && day.remindDays >= 0
        ? day.remindDays * 86400000
        : leadMinutes * 60000

    const fire = new Date(occurrence)
    fire.setHours(DAY_HOUR, DAY_MINUTE, 0, 0)
    fire.setTime(fire.getTime() - leadMs)
    if (fire.getTime() <= now) continue

    try {
      const ok = await Notification.schedule({
        title: `${day.emoji} ${day.title}`,
        body: `${occurrence.getMonth() + 1} 月 ${occurrence.getDate()} 日${day.note ? ` · ${day.note}` : ""}`,
        trigger: triggerAt(fire),
        threadIdentifier: "calendar.days",
      })
      if (ok) count++
    } catch (e) {
      // 单条失败不影响其余
    }
  }
  return count
}

/**
 * 给日程排「会前提醒」。
 *
 * @param events 日程列表（全天日程自动跳过）
 * @param leadMinutes 提前量（分钟），-1 表示不提醒
 */
export async function scheduleEventReminders(
  events: AgendaItem[],
  leadMinutes: number,
): Promise<number> {
  if (leadMinutes < 0) return 0
  const now = Date.now()
  let count = 0

  for (const item of events) {
    if (item.isAllDay) continue
    const fire = new Date(item.start.getTime() - leadMinutes * 60000)
    if (fire.getTime() <= now) continue

    try {
      const ok = await Notification.schedule({
        title: `即将开始 · ${item.title}`,
        body: item.location ? `${formatClock(item.start)} · ${item.location}` : `${formatClock(item.start)} 开始`,
        trigger: triggerAt(fire),
        threadIdentifier: "calendar.events",
      })
      if (ok) count++
    } catch (e) {
      // 单条失败不影响其余
    }
  }
  return count
}

/**
 * 按当前设置重排全部通知。
 * 先清空本脚本的待发通知，再分别排入日子与日程提醒。
 */
export async function rescheduleAll(
  days: DayItem[],
  events: AgendaItem[],
  settings: { remindMinutes: number; eventLeadMinutes: number },
): Promise<{ days: number; events: number }> {
  await clearAllPending()
  const dayCount = await scheduleDayReminders(days, settings.remindMinutes)
  const eventCount = await scheduleEventReminders(events, settings.eventLeadMinutes)
  return { days: dayCount, events: eventCount }
}
