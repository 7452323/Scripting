import {
  Button,
  Image,
  Navigation,
  NavigationStack,
  Script,
  Tab,
  TabView,
  Toolbar,
  ToolbarItem,
  useObservable,
} from "scripting"
import { HomePage } from "./home"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"

const ACCENT = "systemIndigo"

export function MainPage() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)

  const toolbar = (
    <Toolbar>
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

      {Script.supportsMinimization() ? (
        <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
          <Button
            action={() => {
              if (!Script.isMinimized()) {
                Script.minimize().catch(() => {})
              }
            }}
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
          <HomePage />
        </Tab>
        <Tab title="媒体库" systemImage="play.square.stack.fill" value={1}>
          <LibraryPage />
        </Tab>
        <Tab title="搜索" systemImage="magnifyingglass" value={2} role="search">
          <SearchPage />
        </Tab>
        <Tab title="设置" systemImage="gearshape.fill" value={3}>
          <SettingsPage />
        </Tab>
      </TabView>
    </NavigationStack>
  )
}
