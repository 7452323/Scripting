import {
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  Toggle,
  VStack,
  useState,
} from "scripting"
import { loadSettings, saveSettings, type AppSettings } from "../storage"
import { buildPageToolbar } from "./toolbar"

export function SettingsPage() {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        toolbar={buildPageToolbar(dismiss)}
      >
        <Section header={<Text textCase={null}>播放</Text>}>
          <Toggle
            title="记住播放进度"
            value={settings.rememberProgress}
            onChanged={v => update({ rememberProgress: v })}
          />
          <Toggle
            title="自动播放下一集（预留）"
            value={settings.autoPlayNext}
            onChanged={v => update({ autoPlayNext: v })}
          />
        </Section>

        <Section
          header={<Text textCase={null}>关于 MediaHub</Text>}
          footer="第一阶段基础框架 · 后续将支持 Emby / Plex / 115 / 脚本源"
        >
          <VStack alignment="leading" spacing={6} padding={{ vertical: 8 }}>
            <Text fontWeight="semibold">版本 0.1.2</Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              原生 AVPlayer 播放器 + 媒体库管理。架构已为多源扩展预留接口。
            </Text>
          </VStack>
        </Section>

        <Section header={<Text textCase={null}>后续计划</Text>}>
          <VStack alignment="leading" spacing={4} padding={{ vertical: 8 }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              · Emby / Plex 服务器接入
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              · 115 网盘浏览与直链播放
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              · 自定义 JS / Python 脚本源
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              · 元数据刮削（TMDB / NFO）
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              · 字幕与多音轨管理
            </Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
