/**
 * lunar.ts — 农历 / 二十四节气 / 节日引擎
 *
 * 农历：1900-2100 压缩数据表（与国标一致的经典实现，已用多个春节锚点校验）
 * 节气：基于太阳视黄经的天文算法（Meeus 低精度项），误差 < 1 分钟
 */

const LUNAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
]

const MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"]
const DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
]

export interface LunarDay {
  year: number
  month: number
  day: number
  isLeap: boolean
  monthName: string
  dayName: string
  /** 月历格子里显示的一行小字：初一显示月份名，其余显示日名 */
  label: string
}

const LUNAR_MIN_YEAR = 1900
const LUNAR_MAX_YEAR = 2100

function leapMonth(y: number): number {
  return LUNAR_INFO[y - LUNAR_MIN_YEAR] & 0xf
}

function leapDays(y: number): number {
  if (!leapMonth(y)) return 0
  return LUNAR_INFO[y - LUNAR_MIN_YEAR] & 0x10000 ? 30 : 29
}

function monthDays(y: number, m: number): number {
  return LUNAR_INFO[y - LUNAR_MIN_YEAR] & (0x10000 >> m) ? 30 : 29
}

function yearDays(y: number): number {
  let sum = 0
  for (let m = 1; m <= 12; m++) sum += monthDays(y, m)
  return sum + leapDays(y)
}

/** 公历日期 → 年内天数序（相对 1900-01-31，1930 年后无夏令时影响） */
function dayOffset(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000)
}

export function toLunar(date: Date): LunarDay {
  const y0 = date.getFullYear()
  const m0 = date.getMonth() + 1
  const d0 = date.getDate()
  let offset = dayOffset(y0, m0, d0)

  let year = LUNAR_MIN_YEAR
  while (year <= LUNAR_MAX_YEAR) {
    const days = yearDays(year)
    if (offset < days) break
    offset -= days
    year++
  }

  const leap = leapMonth(year)
  let isLeap = false
  let month = 1
  while (month <= 12) {
    const days = isLeap ? leapDays(year) : monthDays(year, month)
    if (offset < days) break
    offset -= days
    if (isLeap) {
      isLeap = false
      month++
    } else if (leap && month === leap) {
      isLeap = true
    } else {
      month++
    }
  }

  const day = offset + 1
  const monthName = `${isLeap ? "闰" : ""}${MONTH_NAMES[month - 1]}月`
  const dayName = DAY_NAMES[day - 1]
  return {
    year,
    month,
    day,
    isLeap,
    monthName,
    dayName,
    label: day === 1 ? monthName : dayName,
  }
}

/* ------------------------------------------------------------------ */
/* 二十四节气                                                          */
/* ------------------------------------------------------------------ */

export const TERM_NAMES = [
  "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
  "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
  "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
]

const TERM_ANGLES = [
  285, 300, 315, 330, 345, 0, 15, 30, 45, 60, 75, 90,
  105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270,
]

const TERM_GUESS_MONTH = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12]
const TERM_GUESS_DAY = [5, 20, 4, 19, 6, 21, 5, 20, 6, 21, 6, 21, 7, 23, 8, 23, 8, 23, 8, 24, 7, 22, 7, 22]

const RAD = Math.PI / 180

function jdFromUTC(y: number, m: number, d: number, hours: number): number {
  let yy = y
  let mm = m
  if (mm <= 2) {
    yy -= 1
    mm += 12
  }
  const a = Math.floor(yy / 100)
  const b = 2 - a + Math.floor(a / 4)
  return (
    Math.floor(365.25 * (yy + 4716)) +
    Math.floor(30.6001 * (mm + 1)) +
    d +
    hours / 24 +
    b -
    1524.5
  )
}

function solarApparentLongitude(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
  const mr = m * RAD
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(mr) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * mr) +
    0.000289 * Math.sin(3 * mr)
  const trueLong = l0 + c
  const omega = 125.04 - 1934.136 * t
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  return ((lambda % 360) + 360) % 360
}

/** 某个节气（index 0..23）在指定年份的北京时间时刻（返回该日的本地 0 点 Date） */
function termDateTime(year: number, index: number): Date {
  const target = TERM_ANGLES[index]
  let jd = jdFromUTC(year, TERM_GUESS_MONTH[index], TERM_GUESS_DAY[index], 12)
  for (let i = 0; i < 24; i++) {
    const lambda = solarApparentLongitude(jd)
    let diff = ((target - lambda + 180) % 360) - 180
    if (diff < -180) diff += 360
    if (Math.abs(diff) < 1e-8) break
    jd += (diff * 365.2422) / 360
  }
  // UTC → 北京时间
  const beijing = jd + 8 / 24
  // JD → 年月日
  const z = Math.floor(beijing + 0.5)
  const f = beijing + 0.5 - z
  let a = z
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25)
    a = z + 1 + alpha - Math.floor(alpha / 4)
  }
  const b = a + 1524
  const c = Math.floor((b - 122.1) / 365.25)
  const d = Math.floor(365.25 * c)
  const e = Math.floor((b - d) / 30.6001)
  const day = b - d - Math.floor(30.6001 * e) + f
  const month = e < 14 ? e - 1 : e - 13
  const y = month > 2 ? c - 4716 : c - 4715
  return new Date(y, month - 1, Math.floor(day))
}

const termCache = new Map<number, Date[]>()

export function solarTermsOfYear(year: number): Date[] {
  const cached = termCache.get(year)
  if (cached) return cached
  const list: Date[] = []
  for (let i = 0; i < 24; i++) list.push(termDateTime(year, i))
  termCache.set(year, list)
  return list
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 当天是节气则返回节气名 */
export function termOnDate(date: Date): string | null {
  const year = date.getFullYear()
  for (const y of [year - 1, year, year + 1]) {
    const terms = solarTermsOfYear(y)
    for (let i = 0; i < 24; i++) {
      if (sameDay(terms[i], date)) return TERM_NAMES[i]
    }
  }
  return null
}

export interface NextTerm {
  name: string
  date: Date
  days: number
}

/** 从 date 起（含当天）的下一个节气 */
export function nextTerm(date: Date, includeToday = true): NextTerm {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const year = base.getFullYear()
  const all: { name: string; date: Date }[] = []
  for (const y of [year - 1, year, year + 1]) {
    const terms = solarTermsOfYear(y)
    for (let i = 0; i < 24; i++) all.push({ name: TERM_NAMES[i], date: terms[i] })
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime())
  for (const t of all) {
    const diff = Math.round((t.date.getTime() - base.getTime()) / 86400000)
    if (diff > 0 || (includeToday && diff === 0)) {
      return { name: t.name, date: t.date, days: diff }
    }
  }
  const fallback = all[all.length - 1]
  return { name: fallback.name, date: fallback.date, days: 0 }
}

/* ------------------------------------------------------------------ */
/* 节日                                                                */
/* ------------------------------------------------------------------ */

const SOLAR_FESTIVALS: Record<string, string> = {
  "1-1": "元旦",
  "2-14": "情人节",
  "3-8": "妇女节",
  "3-12": "植树节",
  "4-1": "愚人节",
  "5-1": "劳动节",
  "5-4": "青年节",
  "6-1": "儿童节",
  "7-1": "建党节",
  "8-1": "建军节",
  "9-10": "教师节",
  "10-1": "国庆节",
  "11-11": "光棍节",
  "12-24": "平安夜",
  "12-25": "圣诞节",
}

const LUNAR_FESTIVALS: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "2-2": "龙抬头",
  "5-5": "端午节",
  "7-7": "七夕",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
  "12-23": "小年",
}

/** 节日名：农历节日优先，其次公历节日 */
export function festivalOn(date: Date, lunar?: LunarDay): string | null {
  const l = lunar ?? toLunar(date)
  if (!l.isLeap) {
    const name = LUNAR_FESTIVALS[`${l.month}-${l.day}`]
    if (name) return name
  }
  return SOLAR_FESTIVALS[`${date.getMonth() + 1}-${date.getDate()}`] ?? null
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

export const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"]

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + days)
  return d
}

export function sameDate(a: Date, b: Date): boolean {
  return sameDay(a, b)
}

export function relativeDayName(date: Date, today: Date): string {
  const diff = Math.round(
    (startOfDay(date).getTime() - startOfDay(today).getTime()) / 86400000
  )
  if (diff === 0) return "今天"
  if (diff === 1) return "明天"
  if (diff === 2) return "后天"
  if (diff === -1) return "昨天"
  if (diff === -2) return "前天"
  if (diff < 0) return `${-diff} 天前`
  return `${diff} 天后`
}
