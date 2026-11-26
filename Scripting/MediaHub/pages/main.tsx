import {
  TabView,
  Tab,
  useState,
} from "scripting"
import { LibraryPage } from "./library"
import { HistoryPage } from "./history"
import { SettingsPage } from "./settings"

export function MainPage() {
  const [selection, setSelection] = useState(0)

  return (
    <TabView selection={selection} onChange={setSelection}>
      <Tab title="媒体库" systemImage="play.square.stack.fill">
        <LibraryPage />
      </Tab>
      <Tab title="历史" systemImage="clock.fill">
        <HistoryPage />
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill">
        <SettingsPage />
      </Tab>
    </TabView>
  )
}
