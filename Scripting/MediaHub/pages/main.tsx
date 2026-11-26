import {
  Tab,
  TabView,
  useObservable,
} from "scripting"
import { HomePage } from "./home"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"

export function MainPage() {
  const selection = useObservable<number>(0)

  return (
    <TabView
      selection={selection}
      tint="systemIndigo"
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
  )
}
