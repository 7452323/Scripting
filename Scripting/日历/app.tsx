/**
 * 日历
 *
 * 结构：底部四 Tab（月历 / 日程 / 待办 / 日子），全屏呈现，左上角关闭按钮。
 * 数据：日程 ← 系统日历，待办 ← 系统提醒事项，日子 ← 本地存储；取不到时回退示例数据。
 * 关闭按钮由 index.tsx 注入（Navigation.useDismiss）。
 */

import {
  Button,
  Circle,
  DatePicker,
  Divider,
  HStack,
  Image,
  LazyVGrid,
  LazyVStack,
  List,
  RoundedRectangle,
  Rectangle,
  ScrollView,
  Script,
  Section,
  Spacer,
  Tab,
  TabView,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useObservable,
  useColorScheme,
  Widget,
} from "scripting"
import type { Color, DynamicShapeStyle, ShapeStyle } from "scripting"

import { CHANGELOG_KEY, VERSION, latestEntry } from "./changelog"
import { ACCENT_THEMES, C, F, applyAccentTheme, applyAppearance } from "./theme"
import { WIDGET_BACKGROUND, WIDGET_SIZES, WidgetContent, type WidgetSize } from "./widget_views"
import { sendTestNotification, rescheduleAll } from "./notify"
import {
  applyRuntime,
  formatClock,
  loadSettings,
  runtime,
  saveSettings,
  type Settings,
  type WeekStart,
} from "./settings"
import {
  WEEKDAY_CN,
  addDays,
  festivalOn,
  formatMonthDay,
  nextTerm,
  relativeDayName,
  sameDate,
  startOfDay,
  termOnDate,
  toLunar,
} from "./lunar"
import {
  DayItem,
  DayKind,
  DayRepeat,
  AgendaItem,
  TodoItem,
  dayCountdown,
  formatDaySubtitle,
  loadDays,
  loadDoneIds,
  loadSystemEvents,
  loadSystemTodos,
  resolveDayDate,
  sampleEvents,
  sampleTodos,
  saveDays,
  saveDoneIds,
  weekdayLabel,
} from "./data"

const MONTH_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"]
const GRID_COLUMNS = Array.from({ length: 7 }, () => ({ size: { type: "flexible" as const } }))

/** 打开系统「日历」的编辑界面（月历页点击日程） */
async function openSystemEventEditor(identifier: string, onChanged?: () => void) {
  try {
    const event = await CalendarEvent.get(identifier)
    if (!event) {
      await Dialog.alert({ title: "无法编辑", message: "这条日程已不存在，可能在别处被删掉了。" })
      return
    }
    await event.presentEditView()
    if (onChanged) onChanged()
  } catch (e) {
    await Dialog.alert({ title: "无法编辑", message: "请确认已授予日历权限。" })
  }
}

/* ================================================================== */
/* 触感                                                                */
/* ================================================================== */

/**
 * 统一入口的触感反馈。
 *
 * 包一层 try/catch 的原因：`HapticFeedback` 是原生调用，在某些上下文
 * （sheet 正在关闭、预览环境、音频会话被占用）里会抛错，裸叫会直接把
 * 整个脚本带崩。触感属于锦上添花，任何情况下都不应该影响主流程。
 */
function haptic(kind: "selection" | "light" | "success" | "warning"): void {
  try {
    if (kind === "selection") HapticFeedback.selection()
    else if (kind === "light") HapticFeedback.lightImpact()
    else if (kind === "success") HapticFeedback.notificationSuccess()
    else HapticFeedback.notificationWarning()
  } catch (e) {
    /* 触感不可用时静默忽略 */
  }
}

/* ================================================================== */
/* 基础组件                                                            */
/* ================================================================== */

/** 圆形图标（普通函数返回视图，避免组件抽象带来的渲染差异） */
function circleIcon(options: {
  systemName: string
  size?: number
  iconFont?: number
  tint?: Color
  background?: ShapeStyle | DynamicShapeStyle
  onTap?: () => void
}) {
  const size = options.size ?? 32
  const tint = options.tint ?? C.accent
  const background = options.background ?? C.accentSoft
  return (
    <ZStack onTapGesture={options.onTap}>
      <Circle fill={background} frame={{ width: size, height: size }} />
      <Image
        systemName={options.systemName}
        font={options.iconFont ?? 14}
        fontWeight="semibold"
        foregroundStyle={tint}
      />
    </ZStack>
  )
}

function Chip({ text, color, background }: { text: string; color: Color; background: ShapeStyle | DynamicShapeStyle }) {
  return (
    <Text
      font={11.5}
      fontWeight="semibold"
      foregroundStyle={color}
      padding={{ horizontal: 8, vertical: 3.5 }}
      background={{ style: background, shape: "capsule" }}
    >
      {text}
    </Text>
  )
}

/** 每页统一的顶部工具栏：左上角关闭按钮 */
function Toolbar({
  onClose,
  onAdd,
  leading,
}: {
  onClose: () => void
  onAdd?: () => void
  leading?: unknown
}) {
  return (
    <HStack spacing={10} padding={{ horizontal: 18, top: 4, bottom: 8 }}>
      {circleIcon({ systemName: "xmark", iconFont: 13, onTap: onClose })}
      {leading as any}
      <Spacer />
      {onAdd
        ? circleIcon({
            systemName: "plus",
            iconFont: 15,
            tint: "#FFFFFF",
            background: C.accent,
            size: 34,
            onTap: onAdd,
          })
        : null}
    </HStack>
  )
}

function SectionLabel({ text, count }: { text: string; count?: number }) {
  return (
    <HStack spacing={6} padding={{ horizontal: 22, top: 16, bottom: 8 }}>
      <Text font={13} fontWeight="bold" foregroundStyle={C.textSecondary}>
        {text}
      </Text>
      {count !== undefined ? (
        <Text font={13} fontWeight="bold" foregroundStyle={C.textTertiary}>
          {String(count)}
        </Text>
      ) : null}
      <Spacer />
    </HStack>
  )
}

function Card({ children }: { children: unknown }) {
  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: 14, vertical: 4 }}
      background={{ style: C.surface, shape: { type: "rect", cornerRadius: 16 } }}
    >
      {children as any}
    </VStack>
  )
}

/* ================================================================== */
/* 月历页                                                              */
/* ================================================================== */

function MonthCell({
  date,
  inMonth,
  isToday,
  isSelected,
  label,
  festival,
  term,
  hasEvent,
  hasDay,
  onSelect,
}: {
  date: Date
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  label: string
  festival: string | null
  term: string | null
  hasEvent: boolean
  /** 该日是否有「日子」标记（受日子自带的「在月历中显示」控制） */
  hasDay: boolean
  onSelect: (d: Date) => void
}) {
  const highlighted = isSelected
  const dayColor = highlighted
    ? "#FFFFFF"
    : isToday
      ? C.accent
      : inMonth
        ? C.text
        : C.textTertiary

  const subText = term ?? festival ?? label
  const subColor = !inMonth
    ? C.textTertiary
    : term
      ? C.greenDeep
      : festival
        ? C.accent
        : C.textSecondary

  return (
    <VStack
      alignment="center"
      spacing={1}
      padding={{ vertical: 3 }}
      onTapGesture={() => onSelect(date)}
    >
      <Text
        font={17}
        fontWeight={highlighted || isToday ? "bold" : "semibold"}
        foregroundStyle={dayColor}
        frame={{ width: 34, height: 32 }}
        background={
          highlighted || isToday
            ? { style: C.accent, shape: { type: "rect", cornerRadius: 10 } }
            : undefined
        }
        multilineTextAlignment="center"
      >
        {String(date.getDate())}
      </Text>
      <Text font={9.5} foregroundStyle={subColor} lineLimit={1}>
        {subText}
      </Text>
      {/* 圆点 = 有日程，方点 = 有日子（形状区分，不会看混） */}
      <HStack spacing={3} frame={{ height: 4 }}>
        <RoundedRectangle
          cornerRadius={999}
          fill={hasEvent && inMonth ? C.accent : "clear"}
          frame={{ width: 4, height: 4 }}
        />
        <RoundedRectangle
          cornerRadius={1}
          fill={hasDay && inMonth ? C.greenDeep : "clear"}
          frame={{ width: 4, height: 4 }}
        />
      </HStack>
    </VStack>
  )
}

function EventTimeLabel({ item }: { item: AgendaItem }) {
  if (item.isAllDay) {
    return (
      <Text font={12} fontWeight="medium" foregroundStyle={C.textSecondary}>
        全天
      </Text>
    )
  }
  return (
    <Text font={12.5} fontWeight="medium" foregroundStyle={C.textSecondary}>
      {formatClock(item.start)}
    </Text>
  )
}

function EventRow({ item, last, onTap }: { item: AgendaItem; last: boolean; onTap?: () => void }) {
  return (
    <VStack spacing={0}>
      <HStack
        spacing={10}
        padding={{ vertical: 10 }}
        contentShape="rect"
        onTapGesture={onTap ? onTap : () => {}}
      >
        <RoundedRectangle
          cornerRadius={999}
          fill={item.color}
          frame={{ width: 3.5, height: 34 }}
        />
        <VStack alignment="leading" spacing={2}>
          <Text font={15.5} fontWeight="semibold" foregroundStyle={C.text} lineLimit={2}>
            {item.isAllDay ? `全天 ${item.title}` : item.title}
          </Text>
          {item.location ? (
            <HStack spacing={3}>
              <Image systemName="mappin.and.ellipse" font={11} foregroundStyle={C.textTertiary} />
              <Text font={12} foregroundStyle={C.textSecondary} lineLimit={1}>
                {item.location}
              </Text>
            </HStack>
          ) : null}
          {item.notes ? (
            <Text font={12} foregroundStyle={C.textTertiary} lineLimit={1}>
              {item.notes}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <EventTimeLabel item={item} />
          {item.meeting ? <Chip text={item.meeting} color={C.greenDeep} background={C.greenSoft} /> : null}
          <Image systemName="chevron.right" font={11} foregroundStyle={C.textTertiary} />
        </VStack>
      </HStack>
      {last ? null : <Divider />}
    </VStack>
  )
}

function MonthScreen({
  today,
  events,
  todos,
  days,
  doneIds,
  onClose,
  onAdd,
  onToggle,
  onChanged,
}: {
  today: Date
  events: AgendaItem[]
  todos: TodoItem[]
  days: DayItem[]
  doneIds: string[]
  onClose: () => void
  onAdd: () => void
  onToggle: (id: string) => void
  onChanged: () => void
}) {
  const [cursor, setCursor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<Date>(today)

  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const offset = runtime.weekStart === 1 ? (first.getDay() + 6) % 7 : first.getDay()
    const start = addDays(first, -offset)

    // 先把「日子」按今年实际落到的那天收进 Set，避免 42 个格子 × N 条日子重复解析日期
    const dayKeys = new Set<string>()
    for (const d of days) {
      if (d.showOnCalendar === false) continue
      const occ = resolveDayDate(d, today)
      dayKeys.add(`${occ.getFullYear()}-${occ.getMonth()}-${occ.getDate()}`)
    }

    const list = []
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i)
      const lunar = toLunar(date)
      list.push({
        date,
        inMonth: date.getMonth() === cursor.getMonth(),
        isToday: sameDate(date, today),
        label: lunar.label,
        festival: festivalOn(date, lunar),
        term: termOnDate(date),
        hasEvent: events.some((e) => sameDate(e.start, date)),
        hasDay: dayKeys.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`),
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, today.getTime(), events, days, runtime.weekStart])

  const lunarCursor = toLunar(new Date(cursor.getFullYear(), cursor.getMonth(), 15))
  const term = nextTerm(today)
  const termIsToday = term.days === 0

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => sameDate(e.start, selected))
        .sort((a, b) => {
          if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
          return a.start.getTime() - b.start.getTime()
        }),
    [events, selected.getTime()]
  )

  const dayTodos = useMemo(
    () => todos.filter((t) => t.due && sameDate(t.due, selected)),
    [todos, selected.getTime()]
  )

  const shiftMonth = (delta: number) => {
    haptic("selection")
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1)
    setCursor(next)
  }

  return (
    <ScrollView background={pageBackground()} scrollEdgeEffectHidden={true}>
      <VStack alignment="leading" spacing={0} padding={{ bottom: 24 }} frame={{ maxWidth: "infinity" }}>
        <Toolbar
          onClose={onClose}
          onAdd={onAdd}
          leading={
            <Text
              font={13.5}
              fontWeight="semibold"
              foregroundStyle={C.accent}
              padding={{ horizontal: 13, vertical: 7 }}
              background={{ style: C.accentSoft, shape: "capsule" }}
              onTapGesture={() => {
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
                setSelected(today)
              }}
            >
              今天
            </Text>
          }
        />

        {/* 节气横幅 */}
        <VStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ bottom: 10 }}>
          <Text
            font={12.5}
            fontWeight="semibold"
            foregroundStyle={C.greenDeep}
            padding={{ horizontal: 14, vertical: 6 }}
            background={{ style: C.greenSoft, shape: "capsule" }}
          >
            {termIsToday
              ? `今日 ${term.name}`
              : `下一个节气 ${term.name} · ${formatMonthDay(term.date)} · 还有 ${term.days} 天`}
          </Text>
        </VStack>

        {/* 月份标题 */}
        <HStack alignment="bottom" spacing={8} padding={{ horizontal: 20, bottom: 10 }}>
          <VStack alignment="leading" spacing={1}>
            <HStack spacing={6} alignment="bottom">
              <Text font={13} fontWeight="semibold" foregroundStyle={C.accent}>
                {String(cursor.getFullYear())}
              </Text>
              <Text font={13} foregroundStyle={C.textSecondary}>
                {`农历${lunarCursor.monthName}`}
              </Text>
            </HStack>
            {/* 切月时数字滚动一下，比硬切换自然 */}
            <Text
              font={30}
              fontWeight="bold"
              foregroundStyle={C.text}
              contentTransition="numericText"
              animation={{
                animation: Animation.snappy({ duration: 0.28 }),
                value: `${cursor.getFullYear()}-${cursor.getMonth()}`,
              }}
            >
              {`${MONTH_CN[cursor.getMonth()]}月`}
            </Text>
          </VStack>
          <Spacer />
          <Button action={() => shiftMonth(-1)}>
            {circleIcon({ systemName: "chevron.left", iconFont: 13, tint: C.textSecondary, background: C.surfaceSoft, size: 30 })}
          </Button>
          <Button action={() => shiftMonth(1)}>
            {circleIcon({ systemName: "chevron.right", iconFont: 13, tint: C.textSecondary, background: C.surfaceSoft, size: 30 })}
          </Button>
        </HStack>

        {/* 星期表头 */}
        <HStack spacing={0} padding={{ horizontal: 12, bottom: 4 }}>
          {weekOrder().map((wd) => (
            <Text
              key={wd}
              font={12}
              fontWeight="semibold"
              foregroundStyle={C.textTertiary}
              frame={{ maxWidth: "infinity" }}
              multilineTextAlignment="center"
            >
              {WEEKDAY_CN[wd]}
            </Text>
          ))}
        </HStack>

        {/* 月历网格 */}
        <LazyVGrid columns={GRID_COLUMNS} spacing={0} padding={{ horizontal: 12 }}>
          {cells.map((cell) => (
            <MonthCell
              key={cell.date.getTime()}
              date={cell.date}
              inMonth={cell.inMonth}
              isToday={cell.isToday}
              isSelected={sameDate(cell.date, selected)}
              label={cell.label}
              festival={cell.festival}
              term={cell.term}
              hasEvent={cell.hasEvent}
              hasDay={cell.hasDay}
              onSelect={(d) => {
                haptic("selection")
                setSelected(d)
              }}
            />
          ))}
        </LazyVGrid>

        {/* 当日概览 */}
        <HStack spacing={6} padding={{ horizontal: 22, top: 16, bottom: 8 }}>
          <Text font={15} fontWeight="bold" foregroundStyle={C.text}>
            {`${selected.getMonth() + 1}月${selected.getDate()}日`}
          </Text>
          <Text font={13} foregroundStyle={C.textSecondary}>
            {`${weekdayLabel(selected)} · ${toLunar(selected).label}`}
          </Text>
          <Spacer />
          <Text font={12} foregroundStyle={C.textTertiary}>
            {`${dayEvents.length} 个日程 · ${dayTodos.length} 个待办`}
          </Text>
        </HStack>

        {dayEvents.length > 0 ? (
          <VStack padding={{ horizontal: 18 }}>
            <Card>
              {dayEvents.map((item, index) => (
                <EventRow
                  key={`${item.id}-${index}`}
                  item={item}
                  last={index === dayEvents.length - 1}
                  onTap={() => openSystemEventEditor(item.id, onChanged)}
                />
              ))}
            </Card>
          </VStack>
        ) : (
          <VStack padding={{ horizontal: 18 }}>
            <VStack
              alignment="center"
              spacing={6}
              padding={{ vertical: 26 }}
              frame={{ maxWidth: "infinity" }}
              background={{ style: C.surfaceSoft, shape: { type: "rect", cornerRadius: 16 } }}
            >
              <Image systemName="cup.and.saucer" font={20} foregroundStyle={C.textTertiary} />
              <Text font={13.5} foregroundStyle={C.textSecondary}>
                这天没有记录
              </Text>
            </VStack>
          </VStack>
        )}

        {dayTodos.length > 0 ? (
          <VStack spacing={0} padding={{ horizontal: 18, top: 14 }}>
            <SectionLabel text="当天待办" count={dayTodos.length} />
            <Card>
              {dayTodos.map((item, index) => (
                <TodoRow
                  key={`${item.id}-${index}`}
                  item={item}
                  today={today}
                  last={index === dayTodos.length - 1}
                  done={doneIds.includes(item.id)}
                  onToggle={() => onToggle(item.id)}
                />
              ))}
            </Card>
          </VStack>
        ) : null}
      </VStack>
    </ScrollView>
  )
}

/* ================================================================== */
/* 日程页                                                              */
/* ================================================================== */

function AgendaScreen({
  today,
  events,
  onClose,
  onAdd,
  onChanged,
}: {
  today: Date
  events: AgendaItem[]
  onClose: () => void
  onAdd: () => void
  /** 编辑 / 删除日程后重新拉取数据 */
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<AgendaItem | null>(null)
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: AgendaItem[] }>()
    for (const e of events) {
      const key = `${e.start.getFullYear()}-${e.start.getMonth()}-${e.start.getDate()}`
      const bucket = map.get(key)
      if (bucket) bucket.items.push(e)
      else map.set(key, { date: startOfDay(e.start), items: [e] })
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])

  return (
    <ScrollView
      background={pageBackground()}
      scrollEdgeEffectHidden={true}
      sheet={
        detail
          ? {
              content: (
                <EventDetailSheet
                  item={detail}
                  onClose={() => setDetail(null)}
                  onChanged={onChanged}
                />
              ),
              isPresented: true,
              onChanged: (presented: boolean) => {
                if (!presented) setDetail(null)
              },
            }
          : undefined
      }
    >
      {/* 用 LazyVStack：日程可能横跨 -45 ~ +120 天，分组成百条，
          普通 VStack 会一次性全部构建（这就是切到日程页卡一下的原因），
          LazyVStack 只构建可见区域。 */}
      <LazyVStack alignment="leading" spacing={0} padding={{ bottom: 24 }} frame={{ maxWidth: "infinity" }}>
        <Toolbar onClose={onClose} onAdd={onAdd} />
        <Text font={F.largeTitle} fontWeight="bold" foregroundStyle={C.text} padding={{ horizontal: 20, bottom: 12 }}>
          日程
        </Text>

        {groups.length === 0 ? (
          <EmptyState icon="calendar" title="近期没有安排" subtitle="来自系统日历的日程会显示在这里" />
        ) : null}

        {groups.map((group) => (
          <VStack key={group.date.getTime()} spacing={0}>
            <HStack spacing={6} padding={{ horizontal: 22, top: 14, bottom: 6 }}>
              <Text font={12.5} fontWeight="bold" foregroundStyle={C.accent}>
                {relativeDayName(group.date, today)}
              </Text>
              <Text font={12.5} fontWeight="medium" foregroundStyle={C.textSecondary}>
                {`${group.date.getMonth() + 1}月${group.date.getDate()}日 ${weekdayLabel(group.date)} · ${toLunar(group.date).label}`}
              </Text>
              <Spacer />
            </HStack>
            <VStack padding={{ horizontal: 18 }}>
              <Card>
                {group.items.map((item, index) => (
                  <EventRow
                    key={`${item.id}-${index}`}
                    item={item}
                    last={index === group.items.length - 1}
                    onTap={() => setDetail(item)}
                  />
                ))}
              </Card>
            </VStack>
          </VStack>
        ))}
      </LazyVStack>
    </ScrollView>
  )
}

/* ================================================================== */
/* 待办页                                                              */
/* ================================================================== */

function TodoRow({
  item,
  today,
  last,
  done,
  onToggle,
  onDelete,
  swipe = false,
}: {
  item: TodoItem
  today: Date
  last: boolean
  done: boolean
  onToggle: () => void
  onDelete?: () => void
  /** 位于 List 中时启用滑动删除 */
  swipe?: boolean
}) {
  const overdue = item.due ? startOfDay(item.due).getTime() < startOfDay(today).getTime() : false

  const subtitle = (() => {
    const parts: string[] = []
    if (item.due) {
      const suffix = relativeDayName(item.due, today)
      if (item.hasTime) {
        parts.push(`${suffix} ${formatClock(item.due)}`)
      } else {
        parts.push(`${item.due.getMonth() + 1}/${item.due.getDate()} ${weekdayLabel(item.due)}`)
      }
    } else {
      parts.push("无日期")
    }
    parts.push(item.listTitle)
    return parts.join(" · ")
  })()

  const children = [
    <ZStack key="box">
      <Circle
        fill={done ? C.green : "clear"}
        stroke={{
          shapeStyle: done ? C.green : overdue ? C.accent : C.textTertiary,
          strokeStyle: { lineWidth: 1.6 },
        }}
        frame={{ width: 20, height: 20 }}
      />
      {done ? (
        <Image systemName="checkmark" font={10} fontWeight="bold" foregroundStyle="#FFFFFF" />
      ) : null}
    </ZStack>,
    <VStack key="text" alignment="leading" spacing={2}>
      <Text
        font={15.5}
        fontWeight="medium"
        foregroundStyle={done ? C.textTertiary : C.text}
        strikethrough={done ? C.textTertiary : undefined}
        lineLimit={1}
      >
        {item.title}
      </Text>
      <Text font={12} foregroundStyle={overdue && !done ? C.accent : C.textSecondary}>
        {subtitle}
      </Text>
    </VStack>,
    <Spacer key="spacer" />,
    item.priority > 0 ? (
      <RoundedRectangle
        key="dot"
        cornerRadius={999}
        fill={done ? C.textTertiary : item.priority >= 3 ? C.accent : C.green}
        frame={{ width: 6, height: 6 }}
      />
    ) : null,
  ]

  if (swipe && onDelete) {
    return (
      <HStack
        spacing={12}
        padding={{ vertical: 8 }}
        contentShape="rect"
        onTapGesture={onToggle}
        trailingSwipeActions={{
          // 同日子页：不用 role="destructive"，也不用全滑直接触发，
          // 避免系统提前按「已删除」收行导致闪退。
          allowsFullSwipe: false,
          actions: [
            <Button key="del-trailing" title="删除" tint="#FF3B30" action={onDelete} />,
          ],
        }}
      >
        {children}
      </HStack>
    )
  }

  return (
    <VStack spacing={0}>
      <HStack spacing={12} padding={{ vertical: 11 }} onTapGesture={onToggle}>
        {children}
      </HStack>
      {last ? null : <Divider />}
    </VStack>
  )
}

function TodoScreen({
  today,
  todos,
  doneIds,
  onClose,
  onAdd,
  onToggle,
  onDelete,
}: {
  today: Date
  todos: TodoItem[]
  doneIds: string[]
  onClose: () => void
  onAdd: () => void
  onToggle: (id: string) => void
  onDelete: (item: TodoItem) => void
}) {
  const groups = useMemo(() => {
    const overdue: TodoItem[] = []
    const dueToday: TodoItem[] = []
    const upcoming: TodoItem[] = []
    const someday: TodoItem[] = []
    const base = startOfDay(today).getTime()
    for (const t of todos) {
      if (!t.due) {
        someday.push(t)
        continue
      }
      const d = startOfDay(t.due).getTime()
      if (d < base) overdue.push(t)
      else if (d === base) dueToday.push(t)
      else upcoming.push(t)
    }
    const byDate = (a: TodoItem, b: TodoItem) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)
    overdue.sort(byDate)
    dueToday.sort(byDate)
    upcoming.sort(byDate)
    return [
      { key: "overdue", title: "已逾期", items: overdue },
      { key: "today", title: "今天", items: dueToday },
      { key: "upcoming", title: "接下来", items: upcoming },
      { key: "someday", title: "无日期", items: someday },
    ].filter((g) => g.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, today.getTime()])

  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }} background={pageBackground()}>
      <Toolbar onClose={onClose} onAdd={onAdd} />
      <Text font={F.largeTitle} fontWeight="bold" foregroundStyle={C.text} padding={{ horizontal: 20, bottom: 6 }}>
        待办
      </Text>

      {groups.length === 0 ? (
        <EmptyState icon="checkmark.circle" title="没有任务" subtitle="来自系统提醒事项的任务会显示在这里" />
      ) : (
        <List
          listStyle="insetGroup"
          scrollContentBackground="hidden"
          background={pageBackground()}
          scrollEdgeEffectHidden={true}
          listRowBackground={<VStack background={C.surface} />}
          listRowSeparatorTint={C.separator}
        >
          {groups.map((group) => (
            <Section
              key={group.key}
              header={
                <HStack
                  spacing={6}
                  padding={{ horizontal: 4, top: 14, bottom: 6 }}
                  frame={{ maxWidth: "infinity" }}
                  background={pageBackground()}
                >
                  <Text font={13} fontWeight="bold" foregroundStyle={C.textSecondary}>
                    {group.title}
                  </Text>
                  <Text font={13} fontWeight="bold" foregroundStyle={C.textTertiary}>
                    {String(group.items.length)}
                  </Text>
                  <Spacer />
                </HStack>
              }
            >
              {group.items.map((item, index) => (
                <TodoRow
                  key={`${item.id}-${index}`}
                  item={item}
                  today={today}
                  last={index === group.items.length - 1}
                  done={doneIds.includes(item.id)}
                  onToggle={() => onToggle(item.id)}
                  onDelete={() => onDelete(item)}
                  swipe
                />
              ))}
            </Section>
          ))}
        </List>
      )}
    </VStack>
  )
}

/* ================================================================== */
/* 日子页                                                              */
/* ================================================================== */

function DayRow({
  item,
  today,
  last = true,
  inList = false,
  onAccent = false,
}: {
  item: DayItem
  today: Date
  last?: boolean
  /** 位于 List 中：分隔线交给 List 画 */
  inList?: boolean
  /** 置顶橙底 */
  onAccent?: boolean
}) {
  const info = dayCountdown(item, today)
  const subtitle = formatDaySubtitle(item, today)
  const isCycle = item.repeat === "cycle" && item.cycleTotal
  const ratio = isCycle ? Math.min(1, (item.cycleDone ?? 0) / (item.cycleTotal as number)) : 0

  const trailing = (() => {
    if (isCycle) return { text: `${Math.round(ratio * 1000) / 10}%`, sub: "进度" }
    // 纪念日看「已经第几年」，倒数日看「还有几天」
    if (item.kind === "anniversary") {
      const years = yearsSince(item.date, today)
      if (years > 0) return { text: String(years), sub: "周年" }
    }
    if (info.days < 0) return { text: "已过去", sub: `${Math.abs(info.days)} 天` }
    if (info.days === 0) return { text: "就是今天", sub: "" }
    return { text: String(info.days), sub: "天后" }
  })()

  return (
    <VStack spacing={0}>
      <HStack spacing={12} padding={{ vertical: 10 }} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="center"
          frame={{ width: 38, height: 38 }}
          background={{ style: onAccent ? C.accentSoft : C.surfaceSoft, shape: "circle" }}
        >
          <Text font={18}>{item.emoji}</Text>
        </VStack>
        <VStack alignment="leading" spacing={3}>
          <HStack spacing={5}>
            {onAccent ? <Image systemName="pin.fill" font={11} foregroundStyle={C.accent} /> : null}
            <Text font={15.5} fontWeight="semibold" foregroundStyle={C.text} lineLimit={1}>
              {item.title}
            </Text>
          </HStack>
          <Text font={12} foregroundStyle={C.textSecondary} lineLimit={1}>
            {subtitle}
          </Text>
          {isCycle ? (
            <VStack alignment="leading" spacing={4} padding={{ top: 2 }}>
              <ZStack
                alignment="leading"
                frame={{ width: 150, height: 4 }}
                background={{ style: C.greenSoft, shape: { type: "rect", cornerRadius: 2 } }}
              >
                <RoundedRectangle
                  cornerRadius={2}
                  fill={C.green}
                  frame={{ width: Math.max(2, 150 * ratio), height: 4 }}
                />
              </ZStack>
              <Text font={11} fontWeight="semibold" foregroundStyle={C.greenDeep}>
                {`${item.cycleDone ?? 0} 已完成 · 还剩 ${(item.cycleTotal ?? 0) - (item.cycleDone ?? 0)}`}
              </Text>
            </VStack>
          ) : null}
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text
            font={info.days >= 0 && info.days <= 2 ? 14 : 26}
            fontWeight="bold"
            foregroundStyle={info.days < 0 ? C.textTertiary : C.accent}
          >
            {trailing.text}
          </Text>
          {trailing.sub ? (
            <Text font={11} fontWeight="medium" foregroundStyle={C.textSecondary}>
              {trailing.sub}
            </Text>
          ) : null}
        </VStack>
      </HStack>
      {inList || last ? null : <Divider />}
    </VStack>
  )
}

function DaysScreen({
  today,
  days,
  onClose,
  onAdd,
  onEdit,
  onDelete,
}: {
  today: Date
  days: DayItem[]
  onClose: () => void
  onAdd: () => void
  /** 点击条目进入编辑 */
  onEdit: (item: DayItem) => void
  /** 滑动删除 */
  onDelete: (item: DayItem) => void
}) {
  const groups = useMemo(() => {
    const base = startOfDay(today).getTime()
    const pinned = days.filter((d) => d.pinned)
    const rest = days.filter((d) => !d.pinned)
    const now: DayItem[] = []
    const soon: DayItem[] = []
    const later: DayItem[] = []
    for (const d of rest) {
      const diff = Math.round((startOfDay(resolveDayDate(d, today)).getTime() - base) / 86400000)
      if (diff <= 0) now.push(d)
      else if (diff <= 7) soon.push(d)
      else later.push(d)
    }
    const byDate = (a: DayItem, b: DayItem) =>
      resolveDayDate(a, today).getTime() - resolveDayDate(b, today).getTime()
    now.sort(byDate)
    soon.sort(byDate)
    later.sort(byDate)
    return [
      { key: "pinned", title: "置顶", items: pinned, pinned: true },
      { key: "now", title: "今天", items: now, pinned: false },
      { key: "soon", title: "即将", items: soon, pinned: false },
      { key: "later", title: "之后", items: later, pinned: false },
    ].filter((g) => g.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, today.getTime()])

  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }} background={pageBackground()}>
      <Toolbar onClose={onClose} onAdd={onAdd} />
      <Text font={F.largeTitle} fontWeight="bold" foregroundStyle={C.text} padding={{ horizontal: 20, bottom: 12 }}>
        日子
      </Text>

      {groups.length === 0 ? (
        <EmptyState icon="hourglass" title="还没有日子" subtitle="点右上角 ＋ 记下生日、纪念日或倒数日" />
      ) : (
        <List
          listStyle="insetGroup"
          scrollContentBackground="hidden"
          background={pageBackground()}
          scrollEdgeEffectHidden={true}
          listRowBackground={<VStack background={C.surface} />}
          listRowSeparatorTint={C.separator}
        >
          {groups.map((group) => {
            const accentRow = group.key === "pinned"
            return (
              <Section
                key={group.key}
                header={
                  <HStack
                    spacing={6}
                    padding={{ horizontal: 4, top: 14, bottom: 4 }}
                    frame={{ maxWidth: "infinity" }}
                    background={pageBackground()}
                  >
                    <Text font={13} fontWeight="bold" foregroundStyle={C.textSecondary}>
                      {group.title}
                    </Text>
                    <Text font={13} fontWeight="bold" foregroundStyle={C.textTertiary}>
                      {String(group.items.length)}
                    </Text>
                    <Spacer />
                  </HStack>
                }
              >
                {group.items.map((item) => (
                  <HStack
                    key={item.id}
                    frame={{ maxWidth: "infinity" }}
                    contentShape="rect"
                    onTapGesture={() => onEdit(item)}
                    trailingSwipeActions={{
                      // 关掉全滑直接触发：全滑时系统会立即按「已删除」处理，
                      // 而我们要等用户确认，两边时序对不上。
                      allowsFullSwipe: false,
                      actions: [
                        // 用 tint 而不是 role="destructive"：
                        // destructive 会让系统把这次点击当成「已确认删除」立即收行，
                        // 但实际删除要等确认框，系统期望与数据变化错位就会闪退。
                        <Button
                          key="del-trail"
                          title="删除"
                          tint="#FF3B30"
                          action={() => onDelete(item)}
                        />,
                      ],
                    }}
                  >
                    <DayRow item={item} today={today} inList onAccent={accentRow} />
                  </HStack>
                ))}
              </Section>
            )
          })}
        </List>
      )}
    </VStack>
  )
}

/* ================================================================== */
/* 空状态                                                              */
/* ================================================================== */

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <VStack alignment="center" spacing={8} padding={{ top: 60 }} frame={{ maxWidth: "infinity" }}>
      <Image systemName={icon} font={30} foregroundStyle={C.textTertiary} />
      <Text font={15} fontWeight="semibold" foregroundStyle={C.textSecondary}>
        {title}
      </Text>
      <Text font={12.5} foregroundStyle={C.textTertiary}>
        {subtitle}
      </Text>
    </VStack>
  )
}

/* ================================================================== */
/* 更新日志                                                            */
/* ================================================================== */

/* ================================================================== */
/* 日程详情                                                             */
/* ================================================================== */

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <HStack spacing={10} alignment="top" padding={{ vertical: 9 }}>
      <Image systemName={icon} font={13} foregroundStyle={C.textTertiary} frame={{ width: 18 }} />
      <Text font={12.5} fontWeight="medium" foregroundStyle={C.textSecondary} frame={{ width: 34 }}>
        {label}
      </Text>
      <Text font={14} foregroundStyle={C.text}>
        {value}
      </Text>
      <Spacer />
    </HStack>
  )
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <HStack spacing={12} padding={{ vertical: 14 }}>
      <VStack
        alignment="center"
        frame={{ width: 34, height: 34 }}
        background={{ style: C.accentSoft, shape: "circle" }}
        onTapGesture={onClose}
      >
        <Image systemName="xmark" font={14} fontWeight="bold" foregroundStyle={C.accentDeep} />
      </VStack>
      <Text font={17} fontWeight="bold" foregroundStyle={C.text}>
        {title}
      </Text>
      <Spacer />
    </HStack>
  )
}

function SheetButton({
  title,
  icon,
  tone = "normal",
  onTap,
}: {
  title: string
  icon?: string
  tone?: "normal" | "primary" | "danger"
  onTap: () => void
}) {
  const bg = tone === "primary" ? C.accent : C.surface
  const fg = tone === "primary" ? "#FFFFFF" : tone === "danger" ? "#C0392B" : C.accentDeep
  return (
    <HStack
      spacing={8}
      alignment="center"
      padding={{ vertical: 14 }}
      frame={{ maxWidth: "infinity" }}
      background={{ style: bg, shape: { type: "rect", cornerRadius: 14 } }}
      onTapGesture={onTap}
    >
      {icon ? <Image systemName={icon} font={15} foregroundStyle={fg} /> : null}
      <Text font={15.5} fontWeight="semibold" foregroundStyle={fg}>
        {title}
      </Text>
    </HStack>
  )
}

export function EventDetailSheet({
  item,
  onClose,
  onChanged,
}: {
  item: AgendaItem
  onClose: () => void
  /** 编辑或删除后通知外层刷新 */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  const dateText = `${item.start.getFullYear()}年${item.start.getMonth() + 1}月${item.start.getDate()}日 ${weekdayLabel(item.start)}`
  const timeText = (() => {
    if (item.isAllDay) return `${dateText} · 全天`
    const hm = (d: Date) => formatClock(d)
    const sameDay = startOfDay(item.start).getTime() === startOfDay(item.end).getTime()
    if (sameDay) return `${dateText} ${hm(item.start)} – ${hm(item.end)}`
    return `${dateText} ${hm(item.start)} – ${item.end.getMonth() + 1}月${item.end.getDate()}日 ${hm(item.end)}`
  })()

  const openInCalendar = async () => {
    if (busy) return
    setBusy(true)
    try {
      const event = await CalendarEvent.get(item.id)
      if (!event) {
        await Dialog.alert({ title: "无法编辑", message: "这条日程已不存在，可能在别处被删掉了。" })
      } else {
        await event.presentEditView()
        onChanged()
      }
    } catch (e) {
      await Dialog.alert({ title: "无法编辑", message: "请确认已授予日历权限。" })
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const removeEvent = async () => {
    // 同 deleteDay：先收起本 sheet，等动画跑完再弹系统确认框。
    // 在已呈现的 sheet 上叠 alert，两者的 dismiss 会打架导致闪退。
    onClose()
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(undefined), 500)
    })

    const ok = await Dialog.confirm({
      title: "删除此日程？",
      message: item.title,
      confirmLabel: "删除",
    })
    if (!ok) return
    try {
      const event = await CalendarEvent.get(item.id)
      if (event) await event.remove()
    } catch (e) {
      /* 示例数据：仅从界面移除 */
    }
    onChanged()
  }

  return (
    <ScrollView background={pageBackground()} scrollEdgeEffectHidden={true}>
      <VStack alignment="leading" spacing={0} padding={{ horizontal: 20, bottom: 30 }} frame={{ maxWidth: "infinity" }}>
        <SheetHeader title="日程详情" onClose={onClose} />

        <HStack spacing={12} alignment="top" padding={{ vertical: 4, bottom: 14 }}>
          <RoundedRectangle cornerRadius={999} fill={item.color} frame={{ width: 4, height: 46 }} />
          <VStack alignment="leading" spacing={6}>
            <Text font={20} fontWeight="bold" foregroundStyle={C.text}>
              {item.isAllDay ? `全天 ${item.title}` : item.title}
            </Text>
            <Text font={13} foregroundStyle={C.textSecondary}>
              {timeText}
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <Card>
          <InfoRow icon="clock" label="时间" value={item.isAllDay ? "全天" : timeText.replace(`${dateText} `, "")} />
          {item.location ? <InfoRow icon="mappin.and.ellipse" label="地点" value={item.location} /> : null}
          <InfoRow icon="calendar" label="日历" value={item.calendarTitle} />
          {item.meeting ? <InfoRow icon="video" label="会议" value={item.meeting} /> : null}
        </Card>

        {item.notes ? (
          <VStack alignment="leading" spacing={8} padding={{ top: 16 }} frame={{ maxWidth: "infinity" }}>
            <Text font={13} fontWeight="bold" foregroundStyle={C.textSecondary}>
              备注
            </Text>
            <VStack
              alignment="leading"
              padding={{ horizontal: 15, vertical: 14 }}
              frame={{ maxWidth: "infinity" }}
              background={{ style: C.surface, shape: { type: "rect", cornerRadius: 16 } }}
            >
              <Text font={14.5} foregroundStyle={C.text}>
                {item.notes}
              </Text>
            </VStack>
          </VStack>
        ) : null}

        <VStack spacing={10} padding={{ top: 18 }} frame={{ maxWidth: "infinity" }}>
          <SheetButton
            title={busy ? "打开中…" : "在系统日历中编辑"}
            icon="square.and.pencil"
            tone="primary"
            onTap={openInCalendar}
          />
          <SheetButton title="删除此日程" icon="trash" tone="danger" onTap={removeEvent} />
        </VStack>
      </VStack>
    </ScrollView>
  )
}

/* ================================================================== */
/* 日子编辑                                                             */
/* ================================================================== */

const EMOJI_CHOICES = [
  "🎂", "💼", "🎯", "🏥", "✈️", "🚀", "💍", "🏁", "📚", "⭐️",
  "🎓", "💰", "🏠", "❤️", "🍼", "🎉", "📝", "⏰", "🏃", "🍅",
  "🌱", "🎁", "🏆", "🧧", "☕️", "🐣", "🌸", "🔔",
]

const REPEAT_OPTIONS: { key: DayRepeat; label: string }[] = [
  { key: "once", label: "不重复" },
  { key: "yearly", label: "每年公历" },
  { key: "lunar", label: "每年农历" },
  { key: "monthly", label: "每月" },
  { key: "cycle", label: "周期进度" },
]

const KIND_OPTIONS: { key: DayKind; label: string }[] = [
  { key: "countdown", label: "倒数日" },
  { key: "anniversary", label: "纪念日" },
]

// -2 = 跟随设置页的全局提醒；-1 = 显式不提醒；>=0 = 提前 N 天
const REMIND_OPTIONS: { key: number; label: string }[] = [
  { key: -2, label: "跟随设置" },
  { key: -1, label: "不提醒" },
  { key: 0, label: "当天" },
  { key: 1, label: "1天前" },
  { key: 3, label: "3天前" },
  { key: 7, label: "7天前" },
]

function ChoicePills<T extends string | number>({
  options,
  value,
  onSelect,
}: {
  options: { key: T; label: string }[]
  value: T
  onSelect: (value: T) => void
}) {
  return (
    <HStack spacing={8}>
      {options.map((option) => {
        const active = option.key === value
        return (
          <VStack
            key={String(option.key)}
            alignment="center"
            padding={{ horizontal: 10, vertical: 7 }}
            background={{
              style: active ? C.accent : C.accentSoft,
              shape: { type: "rect", cornerRadius: 10 },
            }}
            onTapGesture={() => onSelect(option.key)}
          >
            <Text
              font={13}
              fontWeight={active ? "semibold" : "medium"}
              foregroundStyle={active ? "#FFFFFF" : C.accentDeep}
            >
              {option.label}
            </Text>
          </VStack>
        )
      })}
      <Spacer />
    </HStack>
  )
}

function FieldLabel({ text }: { text: string }) {
  return (
    <Text font={13} fontWeight="bold" foregroundStyle={C.textSecondary} padding={{ top: 16, bottom: 8 }}>
      {text}
    </Text>
  )
}

export function DayEditorSheet({
  initial,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  /** null 表示新建 */
  initial: DayItem | null
  today: Date
  onSave: (item: DayItem) => void
  onDelete?: (item: DayItem) => void
  onClose: () => void
}) {
  const isNew = initial == null
  const [title, setTitle] = useState(isNew ? "" : (initial as DayItem).title)
  const [emoji, setEmoji] = useState(isNew ? "🎂" : (initial as DayItem).emoji)
  const [kind, setKind] = useState<DayKind>(isNew ? "countdown" : ((initial as DayItem).kind ?? "countdown"))
  const [dateTS, setDateTS] = useState<number>(
    (isNew ? addDays(today, 30) : (initial as DayItem).date).getTime()
  )
  const [repeat, setRepeat] = useState<DayRepeat>(isNew ? "once" : (initial as DayItem).repeat)
  const [note, setNote] = useState(isNew ? "" : (initial as DayItem).note)
  const [remindDays, setRemindDays] = useState<number>(
    isNew ? -2 : ((initial as DayItem).remindDays ?? -2)
  )
  // 周期进度：仅在重复方式选「周期进度」时使用
  const [cycleTotal, setCycleTotal] = useState<string>(
    isNew ? "" : String((initial as DayItem).cycleTotal ?? "")
  )
  const [cycleDone, setCycleDone] = useState<string>(
    isNew ? "" : String((initial as DayItem).cycleDone ?? "")
  )
  const [pinned, setPinned] = useState(isNew ? false : (initial as DayItem).pinned)

  const previewDate = new Date(dateTS)
  const info = dayCountdown({ ...(initial ?? ({} as DayItem)), id: "preview", title, date: previewDate, note, emoji, pinned, repeat }, today)
  const previewSubtitle = (() => {
    if (info.days === 0) return "就是今天"
    if (info.days < 0) return `已过去 ${Math.abs(info.days)} 天`
    return `还有 ${info.days} 天`
  })()

  const save = () => {
    const clean = title.trim()
    if (clean.length === 0) return
    const base = initial
    const item: DayItem = {
      id: base?.id ?? `day-${Date.now()}`,
      title: clean,
      date: new Date(dateTS),
      note: note.trim(),
      emoji: emoji || "🎯",
      pinned,
      repeat,
      kind,
      remindDays,
      showOnCalendar: base?.showOnCalendar ?? true,
      cycleDone: repeat === "cycle" ? Math.max(0, Number(cycleDone) || 0) : undefined,
      cycleTotal: repeat === "cycle" ? Math.max(0, Number(cycleTotal) || 0) || undefined : undefined,
      color: base?.color,
    }
    onSave(item)
  }

  return (
    <ScrollView background={pageBackground()} scrollEdgeEffectHidden={true}>
      <VStack alignment="leading" spacing={0} padding={{ horizontal: 20, bottom: 30 }} frame={{ maxWidth: "infinity" }}>
        <SheetHeader title={isNew ? "新建日子" : "编辑日子"} onClose={onClose} />

        <HStack
          spacing={14}
          padding={{ horizontal: 16, vertical: 16 }}
          background={{ style: C.surface, shape: { type: "rect", cornerRadius: 18 } }}
        >
          <VStack
            alignment="center"
            frame={{ width: 52, height: 52 }}
            background={{ style: C.accentSoft, shape: "circle" }}
          >
            <Text font={26}>{emoji || "🎯"}</Text>
          </VStack>
          <VStack alignment="leading" spacing={4}>
            <Text font={17} fontWeight="bold" foregroundStyle={C.text} lineLimit={1}>
              {title.trim().length > 0 ? title.trim() : "如：小雨生日"}
            </Text>
            <Text font={12.5} foregroundStyle={C.textSecondary} lineLimit={1}>
              {previewSubtitle}
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <FieldLabel text="标题" />
        <VStack
          padding={{ horizontal: 14, vertical: 4 }}
          frame={{ maxWidth: "infinity" }}
          background={{ style: C.surface, shape: { type: "rect", cornerRadius: 12 } }}
        >
          <TextField title="" prompt="如：小雨生日" value={title} onChanged={setTitle} />
        </VStack>

        <FieldLabel text="图标" />
        <LazyVGrid columns={Array.from({ length: 7 }, () => ({ size: { type: "flexible" as const } }))} spacing={8}>
          {EMOJI_CHOICES.map((choice) => {
            const active = choice === emoji
            return (
              <VStack
                key={choice}
                alignment="center"
                frame={{ height: 40 }}
                background={{ style: active ? C.accentSoft : C.surface, shape: { type: "rect", cornerRadius: 10 } }}
                border={active ? { style: C.accent, width: 1.5 } : undefined}
                onTapGesture={() => setEmoji(choice)}
              >
                <Text font={20}>{choice}</Text>
              </VStack>
            )
          })}
        </LazyVGrid>

        <FieldLabel text="类型" />
        <ChoicePills options={KIND_OPTIONS} value={kind} onSelect={setKind} />

        <FieldLabel text="日期" />
        <DatePicker
          title=""
          displayedComponents={["date"]}
          value={dateTS}
          onChanged={(value: number) => setDateTS(value)}
        />

        <FieldLabel text="重复" />
        <ChoicePills options={REPEAT_OPTIONS} value={repeat} onSelect={setRepeat} />
        {repeat === "cycle" ? (
          <HStack spacing={10} padding={{ top: 8 }}>
            <Text font={13.5} foregroundStyle={C.textSecondary}>
              共
            </Text>
            <VStack
              padding={{ horizontal: 12, vertical: 3 }}
              frame={{ width: 92 }}
              background={{ style: C.surface, shape: { type: "rect", cornerRadius: 10 } }}
            >
              <TextField title="" prompt="100" value={cycleTotal} onChanged={setCycleTotal} />
            </VStack>
            <Text font={13.5} foregroundStyle={C.textSecondary}>
              天，已完成
            </Text>
            <VStack
              padding={{ horizontal: 12, vertical: 3 }}
              frame={{ width: 78 }}
              background={{ style: C.surface, shape: { type: "rect", cornerRadius: 10 } }}
            >
              <TextField title="" prompt="0" value={cycleDone} onChanged={setCycleDone} />
            </VStack>
          </HStack>
        ) : null}
        {repeat === "lunar" && kind === "anniversary" ? (
          <Text font={12} foregroundStyle={C.textTertiary} padding={{ top: 6 }}>
            农历每年按农历同月同日推算，闰月年份优先过闰月。
          </Text>
        ) : null}

        <FieldLabel text="提醒" />
        <ChoicePills options={REMIND_OPTIONS} value={remindDays} onSelect={setRemindDays} />

        <FieldLabel text="备注" />
        <VStack
          padding={{ horizontal: 14, vertical: 4 }}
          frame={{ maxWidth: "infinity" }}
          background={{ style: C.surface, shape: { type: "rect", cornerRadius: 12 } }}
        >
          <TextField title="" prompt="备注（可选）" value={note} onChanged={setNote} />
        </VStack>

        <HStack spacing={10} padding={{ top: 18, bottom: 4 }}>
          <Text font={14.5} fontWeight="medium" foregroundStyle={C.text}>
            置顶
          </Text>
          <Spacer />
          <Toggle title="" value={pinned} onChanged={setPinned} />
        </HStack>

        <VStack spacing={10} padding={{ top: 16 }} frame={{ maxWidth: "infinity" }}>
          <SheetButton title={isNew ? "添加" : "保存"} icon="checkmark" tone="primary" onTap={save} />
          {!isNew && onDelete ? (
            <SheetButton title="删除这个日子" icon="trash" tone="danger" onTap={() => onDelete(initial as DayItem)} />
          ) : null}
        </VStack>
      </VStack>
    </ScrollView>
  )
}

function ChangelogSheet({ onClose }: { onClose: () => void }) {
  const entry = latestEntry()
  return (
    <ScrollView background={C.surface}>
      <VStack alignment="leading" spacing={14} padding={{ horizontal: 24, top: 28, bottom: 28 }} frame={{ maxWidth: "infinity" }}>
        <HStack spacing={10}>
          <Image systemName="calendar" font={22} foregroundStyle={C.accent} />
          <Text font={20} fontWeight="bold" foregroundStyle={C.text}>
            {`日历 ${entry.version}`}
          </Text>
        </HStack>
        <Text font={13} foregroundStyle={C.textSecondary}>
          {entry.title}
        </Text>
        {entry.notes.map((note, index) => (
          <HStack key={index} spacing={9} alignment="top">
            <Circle fill={C.accent} frame={{ width: 5, height: 5 }} padding={{ top: 6 }} />
            <Text font={14} foregroundStyle={C.text}>
              {note}
            </Text>
          </HStack>
        ))}
        <VStack
          alignment="center"
          frame={{ maxWidth: "infinity" }}
          padding={{ vertical: 12 }}
          background={{ style: C.accent, shape: { type: "rect", cornerRadius: 14 } }}
          onTapGesture={onClose}
        >
          <Text font={15} fontWeight="semibold" foregroundStyle="#FFFFFF">
            知道了
          </Text>
        </VStack>
      </VStack>
    </ScrollView>
  )
}

/* ================================================================== */
/* App 壳                                                              */
/* ================================================================== */

export function App({
  onClose,
  previewEvents,
  previewTodos,
  previewDays,
  previewTab,
  previewDoneIds,
}: {
  onClose: () => void
  /** 以下仅供预览/测试注入数据，正常运行无需传入 */
  previewEvents?: AgendaItem[]
  previewTodos?: TodoItem[]
  previewDays?: DayItem[]
  previewTab?: string
  previewDoneIds?: string[]
}) {
  const [tabIndex, setTabIndex] = useState<number>(initialTabIndex(previewTab))
  // 必须写成 (() => loadSettings())：直接传函数会被当成 state 的初始值（函数本身），
  // 导致 settings.accent / weekStart 全是 undefined，设置全部失效。
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  // 外观恒跟随系统（不做手动切换）。配色要自己展开成单值 ——
  // preferredColorScheme 只影响系统覆盖层，改变不了自己视图的颜色（详见 theme.ts 顶部注释）。
  const systemScheme = useColorScheme()

  // 每次渲染都同步到运行时快照与配色表，供深层组件直接读取
  applyRuntime(settings)
  applyAccentTheme(settings.accent)
  applyAppearance(systemScheme)
  // 配色表刚被改写，让缓存的页面底色元素用新颜色重建
  resetPageBackground()

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettingsState((prev) => {
        const next: Settings = { ...prev, ...patch }
        applyRuntime(next)
        saveSettings(next)
        return next
      })

      // 桌面小组件是独立进程：改完设置它不会自动感知，得主动请求 WidgetKit 刷新，
      // 否则用户会以为「改了没反应」。只在影响小组件的项变化时触发。
      if ("widgetSize" in patch || "accent" in patch) {
        try {
          Widget.reloadAll()
          haptic("light")
        } catch (e) {
          // 不在支持的环境里时忽略（如预览）
        }
      }
    },
    []
  )
  const changelogShown = useObservable<boolean>(false)
  const today = useMemo(() => startOfDay(new Date()), [])
  const [events, setEvents] = useState<AgendaItem[]>(previewEvents ?? [])
  const [todos, setTodos] = useState<TodoItem[]>(previewTodos ?? [])
  const [days, setDays] = useState<DayItem[]>(previewDays ?? [])
  /**
   * days 的最新值镜像。
   *
   * 有了它，saveDay / deleteDay 就不必把 days 列进依赖 —— 否则每次数据变动
   * 都会重建这两个回调，进而冲掉页面级 useMemo（又变回切页卡顿）。
   */
  const daysRef = useRef<DayItem[]>(days)
  daysRef.current = days
  /** 本地完成标记（点击待办出现删除线，跨启动保留） */
  const [doneIds, setDoneIds] = useState<string[]>(() => previewDoneIds ?? loadDoneIds())
  /** doneIds 镜像，理由同 daysRef */
  const doneIdsRef = useRef<string[]>(doneIds)
  doneIdsRef.current = doneIds

  const toggleTodo = useCallback((id: string) => {
    // 触感与存储写入都放在 updater 外（updater 必须是纯函数）
    const prev = doneIdsRef.current
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    doneIdsRef.current = next
    setDoneIds(next)
    saveDoneIds(next)
    haptic("light")
  }, [])

  /** 删除待办：先本地移除，同步移除系统提醒事项 */
  const deleteTodo = useCallback(async (item: TodoItem) => {
    setTodos((prev) => prev.filter((t) => t.id !== item.id))
    const next = doneIdsRef.current.filter((x) => x !== item.id)
    doneIdsRef.current = next
    setDoneIds(next)
    saveDoneIds(next)
    try {
      const reminder = await Reminder.get(item.id)
      if (reminder) await reminder.remove()
    } catch (e) {
      /* 示例数据或系统数据不可用时忽略 */
    }
  }, [])

  /** 重新拉取系统数据（新建后刷新用） */
  const reload = useCallback(async () => {
    const [evts, tds] = await Promise.all([
      loadSystemEvents(addDays(today, -45), addDays(today, 120)).catch(() => [] as AgendaItem[]),
      loadSystemTodos().catch(() => [] as TodoItem[]),
    ])
    setEvents(evts.length > 0 ? evts : previewEvents ?? sampleEvents(today))
    setTodos(tds.length > 0 ? tds : previewTodos ?? sampleTodos(today))
  }, [today])

  /** 新建日程：走系统编辑界面 */
  const addEvent = useCallback(async () => {
    try {
      const created = await CalendarEvent.presentCreateView()
      if (created) await reload()
    } catch (e) {
      await Dialog.alert({ title: "创建失败", message: "请确认已授予日历权限。" })
    }
  }, [reload])

  /** 新建待办：写入系统提醒事项 */
  const addTodo = useCallback(async () => {
    const title = await Dialog.prompt({
      title: "新建待办",
      message: "将写入系统「提醒事项」",
      placeholder: "要做什么？",
      confirmLabel: "添加",
    })
    if (!title || title.trim().length === 0) return
    try {
      const reminder = new Reminder()
      reminder.title = title.trim()
      await reminder.save()
      await reload()
    } catch (e) {
      setTodos((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, title: title.trim(), due: null, hasTime: false, priority: 0, listTitle: "提醒事项", color: C.accent },
      ])
    }
  }, [reload])

  /* --- 日子编辑 ------------------------------------------------- */

  const editorOpen = useObservable<boolean>(false)
  const [editingDay, setEditingDay] = useState<DayItem | null>(null)
  const [editorSeq, setEditorSeq] = useState(0)

  /** 打开新建 / 编辑日子面板；item 为 null 时是新建 */
  const openDayEditor = useCallback(
    (item: DayItem | null) => {
      setEditingDay(item)
      setEditorSeq((n) => n + 1)
      editorOpen.setValue(true)
    },
    [editorOpen]
  )

  const closeDayEditor = useCallback(() => {
    editorOpen.setValue(false)
  }, [editorOpen])

  const saveDay = useCallback(
    (item: DayItem) => {
      // 注意：不要在 setDays 的 updater 里做存储写入 / 触感这类副作用。
      // updater 会在渲染阶段被调用，必须是纯函数。
      const prev = daysRef.current
      const exists = prev.some((d) => d.id === item.id)
      const next = exists ? prev.map((d) => (d.id === item.id ? item : d)) : [...prev, item]
      daysRef.current = next
      setDays(next)
      saveDays(next)
      haptic("success")
      closeDayEditor()
    },
    [closeDayEditor]
  )

  /**
   * 真正执行删除。
   *
   * ⚠️ 不要在这里弹任何系统弹窗 —— 它会被左滑的 swipe action 直接调用，
   * 而「左滑面板 + 系统弹窗」两个 dismissal 叠在一起会闪退。
   * 需要确认的场合请走 deleteDayWithConfirm。
   */
  const deleteDayDirect = useCallback((item: DayItem) => {
    const next = daysRef.current.filter((d) => d.id !== item.id)
    daysRef.current = next
    setDays(next)
    saveDays(next)
    haptic("light")
  }, [])

  /**
   * 带确认的删除，仅用于编辑面板内的删除按钮。
   * 那里本来就是一个 sheet，先收起来再弹确认（同样避免 dismissal 冲突）。
   */
  const deleteDayWithConfirm = useCallback(
    async (item: DayItem) => {
      closeDayEditor()
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(undefined), 500)
      })

      const ok = await Dialog.confirm({
        title: "删除这个日子？",
        message: item.title,
        confirmLabel: "删除",
      })
      if (!ok) return
      deleteDayDirect(item)
    },
    [closeDayEditor, deleteDayDirect]
  )

  /** 日子页的两个入口（稳定引用，避免破坏页面级 useMemo） */
  const onAddDay = useCallback(() => openDayEditor(null), [openDayEditor])
  const onEditDay = useCallback((item: DayItem) => openDayEditor(item), [openDayEditor])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [evts, tds] = await Promise.all([
        loadSystemEvents(addDays(today, -45), addDays(today, 120)).catch(() => [] as AgendaItem[]),
        loadSystemTodos().catch(() => [] as TodoItem[]),
      ])
      if (!alive) return
      setEvents(previewEvents && previewEvents.length > 0 ? previewEvents : evts.length > 0 ? evts : sampleEvents(today))
      setTodos(previewTodos && previewTodos.length > 0 ? previewTodos : tds.length > 0 ? tds : sampleTodos(today))
      setDays(previewDays && previewDays.length > 0 ? previewDays : loadDays(today))
    })().catch(() => {
      if (!alive) return
      setEvents(previewEvents && previewEvents.length > 0 ? previewEvents : sampleEvents(today))
      setTodos(previewTodos && previewTodos.length > 0 ? previewTodos : sampleTodos(today))
      setDays(previewDays && previewDays.length > 0 ? previewDays : loadDays(today))
    })

    return () => {
      alive = false
    }
  }, [])

  // 该版本首次打开时展示更新内容
  useEffect(() => {
    let seen: string | null | undefined
    try {
      seen = Storage.get<string>(CHANGELOG_KEY) ?? undefined
    } catch (e) {
      seen = undefined
    }
    if (seen !== VERSION) changelogShown.setValue(true)
  }, [])

  // 设置或数据变化时重排通知（日子提醒 + 日程会前提醒）。
  // 预览模式（注入了示例数据）不碰真实通知队列。
  useEffect(() => {
    if (previewEvents !== undefined) return
    rescheduleAll(days, events, {
      remindMinutes: settings.remindMinutes,
      eventLeadMinutes: settings.eventLeadMinutes,
    }).catch(() => {
      /* 没有通知权限时静默失败 */
    })
  }, [previewEvents, settings.remindMinutes, settings.eventLeadMinutes, days, events])

  const closeChangelog = useCallback(() => {
    changelogShown.setValue(false)
    try {
      Storage.set(CHANGELOG_KEY, VERSION)
    } catch (e) {
      /* ignore */
    }
  }, [changelogShown])

  // ---- 页面级记忆化 ----------------------------------------------------
  // 5 个 Tab 的内容如果每次 render 都内联新建，切 tab（setTabIndex 触发整个 App 重渲）
  // 时整棵树 —— 5 个页面 × 几十上百个元素 —— 都要重新构造并桥接给 SwiftUI。
  // 日程页元素最多，所以「点日程页面卡一下」。用 useMemo 钉住元素引用后，
  // 切 tab 时依赖未变 ⇒ 引用不变 ⇒ 这层重建被跳过。
  const monthPage = useMemo(
    () => (
      <MonthScreen
        today={today}
        events={events}
        todos={todos}
        days={days}
        doneIds={doneIds}
        onClose={onClose}
        onAdd={addEvent}
        onToggle={toggleTodo}
        onChanged={reload}
      />
    ),
    [today, events, todos, days, doneIds, onClose, addEvent, toggleTodo, reload]
  )

  const agendaPage = useMemo(
    () => (
      <AgendaScreen today={today} events={events} onClose={onClose} onAdd={addEvent} onChanged={reload} />
    ),
    [today, events, onClose, addEvent, reload]
  )

  const todoPage = useMemo(
    () => (
      <TodoScreen
        today={today}
        todos={todos}
        doneIds={doneIds}
        onClose={onClose}
        onAdd={addTodo}
        onToggle={toggleTodo}
        onDelete={deleteTodo}
      />
    ),
    [today, todos, doneIds, onClose, addTodo, toggleTodo, deleteTodo]
  )

  const daysPage = useMemo(
    () => (
      <DaysScreen
        today={today}
        days={days}
        onClose={onClose}
        onAdd={onAddDay}
        onEdit={onEditDay}
        onDelete={deleteDayDirect}
      />
    ),
    [today, days, onClose, onAddDay, onEditDay, deleteDayDirect]
  )

  const settingsPage = useMemo(
    () => (
      <SettingsScreen
        settings={settings}
        onChange={updateSettings}
        onClose={onClose}
        days={days}
        events={events}
        todos={todos}
        today={today}
      />
    ),
    [settings, updateSettings, onClose, days, events, todos, today]
  )

  return (
    // 裸 TabView：保留系统原生 tab bar。页面背景交给各自的
    // `background={<Rectangle ignoresSafeArea />}` 铺满（照搬 AI Usage 的做法）。
    <TabView
      // 主题色 / 外观 / 周起始 / 时间制式变化时重建 TabView：
      // 各个 Tab 的内容会被缓存，不换 key 的话改完主题其它页面不会重绘，
      // preferredColorScheme 也不会重新应用。tabIndex 是 state，重建后仍停在当前页。
      key={`${settings.accent}|${systemScheme}|${settings.weekStart}|${settings.use24Hour}`}
      tabIndex={tabIndex}
      onTabIndexChanged={(i: number) => setTabIndex(i)}
      tint={C.accent}
      sheet={[
        {
          content: <ChangelogSheet onClose={closeChangelog} />,
          isPresented: changelogShown.value,
          onChanged: (presented: boolean) => {
            if (!presented) closeChangelog()
          },
        },
        {
          content: (
            <DayEditorSheet
              key={`day-editor-${editorSeq}`}
              initial={editingDay}
              today={today}
              onSave={saveDay}
              onDelete={deleteDayWithConfirm}
              onClose={closeDayEditor}
            />
          ),
          isPresented: editorOpen.value,
          onChanged: (presented: boolean) => {
            if (!presented) closeDayEditor()
          },
        },
      ]}
    >
            <Tab title="月历" systemImage="calendar" value={0}>
              {monthPage}
            </Tab>
            <Tab title="日程" systemImage="list.bullet" value={1}>
              {agendaPage}
            </Tab>
            <Tab title="待办" systemImage="checklist" value={2}>
              {todoPage}
            </Tab>
            <Tab title="日子" systemImage="hourglass" value={3}>
              {daysPage}
            </Tab>
            <Tab title="设置" systemImage="gearshape" value={4}>
              {settingsPage}
            </Tab>
    </TabView>
  )
}

/** 按「一周开始于」偏好返回列顺序（周日 / 周一开头） */function weekOrder(): number[] {
  return runtime.weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
}

/**
 * 从起始日算起已满多少年（纪念日用）。
 * 按日历判断是否已过今年的周年日，比除以 365 更准。
 */
function yearsSince(origin: Date, today: Date): number {
  const years = today.getFullYear() - origin.getFullYear()
  const passedThisYear =
    today.getMonth() > origin.getMonth() ||
    (today.getMonth() === origin.getMonth() && today.getDate() >= origin.getDate())
  return passedThisYear ? years : years - 1
}

/** 设置页的一行选项：图标 + 标签 + 分段选择 */
function SettingSegment<T extends string | number | boolean>({
  title,
  icon,
  options,
  value,
  onChange,
  compact = false,
}: {
  title?: string
  icon?: string
  options: { label: string; value: T }[]
  value: T
  onChange: (value: T) => void
  /** 嵌在其他卡片里时用：不画标题、去掉上下留白 */
  compact?: boolean
}) {
  return (
    <VStack alignment="leading" spacing={9} padding={compact ? { vertical: 0 } : { vertical: 11 }}>
      {title ? (
        <HStack spacing={8}>
          <Image systemName={icon ?? "circle"} font={14} foregroundStyle={C.accent} />
          <Text font={15} fontWeight="medium" foregroundStyle={C.text}>
            {title}
          </Text>
          <Spacer />
        </HStack>
      ) : null}
      <HStack
        spacing={0}
        padding={{ horizontal: 3, vertical: 3 }}
        frame={{ maxWidth: "infinity" }}
        background={{ style: C.surfaceSoft, shape: { type: "rect", cornerRadius: 10 } }}
      >
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <Button
              key={String(opt.value)}
              action={() => onChange(opt.value)}
              frame={{ maxWidth: "infinity" }}
            >
              <Text
                font={13.5}
                fontWeight={active ? "semibold" : "regular"}
                foregroundStyle={active ? C.text : C.textSecondary}
                frame={{ maxWidth: "infinity" }}
                multilineTextAlignment="center"
                padding={{ vertical: 6 }}
                background={{
                  style: active ? C.surface : "rgba(0,0,0,0)",
                  shape: { type: "rect", cornerRadius: 8 },
                }}
                contentShape="rect"
              >
                {opt.label}
              </Text>
            </Button>
          )
        })}
      </HStack>
    </VStack>
  )
}

/** 设置页 */
function SettingsScreen({
  settings,
  onChange,
  onClose,
  days,
  events,
  todos,
  today,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  /** 以下仅用于渲染小组件预览 */
  days: DayItem[]
  events: AgendaItem[]
  todos: TodoItem[]
  today: Date
}) {
  return (
    <ScrollView background={pageBackground()}>
      <Toolbar onClose={onClose} />
      <Text
        font={F.largeTitle}
        fontWeight="bold"
        foregroundStyle={C.text}
        padding={{ horizontal: 20, top: 4, bottom: 12 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        设置
      </Text>
      <VStack alignment="leading" spacing={14} padding={{ horizontal: 16, bottom: 40 }}>
        <Card>
          <VStack alignment="leading" spacing={9} padding={{ vertical: 11 }}>
            <HStack spacing={8}>
              <Image systemName="paintpalette" font={14} foregroundStyle={C.accent} />
              <Text font={15} fontWeight="medium" foregroundStyle={C.text}>
                主题色
              </Text>
              <Spacer />
            </HStack>
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              {ACCENT_THEMES.map((theme) => {
                const active = theme.id === settings.accent
                return (
                  <Button
                    key={theme.id}
                    action={() => onChange({ accent: theme.id })}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <VStack spacing={5} frame={{ maxWidth: "infinity" }} contentShape="rect">
                      <ZStack>
                        <Circle fill={theme.accent} frame={{ width: 26, height: 26 }} />
                        {active ? (
                          <Image
                            systemName="checkmark"
                            font={12}
                            fontWeight="bold"
                            foregroundStyle={C.onAccent}
                          />
                        ) : null}
                      </ZStack>
                      <Text font={10} foregroundStyle={active ? C.text : C.textTertiary}>
                        {theme.name}
                      </Text>
                    </VStack>
                  </Button>
                )
              })}
            </HStack>
          </VStack>
        </Card>

        {/* 小组件：内嵌实时预览 + 默认展示模式 */}
        <Card>
          <VStack alignment="leading" spacing={11} padding={{ vertical: 11 }}>
            <HStack spacing={8}>
              <Image systemName="square.grid.2x2" font={14} foregroundStyle={C.accent} />
              <Text font={15} fontWeight="medium" foregroundStyle={C.text}>
                小组件
              </Text>
              <Spacer />
            </HStack>

            {/* 预览：与桌面上的真实小组件共用 widget_views.tsx 的渲染代码 */}
            <VStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
              <VStack
                alignment="leading"
                spacing={0}
                frame={
                  settings.widgetSize === "small"
                    ? { width: 155, height: 155 }
                    : {
                        maxWidth: "infinity",
                        height: settings.widgetSize === "large" ? 340 : 158,
                      }
                }
                clipShape={{ type: "rect", cornerRadius: 16 }}
              >
                <WidgetContent
                  size={settings.widgetSize}
                  days={days}
                  events={events}
                  todos={todos}
                  today={today}
                  background={WIDGET_BACKGROUND}
                  inWidget={false}
                />
              </VStack>
            </VStack>

            <SettingSegment<WidgetSize>
              compact={true}
              options={WIDGET_SIZES.map((sz) => ({ label: sz.label, value: sz.key }))}
              value={settings.widgetSize}
              onChange={(v) => onChange({ widgetSize: v })}
            />

            <Text font={11.5} foregroundStyle={C.textTertiary}>
              上面是实时预览，按尺寸显示不同内容：小 = 月历，中 = 月历 + 待办，大 = 月历 + 待办 +
              日子。桌面添加后会自动适配，无需配置。
            </Text>
          </VStack>
        </Card>

        <Card>
          <SettingSegment<WeekStart>
            title="一周开始于"
            icon="calendar"
            value={settings.weekStart}
            options={[
              { label: "周一", value: 1 },
              { label: "周日", value: 0 },
            ]}
            onChange={(v) => onChange({ weekStart: v })}
          />
        </Card>
        <Card>
          <SettingSegment<boolean>
            title="时间制式"
            icon="clock"
            value={settings.use24Hour}
            options={[
              { label: "24 小时", value: true },
              { label: "12 小时", value: false },
            ]}
            onChange={(v) => onChange({ use24Hour: v })}
          />
        </Card>
        <Card>
          <SettingSegment<number>
            title="日子提醒"
            icon="bell"
            value={settings.remindMinutes}
            options={[
              { label: "不提醒", value: -1 },
              { label: "准时", value: 0 },
              { label: "提前 30 分", value: 30 },
              { label: "提前 1 天", value: 1440 },
            ]}
            onChange={(v) => onChange({ remindMinutes: v })}
          />
          <Divider />
          <SettingSegment<number>
            title="会前提醒"
            icon="bell.badge"
            value={settings.eventLeadMinutes}
            options={[
              { label: "不提醒", value: -1 },
              { label: "5 分钟", value: 5 },
              { label: "15 分钟", value: 15 },
              { label: "1 小时", value: 60 },
            ]}
            onChange={(v) => onChange({ eventLeadMinutes: v })}
          />
          <Divider />
          <Button
            action={async () => {
              const ok = await sendTestNotification()
              await Dialog.alert({
                title: ok ? "已发送" : "发送失败",
                message: ok
                  ? "测试通知已排入队列，稍后即可收到。"
                  : "请在系统设置里允许「Scripting」发送通知。",
              })
            }}
          >
            <HStack spacing={8} padding={{ vertical: 12 }} contentShape="rect">
              <Image systemName="paperplane" font={14} foregroundStyle={C.accent} />
              <Text font={15} fontWeight="medium" foregroundStyle={C.text}>
                发送测试通知
              </Text>
              <Spacer />
              <Image systemName="chevron.right" font={12} foregroundStyle={C.textTertiary} />
            </HStack>
          </Button>
        </Card>
        <AboutCard />

        <AuthorCard />
      </VStack>
    </ScrollView>
  )
}

/**
 * 页面底色：延伸到安全区，铺满状态栏与底部。
 *
 * 之前以为“白条”是 TabView 画的材质、想方设法去关它，方向错了 ——
 * 真因是背景没延伸到安全区。AI Usage 的做法：页面级 background 用
 * `<Rectangle ignoresSafeArea allowsHitTesting={false} />`，TabView 裸用即可。
 */
/* ================================================================== */
/* 作者信息                                                            */
/* ================================================================== */

/** 头像与名称取自 GitHub 主页，点击跳转 */
const AUTHOR = {
  name: "Scripting",
  handle: "github.com/7452323",
  url: "https://github.com/7452323",
  /**
   * 头像文件（放在脚本目录里，随脚本一起分发）。
   *
   * 预先缩成 120×120：原图 460×460 直接交给 40pt 的框，
   * 若缩放没生效就会被裁成左上角一小块（就是「头像没显示完整」的原因）。
   */
  avatarFile: "avatar_small.png",
}

/** 关于：一句话说明这个应用是做什么的 */
function AboutCard() {
  return (
    <Card>
      <VStack alignment="leading" spacing={9} padding={{ vertical: 12 }}>
        <HStack spacing={8}>
          <Image systemName="info.circle" font={14} foregroundStyle={C.accent} />
          <Text font={15} fontWeight="medium" foregroundStyle={C.text}>
            关于
          </Text>
          <Spacer />
        </HStack>
        <Text font={12.5} foregroundStyle={C.textSecondary} lineSpacing={3}>
          把日程、待办和重要的日子放在一处。支持农历与节气、桌面小组件、本地提醒，外观跟随系统。
        </Text>
      </VStack>
    </Card>
  )
}

function AuthorCard() {
  return (
    <Card>
      <Button
        action={async () => {
          haptic("light")
          try {
            await Safari.openURL(AUTHOR.url)
          } catch (e) {
            /* 打不开就算了，不打扰用户 */
          }
        }}
      >
        <HStack spacing={12} padding={{ vertical: 12 }} contentShape="rect">
          <Image
            filePath={`${Script.directory}/${AUTHOR.avatarFile}`}
            resizable={true}
            frame={{ width: 40, height: 40 }}
            clipShape="circle"
          />
          <VStack alignment="leading" spacing={2}>
            <Text font={15} fontWeight="semibold" foregroundStyle={C.text}>
              {AUTHOR.name}
            </Text>
            <Text font={12} foregroundStyle={C.textSecondary}>
              {AUTHOR.handle}
            </Text>
          </VStack>
          <Spacer />
          <Image systemName="arrow.up.right" font={12} foregroundStyle={C.textTertiary} />
        </HStack>
      </Button>
    </Card>
  )
}

let pageBgCache: any = null

function pageBackground(): any {
  // 缓存复用：元素本身是纯展示，重建只会让 SwiftUI 白白重绘
  if (!pageBgCache) {
    pageBgCache = <Rectangle fill={C.bg} ignoresSafeArea={true} allowsHitTesting={false} />
  }
  return pageBgCache
}

/** 主题色 / 外观变化后调用，丢弃缓存的底色元素 */
function resetPageBackground(): void {
  pageBgCache = null
}

/** 标签页顺序：把预览传入的标签名映射成索引 */
const TAB_ORDER = ["month", "agenda", "todo", "days", "settings"]

function initialTabIndex(tab?: string): number {
  const i = TAB_ORDER.indexOf(tab ?? "month")
  return i < 0 ? 0 : i
}
