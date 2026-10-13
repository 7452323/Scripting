import { Button, Divider, HStack, Image, LazyVStack, Text, VStack, ZStack } from "scripting"
import type { Drama } from "../client"
import { ACCENT, COVER_RADIUS, GRID_COVER_HEIGHT, ROW_COVER_HEIGHT, ROW_COVER_WIDTH } from "../design"

/** 顶部封面：底部「共 N 集」胶囊 + 右上角「⋯」（可选）。 */
export function DramaArtwork(props: { drama: Drama; width?: number; height: number; radius?: number; contentMode?: "fill" | "fit" }) {
  const frame = props.width ? { width: props.width, height: props.height } : { maxWidth: "infinity" as const, height: props.height }
  return <ZStack frame={frame} background={props.drama.cover ? undefined : "tertiarySystemFill"} clipShape={{ type: "rect", cornerRadius: props.radius ?? COVER_RADIUS, style: "continuous" }}>
    {props.drama.cover
      ? <Image imageUrl={props.drama.cover} resizable aspectRatio={{ contentMode: props.contentMode ?? "fill" }} frame={frame} clipped={props.contentMode !== "fit"} />
      : <Image systemName="play.rectangle" font="title2" foregroundStyle="tertiaryLabel" />}
    {props.drama.episodeLabel
      ? <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" }} padding={7}>
          <Text font="caption2" fontWeight="bold" foregroundStyle="white" padding={{ horizontal: 7, vertical: 3 }} background="rgba(0,0,0,0.62)" clipShape="capsule">{props.drama.episodeLabel}</Text>
        </HStack>
      : undefined}
  </ZStack>
}

/**
 * 浏览网格卡片：封面 + 标题 + **一个**题材标签（对齐红果的列表样式，
 * 集数已经画在封面上了，信息行不再重复一遍）。
 */
export function DramaCard({ drama, onOpen, width, coverHeight = GRID_COVER_HEIGHT, contentMode = "fill" }: { drama: Drama; onOpen: (drama: Drama) => void; width?: number; coverHeight?: number; contentMode?: "fill" | "fit" }) {
  const cardHeight = coverHeight + 62
  const cardFrame = width ? { width, height: cardHeight, alignment: "topLeading" as const } : { maxWidth: "infinity" as const, height: cardHeight, alignment: "topLeading" as const }
  const textFrame = width ? { width, alignment: "topLeading" as const } : { maxWidth: "infinity" as const, alignment: "topLeading" as const }
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={cardFrame} accessibilityLabel={`${drama.title}，打开详情`}>
    <VStack spacing={6} alignment="leading" frame={cardFrame}>
      <DramaArtwork drama={drama} width={width} height={coverHeight} contentMode={contentMode} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ ...textFrame, height: 36 }}>{drama.title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ ...textFrame, height: 16, alignment: "leading" }}>{drama.tags[0] || "短剧"}</Text>
    </VStack>
  </Button>
}

function meta(drama: Drama): string {
  // 集数只在封面左下角的徽标上显示（和详情页一致），这里不再重复
  return [drama.tags.slice(0, 2).join("·"), drama.hot].filter(Boolean).join(" · ")
}

export function DramaRow({ drama, subtitle, onOpen }: { drama: Drama; subtitle?: string; onOpen: (drama: Drama) => void }) {
  const line = subtitle || meta(drama)
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={{ maxWidth: "infinity" }} accessibilityLabel={`${drama.title}，打开详情`}>
    <HStack spacing={12} alignment="center" padding={{ vertical: 10 }} frame={{ maxWidth: "infinity", minHeight: 140 }}>
      <DramaArtwork drama={drama} width={ROW_COVER_WIDTH} height={ROW_COVER_HEIGHT} radius={10} />
      <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline" fontWeight="semibold" lineLimit={3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.title}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{line || "短剧"}</Text>
        {drama.intro ? <Text font="caption" foregroundStyle="tertiaryLabel" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.intro}</Text> : undefined}
      </VStack>
      <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: 16 }} />
    </HStack>
  </Button>
}

export function DramaRowList({ items, subtitle, onOpen }: { items: Drama[]; subtitle?: (drama: Drama) => string | undefined; onOpen: (drama: Drama) => void }) {
  return <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>
    {items.map((drama, index) => <VStack key={drama.id} spacing={0} frame={{ maxWidth: "infinity" }}>
      <DramaRow drama={drama} subtitle={subtitle?.(drama)} onOpen={onOpen} />
      {index < items.length - 1 ? <Divider /> : undefined}
    </VStack>)}
  </LazyVStack>
}

/**
 * 榜单行：名次徽章 + 封面 + 标题 + **评分 / 热度 / 收藏 / 点赞 / 题材**。
 *
 * 数据全部来自榜单接口自己的已格式化文案（`toDrama` 以前把它们丢了，所以榜上只剩一个「No.1」）。
 * 前三名徽章用品牌色，其余灰色 —— 和原生榜单一个观感。
 */
export function RankRow({ drama, onOpen }: { drama: Drama; onOpen: (drama: Drama) => void }) {
  const top = drama.rank > 0 && drama.rank <= 3
  const meta = [drama.favorites, drama.likes].filter(Boolean).join(" · ")
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={{ maxWidth: "infinity" }} accessibilityLabel={`${drama.rank ? `第 ${drama.rank} 名 ` : ""}${drama.title}，打开详情`}>
    <HStack spacing={12} alignment="top" padding={{ vertical: 12 }} frame={{ maxWidth: "infinity", minHeight: ROW_COVER_HEIGHT + 24 }}>
      <ZStack frame={{ width: 26, height: ROW_COVER_HEIGHT, alignment: "center" }}>
        <Text font="caption" fontWeight="bold" foregroundStyle="white" frame={{ width: 24, height: 24 }}
          background={top ? ACCENT : "rgba(120,120,128,0.35)"} clipShape={{ type: "rect", cornerRadius: 7, style: "continuous" }}>{String(drama.rank || "-")}</Text>
      </ZStack>

      <DramaArtwork drama={drama} width={ROW_COVER_WIDTH} height={ROW_COVER_HEIGHT} radius={10} />

      <VStack spacing={6} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.title}</Text>

        <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {drama.score ? <Text font="caption" fontWeight="semibold" foregroundStyle="white" padding={{ horizontal: 7, vertical: 3 }} background={ACCENT} clipShape={{ type: "rect", cornerRadius: 6, style: "continuous" }}>{`${drama.score} 分`}</Text> : undefined}
          {drama.hot ? <Text font="caption" fontWeight="medium" foregroundStyle={ACCENT} lineLimit={1}>{drama.hot}</Text> : undefined}
          {drama.statusTag ? <Text font="caption2" fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>{drama.statusTag}</Text> : undefined}
        </HStack>

        {meta ? <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{meta}</Text> : undefined}
        {drama.intro ? <Text font="caption" foregroundStyle="tertiaryLabel" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.intro}</Text> : undefined}
        {drama.tags.length ? <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.tags.slice(0, 4).join(" · ")}</Text> : undefined}
      </VStack>
    </HStack>
  </Button>
}

export function RankRowList({ items, onOpen }: { items: Drama[]; onOpen: (drama: Drama) => void }) {
  return <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>
    {items.map((drama, index) => <VStack key={drama.id} spacing={0} frame={{ maxWidth: "infinity" }}>
      <RankRow drama={drama} onOpen={onOpen} />
      {index < items.length - 1 ? <Divider /> : undefined}
    </VStack>)}
  </LazyVStack>
}
