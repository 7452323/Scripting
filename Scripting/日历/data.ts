/**
 * data.ts — 数据模型与数据源
 *
 * · 日程：来自系统「日历」（CalendarEvent）
 * · 待办：来自系统「提醒事项」（Reminder）
 * · 日子：App 自有数据，存于 Storage
 * 任一系统数据源不可用时，回退到内置示例，保证界面始终完整可看。
 */

import type { Color } from "scripting"

import { C, FALLBACK_COLORS } from "./theme"
import { addDays, startOfDay, toLunar, formatMonthDay, WEEKDAY_CN } from "./lunar"

export interface AgendaItem {
  id: string
  title: string
  start: Date
  end: Date
  isAllDay: boolean
  location: string | null
  meeting: string | null
  color: Color
  calendarTitle: string
  /** 备注（详情页展示） */
  notes?: string | null
  /** 关联 URL（会议链接等） */
  url?: string | null
}

export interface TodoItem {
  id: string
  title: string
  due: Date | null
  hasTime: boolean
  priority: number
  listTitle: string
  color: Color
}

export type DayRepeat = "yearly" | "lunar" | "once" | "cycle" | "monthly"

/** 日子类型：纪念日（向后看已经多久） / 倒数日（向前看还有多久） */
export type DayKind = "anniversary" | "countdown"

export interface DayItem {
  id: string
  title: string
  date: Date
  note: string
  emoji: string
  pinned: boolean
  repeat: DayRepeat
  /** 纪念日 / 倒数日，缺省按倒数日 */
  kind?: DayKind
  /** 提前几天提醒（0 或未设 = 不提醒） */
  remindDays?: number
  /** 在月历格子上标记 */
  showOnCalendar?: boolean
  /** 计数周期（如试用期 41/91） */
  cycleDone?: number
  cycleTotal?: number
  color?: Color
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const MEETING_MAP: [string, string][] = [
  ["zoom.us", "Zoom"],
  ["zoom.com", "Zoom"],
  ["meeting.tencent", "腾讯会议"],
  ["voov", "腾讯会议"],
  ["feishu", "飞书"],
  ["larksuite", "飞书"],
  ["dingtalk", "钉钉"],
  ["meet.google", "Google Meet"],
]

function detectMeeting(url: string | null, location: string | null): string | null {
  const text = `${url ?? ""} ${location ?? ""}`.toLowerCase()
  for (const [key, label] of MEETING_MAP) {
    if (text.includes(key)) return label
  }
  return null
}

function colorOf(calendar: unknown, index: number): Color {
  const c = calendar as { color?: unknown; title?: string } | null
  const value = c?.color
  if (typeof value === "string" && value.startsWith("#")) return value as Color
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

function titleOf(calendar: unknown): string {
  const c = calendar as { title?: string } | null
  return c?.title ?? "日历"
}

/* ------------------------------------------------------------------ */
/* 系统日历                                                             */
/* ------------------------------------------------------------------ */

export async function loadSystemEvents(start: Date, end: Date): Promise<AgendaItem[]> {
  const events = await CalendarEvent.getAll(start, end)
  const items: AgendaItem[] = []
  events.forEach((e, i) => {
    items.push({
      id: e.identifier || `evt-${i}-${e.startDate.getTime()}`,
      title: e.title?.trim() || "(无标题)",
      start: e.startDate,
      end: e.endDate,
      isAllDay: e.isAllDay,
      location: e.location && e.location.trim().length > 0 ? e.location.trim() : null,
      meeting: detectMeeting(e.url, e.location),
      color: colorOf(e.calendar, i),
      calendarTitle: titleOf(e.calendar),
      notes: e.notes && e.notes.trim().length > 0 ? e.notes.trim() : null,
      url: e.url && e.url.trim().length > 0 ? e.url.trim() : null,
    })
  })
  items.sort((a, b) => {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
    return a.start.getTime() - b.start.getTime()
  })
  return items
}

/* ------------------------------------------------------------------ */
/* 系统提醒事项                                                         */
/* ------------------------------------------------------------------ */

export async function loadSystemTodos(): Promise<TodoItem[]> {
  const reminders = await Reminder.getIncompletes({})
  const items: TodoItem[] = []
  reminders.forEach((r, i) => {
    const comps = r.dueDateComponents
    let due: Date | null = null
    let hasTime = false
    if (comps) {
      const d = comps.date ?? null
      if (d) {
        due = d
        hasTime = comps.hour !== undefined && comps.hour !== null
      }
    }
    items.push({
      id: r.identifier || `todo-${i}`,
      title: r.title?.trim() || "(无标题)",
      due,
      hasTime,
      priority: typeof r.priority === "number" ? r.priority : 0,
      listTitle: titleOf(r.calendar),
      color: colorOf(r.calendar, i),
    })
  })
  return items
}

/* ------------------------------------------------------------------ */
/* 日子（本地数据）                                                     */
/* ------------------------------------------------------------------ */

/** v2：示例数据中移除了「试用期」，旧缓存不再复用 */
const DAYS_KEY = "calendar.days.v2"

/** 待办的已完成标记（跨启动保留） */
const DONE_KEY = "calendar.todos.done.v1"

export function loadDoneIds(): string[] {
  try {
    const raw = Storage.get<string>(DONE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch (e) {
    return []
  }
}

export function saveDoneIds(ids: string[]): void {
  try {
    Storage.set(DONE_KEY, JSON.stringify(ids))
  } catch (e) {
    /* 存储不可用时忽略 */
  }
}

function shiftYearly(date: Date, today: Date): Date {
  const next = new Date(today.getFullYear(), date.getMonth(), date.getDate())
  const today0 = startOfDay(today)
  if (next.getTime() < today0.getTime()) next.setFullYear(next.getFullYear() + 1)
  return next
}

function shiftLunarYearly(date: Date, today: Date): Date {
  const l = toLunar(date)
  return nextLunarDate(l.month, l.day, today)
}

/** 今天之后（含今天）最近一次指定的农历月/日 */
export function nextLunarDate(month: number, day: number, today: Date): Date {
  const base = startOfDay(today)
  for (let offset = 0; offset <= 400; offset++) {
    const candidate = addDays(base, offset)
    const l = toLunar(candidate)
    if (l.month === month && l.day === day && !l.isLeap) return candidate
  }
  return base
}

function shiftMonthly(date: Date, today: Date): Date {
  const today0 = startOfDay(today)
  const day = date.getDate()
  let year = today0.getFullYear()
  let month = today0.getMonth()
  for (let i = 0; i < 24; i++) {
    const lastDay = new Date(year, month + 1, 0).getDate()
    const candidate = new Date(year, month, Math.min(day, lastDay))
    if (candidate.getTime() >= today0.getTime()) return candidate
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  return today0
}

/** 把内置模板中的相对日期落到真实的最近一次发生日 */
export function resolveDayDate(item: DayItem, today: Date): Date {
  if (item.repeat === "yearly") return shiftYearly(item.date, today)
  if (item.repeat === "lunar") return shiftLunarYearly(item.date, today)
  if (item.repeat === "monthly") return shiftMonthly(item.date, today)
  return item.date
}

function sampleDays(today: Date): DayItem[] {
  return [
    {
      id: "d1",
      title: "妈妈生日",
      date: nextLunarDate(8, 28, today),
      note: "周岁 58",
      emoji: "🎂",
      pinned: true,
      repeat: "lunar",
      color: C.accent,
    },
    {
      id: "d3",
      title: "就在今天",
      date: addDays(today, 0),
      note: "一次性",
      emoji: "🎯",
      pinned: false,
      repeat: "once",
    },
    {
      id: "d4",
      title: "明天体检",
      date: addDays(today, 1),
      note: "一次性",
      emoji: "🏥",
      pinned: false,
      repeat: "once",
    },
    {
      id: "d5",
      title: "两天后出行",
      date: addDays(today, 2),
      note: "一次性",
      emoji: "✈️",
      pinned: false,
      repeat: "once",
    },
    {
      id: "d6",
      title: "发布会",
      date: addDays(today, 6),
      note: "一次性",
      emoji: "🚀",
      pinned: false,
      repeat: "once",
    },
    {
      id: "d7",
      title: "结婚纪念日",
      date: addDays(today, 15),
      note: "每年",
      emoji: "💍",
      pinned: false,
      repeat: "yearly",
    },
    {
      id: "d8",
      title: "项目里程碑",
      date: addDays(today, 30),
      note: "一次性",
      emoji: "🏁",
      pinned: false,
      repeat: "once",
    },
  ]
}

function hydrateDay(raw: any): DayItem {
  return {
    ...raw,
    date: new Date(raw.date),
  }
}

export function loadDays(today: Date): DayItem[] {
  try {
    const stored = Storage.get<DayItem[]>(DAYS_KEY)
    if (Array.isArray(stored) && stored.length > 0) return stored.map(hydrateDay)
  } catch (e) {
    /* 忽略：使用示例数据 */
  }
  const sample = sampleDays(today)
  try {
    Storage.set(DAYS_KEY, sample)
  } catch (e) {
    /* 忽略 */
  }
  return sample
}

export function saveDays(items: DayItem[]): void {
  try {
    Storage.set(DAYS_KEY, items)
  } catch (e) {
    /* 忽略 */
  }
}

/** 今日 / 明天 / N 天后的标签 */
export function dayCountdown(item: DayItem, today: Date): { days: number; label: string; text: string } {
  const target = startOfDay(resolveDayDate(item, today))
  const base = startOfDay(today)
  const days = Math.round((target.getTime() - base.getTime()) / 86400000)
  let label = ""
  if (days === 0) label = "今天"
  else if (days === 1) label = "明天"
  else if (days === 2) label = "2 天后"
  else if (days < 0) label = `已过 ${-days} 天`
  return { days, label, text: `${Math.abs(days)} 天` }
}

export function formatDaySubtitle(item: DayItem, today: Date): string {
  const target = resolveDayDate(item, today)
  const l = toLunar(target)
  const parts: string[] = []
  if (item.repeat === "lunar") parts.push(`${l.monthName}${l.dayName}`)
  parts.push(formatMonthDay(target))
  if (item.note) parts.push(item.note)
  return parts.join(" · ")
}

/* ------------------------------------------------------------------ */
/* 示例日程 / 待办（系统数据为空时使用）                                 */
/* ------------------------------------------------------------------ */

export function sampleEvents(today: Date): AgendaItem[] {
  const mk = (
    id: string,
    title: string,
    dayOffset: number,
    hour: number | null,
    durationMin: number,
    location: string | null,
    meeting: string | null,
    color: Color
  ): AgendaItem => {
    const base = addDays(today, dayOffset)
    const start = new Date(base)
    if (hour === null) {
      start.setHours(0, 0, 0, 0)
      const end = new Date(base)
      end.setHours(23, 59, 0, 0)
      return {
        id, title, start, end, isAllDay: true, location, meeting, color, calendarTitle: "工作",
      }
    }
    start.setHours(hour, 0, 0, 0)
    const end = new Date(start.getTime() + durationMin * 60000)
    return {
      id, title, start, end, isAllDay: false, location, meeting, color, calendarTitle: "工作",
    }
  }

  return [
    mk("s1", "产品开放日", 0, null, 0, null, null, "#7D8F52"),
    mk("s2", "设计评审", 0, 14, 60, "3 号楼 A 室", null, "#C0632E"),
    mk("s3", "接孩子放学", 0, 17, 30, "学校门口", null, "#4E7D8F"),
    mk("s4", "家庭晚餐", 0, 19, 90, "家", null, "#B5533F"),
    mk("s5", "1:1", 1, 11, 30, null, "Zoom", "#7D8F52"),
    mk("s6", "客户拜访", 1, 15, 60, "浦东世纪大道 100 号", null, "#C0632E"),
    mk("s7", "假期值班", 2, null, 0, null, null, "#B5533F"),
    mk("s8", "面试", 2, 10, 45, null, "飞书", "#4E7D8F"),
    mk("s9", "周会", 3, 9, 30, "会议室 2", "腾讯会议", "#7D8F52"),
    mk("s10", "季度复盘", 5, 14, 120, "线上", "腾讯会议", "#8F6A4E"),
  ]
}

export function sampleTodos(today: Date): TodoItem[] {
  const mk = (
    id: string,
    title: string,
    dayOffset: number | null,
    hour: number | null,
    priority: number,
    listTitle: string = "提醒事项",
    color: Color = C.accent
  ): TodoItem => {
    let due: Date | null = null
    let hasTime = false
    if (dayOffset !== null) {
      due = addDays(today, dayOffset)
      if (hour !== null) {
        due.setHours(hour, 0, 0, 0)
        hasTime = true
      }
    }
    return { id, title, due, hasTime, priority, listTitle, color }
  }

  return [
    mk("t1", "写周报", -1, 9, 3, "工作", "#C0632E"),
    mk("t2", "回复邮件", -1, null, 0, "工作", "#4E7D8F"),
    mk("t3", "今天到期", 0, 9, 2),
    mk("t4", "买菜", 0, null, 0),
    mk("t5", "取快递", 0, 18, 0, "提醒事项", "#7D8F52"),
    mk("t6", "给妈妈回电话", 0, 20, 2),
    mk("t7", "健身房", 1, 9, 0, "生活", "#7D8F52"),
    mk("t8", "报销", 7, null, 1, "工作", "#8F6A4E"),
    mk("t9", "整理相册", null, null, 0, "生活", "#7D5BA6"),
    mk("t10", "预约牙医", null, null, 0, "生活", "#B5533F"),
  ]
}

export function weekdayLabel(date: Date): string {
  return `周${WEEKDAY_CN[date.getDay()]}`
}
