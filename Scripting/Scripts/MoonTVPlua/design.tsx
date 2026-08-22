import { ProgressView, Text, VStack, type Color } from "scripting"

export const ACCENT: Color = "systemYellow"
export const PAGE_PADDING = 18
export const PAGE_BOTTOM_PADDING = 52
export const SECTION_SPACING = 28
export const GRID_SPACING = 14
export const COVER_RADIUS = 14
export const GRID_COVER_HEIGHT = 208
export const SHELF_CARD_WIDTH = 154
export const SHELF_COVER_HEIGHT = 274
export const ROW_COVER_WIDTH = 88
export const ROW_COVER_HEIGHT = 118

export function LoadingState(props: { title: string; minHeight?: number }) {
  return <VStack spacing={10} frame={{ maxWidth: "infinity", minHeight: props.minHeight ?? 200 }}>
    <ProgressView progressViewStyle="circular" tint={ACCENT} />
    <Text font="subheadline" foregroundStyle="secondaryLabel">{props.title}</Text>
  </VStack>
}
