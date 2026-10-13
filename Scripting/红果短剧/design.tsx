import { Button, HStack, Image, ProgressView, Rectangle, Text, VStack, type Color } from "scripting"

export const ACCENT: Color = "systemOrange"
export const PAGE_PADDING = 18
export const PAGE_BOTTOM_PADDING = 52
export const SECTION_SPACING = 26
export const GRID_SPACING = 14
export const COVER_RADIUS = 14
export const SHELF_CARD_WIDTH = 132
/** 红果封面真实尺寸是 640×914（0.70:1）—— 高度必须按同比例，
 *  否则 contentMode=fit 会把海报居中留白，集数徽标就跑到封面下方的空白里去了 */
export const COVER_ASPECT = 914 / 640
export const SHELF_COVER_HEIGHT = Math.round(SHELF_CARD_WIDTH * COVER_ASPECT)
/** 浏览列表统一 3 列（对齐红果） */
export const GRID_COLUMNS = 3
export const GRID_ITEM_SPACING = 10
export const GRID_COVER_HEIGHT = 158
export const ROW_COVER_WIDTH = 88
export const ROW_COVER_HEIGHT = Math.round(ROW_COVER_WIDTH * COVER_ASPECT)

// 列定义按列数缓存：列数固定，但每次 render 都会调一次；新建数组会被 SwiftUI 当成「列变了」重算
const GRID_COLUMN_CACHE = new Map<number, { size: { type: "flexible" }; spacing: number }[]>()
export function gridColumns(count = GRID_COLUMNS) {
  const hit = GRID_COLUMN_CACHE.get(count)
  if (hit) return hit
  const columns = Array.from({ length: count }, (_value, index) => ({
    size: { type: "flexible" as const },
    spacing: index === count - 1 ? 0 : GRID_ITEM_SPACING,
  }))
  GRID_COLUMN_CACHE.set(count, columns)
  return columns
}

// 模块级缓存：避免每次 render 都新建背景元素（会被 SwiftUI 当成「背景变了」重绘）
const PAGE_BACKGROUND = <Rectangle fill="systemBackground" ignoresSafeArea={true} allowsHitTesting={false} />
export function PageBackground() { return PAGE_BACKGROUND }

export function SectionHeading(props: { title: string; subtitle?: string; trailing?: any }) {
  return <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity", alignment: "top" }}>
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title3" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text>
      {props.subtitle ? <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.subtitle}</Text> : undefined}
    </VStack>
    {props.trailing}
  </HStack>
}

export function StateCard(props: { title: string; description: string; systemImage: string; tint?: Color; actionTitle?: string; action?: () => void }) {
  return <VStack spacing={12} padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}>
    <HStack spacing={10}><Image systemName={props.systemImage} foregroundStyle={props.tint ?? ACCENT} frame={{ width: 22 }} /><Text font="headline" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text></HStack>
    <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.description}</Text>
    {props.action && props.actionTitle ? <Button title={props.actionTitle} action={props.action} /> : undefined}
  </VStack>
}

export function LoadingState(props: { title: string; minHeight?: number }) {
  return <VStack spacing={10} frame={{ maxWidth: "infinity", minHeight: props.minHeight ?? 280 }}><ProgressView progressViewStyle="circular" tint={ACCENT} /><Text font="subheadline" foregroundStyle="secondaryLabel">{props.title}</Text></VStack>
}

export function Pagination(props: { page: number; hasNext: boolean; loading: boolean; onPrevious: () => void; onNext: () => void }) {
  return <HStack spacing={10} padding={{ top: 8 }} frame={{ maxWidth: "infinity", minHeight: 48 }}>
    <Button title="上一页" systemImage="chevron.left" disabled={props.page <= 1 || props.loading} action={props.onPrevious} />
    <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${props.page} 页`}</Text>
    <Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!props.hasNext || props.loading} action={props.onNext} />
  </HStack>
}

/** 筛选胶囊。
 *  ⚠️ 选中态**只靠填充色 + 加粗**，千万不要再在里面塞一个 ✓ 图标：
 *  实测（横滑行里）加了 ✓ 以后胶囊宽度不够，文字直接被截成「✓ 穿…」
 *  （用户实报「选上后一个✓导致字显示不全」）。 */
export function Chip(props: { title: string; selected: boolean; secondary?: boolean; disabled?: boolean; action: () => void }) {
  return <Button action={props.action} disabled={props.disabled === true} buttonStyle="plain" contentShape="capsule" accessibilityLabel={props.selected ? `${props.title}（已选中）` : props.title}>
    <HStack spacing={6} padding={{ horizontal: 14, vertical: 9 }} background={props.selected ? ACCENT : props.secondary ? "secondarySystemFill" : "tertiarySystemFill"} clipShape="capsule">
      <Text font="subheadline" fontWeight={props.selected ? "semibold" : "regular"} foregroundStyle={props.selected ? "black" : "label"}>{props.title}</Text>
    </HStack>
  </Button>
}

/** 静态标签胶囊（**不可点**）。
 *  详情页的题材标签用它，比原来那一行「玄幻 · 系统 · 战斗」好看得多；
 *  `highlighted` 给「评分 9.0」这种要抢眼的用（品牌色底 + 白字）。 */
export function TagLabel(props: { text: string; highlighted?: boolean; tint?: Color }) {
  return <Text
    font={props.highlighted ? "caption" : "caption2"}
    fontWeight={props.highlighted ? "semibold" : "medium"}
    foregroundStyle={props.highlighted ? "white" : "secondaryLabel"}
    padding={{ horizontal: props.highlighted ? 9 : 8, vertical: props.highlighted ? 4 : 4 }}
    background={props.highlighted ? ACCENT : "secondarySystemFill"}
    clipShape="capsule">{props.text}</Text>
}
