import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
} from "scripting"
import { DiscoverView } from "./discover"
import { LibraryView } from "./library"
import { SearchView } from "./search"
import { SettingView } from "./settings"
import { PlayerProgressProvider, PlayerStateProvider, usePlayerProgress, usePlayerState } from "./player_state"
import PlayerView from "./player_view"
import { player } from "./player"
import { ACCENT } from "./theme"

function HomeEntry({
  title,
  subtitle,
  systemImage,
  destination,
}: {
  title: string
  subtitle: string
  systemImage: string
  destination: JSX.Element
}) {
  return (
    <NavigationLink destination={destination}>
      <HStack spacing={12} padding={{ vertical: 6 }}>
        <Image
          systemName={systemImage}
          font="title3"
          foregroundStyle={ACCENT}
          frame={{ width: 30, alignment: "center" }}
        />
        <VStack alignment="leading" spacing={2}>
          <Text font="headline" lineLimit={1}>{title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{subtitle}</Text>
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
      </HStack>
    </NavigationLink>
  )
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function openPlayerView() {
  void Navigation.present({
    element: <PlayerView />,
    modalPresentationStyle: "overFullScreen",
  })
}

function HomeNowPlaying() {
  const { currentBook, currentChapter, isPlaying } = usePlayerState()
  const { currentTime } = usePlayerProgress()
  const coverUrl = currentBook?.coverUrl

  function togglePlayback() {
    if (isPlaying) void player.pause()
    else void player.play()
  }

  return (
    <Section header={<Text>正在播放</Text>}>
      <Button action={openPlayerView}>
        <HStack spacing={12} padding={{ vertical: 8 }}>
          {coverUrl ? (
            <Image
              imageUrl={coverUrl}
              resizable={true}
              scaleToFill={true}
              frame={{ width: 44, height: 44 }}
              clipShape={{ type: "rect", cornerRadius: 6 }}
            />
          ) : (
            <VStack
              frame={{ width: 44, height: 44 }}
              background="systemGray5"
              clipShape={{ type: "rect", cornerRadius: 6 }}
              alignment="center"
            >
              <Text font="caption2" foregroundStyle="secondaryLabel">♪</Text>
            </VStack>
          )}
          <VStack alignment="leading" spacing={2} layoutPriority={1}>
            <Text font="subheadline" fontWeight="medium" lineLimit={1}>
              {currentChapter?.title ?? "未选择章节"}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {currentBook?.title ?? "暂无正在播放"}{isPlaying ? ` · ${formatTime(currentTime)}` : ""}
            </Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
      <HStack spacing={10} padding={{ vertical: 2 }}>
        <Button
          title={isPlaying ? "暂停" : "播放"}
          systemImage={isPlaying ? "pause.fill" : "play.fill"}
          tint={ACCENT}
          action={togglePlayback}
          frame={{ maxWidth: "infinity" }}
        />
        <Button
          title="下一章"
          systemImage="forward.end.fill"
          tint={ACCENT}
          action={() => void player.next()}
          frame={{ maxWidth: "infinity" }}
        />
      </HStack>
    </Section>
  )
}

function HomeContent() {
  useEffect(() => {
    void player.init()
  }, [])

  return (
    <List navigationTitle="优雅听书" navigationBarTitleDisplayMode="large" listStyle="insetGroup">
      <Section header={<Text>功能</Text>}>
        <HomeEntry
          title="发现"
          subtitle="分类推荐和热门有声书"
          systemImage="square.grid.2x2"
          destination={<DiscoverView />}
        />
        <HomeEntry
          title="书架"
          subtitle="继续收听已收藏内容"
          systemImage="books.vertical.fill"
          destination={<LibraryView navigationTitle="书架" />}
        />
        <HomeEntry
          title="搜索"
          subtitle="搜索有声书和小说"
          systemImage="magnifyingglass"
          destination={<SearchView />}
        />
        <HomeEntry
          title="设置"
          subtitle="播放、定时和存储管理"
          systemImage="gear"
          destination={<SettingView />}
        />
      </Section>

      <HomeNowPlaying />
    </List>
  )
}

export default function HomeScreenView() {
  return (
    <PlayerStateProvider>
      <PlayerProgressProvider>
        <NavigationStack>
          <HomeContent />
        </NavigationStack>
      </PlayerProgressProvider>
    </PlayerStateProvider>
  )
}
