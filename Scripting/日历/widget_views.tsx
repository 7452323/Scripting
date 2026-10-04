/**
 * widget_views.tsx — 小组件视图（被 widget.tsx 与设置页预览共用）
 *
 * 版式按尺寸决定，不需要用户配置：
 *
 *   small  —— 本月月历
 *   medium —— 左边月历 + 右边待办
 *   large  —— 月历 + 下方待办 / 日子倒数
 *
 * 抽成独立模块是为了让「设置页里的预览」和「桌面上的真实小组件」长得一模一样：
 * 两边共用同一份渲染代码，不会随着后续改动逐渐长歪。
 *
 * 这里不引用 `Widget.*`，所以可以安全地在 App 里渲染。
 */

import { Circle, HStack, Image, Rectangle, Spacer, Text, VStack, ZStack } from "scripting"

import type { AgendaItem, DayItem, TodoItem } from "./data"
import type { DynStyle } from "./theme"
import { dayCountdown, resolveDayDate } from "./data"
import { WEEKDAY_CN, addDays, sameDate, toLunar } from "./lunar"
import { C } from "./theme"
import { formatClock } from "./settings"

const MONTH_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"]

export type WidgetSize = "small" | "medium" | "large"

/**
 * 真机小组件的背景 —— **不设自定义底色**（`undefined`）。
 *
 * 写法参照「一言小组件」的 generateWidgetBackground()：没开颜色背景时返回 undefined，
 * 即 `widgetBackground={undefined}` —— 不铺底，交给 Scripting / 系统：
 * 普通组件用系统默认材质，透明背景 / 模糊背景 / 图片模拟透明组件直接透出壁纸 / 模糊层。
 * 写死成白 / 黑这种不透明底色，只会把底衬盖掉（这就是「透明背景没了」的来因）。
 */
export const WIDGET_BACKGROUND: DynStyle | undefined = undefined

/** App 内「小组件预览」的卡片底 —— 仅用于预览，不是真机小组件的背景 */
export const PREVIEW_BACKGROUND: DynStyle = { light: "#FFFFFF", dark: "#1C1C1E" }

/** 三种尺寸及其内容（设置页预览用） */
export const WIDGET_SIZES: { key: WidgetSize; label: string; hint: string }[] = [
  { key: "small", label: "小", hint: "月历" },
  { key: "medium", label: "中", hint: "月历 + 待办" },
  { key: "large", label: "大", hint: "月历 + 待办 + 日子" },
]

/** 把小组件字符串收敛成合法尺寸 */
export function normalizeWidgetSize(raw: string | undefined): WidgetSize {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "small" || v === "large") return v
  return "medium"
}

/**
 * 小组件月历固定以「周日」为一周起点（与系统日历一致），
 * 不跟随应用里的「一周开始于」设置。
 */

/** 星期表头顺序：日 一 二 三 四 五 六 */
function weekdayOrder(): number[] {
  return [0, 1, 2, 3, 4, 5, 6]
}

/** 该月 6 周 × 7 天的日期矩阵（周日起点，所以偏移量就是星期几本身） */
function monthWeeks(cursor: Date): Date[][] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const offset = first.getDay()
  let d = addDays(first, -offset)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Date[] = []
    for (let i = 0; i < 7; i++) {
      row.push(d)
      d = addDays(d, 1)
    }
    weeks.push(row)
  }
  return weeks
}

/**
 * 紧凑月历。
 *
 * `compact` 用于小尺寸（字号与格子都更小、不显示农历）；
 * `showLunar` 用于大尺寸（每格下方显示农历日，节气 / 节日用强调色）。
 */
function MiniCalendar({
  today,
  events,
  compact = false,
  showLunar = false,
  showDots = true,
}: {
  today: Date
  events: AgendaItem[]
  compact?: boolean
  showLunar?: boolean
  /** 日期下方的「有事件」圆点；小尺寸格子太密，可以关掉 */
  showDots?: boolean
}) {
  const weeks = monthWeeks(today)
  // 今天的农历（如「八月廿四」），显示在标题行
  const lunarToday = toLunar(today)
  const cellH = compact ? 16 : showLunar ? 22 : 19
  const numFont = compact ? 9.5 : 11

  return (
    <VStack alignment="leading" spacing={compact ? 3 : 4} frame={{ maxWidth: "infinity" }}>
      {/* 标题：公历月 + 农历月名 */}
      <HStack spacing={5} alignment="bottom">
        <Text font={compact ? 12.5 : 14} fontWeight="bold" foregroundStyle={C.text}>
          {`${MONTH_CN[today.getMonth()]}月`}
        </Text>
        <Text font={compact ? 9.5 : 11} foregroundStyle={C.textTertiary}>
          {`${lunarToday.monthName}${lunarToday.dayName}`}
        </Text>
        <Spacer />
      </HStack>

      {/*
        星期表头：外层套一层和日期格完全相同的 VStack，里面的 Text 也用固定宽度。
        否则 Text 的「理想宽度」会参与空间分配，而汉字宽度不一（「一」比「日」宽），
        七列就会宽窄不一，与下面的数字列错位。
      */}
      <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
        {weekdayOrder().map((wd) => (
          <VStack key={wd} spacing={0} frame={{ maxWidth: "infinity" }}>
            <Text
              font={compact ? 8.5 : 9.5}
              foregroundStyle={C.textTertiary}
              frame={{ maxWidth: "infinity" }}
              multilineTextAlignment="center"
            >
              {WEEKDAY_CN[wd]}
            </Text>
          </VStack>
        ))}
      </HStack>

      {/* 日期 */}
      {weeks.map((row, ri) => (
        <HStack key={ri} spacing={0} frame={{ maxWidth: "infinity" }}>
          {row.map((date) => {
            const inMonth = date.getMonth() === today.getMonth()
            const isToday = sameDate(date, today)
            const hasEvent = events.some((e) => sameDate(e.start, date))
            const lunar = showLunar ? toLunar(date) : null

            return (
              // 每一列都让内部 Text 用 maxWidth: infinity 撑开，7 列才会真正等分整行宽度，
              // 与上面的星期表头逐列对齐。若 Text 用固定宽度，外层 VStack 的理想宽度
              // 也只有那么点，maxWidth: infinity 传不下去，整行就会缩在一边。
              <VStack key={date.getTime()} spacing={0} frame={{ maxWidth: "infinity", height: cellH }}>
                <ZStack frame={{ maxWidth: "infinity", height: compact ? 15 : 17 }}>
                  {isToday ? (
                    <Circle
                      fill={C.accent}
                      frame={{ width: compact ? 15 : 17, height: compact ? 15 : 17 }}
                    />
                  ) : null}
                  <Text
                    font={numFont}
                    fontWeight={isToday ? "bold" : "regular"}
                    foregroundStyle={isToday ? C.onAccent : inMonth ? C.text : C.textTertiary}
                    frame={{ maxWidth: "infinity" }}
                    multilineTextAlignment="center"
                  >
                    {String(date.getDate())}
                  </Text>
                </ZStack>

                {showLunar && lunar ? (
                  <Text
                    font={7.5}
                    foregroundStyle={hasEvent ? C.accent : C.textTertiary}
                    frame={{ maxWidth: "infinity" }}
                    multilineTextAlignment="center"
                    lineLimit={1}
                  >
                    {lunar.label}
                  </Text>
                ) : showDots && hasEvent ? (
                  <Circle fill={C.accent} frame={{ width: 3, height: 3 }} />
                ) : null}
              </VStack>
            )
          })}
        </HStack>
      ))}
    </VStack>
  )
}

/** 通用的小节标题 */
function SectionTitle({ title, icon }: { title: string; icon: string }) {
  return (
    <HStack spacing={5}>
      <Image systemName={icon} font={10.5} fontWeight="semibold" foregroundStyle={C.accent} />
      <Text font={11} fontWeight="semibold" foregroundStyle={C.textSecondary}>
        {title}
      </Text>
      <Spacer />
    </HStack>
  )
}

function EmptyHint({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <Text font={compact ? 11 : 12} foregroundStyle={C.textTertiary} lineLimit={2}>
      {text}
    </Text>
  )
}

/** 待办列表 */
function TodoList({
  todos,
  limit,
  showHeader = true,
}: {
  todos: TodoItem[]
  limit: number
  showHeader?: boolean
}) {
  const rows = todos.slice(0, limit)
  if (rows.length === 0) return <EmptyHint text="待办都清空了 🎉" />

  return (
    <VStack alignment="leading" spacing={showHeader ? 7 : 6}>
      {showHeader ? <SectionTitle title="待办" icon="checklist" /> : null}
      {rows.map((item) => (
        <HStack key={item.id} spacing={6}>
          <Image systemName="circle" font={11} foregroundStyle={C.textTertiary} />
          <VStack alignment="leading" spacing={0}>
            <Text font={12} fontWeight="medium" foregroundStyle={C.text} lineLimit={1}>
              {item.title}
            </Text>
            {item.due ? (
              <Text font={9.5} foregroundStyle={C.textTertiary} lineLimit={1}>
                {`${item.due.getMonth() + 1}/${item.due.getDate()}${item.hasTime ? ` ${formatClock(item.due)}` : ""}`}
              </Text>
            ) : null}
          </VStack>
          <Spacer />
        </HStack>
      ))}
    </VStack>
  )
}

/** 日子倒数列表 */
function DayList({
  days,
  today,
  limit,
  showHeader = true,
}: {
  days: DayItem[]
  today: Date
  limit: number
  showHeader?: boolean
}) {
  const rows = days
    .map((day) => ({ day, date: resolveDayDate(day, today) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, limit)

  if (rows.length === 0) return <EmptyHint text="还没有日子" />

  return (
    <VStack alignment="leading" spacing={showHeader ? 7 : 6}>
      {showHeader ? <SectionTitle title="日子" icon="hourglass" /> : null}
      {rows.map(({ day, date }) => {
        const { text } = dayCountdown(day, today)
        return (
          <HStack key={day.id} spacing={6}>
            <Text font={13}>{day.emoji}</Text>
            <VStack alignment="leading" spacing={0}>
              <Text font={12} fontWeight="semibold" foregroundStyle={C.text} lineLimit={1}>
                {day.title}
              </Text>
              <Text font={9.5} foregroundStyle={C.textTertiary} lineLimit={1}>
                {`${date.getMonth() + 1}/${date.getDate()}`}
              </Text>
            </VStack>
            <Spacer />
            <Text font={11.5} fontWeight="bold" foregroundStyle={C.accent}>
              {text}
            </Text>
          </HStack>
        )
      })}
    </VStack>
  )
}

/**
 * 完整的小组件版式：背景层 + 内容 + 内边距。
 *
 * 真机小组件只声明 `widgetBackground`，值就是 `WIDGET_BACKGROUND`（undefined = 不铺底）；
 * App 内预览不是小组件，给自己的卡片底。
 */
export function WidgetContent({
  size,
  days,
  events,
  todos,
  today,
  inWidget = true,
}: {
  size: WidgetSize
  days: DayItem[]
  events: AgendaItem[]
  todos: TodoItem[]
  today: Date
  /** true = 真机小组件；false = App 内设置页预览 */
  inWidget?: boolean
}) {
  const bgProps = (inWidget
    ? { widgetBackground: WIDGET_BACKGROUND }
    : { background: PREVIEW_BACKGROUND }) as any

  return (
    <ZStack alignment="topLeading" {...bgProps}>
      <VStack
        alignment="leading"
        spacing={0}
        padding={13}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      >
        {size === "small" ? (
          /* 小尺寸：只有月历（格子小，不打点） */
          <MiniCalendar today={today} events={events} compact={true} showDots={false} />
        ) : size === "medium" ? (
          /* 中尺寸：左月历 + 右待办 */
          <HStack alignment="top" spacing={14} frame={{ maxWidth: "infinity" }}>
            <VStack alignment="leading" spacing={0} frame={{ width: 152 }}>
              <MiniCalendar today={today} events={events} compact={true} />
            </VStack>
            <Rectangle fill={C.separator} frame={{ width: 0.5, height: 118 }} />
            <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
              <TodoList todos={todos} limit={4} />
            </VStack>
          </HStack>
        ) : (
          /* 大尺寸：月历（带农历）+ 下方待办 / 日子 */
          <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <Spacer />
              <VStack alignment="leading" spacing={0} frame={{ width: 252 }}>
                <MiniCalendar today={today} events={events} showLunar={true} />
              </VStack>
              <Spacer />
            </HStack>
            <DividerLine />
            <HStack alignment="top" spacing={14} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
                <TodoList todos={todos} limit={3} />
              </VStack>
              <Rectangle fill={C.separator} frame={{ width: 0.5, height: 82 }} />
              <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
                <DayList days={days} today={today} limit={3} />
              </VStack>
            </HStack>
          </VStack>
        )}
      </VStack>
    </ZStack>
  )
}

/** 细分隔线 */
function DividerLine() {
  return (
    <Rectangle
      fill={C.separator}
      frame={{ maxWidth: "infinity", height: 0.5 }}
      padding={{ vertical: 6 }}
    />
  )
}
