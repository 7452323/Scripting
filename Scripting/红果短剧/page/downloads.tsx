import { Button, HStack, Image, LazyVGrid, ScrollView, Text, VStack, ZStack, useEffect, useMemo, useObservable, useState } from "scripting"
import { ACCENT, COVER_ASPECT, gridColumns, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { clearDownloads, exportFileName, exportTargetLabel, exportVideoFile, exportVideoFiles, filePathOf, formatBytes, loadDownloads, pruneOrphanDownloads, removeDownload, type DownloadItem, type ExportTarget } from "../downloads"
import { cacheFilePath, cacheTotalBytes, clearCache, loadCache, pruneOrphanCache, removeCache, type CacheItem } from "../cache"
import { type Playable, type Playlist } from "../player"
import { WatchPage } from "./watch"
import { finishPlayback } from "../playback"
import { recordPlayback, recordPosition } from "../storage"
import type { Drama } from "../client"
import { DramaArtwork } from "./components"

type Group = { dramaId: string; title: string; cover: string; episodes: DownloadItem[]; bytes: number }
type CacheGroup = { dramaId: string; title: string; episodes: CacheItem[]; bytes: number }

/** 裸调 HapticFeedback 会带崩脚本（历史教训）→ 统一包一层。 */
function hapticSuccess() { try { HapticFeedback.notificationSuccess() } catch { /* 触感不可用不该带崩脚本 */ } }

export function DownloadsPage({ revision, onLibraryChanged }: { revision: number; onLibraryChanged: () => void }) {
  /** 播放页：和详情页一致 —— 点播放进「上面视频 + 下面选集」的页面，不再弹全屏模态。 */
  const [watch, setWatch] = useState<Playlist | null>(null)
  /** 每次打开播放页都换一个 key：返回后再点别的集，拿到的一定是全新实例（不靠对方卸载）。 */
  const [watchNonce, setWatchNonce] = useState(0)
  const watchPresented = useObservable(false)
  const [items, setItems] = useState<DownloadItem[]>(() => loadDownloads())
  const [cached, setCached] = useState<CacheItem[]>(() => loadCache())
  useEffect(() => {
    // ⚠️ 清理要「逐文件 statSync + readDirectorySync」，几百集缓存时要几百毫秒 → 不能在 revision 上跑：
    //    收藏、切集、播放开始/结束、下载完成都会 bump revision，那样就成了「点个收藏卡一下」。
    //    挂载时跑一次（推迟到下一轮事件循环，别挡住首帧），revision 变化只做轻量重读。
    const timer = setTimeout(() => {
      let freed = 0
      try { freed = pruneOrphanDownloads() + pruneOrphanCache() } catch { /* 清理失败不该影响页面 */ }
      if (freed > 1024 * 1024) {
        setNote({ text: `已清理失效文件 · 释放 ${formatBytes(freed)}`, cache: false })
        setItems(loadDownloads())
        setCached(loadCache())
      }
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setItems(loadDownloads())
    setCached(loadCache())
  }, [revision])

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, DownloadItem[]>()
    for (const item of items) {
      const list = map.get(item.dramaId)
      if (list) list.push(item)
      else map.set(item.dramaId, [item])
    }
    return [...map.entries()].map(([dramaId, list]) => {
      const episodes = [...list].sort((a, b) => a.episodeIndex - b.episodeIndex)
      return { dramaId, title: episodes[0].title, cover: episodes[0].cover, episodes, bytes: episodes.reduce((sum, item) => sum + item.bytes, 0) }
    })
  }, [items])

  const [note, setNote] = useState<{ text: string; cache: boolean } | null>(null)
  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + item.bytes, 0), [items])

  const cachedBytes = useMemo(() => cacheTotalBytes(cached), [cached])

  /** 自动缓存按剧分组，方便「重看」时按顺序连着播。 */
  const cacheGroups = useMemo<CacheGroup[]>(() => {
    const map = new Map<string, CacheItem[]>()
    for (const item of cached) {
      const list = map.get(item.dramaId)
      if (list) list.push(item)
      else map.set(item.dramaId, [item])
    }
    return [...map.entries()].map(([dramaId, list]) => {
      const episodes = [...list].sort((a, b) => a.episodeIndex - b.episodeIndex)
      return { dramaId, title: episodes[0].title, episodes, bytes: episodes.reduce((sum, item) => sum + item.bytes, 0) }
    })
  }, [cached])

  /** 本地文件直接喂 AVPlayer，不需要走解密代理。 */
  function playableOf(item: DownloadItem): Playable {
    return { url: filePathOf(item), release: () => { }, note: `本地 · ${item.quality}p`, quality: item.quality }
  }

  /** 本地文件喂播放器之前先确认还在（被清掉时别让播放器报一个看不懂的错）。 */
  function fileExists(path: string): boolean {
    try { return FileManager.existsSync(path) } catch { return false }
  }

  /** 拼一个 Drama 用于写播放历史（下载/缓存两个入口以前不写，导致资料库与「继续播放」永远停在旧值）。 */
  function dramaOf(group: { dramaId: string; title: string; cover?: string; episodes: { episodeIndex: number }[] }, label: string): Drama {
    return { id: group.dramaId, title: group.title, cover: group.cover ?? "", intro: "", episodeCount: group.episodes.length, episodeLabel: label, tags: [], hot: "", rank: 0 }
  }

  async function play(group: Group, startIndex: number) {
    const episode = group.episodes[startIndex]
    if (!episode) return
    if (!fileExists(filePathOf(episode))) {
      setItems(loadDownloads())
      onLibraryChanged()
      await Dialog.alert({ title: "这集不在了", message: "本地文件已被清理，列表也顺手更新了；想离线看就重新下载一次。" })
      return
    }
    const drama = dramaOf(group, `已下 ${group.episodes.length} 集`)
    recordPlayback(drama, episode.episodeIndex, episode.quality, 0)
    onLibraryChanged()
    try {
      setWatch({
        title: group.title,
        entries: group.episodes.map(item => ({ vid: item.vid, label: `第 ${item.episodeIndex} 集` })),
        startIndex,
        first: playableOf(episode),
        resolve: async index => playableOf(group.episodes[index]),
        autoNext: true,
        onSwitch: (index, item) => { recordPlayback(drama, group.episodes[index]?.episodeIndex ?? episode.episodeIndex, item.quality); onLibraryChanged() },
        onProgress: (_index, seconds) => recordPosition(group.dramaId, seconds),
      })
      setWatchNonce(value => value + 1)
      watchPresented.setValue(true)
    } catch (reason) {
      await Dialog.alert({ title: "播放失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  function drop(item: DownloadItem) {
    removeDownload(item.id)
    setItems(loadDownloads())
    onLibraryChanged()
  }

  function dropAll() {
    clearDownloads()
    setItems([])
    onLibraryChanged()
  }

  /** 自动缓存命中时也是本地文件，直接喂播放器。 */
  function cachePlayable(item: CacheItem): Playable {
    return { url: cacheFilePath(item), release: () => { }, note: `本地缓存 · ${item.quality}p`, quality: item.quality }
  }

  async function playCached(group: CacheGroup, startIndex: number) {
    const episode = group.episodes[startIndex]
    if (!episode) return
    if (!fileExists(cacheFilePath(episode))) {
      setCached(loadCache())
      onLibraryChanged()
      await Dialog.alert({ title: "缓存不在了", message: "本地缓存已被清理（超过上限会自动淘汰），列表也顺手更新了。" })
      return
    }
    const drama = dramaOf(group, `缓存 ${group.episodes.length} 集`)
    recordPlayback(drama, episode.episodeIndex, episode.quality, 0)
    onLibraryChanged()
    try {
      setWatch({
        title: group.title,
        entries: group.episodes.map(item => ({ vid: item.vid, label: `第 ${item.episodeIndex} 集` })),
        startIndex,
        first: cachePlayable(episode),
        resolve: async index => cachePlayable(group.episodes[index]),
        autoNext: true,
        onSwitch: (index, item) => { recordPlayback(drama, group.episodes[index]?.episodeIndex ?? episode.episodeIndex, item.quality); onLibraryChanged() },
        onProgress: (_index, seconds) => recordPosition(group.dramaId, seconds),
      })
      setWatchNonce(value => value + 1)
      watchPresented.setValue(true)
    } catch (reason) {
      await Dialog.alert({ title: "播放失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  function dropCached(item: CacheItem) {
    removeCache(item.vid)
    setCached(loadCache())
    onLibraryChanged()
  }

  function dropAllCached() {
    clearCache()
    setCached([])
    onLibraryChanged()
  }

  /** 问用户存哪个地方（三选一，取消返回 null）。 */
  async function askExportTarget(title: string): Promise<ExportTarget | null> {
    const index = await Dialog.actionSheet({
      title,
      message: "导出后即使删掉脚本也还在（推荐：只把想长期留的存 iCloud）",
      actions: [
        { label: "存到「照片」App" },
        { label: "存到「文件」App（本机）" },
        { label: "存到 iCloud Drive" },
      ],
    })
    if (index === null) return null
    return (["photos", "documents", "iCloud"] as ExportTarget[])[index] ?? null
  }

  /** 单集统一菜单：播放 / 导出 / 预览分享 / 删除。 */
  async function openItemMenu(options: { title: string; subtitle: string; path: string; fileName: string; cache: boolean; play: () => Promise<void>; remove: () => void }) {
    const index = await Dialog.actionSheet({
      title: options.title,
      message: options.subtitle,
      actions: [
        { label: "播放" },
        { label: "导出到…" },
        { label: "预览 / 分享…" },
        { label: "删除", destructive: true },
      ],
    })
    if (index === null) return
    try {
      if (index === 0) { await options.play(); return }
      if (index === 1) {
        const target = await askExportTarget(options.title)
        if (!target) return
        setNote({ text: `正在导出到 ${exportTargetLabel(target)}…`, cache: options.cache })
        await exportVideoFile(options.path, options.fileName, target)
        setNote(null)
        hapticSuccess()
        await Dialog.alert({ title: "导出完成", message: `已导出到 ${exportTargetLabel(target)}` })
        return
      }
      if (index === 2) { await QuickLook.previewURLs([options.path]); return }
      options.remove()
    } catch (reason) {
      setNote(null)
      await Dialog.alert({ title: "没成功", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  function openDownloadMenu(group: Group, item: DownloadItem) {
    const index = group.episodes.indexOf(item)
    return openItemMenu({
      title: `第 ${item.episodeIndex} 集 · ${formatBytes(item.bytes)}`,
      subtitle: `${group.title} · 已解密存在本机`,
      path: filePathOf(item),
      fileName: exportFileName(group.title, item.episodeIndex),
      cache: false,
      play: () => play(group, Math.max(0, index)),
      remove: () => drop(item),
    })
  }

  function openCacheMenu(group: CacheGroup, item: CacheItem) {
    const index = group.episodes.indexOf(item)
    return openItemMenu({
      title: `第 ${item.episodeIndex} 集 · ${formatBytes(item.bytes)}`,
      subtitle: `${group.title} · 自动缓存（超过上限会被淘汰）`,
      path: cacheFilePath(item),
      fileName: exportFileName(group.title, item.episodeIndex),
      cache: true,
      play: () => playCached(group, Math.max(0, index)),
      remove: () => dropCached(item),
    })
  }

  /** 整部剧的已下载 / 已缓存集一次导出（串行，带进度）。 */
  async function exportGroup(title: string, count: number, entries: { path: string; fileName: string }[], cache: boolean) {
    const target = await askExportTarget(`导出《${title}》${count} 集`)
    if (!target) return
    try {
      setNote({ text: `正在导出 0/${count}…`, cache })
      const message = await exportVideoFiles(entries, target, (done, total) => setNote({ text: `正在导出 ${done}/${total}…`, cache }))
      setNote(null)
      hapticSuccess()
      await Dialog.alert({ title: "导出完成", message })
    } catch (reason) {
      setNote(null)
      await Dialog.alert({ title: "导出失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  // 播放页被「返回」掉 → 停掉原生播放器并刷新一下列表（它不会自己收）
  useEffect(() => {
    let shown = false
    const listener = (presented: boolean) => {
      if (presented === shown) return
      shown = presented
      if (presented) return
      finishPlayback()
      onLibraryChanged()
    }
    watchPresented.subscribe(listener)
    return () => { watchPresented.unsubscribe(listener) }
  }, [watchPresented, onLibraryChanged])

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="下载" navigationBarTitleDisplayMode="large" refreshable={async () => { setItems(loadDownloads()); setCached(loadCache()) }}
      navigationDestination={{ isPresented: watchPresented, content: watch ? <WatchPage key={watchNonce} playlist={watch} /> : <VStack /> }}>
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ bottom: PAGE_BOTTOM_PADDING }}>
        {!items.length && !cached.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
          <StateCard title="还没有离线内容" description="在线看过的剧集会自动留一份（秒开、没网也能看）；想长期保存就在详情页点「下载」，整集解密成 mp4 存到本机。" systemImage="arrow.down.circle" actionTitle="刷新" action={() => { setItems(loadDownloads()); setCached(loadCache()) }} />
        </VStack> : <>
          {items.length ? <>
          <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
            <SectionHeading title={`已下载 ${items.length} 集`} subtitle={`共 ${formatBytes(totalBytes)} · 存在本机（不占 iCloud）；点某一集可导出到相册 / 文件 / iCloud`} trailing={
              <Button action={dropAll} buttonStyle="plain" tint="systemRed" accessibilityLabel="清空全部下载">
                <Text font="subheadline">清空</Text>
              </Button>} />
            {note && !note.cache ? <Text font="caption" padding={{ horizontal: PAGE_PADDING }} foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{note.text}</Text> : undefined}
          </VStack>

          {groups.map(group => <VStack key={group.dramaId} spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
              <DramaArtwork drama={{ id: group.dramaId, title: group.title, cover: group.cover, intro: "", episodeCount: group.episodes.length, episodeLabel: `${group.episodes.length} 集`, tags: [], hot: "", rank: 0 }} width={72} height={Math.round(72 * COVER_ASPECT)} radius={9} />
              <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="headline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{group.title}</Text>
                <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`${formatBytes(group.bytes)} · ${group.episodes[0]?.quality ?? 0}p`}</Text>
              </VStack>
              <Button title="播放" systemImage="play.fill" tint={ACCENT} frame={{ minHeight: 38 }} action={() => { void play(group, 0) }} />
            </HStack>

            <LazyVGrid columns={gridColumns(4)} alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {group.episodes.map((item, index) => <Button key={item.id} buttonStyle="bordered" tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 40 }}
                action={() => { void play(group, index) }} accessibilityLabel={`播放第 ${item.episodeIndex} 集`}>
                <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "center" }}>
                  <Image systemName="checkmark.circle.fill" font="caption2" foregroundStyle="systemGreen" />
                  <Text font="footnote" lineLimit={1}>{`第 ${item.episodeIndex} 集`}</Text>
                </HStack>
              </Button>)}
            </LazyVGrid>

            <ScrollView axes="horizontal" scrollIndicator="hidden">
              <HStack spacing={9}>
                <Button buttonStyle="plain" tint={ACCENT} frame={{ minHeight: 36 }} action={() => { void exportGroup(group.title, group.episodes.length, group.episodes.map(item => ({ path: filePathOf(item), fileName: exportFileName(group.title, item.episodeIndex) })), false) }} accessibilityLabel="导出这部剧已下载的全部集">
                  <HStack spacing={4} padding={{ horizontal: 12, vertical: 7 }} background="tertiarySystemFill" clipShape="capsule">
                    <Image systemName="square.and.arrow.up" font="caption2" foregroundStyle={ACCENT} />
                    <Text font="caption" fontWeight="semibold" foregroundStyle={ACCENT}>导出全部</Text>
                  </HStack>
                </Button>
                {group.episodes.map(item => <Button key={`manage-${item.id}`} buttonStyle="plain" frame={{ minHeight: 36 }} action={() => { void openDownloadMenu(group, item) }} accessibilityLabel={`第 ${item.episodeIndex} 集的操作菜单（播放 / 导出 / 删除）`}>
                  <HStack spacing={4} padding={{ horizontal: 10, vertical: 7 }} background="secondarySystemFill" clipShape="capsule">
                    <Image systemName="ellipsis.circle" font="caption2" foregroundStyle="secondaryLabel" />
                    <Text font="caption" foregroundStyle="secondaryLabel">{`第 ${item.episodeIndex} 集 · ${formatBytes(item.bytes)}`}</Text>
                  </HStack>
                </Button>)}
              </HStack>
            </ScrollView>
          </VStack>)}
          </> : undefined}

          {cached.length ? <VStack spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
            <SectionHeading title={`自动缓存 ${cached.length} 集`} subtitle={`共 ${formatBytes(cachedBytes)} · 在线看过就自动留一份（不额外耗流量）；超过上限自动淘汰（点某一集可导出）`} trailing={
              <Button action={dropAllCached} buttonStyle="plain" tint="systemRed" accessibilityLabel="清空自动缓存">
                <Text font="subheadline">清空</Text>
              </Button>} />
            {note?.cache ? <Text font="caption" padding={{ horizontal: PAGE_PADDING }} foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{note.text}</Text> : undefined}

            {cacheGroups.map(group => <VStack key={`cache-${group.dramaId}`} spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
                <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="headline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{group.title}</Text>
                  <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`${group.episodes.length} 集 · ${formatBytes(group.bytes)} · ${group.episodes[0]?.quality ?? 0}p`}</Text>
                </VStack>
                <Button title="重看" systemImage="play.fill" tint={ACCENT} frame={{ minHeight: 38 }} action={() => { void playCached(group, 0) }} />
              </HStack>

              <ScrollView axes="horizontal" scrollIndicator="hidden">
                <HStack spacing={9}>
                  {group.episodes.map((item, index) => <Button key={`cache-play-${item.vid}`} buttonStyle="bordered" tint={ACCENT} frame={{ minHeight: 40 }}
                    action={() => { void playCached(group, index) }} accessibilityLabel={`重看第 ${item.episodeIndex} 集`}>
                    <Text font="footnote" lineLimit={1}>{`第 ${item.episodeIndex} 集`}</Text>
                  </Button>)}
                </HStack>
              </ScrollView>

              <ScrollView axes="horizontal" scrollIndicator="hidden">
                <HStack spacing={9}>
                  <Button buttonStyle="plain" tint={ACCENT} frame={{ minHeight: 36 }} action={() => { void exportGroup(group.title, group.episodes.length, group.episodes.map(item => ({ path: cacheFilePath(item), fileName: exportFileName(group.title, item.episodeIndex) })), true) }} accessibilityLabel="导出这部剧已缓存的全部集">
                    <HStack spacing={4} padding={{ horizontal: 12, vertical: 7 }} background="tertiarySystemFill" clipShape="capsule">
                      <Image systemName="square.and.arrow.up" font="caption2" foregroundStyle={ACCENT} />
                      <Text font="caption" fontWeight="semibold" foregroundStyle={ACCENT}>导出全部</Text>
                    </HStack>
                  </Button>
                  {group.episodes.map(item => <Button key={`cache-manage-${item.vid}`} buttonStyle="plain" frame={{ minHeight: 36 }} action={() => { void openCacheMenu(group, item) }} accessibilityLabel={`第 ${item.episodeIndex} 集缓存的操作菜单（播放 / 导出 / 删除）`}>
                    <HStack spacing={4} padding={{ horizontal: 10, vertical: 7 }} background="secondarySystemFill" clipShape="capsule">
                      <Image systemName="ellipsis.circle" font="caption2" foregroundStyle="secondaryLabel" />
                      <Text font="caption" foregroundStyle="secondaryLabel">{`第 ${item.episodeIndex} 集 · ${formatBytes(item.bytes)}`}</Text>
                    </HStack>
                  </Button>)}
                </HStack>
              </ScrollView>
            </VStack>)}
          </VStack> : undefined}
        </>}
      </VStack>
    </ScrollView>
  </ZStack>
}
