import { Button, HStack, Image, Script, ScrollView, Text, VStack, ZStack, useState } from "scripting"
import { ACCENT, Chip, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { BANNER_SECONDS_OPTIONS, CACHE_LIMIT_OPTIONS, clearFavourites, loadFavourites, loadSettings, normalizeBannerSeconds, saveSettings } from "../storage"
import { cacheTotalBytes, clearCache, enforceCacheLimit, loadCache } from "../cache"
import { formatBytes } from "../downloads"

const QUALITIES = [360, 480, 540, 720, 1080]

/** 作者信息：头像随脚本目录一起分发，与「日历」脚本同一套做法 */
const AUTHOR = {
  name: "Scripting",
  handle: "github.com/7452323",
  url: "https://github.com/7452323",
  /**
   * 预先缩成 120×120：原图直接交给 40pt 的框，若缩放没生效就会被裁成左上角一小块
   * （就是「头像没显示完整」的原因）
   */
  avatarFile: "avatar_small.png",
}

export function SettingsPage({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const [quality, setQuality] = useState(() => loadSettings().quality)
  const [autoNext, setAutoNext] = useState(() => loadSettings().autoNext)
  const [crossSeason, setCrossSeason] = useState(() => loadSettings().crossSeason)
  const [bannerSeconds, setBannerSeconds] = useState(() => loadSettings().bannerSeconds)
  const [autoCache, setAutoCache] = useState(() => loadSettings().autoCache)
  const [cacheLimitMB, setCacheLimitMB] = useState(() => loadSettings().cacheLimitMB)
  const [cacheState, setCacheState] = useState(() => { const list = loadCache(); return { count: list.length, bytes: cacheTotalBytes(list) } })
  const [cacheNote, setCacheNote] = useState("")
  const [cleared, setCleared] = useState(false)
  // ⚠️ 以前在 render 体里读（每次 setState 都读一遍 Storage）；改成只在挂载读一次，清空时手动置 0
  const [favourites, setFavourites] = useState(() => loadFavourites().length)

  function refreshCacheState() { const list = loadCache(); setCacheState({ count: list.length, bytes: cacheTotalBytes(list) }) }

  /** 打开作者仓库。用系统浏览器（`Safari.openURL`）：不会在导航栈上再叠一层模态，失败也不影响页面。 */
  async function openRepository() {
    try { HapticFeedback.selection() } catch { /* 触感不可用不该带崩脚本 */ }
    try {
      if (!await Safari.openURL(AUTHOR.url)) throw new Error("false")
    } catch {
      try { await Dialog.alert({ title: "打不开链接", message: "可以手动访问 " + AUTHOR.handle }) } catch { /* ignore */ }
    }
  }
  function chooseAutoCache(value: boolean) { setAutoCache(value); saveSettings({ autoCache: value }) }
  function chooseCacheLimit(value: number) {
    setCacheLimitMB(value)
    saveSettings({ cacheLimitMB: value })
    const freed = enforceCacheLimit(value)
    refreshCacheState()
    setCacheNote(freed ? `已按新上限清理了 ${formatBytes(freed)}。` : "")
    onLibraryChanged()
  }
  function dropCache() { clearCache(); refreshCacheState(); setCacheNote("已清空自动缓存。"); onLibraryChanged() }
  const limitLabel = cacheLimitMB >= 1024 ? `${cacheLimitMB / 1024} GB` : `${cacheLimitMB} MB`

  function choose(value: number) {
    setQuality(value)
    saveSettings({ quality: value })
  }
  function chooseAutoNext(value: boolean) {
    setAutoNext(value)
    saveSettings({ autoNext: value })
  }
  function chooseCrossSeason(value: boolean) {
    setCrossSeason(value)
    saveSettings({ crossSeason: value })
  }
  function chooseBannerSeconds(value: number) {
    const seconds = normalizeBannerSeconds(value)
    setBannerSeconds(seconds)
    saveSettings({ bannerSeconds: seconds })
  }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="设置" navigationBarTitleDisplayMode="large">
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="默认清晰度" subtitle="拖动播放时会按此档位就近选择；1080p 体积较大，首帧等待更久。" />
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9}>
              {QUALITIES.map(value => <Chip key={String(value)} title={`${value}p`} selected={value === quality} action={() => choose(value)} />)}
            </HStack>
          </ScrollView>
          <Text font="footnote" foregroundStyle="secondaryLabel">当前选择：{quality}p · 1080p 体积较大，起播等待更久</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="首页轮播速度" subtitle="首页顶部剧集轮播每隔几秒自动切一张；随时可以左右滑动自己翻，滑动后会重新计时。最多 5 秒。" />
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9}>
              {BANNER_SECONDS_OPTIONS.map(value => <Chip key={String(value)} title={`${value} 秒`} selected={value === bannerSeconds} action={() => chooseBannerSeconds(value)} />)}
            </HStack>
          </ScrollView>
          <Text font="footnote" foregroundStyle="secondaryLabel">当前：{bannerSeconds} 秒一张 · 改成新值后，下一张就按新速度走（不用重开）</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="自动连播" subtitle="一集播完后倒数几秒自动接着播下一集；关闭后仍可在播放器里手动切集。" />
          <HStack spacing={9}>
            <Chip title="开启" selected={autoNext} action={() => chooseAutoNext(true)} />
            <Chip title="关闭" selected={!autoNext} action={() => chooseAutoNext(false)} />
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel">当前：{autoNext ? "开启，倒数 3 秒自动连播" : "关闭，播完停在当前集"}</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="跨季连播" subtitle="一季看完后自动接同名下一季。红果接口没有「季关联」字段，脚本靠「剧名基名 + 季号」在站内搜索里匹配兄弟季；站内搜索单次最多返回 10 条，脚本会自动用「剧名第 N 季」定向补齐下一季。" />
          <HStack spacing={9}>
            <Chip title="开启" selected={crossSeason} action={() => chooseCrossSeason(true)} />
            <Chip title="关闭" selected={!crossSeason} action={() => chooseCrossSeason(false)} />
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel">当前：{crossSeason ? "开启，会额外发 1~2 次搜索请求" : "关闭，只在当前季内连播"}</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="题材分类" subtitle="与红果站内一致：真人剧 24 个题材，漫剧 / AI剧 各 8 个；动漫频道暂无题材。可在「发现」页左侧标签或「全部分类」里浏览。" />
          <Text font="footnote" foregroundStyle="secondaryLabel">筛选会直接作用在红果的列表接口上，因此每个题材返回的都是该题材的真实内容。</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="离线下载" subtitle="在剧集详情页点「下载」，整集会在本机解密成明文 mp4 存到 App Group 目录（不进 iCloud、不出现在「文件」App）。下载完可在右上角「下载」里离线观看，并支持连续播放。" />
          <Text font="footnote" foregroundStyle="secondaryLabel">按默认清晰度保存：当前 {quality}p。一集约 3~40 MB，取决于清晰度。</Text>
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="自动缓存" subtitle="在线看过的剧集会自动留一份：本地代理解密时顺手把那整集明文攒下来（不额外耗流量），下次再看同一集就是秒开、且没网也能看。超过上限按「最近最少用」自动淘汰。" />
          <HStack spacing={9}>
            <Chip title="开启" selected={autoCache} action={() => chooseAutoCache(true)} />
            <Chip title="关闭" selected={!autoCache} action={() => chooseAutoCache(false)} />
          </HStack>
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9}>
              {CACHE_LIMIT_OPTIONS.map(value => <Chip key={String(value)} title={value >= 1024 ? `${value / 1024} GB` : `${value} MB`} selected={value === cacheLimitMB} action={() => chooseCacheLimit(value)} />)}
            </HStack>
          </ScrollView>
          <Text font="footnote" foregroundStyle="secondaryLabel">{`当前：${autoCache ? "开启" : "关闭"} · 上限 ${limitLabel} · 已缓存 ${cacheState.count} 集 / ${formatBytes(cacheState.bytes)}`}</Text>
          <Button title="清空自动缓存" systemImage="trash" tint="systemRed" disabled={!cacheState.count} frame={{ maxWidth: "infinity", minHeight: 44 }} action={dropCache} />
          {cacheNote ? <Text font="footnote" foregroundStyle="secondaryLabel">{cacheNote}</Text> : undefined}
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="本机数据" subtitle={`收藏 ${favourites} 部`} />
          <Button title="清空收藏" systemImage="heart.slash" tint="systemRed" frame={{ maxWidth: "infinity", minHeight: 44 }} action={() => { clearFavourites(); setCleared(true); setFavourites(0); onLibraryChanged() }} />
          {cleared ? <Text font="footnote" foregroundStyle="secondaryLabel">已清空收藏。</Text> : undefined}
        </VStack>

        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="关于红果短剧" subtitle="浏览 · 搜索 · 在线解密播放" />
          <StateCard title="直连红果 App 协议" description="详情与播放地址由 X-Gorgon 签名直连官方接口获取；加密流通过本机本地代理边拉边解（CENC-AES-CTR）。开着「自动缓存」时，解密过的明文会顺手留一份在 App Group 目录（不额外耗流量、不进 iCloud），所以看过的剧再打开是秒开，没网也能接着看。想长期留或换机带走，在下载页对任一一集选「导出」，可存到「照片」App、「文件」App（本机）或 iCloud Drive。" systemImage="lock.open.fill" tint={ACCENT} />
          <StateCard title="仅作学习用途" description="内容版权归红果短剧所有，脚本不提供任何破解会员或付费内容的能力。" systemImage="info.circle" tint="systemGray" />
        </VStack>

        <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="headline" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>版本</Text>
          <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>1.27.0</Text>
        </VStack>

        {/* 底部：作者仓库入口 */}
        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="作者" subtitle="更多脚本与更新" />
          <Button buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 66 }} action={() => { void openRepository() }} accessibilityLabel="在浏览器中打开作者的 GitHub 主页 github.com/7452323">
            <HStack spacing={12} padding={{ horizontal: 14, vertical: 12 }} background="secondarySystemFill" clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }} frame={{ maxWidth: "infinity" }} contentShape="rect">
              <Image filePath={`${Script.directory}/${AUTHOR.avatarFile}`} resizable={true} frame={{ width: 44, height: 44 }} clipShape="circle" />
              <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="subheadline" fontWeight="semibold" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{AUTHOR.name}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{AUTHOR.handle}</Text>
              </VStack>
              <Image systemName="arrow.up.right" font="caption" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
        </VStack>
      </VStack>
    </ScrollView>
  </ZStack>
}
