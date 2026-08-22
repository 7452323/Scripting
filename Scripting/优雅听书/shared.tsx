import {
  NavigationStack,
  Script,
  Tab,
  TabView,
  createContext,
  useContext,
  useEffect,
  useObservable,
} from "scripting"
import { PlayerProgressProvider, PlayerStateProvider } from "./player_state"
import { ACCENT } from "./theme"
import { DiscoverView } from "./discover"
import { LibraryView } from "./library"
import { SearchView } from "./search"
import { SettingView } from "./settings"
import PlayerView from "./player_view"
import { MiniPlayer } from "./mini_player"
import { player } from "./player"

const MiniPlayerContext = createContext<Observable<boolean>>()

type AppMode = "standalone" | "home_screen"

type AppRootProps = {
  mode?: AppMode
}

function MiniPlayerProvider({ children }: { children: JSX.Element }) {
  const isPresented = useObservable<boolean>(false)
  return <MiniPlayerContext.Provider value={isPresented}>{children}</MiniPlayerContext.Provider>
}

function MiniPlayerAccessory() {
  const isPresented = useContext(MiniPlayerContext)
  return <MiniPlayer onTap={() => isPresented.setValue(true)} />
}

export function AppRoot({ mode = "standalone" }: AppRootProps) {
  useEffect(() => {
    void player.init()
    if (mode === "standalone") {
      Script.enableMinimize()
    }
  }, [])

  return (
    <PlayerStateProvider>
      <PlayerProgressProvider>
        <MiniPlayerProvider>
          <AppTabs mode={mode} />
        </MiniPlayerProvider>
      </PlayerProgressProvider>
    </PlayerStateProvider>
  )
}

export function AppTabs({ mode = "standalone" }: AppRootProps) {
  const isPresented = useContext(MiniPlayerContext)
  const selection = useObservable<number>(0)
  const canExit = mode === "standalone"
  const onExit = canExit ? () => Script.minimize() : undefined
  const wrapTab = (element: JSX.Element) => <NavigationStack>{element}</NavigationStack>

  return (
    <TabView
      selection={selection}
      tint={ACCENT}
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
      tabViewBottomAccessory={<MiniPlayerAccessory />}
      sheet={{
        isPresented: isPresented,
        content: <PlayerView />,
      }}
    >
      <Tab title="发现" systemImage="square.grid.2x2" value={0}>
        {wrapTab(<DiscoverView onExit={onExit} />)}
      </Tab>

      <Tab title="书架" systemImage="books.vertical.fill" value={1}>
        {wrapTab(<LibraryView navigationTitle="书架" onExit={onExit} />)}
      </Tab>

      <Tab title="搜索" systemImage="magnifyingglass" role="search" value={2}>
        {wrapTab(<SearchView onExit={onExit} />)}
      </Tab>

      <Tab title="设置" systemImage="gear" value={3}>
        {wrapTab(<SettingView onExit={onExit} />)}
      </Tab>
    </TabView>
  )
}
