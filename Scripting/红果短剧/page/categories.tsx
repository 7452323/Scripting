import { Button, HStack, Image, LazyVGrid, ScrollView, Text, VStack, ZStack, useEffect, useState } from "scripting"
import { allCategoryTags, type CategoryInfo } from "../client"
import { ACCENT, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"

/**
 * 分类总览：把红果四个频道的「题材」一次列全（真人剧 24 个，漫剧 / AI剧 各 8 个）。
 * 点任意一项 → 回到发现页并按该频道 + 题材筛选。
 */
export function CategoryPickerPage({ current, onPick }: { current: { slug: string; tag: string }; onPick: (slug: string, tag: string) => void }) {
  const [groups, setGroups] = useState<CategoryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load(force: boolean) {
    setLoading(true); setError("")
    try { setGroups(await allCategoryTags(force)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(false) }, [])

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="全部分类" navigationBarTitleDisplayMode="inline" refreshable={() => load(true)}>
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 10, bottom: PAGE_BOTTOM_PADDING }}>
        <SectionHeading title="红果题材分类" subtitle="与红果站内一致的频道与题材；选择后回到「发现」按该题材筛选。" />
        {loading && !groups.length ? <LoadingState title="正在读取分类" minHeight={260} />
          : error && !groups.length ? <StateCard title="分类加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load(true) }} />
          : groups.map(group => <VStack key={group.slug} spacing={11} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="headline" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{group.name}</Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">{group.tags.length ? `${group.tags.length} 个题材` : "暂无题材"}</Text>
            </HStack>
            {group.tags.length ? <LazyVGrid
              columns={[{ size: { type: "flexible" }, spacing: 10 }, { size: { type: "flexible" }, spacing: 10 }, { size: { type: "flexible" }, spacing: 10 }]}
              alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
              <Button buttonStyle="plain" contentShape="capsule" tint={group.slug === current.slug && !current.tag ? ACCENT : undefined}
                action={() => onPick(group.slug, "")} accessibilityLabel={`${group.name} 全部`}>
                <HStack spacing={5} padding={{ horizontal: 10, vertical: 9 }} frame={{ maxWidth: "infinity" }} background={group.slug === current.slug && !current.tag ? ACCENT : "secondarySystemFill"} clipShape="capsule">
                  <Text font="subheadline" lineLimit={1}>全部</Text>
                </HStack>
              </Button>
              {group.tags.map(item => {
                const selected = group.slug === current.slug && item.slug === current.tag
                return <Button key={item.slug} buttonStyle="plain" contentShape="capsule" tint={selected ? ACCENT : undefined}
                  action={() => onPick(group.slug, item.slug)} accessibilityLabel={`${group.name} ${item.name}`}>
                  <HStack spacing={5} padding={{ horizontal: 10, vertical: 9 }} frame={{ maxWidth: "infinity" }} background={selected ? ACCENT : "secondarySystemFill"} clipShape="capsule">
                    <Text font="subheadline" lineLimit={1} foregroundStyle={selected ? "black" : "label"}>{item.name}</Text>
                  </HStack>
                </Button>
              })}
            </LazyVGrid> : <Text font="footnote" foregroundStyle="tertiaryLabel">该频道暂时没有题材分类，直接浏览全部内容即可。</Text>}
          </VStack>)}
      </VStack>
    </ScrollView>
  </ZStack>
}
