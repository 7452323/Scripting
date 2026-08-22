import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  type DynamicShapeStyle,
  type ShapeStyle,
  Widget,
} from "scripting"

type WidgetSettings = {
  style: "compact" | "detailed"
  accent: "purple" | "blue" | "green"
  refreshMinutes: number
  showSpeed: boolean
  showUptime: boolean
  showConnections: boolean
  showPolicyLatency: boolean
}

type WidgetSnapshot = {
  timestamp: number
  connected: boolean
  error: string
  uptime: number
  memory: number
  downloadSpeed: number
  uploadSpeed: number
  activeRequests: number
  policyGroup: string
  selectedPolicy: string
  policyLatency: number
  dnsCacheEntries: number
  failedRequests: number
  rejectedRequests: number
  cumulativeDownload: number
  cumulativeUpload: number
  virtualIPs: number
  activeBans: number
  temporaryRules: number
  mode: string
  source: string
  policyGroupCount: number
  policyNodeCount: number
  interfaceCount: number
}

const SETTINGS_KEY = "surge-panel.widget-settings.v1"
const CACHE_KEY = "surge-panel.widget-cache.v1"
const dynamic = (light: ShapeStyle, dark: ShapeStyle): DynamicShapeStyle => ({ light, dark })
const background = dynamic("#F7F5FB", "#111015")
const primary = dynamic("#17171B", "#F3F1F7")
const secondary = dynamic("#77757E", "#AAA6B2")

function loadSettings(): WidgetSettings {
  const saved = Storage.get<Partial<WidgetSettings>>(SETTINGS_KEY) || {}
  return {
    style: saved.style === "compact" ? "compact" : "detailed",
    accent: saved.accent === "blue" || saved.accent === "green" ? saved.accent : "purple",
    refreshMinutes: Math.min(60, Math.max(5, Number(saved.refreshMinutes || 15))),
    showSpeed: saved.showSpeed !== false,
    showUptime: saved.showUptime !== false,
    showConnections: saved.showConnections !== false,
    showPolicyLatency: saved.showPolicyLatency !== false,
  }
}

function loadSnapshot(): WidgetSnapshot {
  const cached = Storage.get<Partial<WidgetSnapshot>>(CACHE_KEY) || {}
  return {
    timestamp: Number(cached.timestamp || 0),
    connected: cached.connected === true,
    error: String(cached.error || "请先打开 Surge Panel 刷新数据"),
    uptime: Number(cached.uptime || 0),
    memory: Number(cached.memory || 0),
    downloadSpeed: Number(cached.downloadSpeed || 0),
    uploadSpeed: Number(cached.uploadSpeed || 0),
    activeRequests: Number(cached.activeRequests || 0),
    policyGroup: String(cached.policyGroup || "策略组"),
    selectedPolicy: String(cached.selectedPolicy || "—"),
    policyLatency: Number(cached.policyLatency || 0),
    dnsCacheEntries: Number(cached.dnsCacheEntries || 0),
    failedRequests: Number(cached.failedRequests || 0),
    rejectedRequests: Number(cached.rejectedRequests || 0),
    cumulativeDownload: Number(cached.cumulativeDownload || 0),
    cumulativeUpload: Number(cached.cumulativeUpload || 0),
    virtualIPs: Number(cached.virtualIPs || 0),
    activeBans: Number(cached.activeBans || 0),
    temporaryRules: Number(cached.temporaryRules || 0),
    mode: String(cached.mode || "rule"),
    source: String(cached.source || "cache"),
    policyGroupCount: Number(cached.policyGroupCount || 0),
    policyNodeCount: Number(cached.policyNodeCount || 0),
    interfaceCount: Number(cached.interfaceCount || 0),
  }
}

function accentColor(value: WidgetSettings["accent"]): DynamicShapeStyle {
  if (value === "blue") return dynamic("#168BA7", "#56C7DF")
  if (value === "green") return dynamic("#278761", "#62D5A3")
  return dynamic("#655BDC", "#A69CFF")
}

function formatBytes(value: number, suffix = ""): string {
  let number = Math.max(0, Number(value || 0))
  const units = ["B", "KB", "MB", "GB", "TB"]
  let index = 0
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index += 1 }
  const digits = index === 0 || number >= 100 ? 0 : number >= 10 ? 1 : 2
  return `${number.toFixed(digits)} ${units[index]}${suffix}`
}

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function Metric({ title, value, tint = primary }: { title: string; value: string; tint?: DynamicShapeStyle }) {
  return <VStack alignment="center" spacing={2} frame={{ maxWidth: "infinity", alignment: "center" }}>
    <Text font="caption2" foregroundStyle={secondary} lineLimit={1}>{title}</Text>
    <Text font="headline" fontWeight="bold" foregroundStyle={tint} lineLimit={1} minScaleFactor={0.72}>{value}</Text>
  </VStack>
}

function Header({ snapshot, tint, compact = false }: { snapshot: WidgetSnapshot; tint: DynamicShapeStyle; compact?: boolean }) {
  const time = snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—"
  return <HStack spacing={5} frame={{ maxWidth: "infinity" }}>
    <Image systemName="bolt.horizontal.circle.fill" foregroundStyle={tint} />
    <Text font={compact ? "subheadline" : "headline"} fontWeight="bold" foregroundStyle={primary} lineLimit={1}>{compact ? "Surge" : "Surge Panel"}</Text>
    <Spacer />
    <Text font="caption2" foregroundStyle={snapshot.connected ? accentColor("green") : dynamic("#D83F48", "#FF7D86")}>{snapshot.connected ? time : "离线"}</Text>
  </HStack>
}

function OfflineView({ snapshot, tint }: { snapshot: WidgetSnapshot; tint: DynamicShapeStyle }) {
  return <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
    <Header snapshot={snapshot} tint={tint} />
    <Spacer />
    <Image systemName="exclamationmark.circle" foregroundStyle={tint} />
    <Text font="headline" foregroundStyle={primary}>暂无可用数据</Text>
    <Text font="caption" foregroundStyle={secondary} lineLimit={2}>{snapshot.error}</Text>
    <Spacer />
  </VStack>
}

function SmallWidget({ snapshot, settings, tint }: { snapshot: WidgetSnapshot; settings: WidgetSettings; tint: DynamicShapeStyle }) {
  return <VStack alignment="center" spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
    <Header snapshot={snapshot} tint={tint} compact />
    {settings.showSpeed ? <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <Metric title="下载" value={`↓ ${formatBytes(snapshot.downloadSpeed, "/s")}`} tint={tint} />
      <Metric title="上传" value={`↑ ${formatBytes(snapshot.uploadSpeed, "/s")}`} tint={tint} />
    </HStack> : null}
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" }}>
      {settings.showConnections ? <Text font="caption2" foregroundStyle={primary} lineLimit={1}>{Math.round(snapshot.activeRequests)} 个连接</Text> : null}
      {settings.showUptime ? <Text font="caption2" foregroundStyle={secondary} lineLimit={1}>运行 {formatUptime(snapshot.uptime)}</Text> : null}
    </HStack>
    {settings.showPolicyLatency ? <Text font="caption2" foregroundStyle={tint} lineLimit={1}>{snapshot.selectedPolicy} · {snapshot.policyLatency ? `${Math.round(snapshot.policyLatency)} ms` : "暂无延迟"}</Text> : null}
  </VStack>
}

function MediumWidget({ snapshot, settings, tint }: { snapshot: WidgetSnapshot; settings: WidgetSettings; tint: DynamicShapeStyle }) {
  return <VStack alignment="center" spacing={9} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
    <Header snapshot={snapshot} tint={tint} />
    <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
      {settings.showSpeed ? <Metric title="下载" value={formatBytes(snapshot.downloadSpeed, "/s")} tint={tint} /> : null}
      {settings.showSpeed ? <Metric title="上传" value={formatBytes(snapshot.uploadSpeed, "/s")} tint={tint} /> : null}
      {settings.showConnections ? <Metric title="连接" value={String(Math.round(snapshot.activeRequests))} tint={tint} /> : null}
    </HStack>
    {settings.showPolicyLatency ? <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "center" }}>
      <VStack alignment="center" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}><Text font="caption2" foregroundStyle={secondary}>{snapshot.policyGroup}</Text><Text font="caption" fontWeight="semibold" foregroundStyle={primary} lineLimit={1}>{snapshot.selectedPolicy}</Text></VStack>
      <VStack alignment="center" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}><Text font="caption2" foregroundStyle={secondary}>策略延迟</Text><Text font="subheadline" fontWeight="bold" foregroundStyle={tint}>{snapshot.policyLatency ? `${Math.round(snapshot.policyLatency)} ms` : "暂无延迟"}</Text></VStack>
    </HStack> : null}
    <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
      {settings.showUptime ? <Metric title="运行时间" value={formatUptime(snapshot.uptime)} /> : null}
      <Metric title="内存" value={formatBytes(snapshot.memory)} />
      <Metric title="DNS" value={String(Math.round(snapshot.dnsCacheEntries))} />
      <Metric title="累计流量" value={formatBytes(snapshot.cumulativeDownload + snapshot.cumulativeUpload)} />
    </HStack>
  </VStack>
}

function LargeWidget({ snapshot, settings, tint }: { snapshot: WidgetSnapshot; settings: WidgetSettings; tint: DynamicShapeStyle }) {
  return <VStack alignment="center" spacing={11} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
    <Header snapshot={snapshot} tint={tint} />
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      {settings.showSpeed ? <Metric title="实时下载" value={formatBytes(snapshot.downloadSpeed, "/s")} tint={tint} /> : null}
      {settings.showSpeed ? <Metric title="实时上传" value={formatBytes(snapshot.uploadSpeed, "/s")} tint={tint} /> : null}
      {settings.showConnections ? <Metric title="活动连接" value={String(Math.round(snapshot.activeRequests))} /> : null}
    </HStack>
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      {settings.showUptime ? <Metric title="运行时间" value={formatUptime(snapshot.uptime)} /> : null}
      <Metric title="内存占用" value={formatBytes(snapshot.memory)} />
      <Metric title="DNS 缓存" value={String(Math.round(snapshot.dnsCacheEntries))} />
    </HStack>
    {settings.showPolicyLatency ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <Metric title={snapshot.policyGroup} value={snapshot.selectedPolicy} />
      <Metric title="策略延迟" value={snapshot.policyLatency ? `${Math.round(snapshot.policyLatency)} ms` : "暂无延迟"} tint={tint} />
    </HStack> : null}
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <Metric title="失败请求" value={String(snapshot.failedRequests)} />
      <Metric title="拒绝请求" value={String(snapshot.rejectedRequests)} />
      <Metric title="虚拟 IP" value={String(snapshot.virtualIPs)} />
      <Metric title="临时规则" value={String(snapshot.temporaryRules)} />
    </HStack>
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <Metric title="累计下载" value={formatBytes(snapshot.cumulativeDownload)} />
      <Metric title="累计上传" value={formatBytes(snapshot.cumulativeUpload)} />
      <Metric title="安全封禁" value={String(Math.round(snapshot.activeBans))} />
    </HStack>
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <Metric title="策略组" value={String(snapshot.policyGroupCount)} />
      <Metric title="策略节点" value={String(snapshot.policyNodeCount)} />
      <Metric title="流量接口" value={String(snapshot.interfaceCount)} />
      <Metric title="异常总数" value={String(snapshot.failedRequests + snapshot.rejectedRequests + snapshot.activeBans)} />
    </HStack>
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" }}>
      <Text font="caption2" foregroundStyle={secondary}>{snapshot.mode === "direct" ? "直连模式" : snapshot.mode === "proxy" ? "全局代理" : "规则模式"}</Text>
      <Text font="caption2" foregroundStyle={secondary}>·</Text>
      <Text font="caption2" foregroundStyle={secondary}>{snapshot.source === "metrics" ? "Metrics" : snapshot.source === "traffic" ? "Traffic API" : "缓存数据"}</Text>
    </HStack>
  </VStack>
}

function WidgetView({ snapshot, settings }: { snapshot: WidgetSnapshot; settings: WidgetSettings }) {
  const family = Widget.family
  const tint = accentColor(settings.accent)
  if (family === "accessoryInline") return <Text>{snapshot.connected ? `Surge · ${formatBytes(snapshot.downloadSpeed, "/s")}` : "Surge Core 离线"}</Text>
  if (family === "accessoryCircular") return <VStack><Image systemName={snapshot.connected ? "bolt.horizontal.circle.fill" : "exclamationmark.circle"} /><Text font="caption2">{Math.round(snapshot.activeRequests)}</Text></VStack>
  if (family === "accessoryRectangular") return <VStack alignment="leading"><Text font="headline">Surge Panel</Text><Text font="caption">{snapshot.connected ? `↓ ${formatBytes(snapshot.downloadSpeed, "/s")} · ${Math.round(snapshot.activeRequests)} 连接` : snapshot.error}</Text></VStack>

  let content
  if (!snapshot.connected) content = <OfflineView snapshot={snapshot} tint={tint} />
  else if (family === "systemSmall") content = <SmallWidget snapshot={snapshot} settings={settings} tint={tint} />
  else if (family === "systemLarge" || family === "systemExtraLarge") content = <LargeWidget snapshot={snapshot} settings={settings} tint={tint} />
  else content = <MediumWidget snapshot={snapshot} settings={settings} tint={tint} />

  const inset = family === "systemSmall" ? 12 : 10
  const size = Widget.displaySize
  return <VStack frame={{ width: size.width, height: size.height }} widgetBackground={background} widgetURL="scripting:///run/Surge_Pro">
    <VStack alignment="center" frame={{ width: Math.max(1, size.width - inset * 2), height: Math.max(1, size.height - inset * 2), alignment: "center" }}>{content}</VStack>
  </VStack>
}

Widget.present(<WidgetView snapshot={loadSnapshot()} settings={loadSettings()} />, { policy: "atEnd" })
