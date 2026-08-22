import {
  Button,
  HStack,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { clearCachedChapters, removeCachedChapters } from "./chapter_cache"

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "lrts_settings"

type Settings = {
  speed: number
  sleepTimerMinutes: number
}

const DEFAULT_SETTINGS: Settings = {
  speed: 1.0,
  sleepTimerMinutes: 30,
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
const TIMER_OPTIONS = [0, 10, 20, 30, 45, 60, 90, 120]

function loadSettings(): Settings {
  try {
    const raw = Storage.get<string>(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS
}

function saveSettings(s: Settings) {
  Storage.set(SETTINGS_KEY, JSON.stringify(s))
}

function formatCacheSize(): string {
  try {
    // Estimate: count stored keys
    const shelf = Storage.get<string>("lrts_bookshelf")
    const count = shelf ? JSON.parse(shelf).length : 0
    if (count === 0) return "0 MB"
    return `~${(count * 2.5).toFixed(1)} MB`
  } catch {
    return "未知"
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function SettingView(props?: { onExit?: () => void }) {
  const [speed, setSpeed] = useState(loadSettings().speed)
  const [timer, setTimer] = useState(loadSettings().sleepTimerMinutes)
  const [cacheSize, setCacheSize] = useState(formatCacheSize())

  useEffect(() => {
    setCacheSize(formatCacheSize())
  }, [])

  function updateSpeed(value: string) {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    setSpeed(next)
    const s = loadSettings()
    s.speed = next
    saveSettings(s)
  }

  function updateTimer(value: string) {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    setTimer(next)
    const s = loadSettings()
    s.sleepTimerMinutes = next
    saveSettings(s)
  }

  async function handleClearCache() {
    const ok = await Dialog.confirm({
      title: "清理缓存",
      message: "将清除所有缓存的搜索和书籍数据，已加入书架的书籍不会受影响。是否继续？",
    })
    if (!ok) return
    try {
      Storage.remove("lrts_search_history")
      clearCachedChapters()
      setCacheSize("0 MB")
      await Dialog.alert({ title: "已清理", message: "缓存已清除" })
    } catch (e) {
      await Dialog.alert({ title: "清理失败", message: String(e) })
    }
  }

  async function handleClearShelf() {
    const ok = await Dialog.confirm({
      title: "清空书架",
      message: "将从书架移除所有已保存书籍，此操作不可撤销。是否继续？",
    })
    if (!ok) return
    try {
      const raw = Storage.get<string>("lrts_bookshelf")
      if (raw) {
        const items: Array<{ id: string }> = JSON.parse(raw)
        for (const item of items) {
          Storage.remove(`lrts_book_${item.id}`)
          removeCachedChapters(item.id)
        }
      }
      Storage.remove("lrts_bookshelf")
      setCacheSize("0 MB")
      await Dialog.alert({ title: "已清空", message: "书架已清空" })
    } catch (e) {
      await Dialog.alert({ title: "操作失败", message: String(e) })
    }
  }

  return (
    <List
      listStyle="insetGroup"
      navigationTitle="设置"
      navigationBarTitleDisplayMode="large"
      toolbar={
        props?.onExit
          ? {
              topBarLeading: [
                <Button title="退出" systemImage="xmark" action={props.onExit} />,
              ],
            }
          : undefined
      }
    >
      {/* Playback section */}
      <Section
        header={<Text>播放</Text>}
        footer={<Text>调整有声书播放速度</Text>}
      >
        <Picker
          title="播放速度"
          value={String(speed)}
          onChanged={updateSpeed}
        >
          {SPEED_OPTIONS.map((s) => (
            <Text key={s} tag={String(s)}>
              {s}x
            </Text>
          ))}
        </Picker>
      </Section>

      {/* Sleep timer section */}
      <Section
        header={<Text>定时关闭</Text>}
        footer={<Text>设定时间后自动停止播放</Text>}
      >
        <Picker
          title="倒计时"
          value={String(timer)}
          onChanged={updateTimer}
        >
          {TIMER_OPTIONS.map((t) => (
            <Text key={t} tag={String(t)}>
              {t === 0 ? "关闭" : `${t} 分钟`}
            </Text>
          ))}
        </Picker>
      </Section>

      {/* Storage / Cache section */}
      <Section
        header={<Text>存储</Text>}
        footer={<Text>在线播放缓存不会占用太多空间，可随时清理。</Text>}
      >
        <HStack>
          <Text>缓存大小</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">{cacheSize}</Text>
        </HStack>
        <Button
          title="清理缓存"
          systemImage="trash"
          role="destructive"
          action={() => void handleClearCache()}
        />
        <Button
          title="清空书架"
          systemImage="books.vertical"
          role="destructive"
          action={() => void handleClearShelf()}
        />
      </Section>

      {/* About section */}
      <Section
        header={<Text>关于</Text>}
      >
        <HStack>
          <Text>版本</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">1.3.6</Text>
        </HStack>
        <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
          <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">
            免责声明
          </Text>
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            本脚本仅用于个人学习、研究与便捷访问公开网络内容，不存储、不分发、不提供任何音频或文字资源。所有内容版权归原作者及相关权利方所有，请在遵守当地法律法规和平台规则的前提下使用。如内容涉及侵权或不适，请以官方渠道和权利方要求为准。
          </Text>
        </VStack>
      </Section>
    </List>
  )
}
