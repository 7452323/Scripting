import {
  Button,
  List,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  useState,
} from "scripting"
import { loadSettings, saveSettings, type AppSettings } from "../storage"
import {
  loadSourcesConfig,
  saveSourcesConfig,
  type SourcesConfig,
  type ScriptSourceConfig,
} from "../sources/config"
import { embyLogin } from "../sources/emby"
import { plexTest } from "../sources/plex"
import { cloud115Check } from "../sources/cloud115"

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [sources, setSources] = useState<SourcesConfig>(() => loadSourcesConfig())
  const [status, setStatus] = useState("")
  const [scriptName, setScriptName] = useState("")
  const [scriptUrl, setScriptUrl] = useState("")

  const updateSettings = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  const updateSources = (patch: Partial<SourcesConfig>) => {
    const next = { ...sources, ...patch }
    setSources(next)
    saveSourcesConfig(next)
  }

  const saveEmby = (patch: Partial<SourcesConfig["emby"]>) => {
    updateSources({ emby: { ...sources.emby, ...patch } })
  }

  const savePlex = (patch: Partial<SourcesConfig["plex"]>) => {
    updateSources({ plex: { ...sources.plex, ...patch } })
  }

  const save115 = (patch: Partial<SourcesConfig["cloud115"]>) => {
    updateSources({ cloud115: { ...sources.cloud115, ...patch } })
  }

  const handleEmbyLogin = async () => {
    setStatus("正在登录 Emby...")
    try {
      const next = await embyLogin(sources.emby)
      updateSources({ emby: next })
      setStatus("Emby 登录成功")
    } catch (e: any) {
      setStatus(e?.message || "Emby 登录失败")
    }
  }

  const handlePlexTest = async () => {
    setStatus("正在连接 Plex...")
    try {
      const id = await plexTest(sources.plex)
      updateSources({ plex: { ...sources.plex, enabled: true } })
      setStatus(`Plex 已连接: ${id}`)
    } catch (e: any) {
      setStatus(e?.message || "Plex 连接失败")
    }
  }

  const handle115Check = async () => {
    setStatus("正在检测 115 Cookie...")
    try {
      const msg = await cloud115Check(sources.cloud115)
      updateSources({ cloud115: { ...sources.cloud115, enabled: true } })
      setStatus(msg)
    } catch (e: any) {
      setStatus(e?.message || "115 检测失败")
    }
  }

  const addScriptSource = () => {
    if (!scriptUrl.trim()) {
      setStatus("请填写脚本源 URL")
      return
    }
    const item: ScriptSourceConfig = {
      id: `s_${Date.now()}`,
      name: scriptName.trim() || "未命名脚本源",
      url: scriptUrl.trim(),
      enabled: true,
      type: scriptUrl.trim().endsWith(".py") ? "py" : "js",
    }
    updateSources({ scripts: [item, ...sources.scripts] })
    setScriptName("")
    setScriptUrl("")
    setStatus("脚本源已添加")
  }

  const removeScript = (id: string) => {
    updateSources({ scripts: sources.scripts.filter(s => s.id !== id) })
  }

  const toggleScript = (id: string) => {
    updateSources({
      scripts: sources.scripts.map(s =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    })
  }

  return (
    <List navigationTitle="设置" navigationBarTitleDisplayMode="large">
      <Section header={<Text textCase={null}>播放</Text>}>
        <Toggle
          title="记住播放进度"
          value={settings.rememberProgress}
          onChanged={v => updateSettings({ rememberProgress: v })}
        />
        <Toggle
          title="自动播放下一集（预留）"
          value={settings.autoPlayNext}
          onChanged={v => updateSettings({ autoPlayNext: v })}
        />
      </Section>

      <Section header={<Text textCase={null}>Emby</Text>} footer="填写服务器地址后点登录">
        <Toggle
          title="启用 Emby"
          value={sources.emby.enabled}
          onChanged={v => saveEmby({ enabled: v })}
        />
        <TextField
          title="服务器"
          value={sources.emby.server}
          onChanged={v => saveEmby({ server: v })}
          prompt="https://emby.example.com:8096"
        />
        <TextField
          title="用户名"
          value={sources.emby.username}
          onChanged={v => saveEmby({ username: v })}
          prompt="用户名"
        />
        <TextField
          title="密码"
          value={sources.emby.password}
          onChanged={v => saveEmby({ password: v })}
          prompt="密码"
        />
        <Button title="登录 Emby" systemImage="person.badge.key" action={handleEmbyLogin} />
        {sources.emby.accessToken ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
            已登录 · UserId {sources.emby.userId?.slice(0, 8)}…
          </Text>
        ) : null}
      </Section>

      <Section header={<Text textCase={null}>Plex</Text>} footer="使用 X-Plex-Token">
        <Toggle
          title="启用 Plex"
          value={sources.plex.enabled}
          onChanged={v => savePlex({ enabled: v })}
        />
        <TextField
          title="服务器"
          value={sources.plex.server}
          onChanged={v => savePlex({ server: v })}
          prompt="http://192.168.1.x:32400"
        />
        <TextField
          title="Token"
          value={sources.plex.token}
          onChanged={v => savePlex({ token: v })}
          prompt="X-Plex-Token"
        />
        <Button title="测试连接" systemImage="link" action={handlePlexTest} />
      </Section>

      <Section
        header={<Text textCase={null}>115 网盘</Text>}
        footer="可从仓库「115获取Cookie」项目获取 Cookie 后粘贴"
      >
        <Toggle
          title="启用 115"
          value={sources.cloud115.enabled}
          onChanged={v => save115({ enabled: v })}
        />
        <TextField
          title="Cookie"
          value={sources.cloud115.cookie}
          onChanged={v => save115({ cookie: v })}
          prompt="UID=...; CID=...; SEID=..."
          axis="vertical"
          lineLimit={{ min: 2, max: 5 }}
        />
        <Button title="检测 Cookie" systemImage="checkmark.shield" action={handle115Check} />
      </Section>

      <Section
        header={<Text textCase={null}>脚本源</Text>}
        footer="远程 JS/PY：返回 { list: [{ title, url, poster? }] }"
      >
        <TextField
          title="名称"
          value={scriptName}
          onChanged={setScriptName}
          prompt="我的源"
        />
        <TextField
          title="脚本地址"
          value={scriptUrl}
          onChanged={setScriptUrl}
          prompt="https://.../source.js"
        />
        <Button title="添加脚本源" systemImage="plus.circle" action={addScriptSource} />
        {sources.scripts.map(s => (
          <VStack key={s.id} alignment="leading" spacing={4} padding={{ vertical: 6 }}>
            <Text fontWeight="medium">
              {s.name} {s.enabled ? "" : "(已关闭)"}
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              {s.url}
            </Text>
            <Button title={s.enabled ? "禁用" : "启用"} action={() => toggleScript(s.id)} />
            <Button title="删除" foregroundStyle="systemRed" action={() => removeScript(s.id)} />
          </VStack>
        ))}
      </Section>

      <Section header={<Text textCase={null}>刮削 (TMDB)</Text>}>
        <TextField
          title="TMDB API Key"
          value={sources.tmdbApiKey}
          onChanged={v => updateSources({ tmdbApiKey: v })}
          prompt="可选，用于标题刮削"
        />
      </Section>

      {status ? (
        <Section>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {status}
          </Text>
        </Section>
      ) : null}

      <Section header={<Text textCase={null}>关于</Text>}>
        <VStack alignment="leading" spacing={6} padding={{ vertical: 8 }}>
          <Text fontWeight="semibold">MediaHub 0.2.0</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            Emby / Plex / 115 / 脚本源 / TMDB 刮削已接入。播放使用系统 AVPlayer。
          </Text>
        </VStack>
      </Section>
    </List>
  )
}
