import {
  Button,
  List,
  NavigationStack,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  Toggle,
  VStack,
  useState,
} from "scripting"
import { pageToolbar } from "./chrome"
import { loadSettings, saveSettings, type AppSettings } from "../storage"
import {
  buildServerUrl,
  loadSourcesConfig,
  saveSourcesConfig,
  type SourcesConfig,
  type ScriptSourceConfig,
  type UrlScheme,
} from "../sources/config"
import { embyLogin } from "../sources/emby"
import { plexStartSafariLogin, plexPollPin, plexTest } from "../sources/plex"
import { cloud115Check, cloud115Space, formatSpace } from "../sources/cloud115"

type SourceKind = "emby" | "plex" | "115" | "script"

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [sources, setSources] = useState<SourcesConfig>(() => loadSourcesConfig())
  const [kind, setKind] = useState<SourceKind>("emby")
  const [status, setStatus] = useState("")
  const [scriptName, setScriptName] = useState("")
  const [scriptUrl, setScriptUrl] = useState("")
  const [plexAuthUrl, setPlexAuthUrl] = useState("")

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
    const emby = { ...sources.emby, ...patch }
    emby.server = buildServerUrl(emby.scheme, emby.host, emby.port)
    updateSources({ emby })
  }

  const savePlex = (patch: Partial<SourcesConfig["plex"]>) => {
    const plex = { ...sources.plex, ...patch }
    plex.server = buildServerUrl(plex.scheme, plex.host, plex.port)
    updateSources({ plex })
  }

  const save115 = (patch: Partial<SourcesConfig["cloud115"]>) => {
    updateSources({ cloud115: { ...sources.cloud115, ...patch } })
  }

  const handleConnect = async () => {
    if (kind === "emby") {
      setStatus("正在登录 Emby...")
      try {
        const next = await embyLogin({
          ...sources.emby,
          server: buildServerUrl(sources.emby.scheme, sources.emby.host, sources.emby.port),
        })
        updateSources({ emby: { ...next, enabled: true } })
        setStatus("Emby 登录成功")
      } catch (e: any) {
        setStatus(e?.message || "Emby 登录失败")
      }
      return
    }

    if (kind === "plex") {
      setStatus("正在连接 Plex 服务器...")
      try {
        const id = await plexTest({
          ...sources.plex,
          server: buildServerUrl(sources.plex.scheme, sources.plex.host, sources.plex.port),
        })
        updateSources({ plex: { ...sources.plex, enabled: true } })
        setStatus(`Plex 已连接: ${id}`)
      } catch (e: any) {
        setStatus(e?.message || "Plex 连接失败")
      }
      return
    }

    if (kind === "115") {
      setStatus("正在检测 115...")
      try {
        await cloud115Check(sources.cloud115)
        let spaceMsg = ""
        try {
          const sp = await cloud115Space(sources.cloud115)
          save115({
            enabled: true,
            spaceUsed: sp.used,
            spaceTotal: sp.total,
          })
          spaceMsg = ` · 空间 ${formatSpace(sp.used)}/${formatSpace(sp.total)}`
        } catch {
          save115({ enabled: true })
        }
        setStatus(`115 Cookie 有效${spaceMsg}`)
      } catch (e: any) {
        setStatus(e?.message || "115 检测失败")
      }
      return
    }

    if (kind === "script") {
      if (!scriptUrl.trim()) {
        setStatus("请填写脚本源 URL")
        return
      }
      const item: ScriptSourceConfig = {
        id: `s_${Date.now()}`,
        name: scriptName.trim() || "未命名脚本源",
        url: scriptUrl.trim(),
        enabled: true,
        type: scriptUrl.trim().toLowerCase().endsWith(".py") ? "py" : "js",
      }
      updateSources({ scripts: [item, ...sources.scripts] })
      setScriptName("")
      setScriptUrl("")
      setStatus("脚本源已添加")
    }
  }

  const handlePlexSafariLogin = async () => {
    setStatus("正在打开 Safari 登录 Plex...")
    setPlexAuthUrl("")
    try {
      const { pinId, code, authUrl } = await plexStartSafariLogin()
      setPlexAuthUrl(authUrl)
      setStatus(`已打开 Safari，请登录授权（代码 ${code}），返回后自动获取 Token…`)
      const token = await plexPollPin(pinId)
      savePlex({ token, enabled: true })
      setStatus("Plex Safari 登录成功，Token 已保存。请填写服务器地址并点「连接/保存」。")
    } catch (e: any) {
      setStatus(e?.message || "Plex Safari 登录失败")
    }
  }

  const schemeOptions = [
    { title: "https", value: "https" },
    { title: "http", value: "http" },
  ]

  const kindOptions = [
    { title: "Emby", value: "emby" },
    { title: "Plex", value: "plex" },
    { title: "115 网盘", value: "115" },
    { title: "脚本源", value: "script" },
  ]

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        toolbar={pageToolbar(onClose)}
      >
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

        <Section
          header={<Text textCase={null}>添加媒体源</Text>}
          footer="选择类型后填写协议、主机与端口，再连接"
        >
          <Picker
            title="源类型"
            value={kind}
            onChanged={(v: string) => setKind(v as SourceKind)}
            options={kindOptions}
          />

          {(kind === "emby" || kind === "plex") && (
            <>
              <Picker
                title="协议"
                value={kind === "emby" ? sources.emby.scheme : sources.plex.scheme}
                onChanged={(v: string) => {
                  const scheme = (v === "http" ? "http" : "https") as UrlScheme
                  if (kind === "emby") saveEmby({ scheme })
                  else savePlex({ scheme })
                }}
                options={schemeOptions}
              />
              <TextField
                title="主机"
                value={kind === "emby" ? sources.emby.host : sources.plex.host}
                onChanged={v => {
                  if (kind === "emby") saveEmby({ host: v })
                  else savePlex({ host: v })
                }}
                prompt="IP 或域名，不含协议"
              />
              <TextField
                title="端口"
                value={kind === "emby" ? sources.emby.port : sources.plex.port}
                onChanged={v => {
                  if (kind === "emby") saveEmby({ rembyPort: v } as any)
                  // fix below
                  if (kind === "emby") saveEmby({ port: v })
                  else savePlex({ port: v })
                }}
                prompt={kind === "emby" ? "8096" : "32400"}
              />
            </>
          )}

          {kind === "emby" && (
            <>
              <Toggle
                title="启用 Emby"
                value={sources.emby.enabled}
                onChanged={v => saveEmby({ enabled: v })}
              />
              <TextField
                title="用户名"
                value={sources.emby.username}
                onChanged={v => saveEmby({ username: v })}
                prompt="用户名"
              />
              <SecureField
                title="密码"
                value={sources.emby.password}
                onChanged={v => saveEmby({ password: v })}
                prompt="密码"
              />
              {sources.emby.accessToken ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  已登录 · {sources.emby.server}
                </Text>
              ) : null}
            </>
          )}

          {kind === "plex" && (
            <>
              <Toggle
                title="启用 Plex"
                value={sources.plex.enabled}
                onChanged={v => savePlex({ enabled: v })}
              />
              <Button
                title="Safari 登录 Plex"
                systemImage="safari"
                action={handlePlexSafariLogin}
              />
              <SecureField
                title="Token（可自动填入）"
                value={sources.plex.token}
                onChanged={v => savePlex({ token: v })}
                prompt="X-Plex-Token"
              />
              {plexAuthUrl ? (
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
                  授权页：{plexAuthUrl}
                </Text>
              ) : null}
              {sources.plex.token ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  已保存 Token · 服务器 {sources.plex.server || "未填"}
                </Text>
              ) : null}
            </>
          )}

          {kind === "115" && (
            <>
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
              {sources.cloud115.spaceTotal ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  空间 {formatSpace(sources.cloud115.spaceUsed || 0)}/
                  {formatSpace(sources.cloud115.spaceTotal)}
                </Text>
              ) : null}
            </>
          )}

          {kind === "script" && (
            <>
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
            </>
          )}

          <Button
            title={kind === "script" ? "添加脚本源" : "连接 / 保存"}
            systemImage="link.badge.plus"
            action={handleConnect}
          />
        </Section>

        {sources.scripts.length > 0 ? (
          <Section header={<Text textCase={null}>已添加脚本源</Text>}>
            {sources.scripts.map(s => (
              <VStack key={s.id} alignment="leading" spacing={4} padding={{ vertical: 6 }}>
                <Text fontWeight="medium">
                  {s.name} {s.enabled ? "" : "(已关闭)"}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                  {s.url}
                </Text>
                <Button
                  title={s.enabled ? "禁用" : "启用"}
                  action={() =>
                    updateSources({
                      scripts: sources.scripts.map(x =>
                        x.id === s.id ? { ...x, enabled: !x.enabled } : x
                      ),
                    })
                  }
                />
                <Button
                  title="删除"
                  foregroundStyle="systemRed"
                  action={() =>
                    updateSources({
                      scripts: sources.scripts.filter(x => x.id !== s.id),
                    })
                  }
                />
              </VStack>
            ))}
          </Section>
        ) : null}

        <Section header={<Text textCase={null}>刮削 (TMDB)</Text>}>
          <SecureField
            title="TMDB API Key"
            value={sources.tmdbApiKey}
            onChanged={v => updateSources({ tmdbApiKey: v })}
            prompt="可选"
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
          <Text fontWeight="semibold">MediaHub 0.3.0</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            统一添加源 · Safari 登录 Plex · 卡片媒体库
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
