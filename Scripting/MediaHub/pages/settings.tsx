import {
  Form,
  Section,
  Toggle,
  Text,
  useState,
} from "scripting"
import { loadSettings, saveSettings, type AppSettings } from "../storage"

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <Form navigationTitle="设置">
      <Section header="播放">
        <Toggle
          title="记住播放进度"
          isOn={settings.rememberProgress}
          onChange={v => update({ rememberProgress: v })}
        />
        <Toggle
          title="自动播放下一集（预留）"
          isOn={settings.autoPlayNext}
          onChange={v => update({ autoPlayNext: v })}
        />
      </Section>

      <Section header="关于 MediaHub" footer="第一阶段基础框架 · 后续将支持 Emby / Plex / 115 / 脚本源">
        <Text>版本 0.1.0</Text>
        <Text foregroundStyle="secondary">
          原生 AVPlayer 播放器 + 媒体库管理。
          架构已为多源扩展预留接口。
        </Text>
      </Section>

      <Section header="后续计划">
        <Text font="caption" foregroundStyle="secondary">
          · Emby / Plex 服务器接入{"\n"}
          · 115 网盘浏览与直链播放{"\n"}
          · 自定义 JS / Python 脚本源{"\n"}
          · 元数据刮削（TMDB / NFO）{"\n"}
          · 字幕与多音轨管理
        </Text>
      </Section>
    </Form>
  )
}
