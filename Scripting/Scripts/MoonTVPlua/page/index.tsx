import { Button, Image, Navigation, NavigationStack, Script, Tab, TabView, Toolbar, ToolbarItem, useObservable } from "scripting"
import { ACCENT } from "../design"
import HomeView from "./home"
import BrowseView from "./browse"
import SearchView from "./search"
import LibraryView from "./library"
import FeaturesView from "./features"
import SettingsView from "./settings"

export function MainPage() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)

  const toolbar = (
    <Toolbar>
      {/* Close */}
      <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
        <Button
          action={() => dismiss()}
          buttonStyle="plain"
          frame={{ width: 44, height: 44 }}
          contentShape="rect"
          accessibilityLabel="关闭"
        >
          <Image systemName="xmark" font="headline" foregroundStyle="label" />
        </Button>
      </ToolbarItem>

      {/* Minimize (only if supported) */}
      {Script.supportsMinimization() ? (
        <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
          <Button
            action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }}
            buttonStyle="plain"
            frame={{ width: 44, height: 44 }}
            contentShape="rect"
            accessibilityLabel="最小化"
          >
            <Image
              systemName="arrow.down.right.and.arrow.up.left"
              font="headline"
              foregroundStyle="label"
            />
          </Button>
        </ToolbarItem>
      ) : undefined}
    </Toolbar>
  )

  return (
    <NavigationStack>
      <TabView
        selection={selection}
        tint={ACCENT}
        toolbar={toolbar}
        tabBarMinimizeBehavior="onScrollDown"
        scrollEdgeEffectHidden="bottom"
        ignoresSafeArea={{ regions: "container", edges: "bottom" }}
      >
        <Tab title="首页" systemImage="house.fill" value={0}>
          <HomeView />
        </Tab>
        <Tab title="分类" systemImage="square.grid.2x2.fill" value={1}>
          <BrowseView />
        </Tab>
        <Tab title="搜索" systemImage="magnifyingglass" value={2} role="search">
          <SearchView />
        </Tab>
        <Tab title="资料库" systemImage="play.square.stack" value={3}>
          <LibraryView />
        </Tab>
        <Tab title="更多" systemImage="ellipsis.circle.fill" value={4}>
          <FeaturesView />
        </Tab>
        <Tab title="设置" systemImage="gearshape.fill" value={5}>
          <SettingsView />
        </Tab>
      </TabView>
    </NavigationStack>
  )
}
