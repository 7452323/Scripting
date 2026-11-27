import {
  Button,
  HStack,
  Image,
  List,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  VStack,
  useState,
  useEffect,
} from "scripting"
import { pageToolbar } from "./chrome"
import { presentPlayer } from "../player"
import { loadSourcesConfig, saveSourcesConfig } from "../sources/config"
import {
  cloud115Check,
  cloud115GetPlayUrl,
  cloud115ListEntries,
  cloud115Space,
  formatSpace,
  type Cloud115Entry,
} from "../sources/cloud115"
import { scrape115Folder } from "../sources/scrape"
import { upsertScrapeEntries, loadScrapeLibrary } from "../storage"
import { RemoteImage } from "../imageLoader"

interface Crumb {
  cid: string
  name: string
}

export function Cloud115Page({ onClose }: { onClose: () => void }) {
  const [stack, setStack] = useState<Crumb[]>([{ cid: "0", name: "115 网盘" }])
  const [entries, setEntries] = useState<Cloud115Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [space, setSpace] = useState("")
  const [scrapedIndex, setScrapedIndex] = useState<
    Record<string, { poster?: string; title: string }>
  >({})

  const refreshScraped = () => {
    const index: Record<string, { poster?: string; title: string }> = {}
    for (const entry of loadScrapeLibrary()) {
      index[entry.refId] = { poster: entry.poster, title: entry.title }
    }
    setScrapedIndex(index)
  }

  const current = stack[stack.length - 1]

  const load = async (cid: string) => {
    const cfg = loadSourcesConfig()
    if (!cfg.cloud115.cookie) {
      setError("还没有登录 115：请到「设置」→ 115 网盘 → 扫码登录")
      setEntries([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await cloud115ListEntries(cfg.cloud115, cid)
      setEntries(list)
      if (!space) {
        try {
          const sp = await cloud115Space(cfg.cloud115)
          setSpace(`${formatSpace(sp.used)}/${formatSpace(sp.total)}`)
          cfg.cloud115.spaceUsed = sp.used
          cfg.cloud115.spaceTotal = sp.total
          saveSourcesConfig(cfg)
        } catch {}
      }
    } catch (e: any) {
      setError(e?.message || "115 目录读取失败")
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(current.cid)
    refreshScraped()
  }, [current.cid])

  const openFolder = (entry: Cloud115Entry) => {
    setStack(prev => [...prev, { cid: entry.id, name: entry.name }])
  }

  const goBack = () => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  const play = async (entry: Cloud115Entry) => {
    const cfg = loadSourcesConfig()
    setStatus(`正在获取播放地址：${entry.name}`)
    try {
      const { url, headers } = await cloud115GetPlayUrl(cfg.cloud115, entry.id)
      setStatus("")
      await presentPlayer({
        url,
        title: entry.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
        headers,
        mediaId: `115_${entry.id}`,
      })
    } catch (e: any) {
      setStatus(e?.message || "115 播放失败")
    }
  }

  const scrapeHere = async () => {
    const cfg = loadSourcesConfig()
    if (!cfg.cloud115.cookie.trim()) {
      setStatus("115 未登录：请到「设置」→ 115 网盘 → 扫码登录")
      return
    }
    if (!cfg.tmdbApiKey.trim()) {
      setStatus("请先在「设置」→ 刮削 (TMDB) 填写 API Key")
      return
    }
    setStatus("正在校验 115 登录态…")
    try {
      await cloud115Check(cfg.cloud115)
    } catch (e: any) {
      setStatus(e?.message || "115 登录态已失效，请到设置重新扫码")
      return
    }

    setStatus("正在扫描并刮削…")
    try {
      let shown = 0
      const result = await scrape115Folder(
        cfg.cloud115,
        cfg.tmdbApiKey,
        current.cid,
        current.name,
        p => {
          // 大目录下每 5 个才刷一次状态，避免疯狂重渲染
          if (p.done === 0 || p.done === p.total || p.done - shown >= 5) {
            shown = p.done
            setStatus(
              p.total > 0
                ? `刮削中 ${p.done}/${p.total}${p.current ? `：${p.current}` : ""}`
                : "正在扫描目录…"
            )
          }
        },
        400,
        6,
        n => setStatus(`正在扫描目录…（已扫描 ${n} 个文件夹）`)
      )
      if (result.length === 0) {
        setStatus("这个文件夹里没有找到视频（会往下找 2 层子目录）")
        return
      }
      upsertScrapeEntries(result)
      refreshScraped()
      const hit = result.filter(e => e.poster).length
      setStatus(
        `完成：${result.length} 个视频，${hit} 个匹配到海报` +
          (result.length >= 400 ? "（已达 400 上限，剩下的请分文件夹刮）" : "") +
          (hit < result.length ? "（没匹配到的可用文件名修正后重新刮削）" : "")
      )
    } catch (e: any) {
      setStatus(e?.message || "刮削失败")
    }
  }

  const folders = entries.filter(e => e.kind === "folder")
  const videos = entries.filter(e => e.kind === "video")
  const scraped = videos.filter(v => scrapedIndex[v.id]).length

  return (
    <NavigationStack>
      <List
        navigationTitle={current.name}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          ...pageToolbar(onClose),
          topBarLeading:
            stack.length > 1 ? (
              <Button
                action={goBack}
                buttonStyle="plain"
                frame={{ width: 44, height: 44 }}
                contentShape="rect"
                accessibilityLabel="返回上级"
              >
                <Image systemName="chevron.left" font="headline" foregroundStyle="label" />
              </Button>
            ) : (
              pageToolbar(onClose).topBarLeading
            ),
        }}
      >
        <Section header={<Text textCase={null}>当前文件夹</Text>}>
          <HStack spacing={10}>
            <Text font="subheadline" lineLimit={1}>
              {stack.map(c => c.name).join(" / ")}
            </Text>
          </HStack>
          <HStack spacing={8}>
            <Button
              title="刷新"
              systemImage="arrow.clockwise"
              action={() => load(current.cid)}
            />
            <Button
              title={scraped > 0 ? `重新刮削 (${scraped})` : "刮削此文件夹"}
              systemImage="sparkles.tv"
              action={scrapeHere}
            />
          </HStack>
          {space ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              空间 {space}
            </Text>
          ) : null}
          {status ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {status}
            </Text>
          ) : null}
        </Section>

        {error ? (
          <Section header={<Text textCase={null}>错误</Text>}>
            <Text font="subheadline" foregroundStyle="systemRed">
              {error}
            </Text>
            <Button title="重试" systemImage="arrow.clockwise" action={() => load(current.cid)} />
          </Section>
        ) : null}

        {loading ? (
          <Section>
            <HStack spacing={10}>
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                正在读取目录…
              </Text>
            </HStack>
          </Section>
        ) : null}

        {folders.length > 0 ? (
          <Section header={<Text textCase={null}>文件夹</Text>}>
            {folders.map(entry => (
              <Button key={entry.id} action={() => openFolder(entry)}>
                <HStack spacing={10} frame={{ maxWidth: "infinity" }} contentShape="rect">
                  <Image systemName="folder.fill" foregroundStyle="systemBlue" />
                  <Text font="subheadline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                    {entry.name}
                  </Text>
                  <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Button>
            ))}
          </Section>
        ) : null}

        {videos.length > 0 ? (
          <Section header={<Text textCase={null}>视频 ({videos.length})</Text>}>
            {videos.map(entry => {
              const meta = scrapedIndex[entry.id]
              return (
                <Button key={entry.id} action={() => play(entry)}>
                  <HStack spacing={10} frame={{ maxWidth: "infinity" }} contentShape="rect">
                    {meta?.poster ? (
                      <VStack
                        frame={{ width: 40, height: 58 }}
                        clipShape={{ type: "rect", cornerRadius: 7, style: "continuous" }}
                      >
                        <RemoteImage url={meta.poster} width={40} height={58} radius={7} />
                      </VStack>
                    ) : null}
                    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                      <Text font="subheadline" fontWeight="medium" lineLimit={2}>
                        {meta?.title || entry.name.replace(/\.[a-z0-9]{2,5}$/i, "")}
                      </Text>
                      <HStack spacing={8}>
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          {entry.size > 0 ? formatSpace(entry.size) : "视频"}
                        </Text>
                        {meta ? (
                          <Text font="caption2" foregroundStyle="systemIndigo">
                            已刮削
                          </Text>
                        ) : null}
                      </HStack>
                    </VStack>
                    <Image systemName="play.circle.fill" font="title3" foregroundStyle="systemIndigo" />
                  </HStack>
                </Button>
              )
            })}
          </Section>
        ) : null}

        {!loading && !error && entries.length === 0 ? (
          <Section>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              这个文件夹里没有子文件夹或视频。
            </Text>
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}
