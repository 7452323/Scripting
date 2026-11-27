import { Navigation, Tab, TabView, useObservable } from "scripting"
import { HomePage } from "./home"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"

const ACCENT = "systemIndigo"

export function MainPage() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)

  const close = () => dismiss()

  return (
    <TabView
      selection={selection}
      tint={ACCENT}
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="首页" systemImage="house.fill" value={0}>
        <HomePage onClose={close} />
      </Tab>
      <Tab title="媒体库" systemImage="play.square.stack.fill" value={1}>
        <LibraryPage onClose={close} />
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value={2} role="search">
        <SearchPage onClose={close} />
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value={3}>
        <SettingsPage onClose={close} />
      </Tab>
    </TabView>
  )
}
