import {
  Button,
  HStack,
  Image,
  List,
  NavigationStack,
  Section,
  Text,
  VStack,
  useState,
  useEffect,
} from "scripting"
import { pageToolbar } from "./chrome"
import { RemoteImage } from "../imageLoader"
import { loadSourcesConfig } from "../sources/config"
import { buildMediaGroups, type MediaGroup } from "../sources/mediaGroups"
import { presentDetail } from "./detail"
import {
  clearScrapeLibrary,
  loadScrapeLibrary,
  removeScrapeEntry,
  type ScrapeEntry,
} from "../storage"

export function ScrapePage({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ScrapeEntry[]>(() => loadScrapeLibrary())
  const [status, setStatus] = useState("")

  const refresh = () => setEntries(loadScrapeLibrary())

  const CATEGORY_ORDER = ["电影", "电视剧", "动画电影", "动画剧集", "纪录片", "综艺", "少儿", "新闻"]
  // 按「一部影视」聚合（不能按集/文件列，否则全是同一张海报）
  const allGroups = buildMediaGroups(entries)
  const byCat = new Map<string, MediaGroup[]>()
  for (const g of allGroups) {
    const key = g.category || (g.type === "series" ? "电视剧" : "电影")
    const list = byCat.get(key) || []
    list.push(g)
    byCat.set(key, list)
  }
  const categories = [
    ...CATEGORY_ORDER.filter(c => byCat.has(c)),
    ...[...byCat.keys()].filter(c => !CATEGORY_ORDER.includes(c)),
  ]

  const openGroup = async (group: MediaGroup) => {
    await presentDetail(group)
    refresh()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="海报刮削"
        navigationBarTitleDisplayMode="inline"
        toolbar={pageToolbar(onClose)}
      >
        <Section header={<Text textCase={null}>刮削库</Text>}>
          <HStack spacing={8}>
            <Text font="subheadline">
              {allGroups.length} 部影视 · {entries.length} 个文件 · {categories.length} 个分类
            </Text>
          </HStack>
          <HStack spacing={8}>
            <Button title="刷新" systemImage="arrow.clockwise" action={refresh} />
            <Button
              title="清空"
              systemImage="trash"
              action={() => {
                clearScrapeLibrary()
                refresh()
                setStatus("已清空刮削库")
              }}
            />
          </HStack>
          {status ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {status}
            </Text>
          ) : null}
        </Section>

        {entries.length === 0 ? (
          <Section>
            <VStack alignment="leading" spacing={8} padding={12}>
              <HStack spacing={8}>
                <Image systemName="sparkles.tv" foregroundStyle="systemIndigo" />
                <Text font="subheadline">还没有刮削内容</Text>
              </HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">
                打开「媒体库」→ 115 网盘，进入某个文件夹后点「刮削此文件夹」，结果会存到本地。
              </Text>
            </VStack>
          </Section>
        ) : null}

        {categories.map(category => {
          const list = byCat.get(category) || []
          return (
            <Section key={category} header={<Text textCase={null}>{`${category} (${list.length})`}</Text>}>
              {list.map(group => (
                <Button key={group.key} action={() => openGroup(group)}>
                  <HStack spacing={10} frame={{ maxWidth: "infinity" }} contentShape="rect">
                    <VStack
                      frame={{ width: 46, height: 68 }}
                      clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
                    >
                      <RemoteImage url={group.poster} width={46} height={68} radius={8} />
                    </VStack>
                    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                      <Text font="subheadline" fontWeight="medium" lineLimit={1}>
                        {group.title}
                      </Text>
                      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {[
                          group.year,
                          group.type === "series" ? `${group.episodeCount} 集` : "",
                          group.rating ? `★${group.rating.toFixed(1)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "未匹配到 TMDB"}
                      </Text>
                    </VStack>
                    <Image systemName="chevron.right" font="caption" foregroundStyle="secondaryLabel" />
                  </HStack>
                </Button>
              ))}
            </Section>
          )
        })}

        {entries.length > 0 ? (
          <Section header={<Text textCase={null}>管理</Text>}>
            {entries.slice(0, 40).map(entry => (
              <HStack key={`m_${entry.id}`} spacing={10} frame={{ maxWidth: "infinity" }}>
                <Text font="footnote" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {entry.title}
                </Text>
                <Button
                  title="删除"
                  systemImage="trash"
                  foregroundStyle="systemRed"
                  action={() => {
                    removeScrapeEntry(entry.id)
                    refresh()
                  }}
                />
              </HStack>
            ))}
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}
