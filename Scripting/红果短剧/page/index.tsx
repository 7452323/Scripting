import { Button, Image, Navigation, NavigationStack, Script, Tab, TabView, Toolbar, ToolbarItem, useCallback, useObservable, useMemo, useState } from "scripting"
import { ACCENT } from "../design"
import { suspendPlayback } from "../playback"
import { DiscoverPage } from "./discover"
import { DownloadsPage } from "./downloads"
import { BROWSE_RANK } from "./feed"
import { HomePageContent } from "./home"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"

const TAB_HOME = 0
const TAB_DISCOVER = 1
const TAB_LIBRARY = 2
const TAB_SEARCH = 3

export function HongguoApp() {
  const selection = useObservable(TAB_HOME)
  const [revision, setRevision] = useState(0)
  // 发现页正在浏览的频道（"" = 第一个频道，BROWSE_RANK = 榜单）；首页的「更多」和顶栏榜单都改它
  const [browse, setBrowse] = useState("")
  // 「更多 / 榜单」点击计数器：目标频道和当前一样时也能强制重新加载（否则是静默 no-op）
  const [browseNonce, setBrowseNonce] = useState(0)
  const settingsPresented = useObservable(false)
  /** 下载页现在是**右上角按钮推开的页面**（1.27.0：底部 tab 移到「榜单」旁边）。 */
  const downloadsPresented = useObservable(false)
  const bump = useCallback(() => setRevision(value => value + 1), [])
  const dismiss = Navigation.useDismiss()
  // ⚠️ 关闭按钮：先自己叫停播放器再关页面 ——
  //    播放器是原生对象，不随页面/JS 树一起停，等 present 的 promise 落地才停就晚了（声音还在响）。
  const close = useCallback(() => { suspendPlayback(); dismiss() }, [dismiss])

  const openBrowse = useCallback((channel: string) => {
    setBrowse(channel)
    setBrowseNonce(value => value + 1)
    selection.setValue(TAB_DISCOVER)
  }, [selection])

  // 页面级 memo：避免切 tab 时把页面的虚拟树全部重建（会明显卡顿）。
  // ⚠️ 必须拆成两组：`browse`（频道/榜单）只有「发现」页关心，
  //    以前写在同一个 memo 的依赖里 → 每次切频道会把首页/资料库/搜索一起重建，白卡一下。
  const [homeTab, libraryTab, searchTab] = useMemo(() => [
    <Tab key="home" title="首页" systemImage="house" value={TAB_HOME}><HomePageContent onLibraryChanged={bump} onBrowse={openBrowse} /></Tab>,
    <Tab key="library" title="资料库" systemImage="play.square.stack" value={TAB_LIBRARY}><LibraryPage revision={revision} onLibraryChanged={bump} /></Tab>,
    <Tab key="search" title="搜索" systemImage="magnifyingglass" value={TAB_SEARCH}><SearchPage onLibraryChanged={bump} /></Tab>,
  ], [revision])
  const discoverTab = useMemo(() =>
    <Tab key="discover" title="发现" systemImage="square.grid.2x2" value={TAB_DISCOVER}>
      <DiscoverPage channel={browse} nonce={browseNonce} onChannelChange={setBrowse} onLibraryChanged={bump} />
    </Tab>, [revision, browse, browseNonce])
  // 顺序必须与 TAB_* 常量一致（TabView 的页码就是数组下标）
  const pages = useMemo(
    () => [homeTab, discoverTab, libraryTab, searchTab],
    [homeTab, discoverTab, libraryTab, searchTab])

  // ⚠️ 顶栏必须 memo：以前每次 revision 变化（收藏、切集、播放开始/结束、下载完成）
  //    都会新建整个 <Toolbar>，SwiftUI 于是重建工具栏按钮（与 Tab children 同一类问题）。
  //    → 所以下载页的 navigationDestination 没挂在这里（挂了就得带 revision 依赖），而是挂在 TabView 上。
  const toolbar = useMemo(() => (<Toolbar>
    <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
      <Button action={close} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭红果短剧">
        <Image systemName="xmark" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => openBrowse(BROWSE_RANK)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="榜单">
        <Image systemName="trophy" font="headline" foregroundStyle={browse === BROWSE_RANK ? ACCENT : "label"} />
      </Button>
    </ToolbarItem>
    {/* 离线下载：1.27.0 从底部 tab 挪到这里（榜单旁边），推开一个页面 */}
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => downloadsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="离线下载">
        <Image systemName="arrow.down.circle" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => settingsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect"
        navigationDestination={{ isPresented: settingsPresented, content: <SettingsPage onLibraryChanged={bump} /> }} accessibilityLabel="设置">
        <Image systemName="gearshape" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
    {Script.supportsMinimization() ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => { suspendPlayback(); if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="最小化红果短剧">
        <Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem> : undefined}
  </Toolbar>), [browse, openBrowse, close, bump, settingsPresented, downloadsPresented])

  return <NavigationStack>
    <TabView selection={selection} tint={ACCENT} toolbar={toolbar}
      navigationDestination={{ isPresented: downloadsPresented, content: <DownloadsPage revision={revision} onLibraryChanged={bump} /> }}>
      {pages}
    </TabView>
  </NavigationStack>
}
