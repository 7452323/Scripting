import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Rectangle,
  Script,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  Widget,
  ZStack,
} from 'scripting'
import { useEffect, useState } from 'scripting'
import {
  displayModeOptions,
  getAllWallpapers,
  getCurrentSettings,
  getDisplayWallpaper,
  setDisplayMode,
  setManualWallpaperDate,
  OneSettingsManager,
  cleanForward,
  type WallpaperData,
  type DisplayMode,
} from './utils/one-service'

// ============================================================
// Preview
// ============================================================

const PREVIEW_HEIGHT = 200
const PREVIEW_RADIUS = 12

interface PreviewProps {
  wallpaper: WallpaperData
  showAuthor: boolean
}

const CurrentPreview = ({ wallpaper, showAuthor }: PreviewProps) => {
  return (
    <VStack spacing={12} alignment="leading">
      <ZStack
        frame={{ height: PREVIEW_HEIGHT }}
        clipShape={{ type: 'rect', cornerRadius: PREVIEW_RADIUS }}
      >
        <Image
          imageUrl={wallpaper.imageUrl}
          resizable
          scaleToFill
          frame={{ height: PREVIEW_HEIGHT }}
        />

        <Rectangle fill="#000000" opacity={0.35} />

        <VStack spacing={0}>
          <Spacer />
          <HStack spacing={0}>
            <VStack
              alignment="leading"
              spacing={4}
              padding={{ top: 0, bottom: 12, leading: 12, trailing: 12 }}
            >
              <Text
                font={14}
                foregroundStyle="rgba(255,255,255,0.92)"
                lineLimit={3}
                shadow={{ color: 'rgba(0,0,0,0.4)', radius: 2, y: 1 }}
              >
                {cleanForward(wallpaper.forward)}
              </Text>
              {showAuthor && (
                <Text
                  font={11}
                  foregroundStyle="rgba(255,255,255,0.7)"
                  lineLimit={1}
                >
                  —— {wallpaper.authorName}
                </Text>
              )}
            </VStack>
            <Spacer />
          </HStack>
        </VStack>
      </ZStack>

      <Text font="caption" foregroundStyle="secondaryLabel">
        当前预览效果仅供参考，添加到桌面查看完整效果
      </Text>
    </VStack>
  )
}

// ============================================================
// Detail Page
// ============================================================

const OneQuoteDetail = () => {
  const dismiss = Navigation.useDismiss()
  const [wallpaperData, setWallpaperData] = useState<WallpaperData | null>(null)
  const [availableWallpapers, setAvailableWallpapers] = useState<WallpaperData[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    OneSettingsManager.getSelectedDate(),
  )
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(() =>
    OneSettingsManager.getDisplayMode(),
  )
  const [showAuthor, setShowAuthor] = useState<boolean>(() =>
    OneSettingsManager.getShowAuthor(),
  )
  const [loading, setLoading] = useState<boolean>(true)

  const loadData = async (forceRefresh: boolean = true): Promise<void> => {
    setLoading(true)
    try {
      const wallpapers = await getAllWallpapers()
      setAvailableWallpapers(wallpapers)

      const settings = getCurrentSettings()
      setSelectedDate(settings.selectedDate)
      setDisplayModeState(settings.displayMode)
      setShowAuthor(settings.showAuthor)

      const displayWallpaper = await getDisplayWallpaper(forceRefresh)
      setWallpaperData(displayWallpaper)
    } catch (error: unknown) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshData = async (): Promise<void> => {
    await loadData(true)
    Widget.reloadAll()
  }

  const handleDateChange = async (rawDate: string): Promise<void> => {
    setSelectedDate(rawDate)
    setManualWallpaperDate(rawDate)

    const found = availableWallpapers.find(w => w.rawDate === rawDate)
    if (found) setWallpaperData(found)

    setDisplayModeState('manual')
    Widget.reloadAll()
  }

  const handleDisplayModeChange = async (mode: string): Promise<void> => {
    const nextMode = mode as DisplayMode
    setDisplayModeState(nextMode)
    const nextSettings = setDisplayMode(nextMode)
    setSelectedDate(nextSettings.selectedDate)

    const displayWallpaper = await getDisplayWallpaper(false)
    setWallpaperData(displayWallpaper)
    Widget.reloadAll()
  }

  const handleShowAuthorChange = (value: boolean): void => {
    setShowAuthor(value)
    OneSettingsManager.setShowAuthor(value)
    Widget.reloadAll()
  }

  useEffect(() => {
    loadData(true)
  }, [])

  // ============================================================
  // Render
  // ============================================================

  if (loading || !wallpaperData) {
    return (
      <NavigationStack>
        <List navigationTitle="ONE 每日一言">
          <Section>
            <Text font="body" foregroundStyle="secondaryLabel">
              正在加载每日内容...
            </Text>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="ONE 每日一言"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        {/* 显示配置 */}
        <Section header={<Text font="headline">显示配置</Text>}>
          <Picker
            title="显示模式"
            value={displayMode}
            onChanged={handleDisplayModeChange}
          >
            {displayModeOptions.map((opt: { label: string; value: DisplayMode }) => (
              <Text key={opt.value} tag={opt.value} font="body">
                {opt.label}
              </Text>
            ))}
          </Picker>

          {displayMode === 'latest' ? (
            <HStack alignment="center">
              <Text font="body" foregroundStyle="secondaryLabel">
                手动指定日期
              </Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">
                最新内容模式下不可操作
              </Text>
            </HStack>
          ) : (
            <Picker
              title="手动指定日期"
              value={selectedDate}
              onChanged={handleDateChange}
            >
              {availableWallpapers.map(w => (
                <Text key={w.rawDate} tag={w.rawDate} font="body">
                  {w.date}
                </Text>
              ))}
            </Picker>
          )}

          <Toggle
            title="显示作者"
            value={showAuthor}
            onChanged={handleShowAuthorChange}
          />

          <VStack spacing={4} alignment="leading">
            <Text font="caption" foregroundStyle="secondaryLabel">
              当前模式：{displayMode === 'latest' ? '显示最新内容' : '固定显示指定日期'}
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              自动刷新策略：每天 9:00 后更新当天内容
            </Text>
          </VStack>
        </Section>

        {/* 当前预览 */}
        <Section header={<Text font="headline">当前显示内容</Text>}>
          <CurrentPreview
            wallpaper={wallpaperData}
            showAuthor={showAuthor}
          />
        </Section>

        {/* 详细信息 */}
        <Section header={<Text font="headline">详细信息</Text>}>
          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              显示模式
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {displayModeOptions.find((o: { label: string; value: DisplayMode }) => o.value === displayMode)?.label || displayMode}
            </Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              当前日期
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{wallpaperData.date}</Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              作者
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{wallpaperData.authorName}</Text>
          </HStack>

          <VStack spacing={4} alignment="leading">
            <Text font="body" foregroundStyle="label">
              内容预览
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={4}>
              {cleanForward(wallpaperData.forward)}
            </Text>
          </VStack>
        </Section>

        {/* 操作 */}
        <Section
          footer={
            <VStack spacing={10} alignment="leading">
              <Text font="caption" foregroundStyle="tertiaryLabel">
                数据来源：v3.wufazhuce.com
              </Text>
              <Text font="caption" foregroundStyle="tertiaryLabel">
                致敬韩寒 🫡 ONE·一个
              </Text>
            </VStack>
          }
        >
          <Button title="刷新每日内容" action={refreshData} />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ============================================================
// Entry
// ============================================================

const run = async (): Promise<void> => {
  await Navigation.present({
    element: <OneQuoteDetail />,
    modalPresentationStyle: 'pageSheet',
  })
  Script.exit()
}

run()
