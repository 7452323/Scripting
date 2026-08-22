import { Image, VStack, ZStack, Spacer, Text, Widget, Rectangle, type Color } from 'scripting'
import {
  getCurrentSettings,
  getDisplayWallpaper,
  OneSettingsManager,
  shouldRefresh,
  markUpdated,
  cleanForward,
  type WallpaperData,
} from './utils/one-service'

// ============================================================
// Color constants (typed to satisfy Color)
// ============================================================

const C_WHITE: Color = 'rgba(255,255,255,0.95)'
const C_WHITE_MUTED: Color = 'rgba(255,255,255,0.85)'
const C_WHITE_DIM: Color = 'rgba(255,255,255,0.75)'
const C_SHADOW: Color = 'rgba(0,0,0,0.5)'
const C_SCRIM: Color = '#000000'

const SHADOW = { color: C_SHADOW, radius: 3, y: 1 }

// ============================================================
// Helpers
// ============================================================

const formatDateStr = (rawDate: string): string => {
  if (rawDate.length < 8) return ''
  return `${rawDate.slice(6, 8)}/${rawDate.slice(4, 6)}`
}

// ============================================================
// Shared sub-components
// ============================================================

const BgImage = ({ imageUrl }: { imageUrl: string }) => (
  <Image imageUrl={imageUrl} widgetAccentedRenderingMode="desaturated" resizable scaleToFill />
)

const Scrim = () => (
  <Rectangle fill={C_SCRIM} opacity={0.35} />
)

// ============================================================
// Small widget
// ============================================================

const SmallWidget = ({ wallpaper }: { wallpaper: WallpaperData }) => {
  const date = formatDateStr(wallpaper.rawDate)
  return (
    <ZStack>
      <BgImage imageUrl={wallpaper.imageUrl} />
      <Scrim />
      <VStack spacing={0} alignment="center">
        <Text widgetAccentable font={9} foregroundStyle={C_WHITE_MUTED} shadow={SHADOW} padding={{ top: 6 }}>
          {date}
        </Text>
        <Spacer />
      </VStack>
    </ZStack>
  )
}

// ============================================================
// Medium widget
// ============================================================

const MediumWidget = ({ wallpaper }: { wallpaper: WallpaperData }) => {
  const settings = getCurrentSettings()
  const date = formatDateStr(wallpaper.rawDate)
  return (
    <ZStack>
      <BgImage imageUrl={wallpaper.imageUrl} />
      <Scrim />
      <VStack spacing={0} alignment="center">
        {/* 上方居中：日期 */}
        <Text widgetAccentable font={11} foregroundStyle={C_WHITE_MUTED} shadow={SHADOW}>
          {date}
        </Text>

        <Spacer />

        {/* 下方居中：正文 + 作者 */}
        <VStack
          alignment="center"
          spacing={6}
          padding={{ top: 0, bottom: 14, leading: 16, trailing: 16 }}
        >
          <Text
            widgetAccentable
            font={13}
            foregroundStyle={C_WHITE}
            lineLimit={5}
            multilineTextAlignment="center"
            shadow={SHADOW}
          >
            {cleanForward(wallpaper.forward)}
          </Text>

          {settings.showAuthor && (
            <Text widgetAccentable font={11} foregroundStyle={C_WHITE_DIM} lineLimit={1}>
              —— {wallpaper.authorName}
            </Text>
          )}
        </VStack>
      </VStack>
    </ZStack>
  )
}

// ============================================================
// Large widget
// ============================================================

const LargeWidget = ({ wallpaper }: { wallpaper: WallpaperData }) => {
  const settings = getCurrentSettings()
  const date = formatDateStr(wallpaper.rawDate)
  return (
    <ZStack>
      <BgImage imageUrl={wallpaper.imageUrl} />
      <Scrim />
      <VStack spacing={0} alignment="center">
        {/* 上方居中：日期 */}
        <Text font={14} foregroundStyle={C_WHITE_MUTED} shadow={SHADOW}>
          {date}
        </Text>

        <Spacer />

        {/* 下方居中：正文 + 作者 */}
        <VStack
          alignment="center"
          spacing={6}
          padding={{ top: 0, bottom: 22, leading: 24, trailing: 24 }}
        >
          <Text
            widgetAccentable
            font={16}
            foregroundStyle={C_WHITE}
            lineLimit={10}
            multilineTextAlignment="center"
            shadow={SHADOW}
          >
            {cleanForward(wallpaper.forward)}
          </Text>

          {settings.showAuthor && (
            <Text widgetAccentable font={13} foregroundStyle={C_WHITE_DIM} lineLimit={1}>
              —— {wallpaper.authorName}
            </Text>
          )}
        </VStack>
      </VStack>
    </ZStack>
  )
}

// ============================================================
// Widget view dispatcher
// ============================================================

const WidgetView = ({ wallpaper }: { wallpaper: WallpaperData }) => {
  switch (Widget.family) {
    case 'systemSmall':
      return <SmallWidget wallpaper={wallpaper} />
    case 'systemMedium':
      return <MediumWidget wallpaper={wallpaper} />
    case 'systemLarge':
    case 'systemExtraLarge':
      return <LargeWidget wallpaper={wallpaper} />
    default:
      return <MediumWidget wallpaper={wallpaper} />
  }
}

// ============================================================
// Error widget
// ============================================================

const ErrorWidget = ({ message }: { message: string }) => (
  <VStack spacing={8} alignment="center" padding={16}>
    <Spacer />
    <Image
      systemName="wifi.exclamationmark"
      font="title2"
      foregroundStyle="systemOrange"
    />
    <Text font="body" foregroundStyle="label">
      ONE·一个
    </Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
      {message}
    </Text>
    <Spacer />
  </VStack>
)

// ============================================================
// Refresh policy
// ============================================================

const getNextRefreshDate = (): Date => {
  const now = new Date()
  const next = new Date(now)
  next.setHours(9, 0, 0, 0)
  if (now >= next) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

// ============================================================
// Main entry
// ============================================================

const presentWidget = async (): Promise<void> => {
  const settings = getCurrentSettings()
  const now = new Date()
  const hasReachedRefreshTime =
    now.getHours() > 9 ||
    (now.getHours() === 9 && (now.getMinutes() > 0 || now.getSeconds() > 0))

  const forceRefresh = settings.autoRefresh && hasReachedRefreshTime && shouldRefresh()

  const wallpaper = await getDisplayWallpaper(forceRefresh)
  markUpdated()

  Widget.present(
    <WidgetView wallpaper={wallpaper} />,
    { policy: 'after', date: getNextRefreshDate() },
  )
}

presentWidget().catch((error: unknown) => {
  console.log(error)
  Widget.present(<ErrorWidget message="加载失败，请稍后重试" />)
})
