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
  HStack,
  useEffect,
  useState,
} from "scripting"
import { pageToolbar } from "./chrome"
import { loadSettings, saveSettings, type AppSettings } from "../storage"
import {
  buildServerUrl,
  clearCloud115Cookie,
  loadSourcesConfig,
  parseServerUrl,
  saveSourcesConfig,
  type SourcesConfig,
  type ScriptSourceConfig,
  type UrlScheme,
} from "../sources/config"
import { embyLogin } from "../sources/emby"
import { plexStartSafariLogin, plexPollPin, plexTest, plexDiscoverServers } from "../sources/plex"
import {
  cloud115Check,
  cloud115Space,
  formatSpace,
  cloud115QrStart,
  cloud115QrPoll,
  type Cloud115QrSession,
  type Cloud115QrState,
} from "../sources/cloud115"
import { RemoteImage } from "../imageLoader"
import { scrapeTMDB } from "../sources/scrape"

type SourceKind = "emby" | "plex" | "115" | "script"

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [sources, setSources] = useState<SourcesConfig>(() => loadSourcesConfig())
  const [kind, setKind] = useState<SourceKind>("emby")
  const [status, setStatus] = useState("")
  const [scriptName, setScriptName] = useState("")
  const [scriptUrl, setScriptUrl] = useState("")
  const [plexAuthUrl, setPlexAuthUrl] = useState("")
  const [qrVisible, setQrVisible] = useState(false)
  const [qrImage, setQrImage] = useState("")
  const [qrStatus, setQrStatus] = useState("")
  const [qrSession, setQrSession] = useState<Cloud115QrSession | null>(null)
  const [qrTick, setQrTick] = useState(0)
  const [tmdbTest, setTmdbTest] = useState("")

  const updateSettings = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  // ⚠️ 每次写入都从 Storage 重新读，不能用 render 闭包里的 sources：
  // 扫码登录后紧接着的异步空间查询会用旧 sources 把刚存好的 cookie 覆盖回空值
  const applySources = (fn: (cur: SourcesConfig) => SourcesConfig) => {
    const next = fn(loadSourcesConfig())
    setSources(next)
    saveSourcesConfig(next)
  }

  const updateSources = (patch: Partial<SourcesConfig>) => {
    applySources(cur => ({ ...cur, ...patch }))
  }

  const saveEmby = (patch: Partial<SourcesConfig["emby"]>) => {
    applySources(cur => {
      const emby = { ...cur.emby, ...patch }
      emby.server = buildServerUrl(emby.scheme, emby.host, emby.port)
      return { ...cur, emby }
    })
  }

  const savePlex = (patch: Partial<SourcesConfig["plex"]>) => {
    applySources(cur => {
      const plex = { ...cur.plex, ...patch }
      plex.server = buildServerUrl(plex.scheme, plex.host, plex.port)
      return { ...cur, plex }
    })
  }

  const save115 = (patch: Partial<SourcesConfig["cloud115"]>) => {
    applySources(cur => ({ ...cur, cloud115: { ...cur.cloud115, ...patch } }))
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
      setStatus(`已打开 Safari，请登录授权（代码 ${code}）…`)
      const token = await plexPollPin(pinId)

      setStatus("登录成功，正在自动发现 Plex 服务器…")
      let servers: { name: string; uri: string; token: string }[] = []
      try {
        servers = await plexDiscoverServers(token)
      } catch {}

      if (servers.length === 0) {
        savePlex({ token, enabled: true })
        setStatus("登录成功，但没发现可用服务器，请手动填写地址")
        return
      }

      const best = servers[0]
      const parsed = parseServerUrl(best.uri)
      savePlex({
        token: best.token || token,
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port,
        enabled: true,
      })
      setStatus(`已登录并连接服务器：${best.name}（${best.uri}）`)
    } catch (e: any) {
      setStatus(e?.message || "Plex Safari 登录失败")
    }
  }

  const handlePlexRediscover = async () => {
    if (!sources.plex.token) {
      setStatus("请先登录 Plex")
      return
    }
    setStatus("正在重新发现 Plex 服务器…")
    try {
      const servers = await plexDiscoverServers(sources.plex.token)
      if (servers.length === 0) {
        setStatus("没有发现可用服务器")
        return
      }
      const best = servers[0]
      const parsed = parseServerUrl(best.uri)
      savePlex({
        token: best.token || sources.plex.token,
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port,
        enabled: true,
      })
      setStatus(`已连接：${best.name}（${best.uri}）`)
    } catch (e: any) {
      setStatus(e?.message || "发现失败")
    }
  }

  const handle115QrLogin = async () => {
    setQrVisible(true)
    setQrImage("")
    setQrSession(null)
    setQrTick(0)
    setQrStatus("正在获取二维码…")
    try {
      const session = await cloud115QrStart()
      setQrSession(session)
      setQrImage(session.imageUrl)
      setQrStatus("请用 115 App 扫码登录")
    } catch (e: any) {
      setQrStatus(e?.message || "115 二维码获取失败")
    }
  }

  const applyQrState = (state: Cloud115QrState) => {
    if (state.status === 2 && state.cookie) {
      save115({ cookie: state.cookie, enabled: true })
      setQrStatus("登录成功，已保存登录状态")
      setQrSession(null)
      setQrVisible(false)
      setStatus("115 登录成功")
      cloud115Space({ ...sources.cloud115, cookie: state.cookie })
        .then(sp => save115({ spaceUsed: sp.used, spaceTotal: sp.total }))
        .catch(() => {})
      return
    }
    if (state.status === 1) {
      setQrStatus("已扫描，请在 115 App 上点「确认登录」")
      return
    }
    if (state.status === -1) {
      setQrStatus(state.message || "二维码已过期，请点「重新获取」")
      return
    }
    if (state.status === -2) {
      setQrStatus("已在手机上取消登录")
      return
    }
    setQrStatus(state.message ? `${state.message}（已检查 ${qrTick} 次）` : `等待扫码…（已检查 ${qrTick} 次）`)
  }

  // 定时器只推进 tick（同步回调）；真正的请求放到 effect 里发（定时器里 await fetch 不会返回）
  useEffect(() => {
    if (!qrVisible || !qrSession) return
    const timer = setInterval(() => setQrTick(v => v + 1), 2000)
    return () => clearInterval(timer)
  }, [qrVisible, qrSession])

  useEffect(() => {
    if (!qrVisible || !qrSession || qrTick === 0) return
    let alive = true
    ;(async () => {
      try {
        const state = await cloud115QrPoll(qrSession, false, qrTick % 3 === 0)
        if (!alive) return
        applyQrState(state)
      } catch (e: any) {
        if (alive) setQrStatus(e?.message || "状态检查失败，请重试")
      }
    })()
    return () => {
      alive = false
    }
  }, [qrTick])

  // 「立即检查」：跳过 status 直接拿 uid 换 Cookie（防止 status 接口不报确认态时永远卡住）
  const handle115CheckNow = async () => {
    if (!qrSession) {
      setQrStatus("请先获取二维码")
      return
    }
    setQrStatus("正在确认…")
    try {
      const state = await cloud115QrPoll(qrSession, true)
      if (state.status === 2 && state.cookie) {
        applyQrState(state)
      } else {
        setQrStatus("115 那边还没确认登录（确认后会自动完成）")
      }
    } catch (e: any) {
      setQrStatus(e?.message || "检查失败")
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
        sheet={{
          isPresented: qrVisible,
          onChanged: setQrVisible,
          content: (
            <VStack spacing={14} padding={20} frame={{ maxWidth: "infinity" }}>
              <Text font="headline">扫码登录 115</Text>
              <VStack
                frame={{ width: 220, height: 220 }}
                background="secondarySystemBackground"
                clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}
              >
                {qrImage ? <RemoteImage url={qrImage} width={220} height={220} radius={14} /> : null}
              </VStack>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {qrStatus}
              </Text>
              <HStack spacing={10}>
                <Button
                  title="立即检查"
                  systemImage="checkmark.circle"
                  action={handle115CheckNow}
                />
                <Button title="重新获取" systemImage="arrow.clockwise" action={handle115QrLogin} />
                <Button title="关闭" action={() => setQrVisible(false)} />
              </HStack>
            </VStack>
          ),
        }}
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
          header={<Text textCase={null}>首页</Text>}
          footer={<Text font="caption">长按首页任意位置也可以快速切换</Text>}
        >
          <Picker
            title="首页媒体库"
            value={sources.homeSource}
            onChanged={(v: string) =>
              updateSources({ homeSource: v as SourcesConfig["homeSource"] })
            }
            pickerStyle="menu"
          >
            <Text tag="emby">Emby</Text>
            <Text tag="plex">Plex</Text>
            <Text tag="115">115 网盘</Text>
          </Picker>
        </Section>

        <Section
          header={<Text textCase={null}>添加媒体源</Text>}
          footer={
            <Text font="caption">选择类型后填写协议、主机与端口，再连接</Text>
          }
        >
          <Picker
            title="源类型"
            value={kind}
            onChanged={(v: string) => setKind(v as SourceKind)}
            pickerStyle="menu"
          >
            {kindOptions.map(o => (
              <Text key={o.value} tag={o.value}>
                {o.title}
              </Text>
            ))}
          </Picker>

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
                pickerStyle="segmented"
              >
                {schemeOptions.map(o => (
                  <Text key={o.value} tag={o.value}>
                    {o.title}
                  </Text>
                ))}
              </Picker>
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
              <Button
                title="重新发现服务器"
                systemImage="antenna.radiowaves.left.and.right"
                action={handlePlexRediscover}
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
              <Button
                title="扫码登录 115"
                systemImage="qrcode.viewfinder"
                action={handle115QrLogin}
              />
              {sources.cloud115.cookie ? (
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                  已登录 · {sources.cloud115.cookie.slice(0, 18)}…
                </Text>
              ) : (
                <Text font="caption" foregroundStyle="systemOrange">
                  未登录：点上方「扫码登录 115」
                </Text>
              )}
              {sources.cloud115.cookie ? (
                <Button
                  title="退出登录"
                  systemImage="rectangle.portrait.and.arrow.right"
                  foregroundStyle="systemRed"
                  action={() => {
                    clearCloud115Cookie()
                    setSources(loadSourcesConfig())
                    setStatus("已退出 115")
                  }}
                />
              ) : null}
              <TextField
                title="手动 Cookie（可选）"
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

        <Section
          header={<Text textCase={null}>刮削 (TMDB)</Text>}
          footer={
            <Text font="caption">
              用于 115 文件夹刮削取海报与简介；需要能访问 api.themoviedb.org
            </Text>
          }
        >
          <SecureField
            title="TMDB API Key"
            value={sources.tmdbApiKey}
            onChanged={v => updateSources({ tmdbApiKey: v })}
            prompt="32 位 v3 Key"
          />
          <Button
            title="测试 TMDB 连接"
            systemImage="checkmark.seal"
            action={async () => {
              const key = loadSourcesConfig().tmdbApiKey.trim()
              if (!key) {
                setTmdbTest("请先填写 TMDB API Key")
                return
              }
              setTmdbTest("正在测试…")
              try {
                const r = await scrapeTMDB(key, "流浪地球2", "movie", "2023")
                setTmdbTest(
                  r
                    ? `连接正常：命中「${r.title}」（${r.year || "—"}）`
                    : "没匹配到结果：检查 Key 是否正确 / 网络是否能访问 TMDB"
                )
              } catch (e: any) {
                setTmdbTest(e?.message || "测试失败")
              }
            }}
          />
          {sources.tmdbApiKey ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              已填写 · {sources.tmdbApiKey.length} 位
            </Text>
          ) : (
            <Text font="caption" foregroundStyle="systemOrange">
              未填写：刮削只能用文件名，拿不到海报
            </Text>
          )}
          {tmdbTest ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {tmdbTest}
            </Text>
          ) : null}
        </Section>

        {status ? (
          <Section>
            <Text font="caption" foregroundStyle="secondaryLabel">
              {status}
            </Text>
          </Section>
        ) : null}

        <Section header={<Text textCase={null}>关于</Text>}>
          <Text fontWeight="semibold">MediaHub 0.11.1</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            多源首页 · 115 网盘 · 海报刮削
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
