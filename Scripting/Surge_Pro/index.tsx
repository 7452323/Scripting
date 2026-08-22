import {
  AreaChart,
  Button,
  Divider,
  fetch,
  Form,
  HStack,
  Label,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Script,
  Spacer,
  Text,
  Tab,
  TabView,
  TextField,
  Toggle,
  VStack,
  WebView,
  Widget,
  useEffect,
  useRef,
  useState,
} from "scripting"

type Config = {
  apiBase: string
  apiKey: string
  refreshSeconds: number
  allowInsecure: boolean
}

type PublicPanelConfig = {
  apiBase: string
  refreshSeconds: number
}

type CounterMap = Record<string, number>

type WidgetSettings = {
  style: "compact" | "detailed"
  accent: "purple" | "blue" | "green"
  refreshMinutes: number
  showSpeed: boolean
  showUptime: boolean
  showConnections: boolean
  showPolicyLatency: boolean
}

type CoreSnapshot = {
  timestamp: number
  source: "metrics" | "traffic"
  uptime: number
  memory: number
  activeRequests: number
  dnsCacheEntries: number
  activeBans: number
  policyIn: CounterMap
  policyOut: CounterMap
  interfaceIn: CounterMap
  interfaceOut: CounterMap
  build: Record<string, string>
}

type TrafficRow = {
  name: string
  download: number
  upload: number
  total: number
}

type NetworkInterfaceRow = {
  name: string
  ipv4: string[]
  ipv6: string[]
}

type RealtimeInterfaceRow = {
  name: string
  download: number
  upload: number
  downloadSpeed: number
  uploadSpeed: number
  maxDownloadSpeed: number
  maxUploadSpeed: number
}

type PolicyNode = {
  name: string
  latency: number
}

type PolicyGroup = {
  name: string
  type: string
  selected: string
  optionCount: number
  policies: string[]
  nodes: PolicyNode[]
  latency: number
}

type HistoryPoint = {
  t: number
  memory: number
  download: number
  upload: number
  active: number
}

type PanelModel = {
  hasSnapshot: boolean
  connected: boolean
  error: string
  updatedAt: number
  source: string
  mode: string
  uptime: number
  memory: number
  downloadSpeed: number
  uploadSpeed: number
  activeRequests: number
  dnsCacheEntries: number
  activeBans: number
  virtualIPs: number
  failedRequests: number
  rejectedRequests: number
  temporaryRules: number
  nodes: TrafficRow[]
  interfaces: TrafficRow[]
  networkInterfaces: NetworkInterfaceRow[]
  realtimeInterfaces: RealtimeInterfaceRow[]
  connectorStats: RealtimeInterfaceRow[]
  trafficStartTime: number
  groups: PolicyGroup[]
  history: HistoryPoint[]
  engine: { version: string; build: string; system: string }
  config: PublicPanelConfig
}

type Metric = { name: string; labels: Record<string, string>; value: number }

const APP_VERSION = "1.5.1"
const CONFIG_KEY = "surge-panel.config.v1"
const HISTORY_KEY = "surge-panel.history.v1"
const WIDGET_SETTINGS_KEY = "surge-panel.widget-settings.v1"
const WIDGET_CACHE_KEY = "surge-panel.widget-cache.v1"
const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  style: "detailed",
  accent: "purple",
  refreshMinutes: 15,
  showSpeed: true,
  showUptime: true,
  showConnections: true,
  showPolicyLatency: true,
}
const HISTORY_INTERVAL_MS = 60_000
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000
const DEFAULT_CONFIG: Config = {
  apiBase: "http://127.0.0.1:6171",
  apiKey: "",
  refreshSeconds: 5,
  allowInsecure: false,
}

function publicPanelConfig(config: Config): PublicPanelConfig {
  return { apiBase: config.apiBase, refreshSeconds: config.refreshSeconds }
}

function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

function normalizeRefreshSeconds(value: unknown): number {
  const options = [5, 10, 15, 20, 25, 30]
  const seconds = Number(value || 5)
  return options.reduce((best, option) => Math.abs(option - seconds) < Math.abs(best - seconds) ? option : best, 5)
}

function normalizeConfig(value: Partial<Config> | null): Config {
  return {
    apiBase: normalizeBaseURL(value?.apiBase || DEFAULT_CONFIG.apiBase),
    apiKey: String(value?.apiKey || ""),
    refreshSeconds: normalizeRefreshSeconds(value?.refreshSeconds),
    allowInsecure: Boolean(value?.allowInsecure) || /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(normalizeBaseURL(value?.apiBase || DEFAULT_CONFIG.apiBase)),
  }
}

function loadConfig(): Config | null {
  const saved = Storage.get<Partial<Config>>(CONFIG_KEY)
  if (!saved) return null
  const apiKey = Keychain.get(CONFIG_KEY) || ""
  return normalizeConfig({ ...saved, apiKey })
}

function saveConfig(config: Config): void {
  Storage.set(CONFIG_KEY, {
    apiBase: config.apiBase,
    refreshSeconds: config.refreshSeconds,
    allowInsecure: config.allowInsecure,
  })
  Keychain.set(CONFIG_KEY, config.apiKey)
}

function normalizeWidgetSettings(value: Partial<WidgetSettings> | null): WidgetSettings {
  const refreshMinutes = Math.min(60, Math.max(5, Math.round(Number(value?.refreshMinutes || DEFAULT_WIDGET_SETTINGS.refreshMinutes) / 5) * 5))
  return {
    style: value?.style === "compact" ? "compact" : "detailed",
    accent: value?.accent === "blue" || value?.accent === "green" ? value.accent : "purple",
    refreshMinutes,
    showSpeed: value?.showSpeed !== false,
    showUptime: value?.showUptime !== false,
    showConnections: value?.showConnections !== false,
    showPolicyLatency: value?.showPolicyLatency !== false,
  }
}

function loadWidgetSettings(): WidgetSettings {
  return normalizeWidgetSettings(Storage.get<Partial<WidgetSettings>>(WIDGET_SETTINGS_KEY) || null)
}

function saveWidgetSettings(settings: WidgetSettings): void {
  Storage.set(WIDGET_SETTINGS_KEY, normalizeWidgetSettings(settings))
}

function saveWidgetCache(model: PanelModel): void {
  const group = model.groups.find(item => item.selected) || model.groups[0]
  const trafficRows = model.nodes.length ? model.nodes : model.interfaces
  const selectedNodeLatency = group?.nodes.find(node => node.name === group.selected && node.latency > 0)?.latency || 0
  const availableNodeLatency = group?.nodes.find(node => node.latency > 0)?.latency || 0
  Storage.set(WIDGET_CACHE_KEY, {
    timestamp: model.updatedAt,
    connected: model.connected,
    error: model.error,
    uptime: model.uptime,
    memory: model.memory,
    downloadSpeed: model.downloadSpeed,
    uploadSpeed: model.uploadSpeed,
    activeRequests: model.activeRequests,
    dnsCacheEntries: model.dnsCacheEntries,
    cumulativeDownload: trafficRows.reduce((sum, row) => sum + row.download, 0),
    cumulativeUpload: trafficRows.reduce((sum, row) => sum + row.upload, 0),
    failedRequests: model.failedRequests,
    rejectedRequests: model.rejectedRequests,
    virtualIPs: model.virtualIPs,
    activeBans: model.activeBans,
    temporaryRules: model.temporaryRules,
    mode: model.mode,
    source: model.source,
    policyGroupCount: model.groups.length,
    policyNodeCount: model.groups.reduce((sum, item) => sum + item.nodes.length, 0),
    interfaceCount: new Set([...model.interfaces.map(item => item.name), ...model.realtimeInterfaces.map(item => item.name), ...model.connectorStats.map(item => item.name)]).size,
    policyGroup: group?.name || "策略组",
    selectedPolicy: group?.selected || "—",
    policyLatency: group?.latency || selectedNodeLatency || availableNodeLatency,
  })
}

function loadHistory(): HistoryPoint[] {
  const saved = Storage.get<HistoryPoint[]>(HISTORY_KEY)
  return Array.isArray(saved) ? saved : []
}

function saveHistory(history: HistoryPoint[]): void {
  Storage.set(HISTORY_KEY, history)
}

async function apiText(config: Config, path: string, method = "GET", body?: string, timeout = 10): Promise<string> {
  const separator = path.includes("?") ? "&" : "?"
  const authenticatedPath = `${path}${separator}x-key=${encodeURIComponent(config.apiKey)}`
  const response = await fetch(config.apiBase + authenticatedPath, {
    method,
    headers: {
      "X-Key": config.apiKey,
      Accept: "*/*",
      "Cache-Control": "no-cache",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    timeout,
    allowInsecureRequest: config.allowInsecure,
    debugLabel: "Surge Panel",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} · ${path}`)
  return response.text()
}

async function apiJSON(config: Config, path: string, method = "GET", body?: string): Promise<unknown> {
  const text = await apiText(config, path, method, body)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`接口未返回 JSON · ${path}`)
  }
}

async function testPolicyGroup(config: Config, groupName: string): Promise<unknown> {
  const text = await apiText(config, "/v1/policy_groups/test", "POST", JSON.stringify({ group_name: groupName }), 60)
  try { return JSON.parse(text) } catch { return null }
}

async function testPolicies(config: Config, policyNames: string[]): Promise<unknown> {
  const text = await apiText(config, "/v1/policies/test", "POST", JSON.stringify({
    policy_names: policyNames,
    url: "http://www.gstatic.com/generate_204",
  }), 60)
  try { return JSON.parse(text) } catch { return null }
}

async function safeJSON(config: Config, path: string): Promise<unknown | null> {
  try {
    return await apiJSON(config, path)
  } catch {
    return null
  }
}

async function safeText(config: Config, path: string): Promise<string | null> {
  try {
    return await apiText(config, path)
  } catch {
    return null
  }
}

async function fetchSurgeNetwork(config: Config): Promise<unknown | null> {
  try {
    return await apiJSON(config, "/v1/scripting/evaluate", "POST", JSON.stringify({
      script_text: "$done($network)",
      mock_type: "generic",
      timeout: 3,
    }))
  } catch {
    return null
  }
}

async function captureCore(config: Config): Promise<CoreSnapshot> {
  try {
    const metrics = parsePrometheus(await apiText(config, "/v1/metrics"))
    if (!metrics.some(item => ["surgeuptimeseconds", "surgeuptimesecond"].includes(normalizeKey(item.name)))) {
      throw new Error("当前版本没有返回 Surge Metrics")
    }
    return coreFromMetrics(metrics)
  } catch (metricsError) {
    try {
      return coreFromTraffic(await apiJSON(config, "/v1/traffic"))
    } catch {
      throw metricsError
    }
  }
}

async function fetchDetails(config: Config): Promise<Record<string, unknown | null>> {
  const [outbound, recent, dns, rules, groups, testResults, benchmarkResults, policies, profile, network, traffic] = await Promise.all([
    safeJSON(config, "/v1/outbound"),
    safeJSON(config, "/v1/requests/recent"),
    safeJSON(config, "/v1/dns"),
    safeJSON(config, "/v1/rules"),
    safeJSON(config, "/v1/policy_groups"),
    safeJSON(config, "/v1/policy_groups/test_results"),
    safeJSON(config, "/v1/policies/benchmark_results"),
    safeJSON(config, "/v1/policies"),
    safeText(config, "/v1/profiles/current?sensitive=0"),
    fetchSurgeNetwork(config),
    safeJSON(config, "/v1/traffic"),
  ])
  return { outbound, recent, dns, rules, groups, testResults, benchmarkResults, policies, profile, network, traffic }
}

function parsePrometheus(text: string): Metric[] {
  const output: Metric[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)$/)
    const value = Number(match?.[3])
    if (!match || !Number.isFinite(value)) continue
    output.push({ name: match[1], labels: parseLabels(match[2] || ""), value })
  }
  return output
}

function parseLabels(source: string): Record<string, string> {
  const labels: Record<string, string> = {}
  const regex = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g
  for (let match; (match = regex.exec(source));) {
    labels[match[1]] = match[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  return labels
}

function metricValue(metrics: Metric[], names: string | string[], fallback = 0): number {
  const accepted = Array.isArray(names) ? names : [names]
  const normalized = accepted.map(normalizeKey)
  return metrics.find(item => normalized.includes(normalizeKey(item.name)))?.value ?? fallback
}

function labeledMetric(metrics: Metric[], names: string | string[], label: string): CounterMap {
  const accepted = Array.isArray(names) ? names : [names]
  return metrics.reduce<CounterMap>((output, row) => {
    if (accepted.some(name => normalizeKey(name) === normalizeKey(row.name))) output[String(row.labels[label] || row.labels.name || "未知")] = row.value
    return output
  }, {})
}

function directionalMetric(metrics: Metric[], scope: "interface" | "policy", direction: "in" | "out"): CounterMap {
  const label = scope
  const legacy = normalizeKey(`surge_${scope}_${direction}_bytes_total`)
  const genericNames = [`surge_${scope}_bytes_total`, `surge${scope}_bytes_total`, `surge_${scope}_bytestotal`].map(normalizeKey)
  const aliases = direction === "in" ? ["in", "download", "received", "rx"] : ["out", "upload", "sent", "tx"]
  return metrics.reduce<CounterMap>((output, row) => {
    const rowDirection = String(row.labels.direction || row.labels.type || "").toLowerCase()
    const rowName = normalizeKey(row.name)
    if (rowName === legacy || (genericNames.includes(rowName) && aliases.includes(rowDirection))) {
      const key = String(row.labels[label] || row.labels.name || row.labels.policy || row.labels.interface || "未知")
      output[key] = Number(row.value || 0)
    }
    return output
  }, {})
}

function coreFromMetrics(metrics: Metric[]): CoreSnapshot {
  const build = metrics.find(item => item.name === "surge_build_info")
  return {
    timestamp: Date.now(), source: "metrics",
    uptime: metricValue(metrics, ["surge_uptime_seconds", "surgeuptime_seconds"]),
    memory: metricValue(metrics, ["surge_memory_bytes", "surgememorybytes"]),
    activeRequests: metricValue(metrics, ["surge_active_requests", "surge_in_flight_requests"]),
    dnsCacheEntries: metricValue(metrics, ["surge_dns_cache_entries", "surge_dns_cache_size"]),
    activeBans: metricValue(metrics, ["surge_active_bans", "surge_unauthorized_access_bans"]),
    policyIn: directionalMetric(metrics, "policy", "in"),
    policyOut: directionalMetric(metrics, "policy", "out"),
    interfaceIn: directionalMetric(metrics, "interface", "in"),
    interfaceOut: directionalMetric(metrics, "interface", "out"),
    build: build?.labels || {},
  }
}

function coreFromTraffic(traffic: unknown): CoreSnapshot {
  const root = traffic as Record<string, unknown>
  const uptimeRaw = deepNumber(root, ["uptime", "uptimeseconds", "runningtime", "elapsed"])
  const startTime = deepNumber(root, ["starttime", "startedat", "starttimestamp"])
  const uptime = uptimeRaw || (startTime ? Math.max(0, (Date.now() - (startTime > 100000000000 ? startTime : startTime * 1000)) / 1000) : 0)
  return {
    timestamp: Date.now(), source: "traffic", uptime,
    memory: deepNumber(root, ["memorybytes", "memoryusage", "memory", "physicalmemory"]),
    activeRequests: deepNumber(root, ["activerequests", "activeconnections", "currentconnections"]),
    dnsCacheEntries: deepNumber(root, ["dnscacheentries", "dnscachecount"]), activeBans: 0,
    policyIn: {}, policyOut: {},
    interfaceIn: { total: deepNumber(root, ["bytesin", "downloadbytes", "inboundbytes", "receivedbytes"]) },
    interfaceOut: { total: deepNumber(root, ["bytesout", "uploadbytes", "outboundbytes", "sentbytes"]) },
    build: {},
  }
}

function deepNumber(root: unknown, names: string[]): number {
  const wanted = names.map(normalizeKey)
  const visited = new Set<object>()
  const visit = (value: unknown, depth: number): number => {
    if (!value || typeof value !== "object" || depth > 7 || visited.has(value)) return 0
    visited.add(value)
    for (const [key, child] of Object.entries(value)) {
      if (wanted.includes(normalizeKey(key)) && Number.isFinite(Number(child))) return Number(child)
      const nested = visit(child, depth + 1)
      if (nested) return nested
    }
    return 0
  }
  return visit(root, 0)
}

function normalizeKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, "") }
function totalCounter(values: CounterMap): number { return Object.values(values).reduce((sum, value) => sum + value, 0) }

function deriveSpeed(previous: CoreSnapshot | null, current: CoreSnapshot): { download: number; upload: number } {
  if (!previous || current.timestamp <= previous.timestamp || (previous.uptime && current.uptime < previous.uptime)) return { download: 0, upload: 0 }
  const elapsed = Math.max(0.25, (current.timestamp - previous.timestamp) / 1000)
  const beforeIn = totalCounter(previous.policyIn) || totalCounter(previous.interfaceIn)
  const beforeOut = totalCounter(previous.policyOut) || totalCounter(previous.interfaceOut)
  const nowIn = totalCounter(current.policyIn) || totalCounter(current.interfaceIn)
  const nowOut = totalCounter(current.policyOut) || totalCounter(current.interfaceOut)
  return { download: Math.max(0, (nowIn - beforeIn) / elapsed), upload: Math.max(0, (nowOut - beforeOut) / elapsed) }
}

function surgeTrafficStats(raw: unknown, key: "interface" | "connector"): RealtimeInterfaceRow[] {
  if (!isRecord(raw)) return []
  const values = isRecord(raw[key]) ? raw[key] as Record<string, unknown> : {}
  return Object.entries(values).filter(([, value]) => isRecord(value)).map(([name, value]) => {
    const item = value as Record<string, unknown>
    return {
      name,
      download: Number(item.in || 0),
      upload: Number(item.out || 0),
      downloadSpeed: Number(item.inCurrentSpeed || 0),
      uploadSpeed: Number(item.outCurrentSpeed || 0),
      maxDownloadSpeed: Number(item.inMaxSpeed || 0),
      maxUploadSpeed: Number(item.outMaxSpeed || 0),
    }
  })
}

function surgeTrafficStartTime(raw: unknown): number {
  if (!isRecord(raw)) return 0
  const value = Number(raw.startTime || 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 100000000000 ? value : value * 1000
}

function surgeNetworkInterfaces(raw: unknown): NetworkInterfaceRow[] {
  let value = raw
  if (isRecord(value)) value = value.result || value.output || value.value || value.data || value
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!isRecord(value)) return []
  const rows = new Map<string, NetworkInterfaceRow>()
  const add = (nameValue: unknown, family: "ipv4" | "ipv6", addressValue: unknown): void => {
    const name = String(nameValue || "").trim()
    const address = String(addressValue || "").trim()
    if (!name || !address) return
    const row = rows.get(name) || { name, ipv4: [], ipv6: [] }
    if (!row[family].includes(address)) row[family].push(address)
    rows.set(name, row)
  }
  const v4 = isRecord(value.v4) ? value.v4 : {}
  const v6 = isRecord(value.v6) ? value.v6 : {}
  add(v4.primaryInterface, "ipv4", v4.primaryAddress)
  add(v6.primaryInterface, "ipv6", v6.primaryAddress)
  return [...rows.values()]
}

function buildTrafficRows(inbound: CounterMap, outbound: CounterMap, includeIdle = false): TrafficRow[] {
  const names = new Set([...Object.keys(inbound), ...Object.keys(outbound)])
  const rows = [...names].map(name => {
    const download = Number(inbound[name] || 0)
    const upload = Number(outbound[name] || 0)
    return { name, download, upload, total: download + upload }
  })
  return rows.filter(item => includeIdle || item.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, includeIdle ? rows.length : 30)
}

function extractArray(root: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(root)) return root.filter(isRecord)
  if (!isRecord(root)) return []
  for (const key of keys) {
    const candidate = root[key]
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }
  for (const value of Object.values(root)) if (Array.isArray(value)) return value.filter(isRecord)
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }

function hasMeaningfulError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === "string") return !["", "none", "null", "nil", "no error", "success", "0"].includes(error.trim().toLowerCase())
  if (Array.isArray(error)) return error.length > 0
  return typeof error === "object" ? Object.keys(error).length > 0 : Boolean(error)
}

function countVirtualIPs(dns: unknown): number {
  const text = JSON.stringify(dns || {})
  const ipv4 = text.match(/198\.(?:18|19)\.(?:\d{1,3})\.(?:\d{1,3})/g) || []
  const ipv6 = text.match(/fd00:6152:[0-9a-f:]+/gi) || []
  return new Set([...ipv4, ...ipv6]).size
}

function collectLatencies(root: unknown): CounterMap {
  const output: CounterMap = {}
  const visited = new Set<object>()
  const add = (name: unknown, value: unknown): void => {
    const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/)
    const delay = match ? Number(match[0]) : Number.NaN
    const key = String(name || "").trim()
    if (key && Number.isFinite(delay) && delay > 0) output[key] = delay
  }
  const visit = (value: unknown, parent = "", depth = 0): void => {
    if (value == null || depth > 7) return
    if (typeof value === "number" || (typeof value === "string" && /\d/.test(value))) { add(parent, value); return }
    if (Array.isArray(value)) { value.forEach(item => visit(item, parent, depth + 1)); return }
    if (!isRecord(value) || visited.has(value)) return
    visited.add(value)
    const name = String(value.policy || value.name || value.policyName || value.policy_name || value.proxy || value.node || parent)
    const delay = value.delay ?? value.latency ?? value.rtt ?? value.score ?? value.result ?? value.responseTime ?? value.response_time ?? value.time ?? value.ms
    if (delay != null) add(name, delay)
    Object.entries(value).forEach(([key, child]) => {
      if (typeof child === "number" || (typeof child === "string" && /\d/.test(child))) add(key, child)
      else visit(child, key, depth + 1)
    })
  }
  visit(root)
  return output
}

function resultEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap(item => {
    if (isRecord(item)) {
      const name = String(item.name ?? item.policy ?? item.policyName ?? item.policy_name ?? item.server ?? item.title ?? "")
      if (name) return [[name, item] as [string, unknown]]
    }
    return resultEntries(item)
  })
  if (!isRecord(value)) return []
  if (isRecord(value.data)) return Object.entries(value.data)
  const results = value.results ?? value.policies ?? value.items ?? value.result ?? value.scores
  if (Array.isArray(results)) return results.flatMap(item => resultEntries(item))
  if (isRecord(results)) return Object.entries(results)
  return Object.entries(value)
}

function readPolicyDelay(value: unknown): number {
  if (typeof value === "number") return value >= 0 ? value : 0
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/)
    const number = match ? Number(match[0]) : Number.NaN
    return Number.isFinite(number) && number >= 0 ? number : 0
  }
  if (!isRecord(value) || value.testing === 1 || value.testing === true) return 0
  if (typeof value.lastTestScoreInMS === "number") {
    if (value.lastTestDate === 0 && value.lastTestScoreInMS === 0 && !value.lastTestErrorMessage) return 0
    if (value.lastTestScoreInMS >= 0) return value.lastTestScoreInMS
  }
  const nested = value.testResult ?? value.lastTestResult ?? value.lastTest ?? value.benchmark
  const nestedDelay = readPolicyDelay(nested)
  if (nestedDelay > 0) return nestedDelay
  for (const key of ["delay", "latency", "rtt", "tcp", "receive", "time", "duration", "value", "latestDelay", "lastDelay", "lastTestScore", "score", "testScore", "available"]) {
    const delay = readPolicyDelay(value[key])
    if (delay > 0) return delay
  }
  return 0
}

function policyDelay(testResults: unknown, groupName: string, policyName: string, option?: unknown): number {
  const roots = Array.isArray(testResults) ? testResults : [testResults]
  for (const root of roots) {
    if (!isRecord(root)) continue
    const groupResults = root[groupName] ?? root[encodeURIComponent(groupName)]
    const lineHash = isRecord(option) ? String(option.lineHash || "") : ""
    for (const source of [groupResults, root]) {
      const entries = new Map(resultEntries(source))
      const result = entries.get(policyName) ?? (lineHash ? entries.get(lineHash) : undefined)
      const delay = readPolicyDelay(result)
      if (delay > 0) return delay
    }
  }
  return readPolicyDelay(option)
}

function normalizeGroups(raw: unknown, testResults: unknown, policiesRaw: unknown): PolicyGroup[] {
  const latency = collectLatencies(testResults)
  const seen = new Set<string>()
  const groups: PolicyGroup[] = []
  const namesFrom = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value.map(item => String(isRecord(item) ? (item.name || item.policy || item.policyName || item.policy_name || item.proxy || item.title || item.id || "") : item).trim()).filter(Boolean)
  }
  const addGroup = (nameValue: unknown, optionsValue: unknown, selectedValue: unknown, typeValue = "策略组"): void => {
    const name = String(nameValue || "").trim()
    if (!name || seen.has(name)) return
    const options = Array.isArray(optionsValue) ? optionsValue : []
    const policies = namesFrom(options)
    const selected = String(selectedValue || "").trim()
    if (!policies.length && !selected) return
    seen.add(name)
    groups.push({
      name,
      type: String(typeValue || "策略组"),
      selected: selected || "自动选择",
      optionCount: policies.length,
      policies,
      nodes: policies.map((policy, index) => ({ name: policy, latency: policyDelay(testResults, name, policy, options[index]) || Number(latency[policy] || 0) })),
      latency: policyDelay(testResults, name, selected) || Number(latency[selected] || latency[name] || 0),
    })
  }
  const addValue = (value: unknown, fallback = ""): void => {
    if (Array.isArray(value)) {
      addGroup(fallback, value, "", "策略组")
      return
    }
    if (!isRecord(value)) {
      if (fallback && typeof value === "string") addGroup(fallback, [], value, "策略组")
      return
    }
    const name = value.name || value.groupName || value.group || fallback
    const options = value.policies || value.options || value.available || value.members || value.proxies || value.children
    const selected = value.selected || value.selection || value.current || value.policy || value.now || value.default
    addGroup(String(name || ""), options, selected, String(value.type || value.groupType || value.kind || "策略组"))
  }
  if (Array.isArray(raw)) raw.forEach(item => addValue(item))
  else if (isRecord(raw)) {
    const ordered = raw["policy-groups"] || raw.groups || raw.policyGroups || raw.policy_groups || raw.items || raw.data
    if (Array.isArray(ordered)) {
      ordered.forEach(item => addValue(item))
    } else if (isRecord(ordered)) {
      Object.entries(ordered).forEach(([key, value]) => addValue(value, key))
    } else {
      Object.entries(raw).forEach(([key, value]) => addValue(value, key))
    }
  }
  if (!groups.length) {
    const list = extractArray(policiesRaw, ["policies", "items", "data"])
    if (list.length) groups.push({ name: "可用策略", type: "策略", selected: "", optionCount: list.length, policies: namesFrom(list), nodes: namesFrom(list).map(name => ({ name, latency: Number(latency[name] || 0) })), latency: 0 })
  }
  return groups.slice(0, 40)
}

function profileGroupOrder(profile: unknown): string[] {
  if (typeof profile !== "string") return []
  let text = profile
  try {
    const parsed = JSON.parse(profile)
    if (isRecord(parsed)) text = String(parsed.content || parsed.profile || parsed.text || parsed.data || "")
  } catch {}
  const section = text.match(/(?:^|\r?\n)\s*\[Proxy Group\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[[^\]]+\]|$)/i)?.[1] || ""
  const order: string[] = []
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    const equal = line.indexOf("=")
    if (equal <= 0) continue
    const name = line.slice(0, equal).trim()
    if (name && !order.includes(name)) order.push(name)
  }
  return order
}

function sortGroupsLikeSurge(groups: PolicyGroup[], profile: unknown): PolicyGroup[] {
  const order = profileGroupOrder(profile)
  if (!order.length) return groups
  const ranks = new Map(order.map((name, index) => [name, index]))
  return groups.map((group, index) => ({ group, index })).sort((a, b) => {
    const rankA = ranks.get(a.group.name)
    const rankB = ranks.get(b.group.name)
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    return a.index - b.index
  }).map(item => item.group)
}

function updateHistory(history: HistoryPoint[], current: CoreSnapshot, speed: { download: number; upload: number }): HistoryPoint[] {
  const cutoff = Date.now() - HISTORY_RETENTION_MS
  const next = history.filter(point => point.t >= cutoff)
  const last = next[next.length - 1]
  if (!last || current.timestamp - last.t >= HISTORY_INTERVAL_MS) {
    next.push({ t: current.timestamp, memory: current.memory, download: speed.download, upload: speed.upload, active: current.activeRequests })
  }
  return next.slice(-1440)
}

function buildModel(current: CoreSnapshot, previous: CoreSnapshot | null, details: Record<string, unknown | null>, history: HistoryPoint[], config: Config): PanelModel {
  const speed = deriveSpeed(previous, current)
  const nextHistory = updateHistory(history, current, speed)
  const recent = extractArray(details.recent, ["requests", "recent", "records", "items", "data"])
  const rules = extractArray(details.rules, ["rules", "items", "data"])
  const failed = recent.filter(item => item.failed === true || item.success === false || hasMeaningfulError(item.error || item.errorMessage || item.failedReason)).length
  const rejected = recent.filter(item => String(item.policyName || item.policy || item.outbound || "").toUpperCase().includes("REJECT")).length
  const temporaryRules = rules.filter(item => item.temporary === true || item.isTemporary === true || /temporary|临时/i.test(String(item.type || item.source || ""))).length
  const outbound = isRecord(details.outbound) ? details.outbound : {}
  return {
    hasSnapshot: true, connected: true, error: "", updatedAt: current.timestamp, source: current.source, mode: String(outbound.mode || "rule").toLowerCase(),
    uptime: current.uptime, memory: current.memory, downloadSpeed: speed.download, uploadSpeed: speed.upload,
    activeRequests: current.activeRequests, dnsCacheEntries: current.dnsCacheEntries, activeBans: current.activeBans,
    virtualIPs: countVirtualIPs(details.dns), failedRequests: failed, rejectedRequests: rejected, temporaryRules,
    nodes: buildTrafficRows(current.policyIn, current.policyOut), interfaces: buildTrafficRows(current.interfaceIn, current.interfaceOut, true),
    networkInterfaces: surgeNetworkInterfaces(details.network), realtimeInterfaces: surgeTrafficStats(details.traffic, "interface"), connectorStats: surgeTrafficStats(details.traffic, "connector"), trafficStartTime: surgeTrafficStartTime(details.traffic), groups: sortGroupsLikeSurge(normalizeGroups(details.groups, [details.testResults, details.benchmarkResults], details.policies), details.profile), history: nextHistory,
    engine: { version: current.build.version || "-", build: current.build.build || "-", system: current.build.system || "iOS" }, config: publicPanelConfig(config),
  }
}

function offlineModel(config: Config, error: unknown, history: HistoryPoint[]): PanelModel {
  return {
    hasSnapshot: false, connected: false, error: readableError(error), updatedAt: 0, source: "offline", mode: "rule", uptime: 0, memory: 0,
    downloadSpeed: 0, uploadSpeed: 0, activeRequests: 0, dnsCacheEntries: 0, activeBans: 0, virtualIPs: 0,
    failedRequests: 0, rejectedRequests: 0, temporaryRules: 0, nodes: [], interfaces: [], networkInterfaces: [], realtimeInterfaces: [], connectorStats: [], trafficStartTime: 0, groups: [], history,
    engine: { version: "-", build: "-", system: "iOS" }, config: publicPanelConfig(config),
  }
}

function readableError(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error || "无法连接 Surge Core")
  if (/401|403|unauthor/i.test(message)) return "API 密钥不正确，Surge 拒绝了访问。"
  if (/timed?\s*out|timeout/i.test(message)) return "连接 Surge Core 超时，请确认 HTTP API 已启用。"
  if (/network|offline|hostname|server|connect/i.test(message)) return "无法连接 Surge Core，请检查 API 地址、Surge 是否启动以及本地网络权限。"
  return message
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum
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

function modeName(mode: string): string {
  return mode === "direct" ? "直连模式" : mode === "proxy" ? "全局代理" : "规则模式"
}

function timestamp(value: number): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

function SetupView({ initial, onSave }: { initial: Config; onSave: (config: Config) => void }) {
  const [apiBase, setApiBase] = useState(initial.apiBase)
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [refresh, setRefresh] = useState(String(initial.refreshSeconds))
  const [allowInsecure, setAllowInsecure] = useState(initial.allowInsecure)
  const [error, setError] = useState("")

  const save = () => {
    const next = normalizeConfig({ apiBase, apiKey, refreshSeconds: Number(refresh), allowInsecure })
    if (!/^https?:\/\//i.test(next.apiBase) || !next.apiKey) {
      setError("请填写 HTTP/HTTPS 地址及 Surge HTTP API 密钥。")
      return
    }
    saveConfig(next)
    onSave(next)
  }

  return <NavigationStack><Form>
    <Section title="Surge HTTP API">
      <TextField title="API 地址" value={apiBase} onChanged={setApiBase} prompt="http://127.0.0.1:6171" />
      <TextField title="API 密钥" value={apiKey} onChanged={setApiKey} />
      <TextField title="刷新间隔（5-30 秒）" value={refresh} onChanged={setRefresh} />
      <Toggle title="允许 HTTP 连接" value={allowInsecure} onChanged={setAllowInsecure} />
    </Section>
    <Section title="安全说明"><Text>密钥保存在 iOS 钥匙串；建议 Surge HTTP API 仅监听 127.0.0.1。</Text></Section>
    {error ? <Section><Text>{error}</Text></Section> : null}
    <Section><Button title="保存并连接" systemImage="checkmark" action={save} /></Section>
  </Form></NavigationStack>
}

function WidgetSettingsView({ initial, onSave }: { initial: WidgetSettings; onSave: (settings: WidgetSettings) => void }) {
  const [style, setStyle] = useState<WidgetSettings["style"]>(initial.style)
  const [accent, setAccent] = useState<WidgetSettings["accent"]>(initial.accent)
  const [refreshMinutes, setRefreshMinutes] = useState(String(initial.refreshMinutes))
  const [showSpeed, setShowSpeed] = useState(initial.showSpeed)
  const [showUptime, setShowUptime] = useState(initial.showUptime)
  const [showConnections, setShowConnections] = useState(initial.showConnections)
  const [showPolicyLatency, setShowPolicyLatency] = useState(initial.showPolicyLatency)

  const current = (): WidgetSettings => normalizeWidgetSettings({
    style,
    accent,
    refreshMinutes: Number(refreshMinutes),
    showSpeed,
    showUptime,
    showConnections,
    showPolicyLatency,
  })
  const save = () => {
    const next = current()
    saveWidgetSettings(next)
    Widget.reloadUserWidgets()
    onSave(next)
  }
  const preview = async (family: "systemSmall" | "systemMedium" | "systemLarge") => {
    const next = current()
    saveWidgetSettings(next)
    Widget.reloadTestWidgets()
    await Widget.preview({ family })
  }

  return <NavigationStack><Form navigationTitle="小组件适配">
    <Section title="布局">
      <Picker title="显示样式" value={style} onChanged={(value: string) => setStyle(value as WidgetSettings["style"])} pickerStyle="navigationLink">
        <Text tag="compact">简洁</Text><Text tag="detailed">详细</Text>
      </Picker>
      <Picker title="强调色" value={accent} onChanged={(value: string) => setAccent(value as WidgetSettings["accent"])} pickerStyle="navigationLink">
        <Text tag="purple">紫色</Text><Text tag="blue">蓝色</Text><Text tag="green">绿色</Text>
      </Picker>
      <Picker title="刷新频率" value={refreshMinutes} onChanged={setRefreshMinutes} pickerStyle="navigationLink">
        {[5, 10, 15, 30, 60].map(value => <Text key={value} tag={String(value)}>{value} 分钟</Text>)}
      </Picker>
    </Section>
    <Section title="显示内容">
      <Toggle title="上传下载速度" value={showSpeed} onChanged={setShowSpeed} />
      <Toggle title="运行时间" value={showUptime} onChanged={setShowUptime} />
      <Toggle title="活动连接" value={showConnections} onChanged={setShowConnections} />
      <Toggle title="策略组延迟" value={showPolicyLatency} onChanged={setShowPolicyLatency} />
    </Section>
    <Section title="预览">
      <Button title="预览小号组件" systemImage="square" action={() => void preview("systemSmall")} />
      <Button title="预览中号组件" systemImage="rectangle" action={() => void preview("systemMedium")} />
      <Button title="预览大号组件" systemImage="rectangle.portrait" action={() => void preview("systemLarge")} />
    </Section>
    <Section><Button title="保存并刷新小组件" systemImage="checkmark.circle" action={save} /></Section>
    <Section title="说明"><Text>小组件会读取当前 Surge HTTP API 配置，并按照所选频率更新。iOS 可能根据电量与使用情况延后刷新。</Text></Section>
  </Form></NavigationStack>
}

function valueRow(label: string, value: string) {
  return <HStack><Text>{label}</Text><Spacer /><Text>{value}</Text></HStack>
}

function Header({ title, subtitle, action }: { title: string; subtitle: string; action?: () => void }) {
  return <Section title={title}><HStack><Text>{subtitle}</Text><Spacer />{action ? <Button title="刷新" systemImage="arrow.clockwise" action={action} /> : null}</HStack></Section>
}

function MetricGrid({ model }: { model: PanelModel }) {
  return <Section title="实时状态">
    <HStack><VStack alignment="leading"><Text>内存</Text><Text>{formatBytes(model.memory)}</Text><Text>Surge 进程</Text></VStack><Spacer /><VStack alignment="leading"><Text>运行时长</Text><Text>{formatUptime(model.uptime)}</Text><Text>自 {model.engine.system} 启动</Text></VStack></HStack>
    <Divider />
    <HStack><VStack alignment="leading"><Text>实时下载</Text><Text>{formatBytes(model.downloadSpeed, "/s")}</Text><Text>全部接口</Text></VStack><Spacer /><VStack alignment="leading"><Text>活动连接</Text><Text>{String(Math.round(model.activeRequests))}</Text><Text>失败 {model.failedRequests} · 拒绝 {model.rejectedRequests}</Text></VStack></HStack>
  </Section>
}

function OverviewPage({ model, refresh, isRefreshing }: { model: PanelModel; refresh: () => void; isRefreshing: boolean }) {
  const marks = model.history.map(point => ({ label: new Date(point.t), value: point.memory / 1048576, interpolationMethod: "linear" as const }))
  return <List tabItem={<Label title="总览" systemImage="square.grid.2x2" />}>
    <Header title="Surge Panel" subtitle={model.connected ? `更新于 ${timestamp(model.updatedAt)} · ${modeName(model.mode)}` : model.error} action={refresh} />
    <MetricGrid model={model} />
    <Section title="内存占用">
      <HStack><Text>{marks.length ? `${marks.at(-1)?.value.toFixed(1)} MB` : "等待采样"}</Text><Spacer /><Text>{isRefreshing ? "刷新中" : `${marks.length} 点`}</Text></HStack>
      {marks.length > 1 ? <AreaChart marks={marks} frame={{ height: 190 }} chartLegend="hidden" /> : <Text>运行一分钟后开始记录趋势</Text>}
    </Section>
    <Section title="引擎健康">
      <HStack><VStack><Text>{Math.round(model.dnsCacheEntries)}</Text><Text>DNS 缓存</Text></VStack><Spacer /><VStack><Text>{model.virtualIPs}</Text><Text>虚拟 IP</Text></VStack><Spacer /><VStack><Text>{model.temporaryRules}</Text><Text>临时规则</Text></VStack><Spacer /><VStack><Text>{Math.round(model.activeBans)}</Text><Text>封禁</Text></VStack></HStack>
    </Section>
  </List>
}

function PoliciesPage({ model }: { model: PanelModel }) {
  return <List tabItem={<Label title="策略" systemImage="point.3.connected.trianglepath.dotted" />}>
    <Header title="策略" subtitle="当前模式与策略组选择" />
    <Section title="出站模式">{valueRow(modeName(model.mode), model.connected ? "Core 在线" : "Core 离线")}</Section>
    <Section title="策略组">
      {model.groups.length ? model.groups.map(group => <VStack key={group.name} alignment="leading"><HStack><Text>{group.name}</Text><Spacer /><Text>{group.type}</Text></HStack><HStack><Text>{group.selected}</Text><Spacer /><Text>{group.latency ? `${Math.round(group.latency)} ms` : `${group.optionCount} 个选项`}</Text></HStack></VStack>) : <Text>当前接口未返回策略组详情</Text>}
    </Section>
  </List>
}

function isDirectTraffic(row: TrafficRow): boolean {
  return /(^|\s)DIRECT(?:$|[-_\s])|直连/i.test(row.name)
}

function TrafficPage({ model }: { model: PanelModel }) {
  const [expanded, setExpanded] = useState(false)
  const rows = model.nodes.length ? model.nodes : model.interfaces
  const totals = rows.reduce((result, row) => ({ download: result.download + row.download, upload: result.upload + row.upload }), { download: 0, upload: 0 })
  const split = rows.reduce((result, row) => { result[isDirectTraffic(row) ? "direct" : "proxy"] += row.total; return result }, { direct: 0, proxy: 0 })
  const grandTotal = split.direct + split.proxy
  const visible = expanded ? rows : rows.slice(0, 8)
  return <List tabItem={<Label title="流量" systemImage="chart.bar" />}>
    <Header title="流量" subtitle="本次 Surge Core 运行以来" />
    <Section title="累计流量">
      <HStack><VStack alignment="leading"><Text>下载</Text><Text>{formatBytes(totals.download)}</Text><Text>当前 {formatBytes(model.downloadSpeed, "/s")}</Text></VStack><Spacer /><VStack alignment="leading"><Text>上传</Text><Text>{formatBytes(totals.upload)}</Text><Text>当前 {formatBytes(model.uploadSpeed, "/s")}</Text></VStack></HStack>
    </Section>
    <Section title="全球流量"><Text>{rows.length ? `已统计 ${rows.length} 个节点 · ${formatBytes(grandTotal)}` : "等待 Surge 返回节点流量"}</Text><Text>节点地区按名称与旗帜识别，原生页面保留地区统计，路线地图由 WebView 版提供。</Text></Section>
    <Section title="本次分流总览">
      {valueRow("直连", `${formatBytes(split.direct)} · ${grandTotal ? Math.round(split.direct / grandTotal * 100) : 0}%`)}
      {valueRow("代理", `${formatBytes(split.proxy)} · ${grandTotal ? Math.round(split.proxy / grandTotal * 100) : 0}%`)}
    </Section>
    <Section title="节点流量排行">
      {visible.length ? visible.map((row, index) => <VStack key={row.name} alignment="leading"><HStack><Text>{index + 1}. {row.name}</Text><Spacer /><Text>{formatBytes(row.total)}</Text></HStack><Text>下载 {formatBytes(row.download)} · 上传 {formatBytes(row.upload)} · {grandTotal ? (row.total / grandTotal * 100).toFixed(1) : 0}%</Text></VStack>) : <Text>暂无节点流量数据</Text>}
      {rows.length > 8 ? <Button title={expanded ? "收起节点" : `显示全部 ${rows.length} 个节点`} systemImage={expanded ? "chevron.up" : "chevron.down"} action={() => setExpanded(!expanded)} /> : null}
    </Section>
  </List>
}

function NetworkPage({ model }: { model: PanelModel }) {
  return <List tabItem={<Label title="网络" systemImage="globe" />}>
    <Header title="网络" subtitle="Surge Core 接口统计" />
    <Section title="连接状态">{valueRow(model.connected ? "已连接" : "未连接", model.source === "metrics" ? "Metrics" : model.source === "traffic" ? "Traffic API" : "Offline")}</Section>
    <Section title="网络接口">
      {model.interfaces.length ? model.interfaces.map(row => <VStack key={row.name} alignment="leading"><HStack><Text>{row.name}</Text><Spacer /><Text>{formatBytes(row.total)}</Text></HStack><Text>↓ {formatBytes(row.download)}  ↑ {formatBytes(row.upload)}</Text></VStack>) : <Text>暂无网络接口统计</Text>}
    </Section>
    <Section title="Core 信息">{valueRow("平台", model.engine.system)}{valueRow("Surge 版本", model.engine.version)}{valueRow("Build", model.engine.build)}</Section>
  </List>
}

function SettingsPage({ config, model, onOpenSettings, clearHistory }: { config: Config; model: PanelModel; onOpenSettings: () => void; clearHistory: () => void }) {
  return <List tabItem={<Label title="设置" systemImage="gearshape" />}>
    <Header title="设置" subtitle="连接与采样配置" />
    <Section title="连接设置">
      {valueRow("API 地址", config.apiBase)}
      {valueRow("API 密钥", "••••••••")}
      {valueRow("刷新间隔", `${config.refreshSeconds} 秒`)}
      {valueRow("历史保留", "24 小时")}
      {valueRow("数据来源", model.source === "metrics" ? "Surge /v1/metrics" : model.source === "traffic" ? "Surge /v1/traffic" : "未连接")}
      {valueRow("面板版本", `V${APP_VERSION}`)}
    </Section>
    <Section><Button title="重新配置连接" systemImage="gearshape" action={onOpenSettings} /></Section>
    <Section><Button title="清除历史曲线" systemImage="trash" role="destructive" action={clearHistory} /></Section>
    <Section title="隐私"><Text>API 密钥保存在 iOS 钥匙串中，不会写进可视化页面。建议 Surge HTTP API 仅监听 127.0.0.1。</Text></Section>
  </List>
}

function webJSON(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

function buildPanelHTML(initial: PanelModel): string {
  const state = webJSON(initial)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><style>
:root{color-scheme:light dark;--bg:#f7f5fb;--surface:#fff;--surfaceRaised:#fcfbff;--text:#17171b;--muted:#77757e;--line:#ebe9ef;--track:#f0eff3;--purple:#655bdc;--purpleFill:#eeeaff;--green:#278761;--greenFill:#e7f5ef;--blue:#168ba7;--yellow:#a96800;--danger:#d83f48;--dangerFill:#fff0f0;--chrome:rgba(255,253,253,.95);--glass:rgba(255,255,255,.68);--glassPressed:rgba(255,255,255,.92);--glassText:#504d58;--mapLand:#f0effa;--mapStroke:#aaa7be;--mapLabelStroke:#fff;--backdrop:rgba(23,21,29,.18);--successFill:#44a928;--successText:#fff;--failureFill:#ffe8e8;--failureText:#c93640}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif}body{padding:env(safe-area-inset-top) 0 calc(64px + env(safe-area-inset-bottom));scroll-padding-bottom:calc(64px + env(safe-area-inset-bottom))}.top{height:66px;padding:12px 20px 8px;display:flex;align-items:center;justify-content:space-between}.top button{width:36px;height:36px;padding:0;border-radius:50%;border:.5px solid var(--line);background:var(--glass);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);box-shadow:0 3px 12px rgba(35,28,55,.10);color:var(--glassText);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s ease,transform .2s ease,box-shadow .2s ease;-webkit-tap-highlight-color:transparent}.top button:active{background:var(--glassPressed);transform:scale(.92);box-shadow:0 1px 5px rgba(35,28,55,.08)}.top button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.top .min{color:var(--purple)}.top .refreshing svg{animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.refreshSelect{border:0;background:transparent;color:var(--purple);font:inherit;font-weight:700;text-align:right;outline:0}.app{padding:0 20px;max-width:760px;margin:auto}.page{display:none}.page.active{display:block}.hero{padding:15px 12px 19px}.hero h1{font-size:36px;line-height:1;margin:0;font-weight:800;letter-spacing:-1.5px}.hero p{margin:9px 0 0;color:var(--muted);font-size:14px}.pill{float:right;margin-top:-27px;background:var(--greenFill);color:var(--green);padding:8px 11px;border-radius:20px;font-weight:700;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 2px 8px #15101b08;margin-bottom:12px}.metric{min-height:132px}.label{color:var(--muted);font-size:14px}.value{font-size:30px;font-weight:700;margin-top:7px;letter-spacing:-.5px}.unit{font-size:17px;font-weight:500}.foot{color:var(--green);font-size:12px;margin-top:7px}.sectionTitle{font-size:19px;font-weight:800;margin:0 0 11px}.chart{height:178px;padding:14px 11px}.chart svg{width:100%;height:138px}.health{display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:15px 8px}.health b{color:var(--purple);font-size:24px}.health span{display:block;color:var(--muted);font-size:11px;margin-top:4px}.pageTitle{font-size:40px;font-weight:800;margin:28px 10px 7px;letter-spacing:-1.5px}.note{color:var(--muted);font-size:14px;margin:0 10px 21px}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.row strong{font-size:14px}.row small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.right{color:var(--muted);text-align:right}.bar{height:7px;background:var(--track);border-radius:8px;margin-top:8px;overflow:hidden}.fill{height:100%;background:var(--purple);border-radius:8px}.action{width:100%;border:0;border-radius:16px;background:var(--surface);padding:14px;font-size:14px;font-weight:700;margin:0 0 10px}.danger{color:var(--danger);background:var(--dangerFill)}.tabs{display:none!important;position:fixed;z-index:4;left:16px;right:16px;bottom:calc(12px + env(safe-area-inset-bottom));height:64px;background:var(--chrome);border:1px solid var(--line);border-radius:35px;display:grid;grid-template-columns:repeat(5,1fr);padding:5px;box-shadow:0 8px 26px #33245018;backdrop-filter:blur(22px)}.tab{border:0;background:transparent;border-radius:26px;color:var(--muted);font-size:10px}.tab b{display:block;font-size:24px;line-height:28px;font-weight:400}.tab.active{background:var(--purpleFill);color:var(--purple)}@media(max-width:370px){.app{padding:0 14px}.hero h1{font-size:38px}.value{font-size:32px}.pageTitle{font-size:42px}}
.policiesPage{padding-top:8px}.groupsHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.groupsHead .sectionTitle{margin:0}.testGroups{width:32px;height:32px;padding:0;border:0;border-radius:10px;background:var(--purpleFill);color:var(--purple);font-size:18px;font-weight:700;line-height:1;cursor:pointer}.testGroups:active{transform:scale(.94)}.testGroups.testing{opacity:.55;animation:pulse .8s ease-in-out infinite}@keyframes pulse{50%{opacity:.25}}.groupGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.groupCard{min-width:0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surfaceRaised);box-shadow:0 1px 3px #15101b08;cursor:pointer}.groupCard:active{transform:scale(.98)}.groupCard .groupTitle{display:flex;align-items:baseline;justify-content:space-between;gap:6px}.groupCard .groupName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700}.groupCard .groupDelay{flex:0 0 auto;color:var(--purple);font-size:10px;font-weight:700}.groupCard .groupType{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;color:var(--muted);font-size:10px}.groupCard .groupCurrent{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:9px;color:var(--text);font-size:12px;font-weight:650}.groupCard .groupMembers{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:5px;color:var(--muted);font-size:10px}.groupCard .groupMeta{display:block;margin-top:8px;color:var(--purple);font-size:10px;font-weight:700}.globePanel{position:relative;height:330px;margin-top:4px;overflow:hidden;border-radius:16px;background:radial-gradient(circle at 52% 44%,rgba(101,91,220,.10),transparent 42%),radial-gradient(circle at 13% 78%,rgba(32,166,199,.07),transparent 34%),var(--surface);border:1px solid var(--line)}.globePanel svg{position:absolute;inset:0;width:100%;height:100%;display:block}.globePanel canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}.globePanel canvas:active{cursor:grabbing}.globeControls{position:absolute;z-index:3;right:10px;top:10px;display:flex;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--glass);backdrop-filter:blur(16px)}.globeControls button{width:38px;height:36px;border:0;border-right:1px solid var(--line);background:transparent;color:var(--muted);font-size:22px;line-height:1}.globeControls button:last-child{border-right:0}.globeControls button:active{background:var(--purpleFill);color:var(--purple)}.flatGrid{fill:none;stroke:var(--muted);stroke-width:1;opacity:.10}.flatLand{fill:var(--mapLand);stroke:var(--mapStroke);stroke-width:1.2}.trafficArc{fill:none;stroke:var(--purple);stroke-width:3;stroke-linecap:round;opacity:.38;filter:url(#routeGlow)}.trafficPulse{fill:var(--purple);opacity:.16;animation:globePulse 2.2s ease-out infinite;transform-box:fill-box;transform-origin:center}.trafficDot{fill:var(--purple);stroke:var(--mapLabelStroke);stroke-width:3;filter:url(#nodeGlow)}.trafficDot.origin{fill:var(--blue)}.trafficLabel{fill:var(--text);font-size:25px;font-weight:700;paint-order:stroke;stroke:var(--mapLabelStroke);stroke-width:7;stroke-linejoin:round}.trafficValue{fill:var(--muted);font-size:20px;font-weight:600;paint-order:stroke;stroke:var(--mapLabelStroke);stroke-width:7;stroke-linejoin:round}.globeMeta{background:linear-gradient(0deg,var(--surface) 58%,rgba(255,255,255,0))}@keyframes globePulse{0%{transform:scale(.55);opacity:.55}75%,100%{transform:scale(2.1);opacity:0}}.globeMeta{display:none!important;position:absolute;left:14px;right:14px;bottom:12px;justify-content:space-between;align-items:end;color:var(--muted);font-size:11px}.globeMeta b{display:block;color:var(--text);font-size:16px;line-height:1.15}.globeLegend{display:flex;align-items:center;gap:5px}.globeLegend i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--purple);box-shadow:0 0 7px var(--purple)}.policyDetail{display:none;position:fixed;inset:0;z-index:50}.policyDetail.open{display:block}.policyBackdrop{position:absolute;inset:0;background:var(--backdrop);backdrop-filter:blur(5px)}.policySheet{position:absolute;left:20px;right:20px;top:50%;max-height:calc(100% - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 56px);transform:translateY(-50%);padding:17px 14px 13px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 18px 50px rgba(0,0,0,.18);color:var(--text);overflow:auto}.policySheetHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 2px 16px}.policySheetHead h2{margin:0;font-size:22px;line-height:1.1}.policySheetHead p{margin:6px 0 0;color:var(--muted);font-size:12px}.policyNodes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.policyNode{min-width:0;min-height:112px;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 1px 3px #15101b08;display:flex;flex-direction:column;justify-content:space-between}.policyNodeName{font-size:16px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.policyNodeFoot{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:13px;color:var(--muted);font-size:11px}.policyNodeDelay{padding:4px 7px;border-radius:7px;background:var(--line);color:var(--muted);font-size:11px;font-weight:700;white-space:nowrap}.policyNodeDelay.ok{background:var(--successFill);color:var(--successText)}.policyNodeDelay.testing{background:var(--purpleFill);color:var(--purple)}.policyNodeDelay.failed{background:var(--failureFill);color:var(--failureText)}.closePolicyDetail{width:100%;height:40px;margin-top:14px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text);font-size:13px;font-weight:650}@media(prefers-color-scheme:dark){:root{--bg:#111015;--surface:#1c1b21;--surfaceRaised:#232229;--text:#f3f1f7;--muted:#aaa6b2;--line:#35323d;--track:#302e37;--purple:#a69cff;--purpleFill:#302b54;--green:#62d5a3;--greenFill:#193b31;--blue:#56c7df;--yellow:#ffc45e;--danger:#ff7d86;--dangerFill:#48252b;--chrome:rgba(31,29,36,.92);--glass:rgba(43,41,49,.72);--glassPressed:rgba(58,55,65,.92);--glassText:#e8e5ed;--mapLand:#2c2940;--mapStroke:#625d78;--mapLabelStroke:#1c1b21;--backdrop:rgba(0,0,0,.48);--successFill:#397f2b;--successText:#eaffea;--failureFill:#512c32;--failureText:#ff9ba4}html,body{background:var(--bg);color:var(--text)}.top button{border-color:var(--line);background:var(--glass);box-shadow:0 3px 12px rgba(0,0,0,.28);color:var(--glassText)}.top button:active{background:var(--glassPressed);box-shadow:0 1px 5px rgba(0,0,0,.24)}.card,.action{box-shadow:none}.groupCard,.policyNode{background:var(--surfaceRaised);box-shadow:none}.tabs{box-shadow:0 8px 26px rgba(0,0,0,.38)}.trafficLabel,.trafficValue{stroke:var(--mapLabelStroke)}.globeMeta{background:linear-gradient(0deg,var(--surface) 58%,rgba(28,27,33,0))}.policyBackdrop{background:var(--backdrop)}.policySheet{background:var(--surface);box-shadow:0 18px 50px rgba(0,0,0,.48)}.policyNode{background:var(--bg);box-shadow:none}.policyNodeDelay{background:var(--line);color:var(--muted)}.policyNodeDelay.ok{background:var(--successFill);color:var(--successText)}.policyNodeDelay.failed{background:var(--failureFill);color:var(--failureText)}.closePolicyDetail{background:var(--bg)}}</style></head><body><header class="top"><button id="close" aria-label="关闭" title="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button><button id="topAction" class="min" aria-label="刷新" title="刷新"><svg id="topActionIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.34-5.66M20 4v7h-7"/></svg></button></header><main class="app">
<section class="page active" data-page="overview"><div class="hero"><h1>Surge Pro</h1><p id="updated"></p><span class="pill" id="mode"></span></div><div class="grid"><div class="card metric"><div class="label">内存</div><div class="value" id="memory"></div><div class="foot">Surge 进程</div></div><div class="card metric"><div class="label">运行时长</div><div class="value" id="uptime"></div><div class="foot">自 iOS 启动</div></div><div class="card metric"><div class="label">实时下载</div><div class="value" id="download"></div><div class="foot">全部接口</div></div><div class="card metric"><div class="label">活动连接</div><div class="value" id="active"></div><div class="foot" id="failed"></div></div></div><div class="card chart"><div class="sectionTitle">内存占用 <span style="float:right;color:var(--purple);font-size:16px" id="chartValue"></span></div><div id="chart"></div></div><div class="card"><div class="sectionTitle">引擎健康</div><div class="health"><div><b id="dns"></b><span>DNS 缓存</span></div><div><b id="vip"></b><span>虚拟 IP</span></div><div><b id="temp"></b><span>临时规则</span></div><div><b id="ban"></b><span>封禁</span></div></div></div></section>
<section class="page policiesPage" data-page="policies"><div class="card"><div class="label">出站模式</div><div class="value" id="modeLarge"></div><div class="foot" id="online"></div></div><div class="card"><div class="groupsHead"><h3 class="sectionTitle">策略组</h3></div><div id="groups" class="groupGrid"></div></div></section><div id="policyDetail" class="policyDetail" aria-hidden="true"><div class="policyBackdrop" id="policyBackdrop"></div><section class="policySheet"><div class="policySheetHead"><div><h2 id="policyDetailName"></h2><p id="policyDetailSub"></p></div><button id="testGroups" class="testGroups" aria-label="测试当前策略组延迟" title="测试当前策略组">ϟ</button></div><div id="policyNodes" class="policyNodes"></div><button id="closePolicyDetail" class="closePolicyDetail">关闭</button></section></div>
<section class="page" data-page="traffic"><h2 class="pageTitle">流量</h2><p class="note">本次 Surge Core 运行以来</p><div class="grid"><div class="card metric"><div class="label">下载</div><div class="value" id="totalDown"></div><div class="foot" id="downRate"></div></div><div class="card metric"><div class="label">上传</div><div class="value" id="totalUp"></div><div class="foot" id="upRate"></div></div></div><div class="card"><h3 class="sectionTitle">全球流量</h3><div id="world" class="globePanel"></div></div><div class="card"><h3 class="sectionTitle">本次分流总览</h3><div id="split"></div></div><div class="card"><h3 class="sectionTitle">节点流量排行</h3><div id="ranks"></div><button class="action" id="expand">显示全部节点</button></div></section>
<section class="page" data-page="network"><h2 class="pageTitle">网络</h2><p class="note">Surge Core 实时统计</p><div class="card"><div class="row"><strong>开启时间</strong><span class="right" id="trafficStartTime"></span></div><div class="row"><strong>启动时长</strong><span class="right" id="trafficUptime"></span></div></div><div class="card"><div class="label">连接状态</div><div class="value" id="networkStatus"></div><div class="foot" id="source"></div></div><div class="card"><h3 class="sectionTitle">可用网络接口</h3><div id="deviceInterfaces"></div></div><div class="card"><h3 class="sectionTitle">联网方式</h3><div id="realtimeInterfaces"></div></div><div class="card"><h3 class="sectionTitle">策略统计</h3><div id="connectorStats"></div></div><div class="card"><h3 class="sectionTitle">Metrics 接口累计</h3><div id="interfaces"></div></div><div class="card"><h3 class="sectionTitle">Core 信息</h3><div id="core"></div></div></section>
<section class="page" data-page="settings"><h2 class="pageTitle">设置</h2><p class="note">连接与采样配置</p><div class="card" id="settings"></div><button class="action" id="widgetSettings">小组件适配</button><button class="action" id="reconfig">重新配置连接</button><button class="action danger" id="clear">清除历史曲线</button><p class="note" style="font-size:13px">API 密钥保存在 iOS 钥匙串中，不会被写进可视化页面。</p><p class="note" style="font-size:13px;text-align:center;margin-top:18px">此脚本改于@Biaexa大佬</p></section></main><nav class="tabs">${[["overview","▦","总览"],["policies","⌘","策略"],["traffic","▥","流量"],["network","◎","网络"],["settings","⚙","设置"]].map(item => `<button class="tab${item[0] === "overview" ? " active" : ""}" data-tab="${item[0]}"><b>${item[1]}</b>${item[2]}</button>`).join("")}</nav>
<script>let state=${state};let expanded=false;let activePolicyGroup='';const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[ch]));const bytes=(n,s='')=>{let u=['B','KB','MB','GB','TB'],i=0,v=Math.max(0,Number(n||0));while(v>=1024&&i<4){v/=1024;i++}return v.toFixed(i===0||v>=100?0:v>=10?1:2)+' '+u[i]+s};const mode=m=>m==='direct'?'直连模式':m==='proxy'?'全局代理':'规则模式';const uptime=s=>{let t=Math.floor(s||0),d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60);return d?d+'d '+h+'h':h?h+'h '+m+'m':m+'m'};function rows(){return state.nodes?.length?state.nodes:state.interfaces||[]}const regions=[[/香港|🇭🇰|\\bhk\\b|hong kong/i,[818,188],'香港'],[/台湾|🇹🇼|\\btw\\b|taiwan/i,[838,181],'台湾'],[/日本|🇯🇵|\\bjp\\b|japan|东京|大阪/i,[889,151],'日本'],[/新加坡|🇸🇬|\\bsg\\b|singapore/i,[789,247],'新加坡'],[/美国|🇺🇸|\\bus\\b|united states|洛杉矶|纽约|西雅图/i,[172,155],'美国'],[/英国|🇬🇧|\\buk\\b|united kingdom|伦敦/i,[500,107],'英国'],[/德国|🇩🇪|\\bde\\b|germany|法兰克福/i,[524,111],'德国'],[/法国|🇫🇷|\\bfr\\b|france|巴黎/i,[507,119],'法国'],[/加拿大|🇨🇦|\\bca\\b|canada/i,[279,93],'加拿大'],[/韩国|🇰🇷|\\bkr\\b|korea|首尔/i,[854,145],'韩国'],[/澳大利亚|🇦🇺|\\bau\\b|australia|悉尼/i,[920,344],'澳大利亚'],[/印度|🇮🇳|\\bin\\b|india|孟买/i,[723,218],'印度'],[/荷兰|🇳🇱|\\bnl\\b|netherlands/i,[517,104],'荷兰'],[/俄罗斯|🇷🇺|\\bru\\b|russia|莫斯科/i,[648,94],'俄罗斯']];const fallbackPoints=[[625,165],[682,133],[735,272],[580,210],[420,168],[703,326],[875,244],[367,127]];function globePoint(name,index){let match=regions.find(x=>x[0].test(name));if(match)return {x:match[1][0],y:match[1][1],label:match[2]};let p=fallbackPoints[index%fallbackPoints.length];return {x:p[0],y:p[1],label:'其他'}}let globeRotation={lon:-105,lat:-18},globeZoom=1,globeDrag=null,globeData={rows:[],total:0};
const globeLocations={香港:[114.17,22.32],台湾:[121.0,23.7],日本:[138.2,36.2],新加坡:[103.82,1.35],美国:[-100,38],英国:[-2,54],德国:[10.4,51],法国:[2.3,46.3],加拿大:[-106,57],韩国:[127.8,36],澳大利亚:[134,-25],印度:[78.9,22.5],荷兰:[5.3,52.1],俄罗斯:[90,60],其他:[0,0],本机:[121.47,31.23]};
const globeLand=[[[61.2,35.7],[63.0,35.4],[64.5,36.3],[65.6,37.3],[67.1,37.4],[68.9,37.3],[70.3,37.7],[71.8,36.7],[73.3,37.5],[75.0,37.4],[72.9,36.7],[71.3,36.1],[71.1,34.7],[70.3,33.4],[69.3,31.9],[67.8,31.6],[66.4,30.7],[65.0,29.5],[62.5,29.3],[60.9,29.8],[61.7,31.4],[60.5,33.0],[60.8,34.4]],[[16.3,-5.9],[16.9,-7.2],[18.1,-8.0],[19.4,-7.2],[21.7,-7.3],[21.8,-8.9],[22.2,-11.1],[23.9,-10.9],[23.9,-12.6],[21.9,-12.9],[21.9,-16.1],[23.2,-17.5],[21.4,-17.9],[19.0,-17.8],[14.2,-17.4],[12.8,-16.9],[11.8,-15.8],[12.2,-14.4],[13.3,-12.5],[13.7,-10.7],[12.9,-9.2],[12.9,-7.6],[12.2,-6.3],[16.3,-5.9]],[[20.6,41.9],[20.7,40.4],[19.3,40.7],[19.3,42.2]],[[51.6,24.2],[53.4,24.2],[54.7,24.8],[56.1,26.1],[55.8,24.3],[55.2,22.7],[52.0,23.0]],[[-65.5,-55.2],[-67.0,-54.9],[-68.6,-54.9],[-68.6,-52.6],[-67.8,-53.9],[-66.5,-54.5],[-65.0,-54.7]],[[-65.0,-22.1],[-62.8,-22.0],[-60.8,-23.9],[-58.8,-24.8],[-57.6,-25.6],[-58.6,-27.1],[-56.5,-27.5],[-54.8,-26.6],[-56.3,-28.9],[-57.6,-30.2],[-58.1,-32.0],[-58.4,-33.9],[-57.2,-35.3],[-56.8,-36.9],[-57.7,-38.2],[-59.2,-38.7],[-61.2,-38.9],[-62.3,-40.2],[-63.8,-41.2],[-65.0,-42.1],[-63.5,-42.6],[-65.2,-43.5],[-65.6,-45.0],[-67.3,-45.6],[-66.6,-47.0],[-67.2,-48.7],[-68.7,-50.3],[-68.8,-51.8],[-71.9,-52.0],[-73.0,-50.7],[-73.4,-49.3],[-72.3,-48.2],[-71.6,-45.6],[-71.8,-44.2],[-72.1,-42.3],[-71.9,-40.8],[-71.4,-38.9],[-71.1,-36.7],[-70.4,-35.2],[-69.8,-33.3],[-70.5,-31.4],[-70.0,-29.4],[-69.0,-27.5],[-68.4,-26.2],[-68.4,-24.5],[-67.0,-23.0],[-65.0,-22.1]],[[43.6,41.1],[45.0,41.2],[45.6,39.9],[46.5,38.8],[45.0,39.7],[43.7,40.3]],[[-59.6,-80.0],[-62.3,-80.9],[-64.5,-80.9],[-66.3,-80.3],[-64.0,-80.3],[-61.9,-80.4],[-60.6,-79.6]],[[-159.2,-79.5],[-161.1,-79.6],[-163.0,-78.9],[-161.2,-78.4],[-159.5,-79.0]],[[-45.2,-78.0],[-43.5,-79.1],[-44.9,-80.3],[-46.5,-80.6],[-48.4,-80.8],[-50.5,-81.0],[-52.9,-81.0],[-51.9,-79.9],[-50.4,-79.2],[-48.7,-78.0],[-46.7,-77.8],[-45.2,-78.0]],[[-121.2,-73.5],[-118.7,-73.5],[-120.2,-74.1],[-121.6,-74.0]],[[-125.6,-73.5],[-124.0,-73.9],[-125.9,-73.7],[-127.3,-73.5],[-125.6,-73.5]],[[-99.0,-71.9],[-96.8,-72.0],[-98.2,-72.5],[-100.8,-72.5],[-102.3,-71.9],[-100.4,-71.9],[-99.0,-71.9]],[[-68.5,-71.0],[-70.0,-72.3],[-72.4,-72.5],[-74.2,-72.4],[-73.2,-71.2],[-71.8,-70.7],[-71.2,-69.0],[-69.7,-69.3],[-68.7,-70.5]],[[-58.6,-64.2],[-60.6,-64.3],[-62.0,-64.8],[-62.1,-66.2],[-63.7,-66.5],[-65.5,-67.6],[-64.0,-68.9],[-62.6,-70.0],[-61.5,-71.1],[-61.0,-72.8],[-62.0,-74.4],[-63.7,-74.9],[-65.9,-75.6],[-68.4,-76.0],[-69.8,-76.2],[-72.2,-76.7],[-74.0,-76.6],[-75.6,-76.7],[-77.2,-76.7],[-75.4,-77.3],[-73.7,-77.9],[-76.5,-78.1],[-77.9,-78.4],[-76.8,-79.5],[-75.4,-80.3],[-73.2,-80.4],[-71.4,-80.7],[-70.0,-81.0],[-68.2,-81.3],[-65.7,-81.5],[-63.3,-81.7],[-61.6,-82.0],[-59.7,-82.4],[-58.2,-83.2],[-55.4,-82.6],[-53.6,-82.3],[-51.5,-82.0],[-49.8,-81.7],[-47.3,-81.7],[-44.8,-81.8],[-42.8,-82.1],[-40.8,-81.4],[-38.2,-81.3],[-36.3,-81.1],[-34.4,-80.9],[-32.3,-80.8],[-30.1,-80.6],[-28.5,-80.3],[-29.7,-79.3],[-31.6,-79.3],[-33.7,-79.5],[-35.6,-79.5],[-35.3,-78.1],[-33.9,-77.9],[-32.2,-77.7],[-29.8,-77.1],[-27.5,-76.5],[-25.5,-76.3],[-23.9,-76.2],[-22.5,-76.1],[-20.0,-75.7],[-17.5,-75.1],[-15.7,-74.5],[-15.4,-73.1],[-13.3,-72.7],[-11.5,-72.0],[-9.1,-71.3],[-7.4,-71.7],[-5.8,-71.0],[-4.3,-71.5],[-1.8,-71.2],[-0.2,-71.6],[1.9,-71.1],[4.1,-70.9],[6.3,-70.5],[7.7,-69.9],[9.5,-70.0],[10.8,-70.8],[12.4,-70.2],[14.7,-70.0],[17.0,-69.9],[19.3,-69.9],[21.5,-70.1],[23.7,-70.5],[26.0,-70.5],[28.1,-70.3],[30.0,-69.9],[32.0,-69.7],[33.3,-68.8],[34.9,-68.7],[37.2,-69.2],[38.6,-69.8],[40.0,-69.1],[42.0,-68.6],[44.1,-68.3],[45.7,-67.8],[47.4,-67.7],[49.0,-67.1],[50.8,-66.9],[52.6,-66.1],[54.5,-65.8],[56.4,-66.0],[58.1,-67.0],[59.9,-67.4],[61.4,-68.0],[63.2,-67.8],[65.0,-67.6],[66.9,-67.9],[68.9,-67.9],[69.7,-69.2],[67.8,-70.3],[67.9,-71.9],[69.9,-72.3],[71.6,-71.7],[73.1,-70.7],[74.5,-69.8],[76.6,-69.6],[78.1,-69.1],[80.1,-68.1],[81.5,-67.5],[83.8,-67.3],[85.7,-67.1],[87.5,-66.9],[89.7,-67.2],[91.6,-67.1],[93.5,-67.2],[95.0,-67.2],[96.7,-67.2],[98.7,-67.1],[100.4,-66.9],[102.8,-65.6],[104.2,-66.0],[106.2,-66.9],[108.1,-67.0],[110.2,-66.7],[111.7,-66.1],[113.6,-65.9],[115.6,-66.7],[117.4,-66.9],[119.8,-67.3],[121.7,-66.9],[123.2,-66.5],[125.2,-66.7],[127.0,-66.6],[128.8,-66.8],[130.8,-66.4],[132.9,-66.4],[134.8,-66.2],[136.2,-66.4],[137.5,-67.0],[139.9,-66.9],[142.1,-66.8],[144.4,-66.8],[146.2,-67.2],[147.7,-68.1],[150.1,-68.6],[151.5,-68.7],[153.6,-68.9],[155.2,-68.8],[156.8,-69.4],[159.2,-69.6],[160.8,-70.2],[162.7,-70.7],[164.9,-70.8],[167.3,-70.8],[169.5,-71.2],[171.2,-71.7],[170.1,-72.9],[168.0,-73.8],[166.1,-74.4],[164.2,-75.5],[163.5,-77.1],[164.7,-78.2],[166.6,-78.3],[165.2,-78.9],[163.7,-79.1],[161.8,-79.2],[160.7,-80.2],[161.6,-81.7],[163.7,-82.4],[165.1,-82.7],[166.6,-83.0],[168.9,-83.3],[172.3,-84.0],[176.0,-84.2],[178.3,-84.5],[180,-84.7],[-179.9,-84.7],[-177.3,-84.5],[-175.9,-84.1],[-174.4,-84.5],[-172.9,-84.1],[-170.0,-83.9],[-168.5,-84.2],[-167.0,-84.6],[-164.2,-84.8],[-161.9,-85.1],[-158.1,-85.4],[-155.2,-85.1],[-150.9,-85.3],[-148.5,-85.6],[-145.9,-85.3],[-143.1,-85.0],[-146.8,-84.5],[-150.1,-84.3],[-153.6,-83.7],[-152.7,-82.5],[-154.5,-81.8],[-156.8,-81.1],[-154.4,-81.2],[-152.1,-81.0],[-150.6,-81.3],[-148.9,-81.0],[-147.2,-80.7],[-149.5,-79.4],[-151.6,-79.3],[-153.4,-79.2],[-155.3,-79.1],[-157.3,-78.4],[-158.4,-76.9],[-157.0,-77.3],[-155.3,-77.2],[-153.7,-77.1],[-151.3,-77.4],[-148.7,-76.9],[-146.1,-76.5],[-144.9,-75.2],[-142.8,-75.3],[-140.2,-75.1],[-137.5,-74.7],[-135.2,-74.3],[-133.7,-74.4],[-132.3,-74.3],[-130.9,-74.5],[-128.2,-74.3],[-125.4,-74.5],[-124.0,-74.5],[-122.6,-74.5],[-121.1,-74.5],[-118.7,-74.2],[-116.2,-74.2],[-113.9,-73.7],[-112.3,-74.7],[-110.1,-74.8],[-108.7,-74.9],[-106.1,-75.1],[-103.4,-75.0],[-102.0,-75.1],[-100.6,-75.3],[-102.5,-74.1],[-103.7,-72.6],[-101.6,-72.8],[-99.1,-72.9],[-97.7,-73.6],[-96.3,-73.6],[-93.7,-73.3],[-91.4,-73.4],[-89.2,-72.6],[-87.3,-73.2],[-85.2,-73.5],[-82.7,-73.6],[-80.7,-73.5],[-79.3,-73.5],[-77.9,-73.4],[-76.2,-74.0],[-73.9,-73.7],[-71.6,-73.3],[-70.2,-73.1],[-68.0,-72.8],[-67.6,-71.2],[-68.5,-70.1],[-67.6,-68.5],[-67.3,-66.9],[-65.4,-65.9],[-63.6,-64.9],[-62.0,-64.6],[-59.9,-64.0],[-58.6,-63.4],[-57.2,-63.5],[-58.6,-64.2]],[[145.4,-40.8],[146.9,-41.0],[148.3,-40.9],[148.0,-42.4],[146.9,-43.6],[145.4,-42.7],[144.7,-41.2]],[[143.6,-13.8],[144.9,-14.6],[145.5,-16.3],[146.2,-17.8],[147.5,-19.5],[148.8,-20.4],[149.7,-22.3],[150.9,-23.5],[152.1,-24.5],[153.1,-26.1],[153.6,-28.1],[153.3,-29.5],[153.1,-30.9],[152.5,-32.6],[151.3,-33.8],[150.7,-35.2],[149.9,-37.1],[148.3,-37.8],[146.9,-38.6],[145.5,-38.6],[143.6,-38.8],[142.2,-38.4],[140.6,-38.0],[139.8,-36.6],[138.1,-35.6],[137.5,-34.1],[136.0,-34.9],[134.6,-33.2],[133.0,-32.0],[131.3,-31.5],[129.5,-31.6],[127.1,-32.3],[125.1,-32.7],[123.7,-33.9],[122.2,-34.0],[120.6,-33.9],[119.3,-34.5],[118.0,-35.1],[116.6,-35.0],[115.0,-34.2],[115.7,-32.9],[115.2,-30.6],[114.6,-28.8],[114.0,-27.3],[113.4,-25.6],[113.5,-23.8],[114.1,-21.8],[115.5,-21.5],[116.7,-20.7],[118.2,-20.4],[119.8,-20.0],[121.4,-19.2],[122.3,-17.8],[123.0,-16.4],[124.4,-15.6],[125.7,-14.5],[127.1,-13.8],[128.4,-14.9],[129.9,-13.6],[131.2,-12.2],[132.6,-12.1],[134.4,-12.0],[135.9,-12.0],[136.1,-13.7],[135.5,-15.0],[137.1,-15.9],[138.3,-16.8],[140.2,-17.7],[141.3,-16.4],[141.7,-15.0],[141.7,-12.9],[142.1,-11.3],[143.2,-12.3],[143.6,-13.8]],[[17.0,48.1],[16.2,46.9],[14.6,46.4],[12.4,46.8],[11.0,46.8],[9.5,47.1],[11.4,47.5],[12.9,47.5],[13.6,48.9],[15.3,49.0],[17.0,48.6]],[[47.4,41.2],[49.1,41.3],[50.4,40.3],[49.2,39.0],[47.7,39.5],[46.0,39.6],[45.2,41.0],[46.6,41.2]],[[29.3,-4.5],[29.0,-2.8],[30.5,-2.4],[30.1,-4.1]],[[3.3,51.3],[5.0,51.5],[6.0,50.1],[4.3,49.9],[3.1,50.8]],[[2.7,6.3],[1.7,9.1],[0.8,10.5],[1.9,11.6],[3.6,11.7],[3.7,10.1],[2.7,8.5],[2.7,6.3]],[[-2.8,9.6],[-4.3,9.6],[-5.5,11.0],[-4.4,12.5],[-3.1,13.5],[-2.0,14.6],[-0.5,15.1],[0.4,14.0],[2.2,12.6],[1.2,11.1],[-0.4,11.1],[-2.9,11.0],[-2.8,9.6]],[[92.7,22.0],[91.4,22.8],[90.3,21.8],[88.9,22.9],[88.1,24.5],[88.6,26.4],[89.9,25.3],[91.8,25.1],[91.2,23.5],[92.7,22.0]],[[22.7,44.2],[24.1,43.7],[25.6,43.7],[27.2,44.2],[28.6,43.7],[27.7,42.6],[26.1,41.8],[24.5,41.6],[23.0,41.3],[22.4,42.6],[22.7,44.2]],[[19.0,44.9],[19.2,43.5],[17.7,43.0],[16.5,44.0],[17.9,45.1]],[[23.5,53.9],[25.5,54.3],[26.6,55.2],[28.2,56.2],[29.9,55.8],[31.4,54.2],[32.7,53.4],[31.3,53.1],[30.6,51.8],[29.0,51.6],[27.5,51.6],[25.3,51.9],[23.5,51.6],[23.8,53.1]],[[-62.8,-22.0],[-64.4,-22.8],[-66.3,-21.8],[-67.8,-22.9],[-68.2,-21.5],[-68.4,-19.4],[-69.6,-17.6],[-69.4,-15.7],[-68.9,-13.6],[-69.5,-11.0],[-68.0,-10.7],[-66.6,-9.9],[-65.3,-10.9],[-64.3,-12.5],[-62.8,-13.0],[-61.1,-13.5],[-60.3,-15.1],[-58.2,-16.3],[-57.5,-18.2],[-57.9,-20.0],[-60.0,-19.3],[-61.8,-19.6],[-62.3,-21.1]],[[-57.6,-30.2],[-56.3,-28.9],[-55.2,-27.9],[-53.6,-26.9],[-54.1,-25.5],[-54.3,-24.0],[-55.6,-22.7],[-57.9,-22.1],[-57.9,-20.7],[-57.7,-19.0],[-58.3,-17.3],[-60.2,-16.3],[-60.3,-14.6],[-61.7,-13.5],[-63.2,-12.6],[-65.4,-11.6],[-65.3,-9.8],[-67.2,-10.3],[-68.8,-11.0],[-70.5,-11.0],[-70.5,-9.5],[-72.2,-10.1],[-73.6,-8.4],[-73.7,-6.9],[-72.9,-5.3],[-70.9,-4.4],[-69.4,-1.6],[-70.0,-0.2],[-69.2,1.0],[-67.9,1.7],[-66.3,0.7],[-64.6,1.3],[-63.4,2.2],[-64.4,3.8],[-62.8,4.0],[-61.0,4.5],[-59.5,4.0],[-59.7,2.2],[-58.5,1.3],[-56.8,1.9],[-55.1,2.5],[-53.6,2.3],[-52.2,3.2],[-50.5,1.9],[-50.7,0.2],[-48.6,-0.2],[-46.6,-0.9],[-44.9,-1.6],[-43.4,-2.4],[-41.5,-2.9],[-40.0,-2.9],[-38.5,-3.7],[-37.2,-4.8],[-35.6,-5.1],[-34.9,-6.7],[-35.1,-9.0],[-37.0,-11.0],[-38.4,-13.0],[-38.9,-15.7],[-39.2,-17.2],[-39.8,-19.6],[-40.8,-20.9],[-41.8,-22.4],[-43.1,-23.0],[-44.6,-23.4],[-46.5,-24.1],[-48.5,-25.9],[-48.7,-28.2],[-50.7,-31.0],[-52.3,-32.2],[-53.4,-33.8],[-53.8,-32.0],[-55.6,-30.9],[-57.0,-30.1]],[[91.7,27.8],[90.4,26.9],[88.8,27.1],[90.0,28.3],[91.7,27.8]],[[25.6,-18.5],[27.3,-20.4],[28.8,-21.6],[28.0,-22.8],[26.8,-24.2],[25.8,-25.2],[24.2,-25.7],[22.8,-25.5],[21.6,-26.7],[20.2,-24.9],[19.9,-21.8],[20.9,-18.3],[23.2,-17.9],[25.1,-17.7]],[[15.3,7.4],[16.7,7.5],[18.4,8.3],[20.1,9.0],[21.7,10.6],[23.6,10.1],[23.8,8.7],[25.1,7.8],[26.2,6.5],[27.4,5.2],[25.7,5.3],[23.3,4.6],[21.7,4.2],[20.3,4.7],[18.9,4.7],[17.8,3.6],[16.0,2.3],[15.0,3.9],[14.5,5.5],[15.3,7.4]],[[-123.5,48.5],[-125.7,48.8],[-127.0,49.8],[-128.4,50.5],[-126.7,50.4],[-124.9,49.5],[-123.5,48.5]],[[-56.1,50.7],[-54.9,49.3],[-53.5,49.2],[-52.6,47.5],[-54.2,46.8],[-56.0,46.9],[-57.3,47.6],[-59.3,47.6],[-58.4,49.1],[-57.4,50.7],[-55.9,51.6]],[[-85.2,65.7],[-83.9,65.1],[-81.6,64.5],[-80.1,63.7],[-82.5,63.7],[-84.1,63.6],[-85.5,63.1],[-87.2,63.5],[-86.2,64.8]],[[-95.6,69.1],[-97.6,69.1],[-99.8,69.4],[-98.2,70.1],[-96.6,69.7]],[[-90.5,69.5],[-88.0,68.6],[-87.4,67.2],[-85.6,68.8],[-84.1,69.8],[-82.6,69.7],[-81.2,68.7],[-81.4,67.1],[-83.3,66.4],[-84.7,66.3],[-86.1,66.1],[-87.3,64.8],[-89.9,64.0],[-91.9,62.8],[-93.2,62.0],[-94.2,60.9],[-94.7,58.9],[-93.2,58.8],[-92.3,57.1],[-90.9,57.3],[-89.0,56.9],[-87.3,56.0],[-85.0,55.3],[-83.4,55.2],[-82.1,53.3],[-79.9,51.2],[-78.6,52.6],[-79.1,54.1],[-77.1,55.8],[-76.6,57.2],[-78.5,58.8],[-77.3,59.9],[-78.1,62.3],[-75.7,62.3],[-73.8,62.4],[-71.7,61.5],[-69.6,61.1],[-69.3,59.0],[-67.6,58.2],[-66.2,58.8],[-65.2,59.9],[-63.8,59.4],[-62.5,58.2],[-61.4,57.0],[-60.5,55.8],[-58.0,54.9],[-56.9,53.8],[-55.7,52.1],[-57.1,51.4],[-58.8,51.1],[-60.0,50.2],[-61.7,50.1],[-63.9,50.3],[-65.4,50.3],[-67.2,49.5],[-70.0,47.7],[-71.1,46.8],[-68.7,48.3],[-66.6,49.1],[-65.1,49.2],[-64.8,47.0],[-63.2,45.7],[-61.5,45.9],[-60.5,47.0],[-61.0,45.3],[-63.3,44.7],[-65.4,43.5],[-64.4,45.3],[-66.0,45.3],[-67.8,45.7],[-68.2,47.4],[-70.0,46.7],[-71.1,45.3],[-73.3,45.0],[-74.9,45.0],[-76.4,44.1],[-78.7,43.6],[-80.2,42.4],[-82.4,41.7],[-82.1,43.6],[-82.6,45.3],[-83.9,46.1],[-85.7,47.2],[-87.4,47.9],[-89.3,48.0],[-90.8,48.3],[-92.6,48.5],[-94.3,48.7],[-97.2,49.0],[-100.7,49],[-104.0,49.0],[-107.0,49],[-110.0,49],[-113,49],[-116.0,49],[-120,49],[-122.8,49],[-124.9,50.0],[-127.4,50.8],[-127.9,52.3],[-129.3,53.6],[-130.5,54.8],[-131.7,56.6],[-132.7,57.7],[-134.3,58.9],[-135.5,59.8],[-137.5,58.9],[-139.0,60],[-141.0,60.3],[-141.0,66.0],[-141.0,69.7],[-139.1,69.5],[-137.5,69.0],[-135.6,69.3],[-132.9,69.5],[-131.4,69.9],[-129.8,70.2],[-128.4,70.0],[-125.8,69.5],[-124.4,70.2],[-123.1,69.6],[-121.5,69.8],[-119.9,69.4],[-117.6,69.0],[-116.2,68.8],[-113.9,68.4],[-115.3,67.9],[-113.5,67.7],[-110.8,67.8],[-108.9,67.4],[-108.2,68.7],[-106.2,68.8],[-104.3,68.0],[-101.5,67.6],[-99.9,67.8],[-98.4,67.8],[-96.1,68.2],[-94.7,68.1],[-95.3,69.7],[-96.4,71.2],[-93.9,71.8],[-91.5,70.2]],[[-114.2,73.1],[-112.4,73.0],[-109.9,73.0],[-108.2,71.7],[-108.4,73.1],[-106.5,73.1],[-104.8,71.7],[-102.8,70.5],[-101.0,70.0],[-102.7,69.5],[-104.2,68.9],[-106.0,69.2],[-109,68.8],[-111.5,68.6],[-113.3,68.5],[-115.2,69.3],[-117.3,70.0],[-115.1,70.2],[-112.4,70.4],[-114.3,70.6],[-116.5,70.5],[-117.9,70.5],[-116.1,71.3],[-117.7,71.3],[-119.4,71.6],[-117.9,72.7],[-115.2,73.3]],[[-76.3,73.1],[-78.4,72.9],[-79.8,72.8],[-78.1,73.7],[-76.3,73.1]],[[-86.6,73.2],[-84.9,73.3],[-82.3,73.8],[-80.6,72.7],[-78.8,72.4],[-75.6,72.2],[-74.2,71.8],[-72.2,71.6],[-68.8,70.5],[-67.0,69.2],[-68.8,68.7],[-66.4,68.1],[-64.9,67.8],[-63.4,66.9],[-61.9,66.9],[-63.9,65.0],[-66.7,66.4],[-68.1,65.7],[-65.7,64.6],[-64.7,63.4],[-66.3,62.9],[-68.8,63.7],[-67.4,62.9],[-66.2,61.9],[-68.9,62.3],[-71.0,62.9],[-73.4,64.2],[-74.8,64.7],[-77.7,64.2],[-76.0,65.3],[-74.0,65.5],[-72.7,67.3],[-74.8,68.6],[-76.9,68.9],[-78.2,69.8],[-81.3,69.7],[-84.9,70.0],[-87.1,70.3],[-88.7,70.4],[-89.9,71.2],[-89.4,73.1],[-85.8,73.8]],[[-100.4,73.8],[-97.4,73.8],[-96.5,72.6],[-98.4,71.3],[-100.0,71.7],[-102.5,72.5],[-100.4,72.7]],[[-93.2,72.8],[-95.4,72.1],[-96.0,73.4],[-94.5,74.1],[-92.4,74.1],[-90.5,73.9],[-92.0,73.0]],[[-120.5,71.4],[-123.1,70.9],[-125.9,71.9],[-124.8,73.0],[-121.5,74.4],[-120.1,74.2],[-117.6,74.2],[-115.5,73.5],[-119.2,72.5],[-120.5,71.8]],[[-98.5,76.7],[-98.2,75],[-99.8,74.9],[-102.5,75.6],[-100.0,76.6],[-98.6,76.6]],[[-108.2,76.2],[-105.9,76.0],[-109.7,74.8],[-112.2,74.4],[-113.7,74.4],[-111.8,75.2],[-116.3,75.0],[-117.7,75.2],[-116.3,76.2],[-112.6,76.1],[-110.8,75.5],[-109.1,75.5],[-110.5,76.4],[-108.5,76.7]],[[-94.7,77.1],[-91.6,76.8],[-89.8,75.8],[-87.8,75.6],[-86.4,75.5],[-84.8,75.7],[-82.8,75.8],[-81.1,75.7],[-79.8,74.9],[-81.9,74.4],[-86.1,74.4],[-88.2,74.4],[-89.8,74.5],[-92.4,74.8],[-93.9,76.3],[-96.0,76.4],[-94.7,77.1]],[[-116.2,77.6],[-117.1,76.5],[-119.9,76.1],[-121.5,75.9],[-122.9,76.1],[-121.2,76.9],[-119.1,77.5],[-117.6,77.5],[-116.2,77.6]],[[-110.2,77.7],[-112.1,77.4],[-113.5,77.7],[-111.3,78.2],[-109.9,78.0]],[[-95.8,78.1],[-97.3,77.9],[-98.6,78.5],[-96.8,78.8]],[[-100.1,78.3],[-102.9,78.3],[-105.2,78.4],[-103.5,79.2],[-100.8,78.8]],[[-87.0,79.7],[-89.0,78.3],[-90.8,78.2],[-92.9,78.3],[-95.0,79.4],[-96.7,80.2],[-95.3,80.9],[-92.4,81.3],[-91.1,80.7],[-89.5,80.5],[-87.8,80.3]],[[-68.5,83.1],[-65.8,83.0],[-63.7,82.9],[-61.9,82.6],[-64.3,81.9],[-66.8,81.7],[-69.5,80.6],[-71.2,79.8],[-73.2,79.6],[-76.9,79.3],[-75.5,79.2],[-77.9,77.9],[-79.8,77.2],[-77.9,77.0],[-80.6,76.2],[-83.2,76.5],[-86.1,76.3],[-87.6,76.4],[-89.5,76.5],[-87.8,77.2],[-85.0,77.5],[-86.3,78.2],[-88.0,78.4],[-85.4,79.0],[-86.9,80.3],[-84.2,80.2],[-81.8,80.5],[-84.1,80.6],[-87.6,80.5],[-89.4,80.9],[-91.4,81.6],[-88.9,82.1],[-87.0,82.3],[-85.5,82.7],[-83.2,82.3],[-81.1,83.0],[-79.3,83.1],[-76.2,83.2],[-72.8,83.2],[-70.7,83.2],[-68.5,83.1]],[[9.6,47.5],[9.0,46.0],[7.3,45.8],[6.0,46.7],[7.5,47.6],[9.6,47.5]],[[-68.6,-52.6],[-68.6,-54.9],[-67.0,-54.9],[-68.6,-55.6],[-70.0,-55.2],[-72.3,-54.5],[-74.7,-52.8],[-72.4,-53.7],[-70.6,-53.6],[-69.3,-52.5]],[[-68.2,-21.5],[-67.8,-22.9],[-68.4,-24.5],[-68.4,-26.2],[-69.0,-27.5],[-70.0,-29.4],[-70.5,-31.4],[-70.1,-33.1],[-70.4,-35.2],[-71.1,-36.7],[-70.8,-38.6],[-71.7,-39.8],[-71.7,-42.1],[-71.5,-43.8],[-71.6,-45.6],[-72.4,-47.7],[-73.4,-49.3],[-73.0,-50.7],[-71.9,-52.0],[-69.5,-52.1],[-70.8,-52.9],[-72.6,-53.5],[-74.9,-52.3],[-75.5,-50.4],[-75.6,-48.7],[-74.1,-46.9],[-75.6,-46.6],[-74.4,-44.1],[-72.7,-42.4],[-73.7,-43.4],[-74.0,-41.8],[-73.7,-39.9],[-73.5,-38.3],[-72.6,-35.5],[-71.9,-33.9],[-71.4,-32.4],[-71.7,-30.9],[-71.5,-28.9],[-70.9,-27.6],[-70.7,-25.7],[-70.4,-23.6],[-70.1,-21.4],[-70.2,-19.8],[-70.4,-18.3],[-69.0,-19.0],[-68.8,-20.4]],[[110.3,18.7],[108.7,18.5],[110.2,20.1],[110.3,18.7]],[[127.7,49.8],[129.4,49.4],[131.0,47.8],[132.5,47.8],[135.0,48.5],[134.1,47.2],[133.1,45.1],[131.0,45.0],[131.1,42.9],[129.6,42.4],[128.1,42.0],[126.2,41.1],[124.3,39.9],[122.9,39.6],[121.1,38.9],[122.2,40.4],[120.8,40.6],[119.0,39.3],[117.5,38.7],[118.9,37.9],[120.8,37.9],[122.4,37.5],[121.1,36.7],[119.7,35.6],[120.6,33.4],[121.9,31.7],[121.5,30.1],[121.7,28.2],[120.4,27.1],[119.6,25.7],[118.7,24.5],[117.3,23.6],[115.9,22.8],[114.2,22.2],[111.8,21.6],[110.4,20.3],[108.5,21.7],[107.0,21.8],[105.8,23.0],[103.5,22.7],[101.7,22.3],[100.4,21.6],[99.5,22.9],[98.7,24.1],[97.7,25.1],[98.7,26.7],[97.9,28.3],[96.2,28.4],[94.6,29.3],[92.5,27.9],[90.7,28.1],[88.8,27.3],[87.0,28.0],[85.0,28.6],[83.3,29.5],[81.5,30.4],[79.7,30.9],[78.5,32.6],[78.9,34.3],[77.8,35.5],[76.2,35.9],[75.2,37.1],[74.3,38.6],[74.8,40.4],[76.5,40.4],[78.2,41.2],[80.1,42.1],[80.0,44.9],[81.9,45.3],[83.2,47.3],[85.2,47.0],[85.8,48.5],[87.4,49.2],[88.9,48.1],[90.3,47.7],[90.6,45.7],[92.1,45.1],[93.5,45.0],[95.3,44.2],[96.3,42.7],[99.5,42.5],[101.8,42.5],[103.3,41.9],[105.0,41.6],[107.7,42.5],[109.2,42.5],[111.1,43.4],[111.9,45.1],[113.5,44.8],[116.0,45.7],[117.4,46.7],[118.9,46.8],[118.1,48.1],[116.3,47.9],[116.7,49.9],[119.3,50.1],[120.2,51.6],[121.0,53.3],[123.6,53.5],[125.1,53.2],[126.6,51.8],[127.7,49.8]],[[-2.9,5.0],[-4.6,5.2],[-6.5,4.7],[-7.6,5.7],[-8.4,6.9],[-8.3,8.3],[-8.3,9.8],[-6.9,10.1],[-5.4,10.4],[-4.0,9.9],[-2.6,8.2],[-3.2,6.3]],[[13.1,2.3],[11.3,2.3],[9.6,2.3],[9.4,3.7],[8.5,4.8],[9.2,6.4],[10.5,7.1],[12.1,7.8],[13.0,9.4],[13.6,10.8],[14.5,11.9],[15.5,10.0],[14.0,9.5],[15.1,8.4],[14.8,6.4],[14.6,5.0],[15.4,3.3],[15.9,1.7],[14.3,2.2]],[[30.8,3.5],[30.9,1.8],[29.9,0.6],[29.6,-1.3],[29.0,-2.8],[29.3,-4.5],[29.4,-5.9],[30.2,-7.1],[29.0,-8.4],[28.5,-10.8],[29.3,-12.4],[27.4,-12.1],[25.8,-11.8],[24.3,-11.3],[22.8,-11.0],[21.9,-9.5],[21.7,-7.9],[20.6,-6.9],[19.2,-7.7],[17.5,-8.1],[16.6,-6.6],[13.4,-5.9],[13.6,-4.5],[15.2,-4.3],[16.0,-2.7],[16.9,-1.2],[17.8,0.3],[17.9,1.7],[18.5,3.5],[19.5,5.0],[20.9,4.3],[22.4,4.0],[24.4,5.1],[26.4,5.2],[28.0,4.4],[29.7,4.6],[30.8,3.5]],[[13.0,-4.8],[11.1,-4.0],[11.8,-2.5],[14.0,-2.5],[14.3,-0.6],[14.3,1.2],[13.0,1.8],[15.1,2.0],[16.5,3.2],[18.5,3.5],[17.9,1.7],[17.8,0.3],[16.9,-1.2],[16.0,-2.7],[15.2,-4.3],[13.6,-4.5]],[[-75.4,-0.2],[-77.4,0.4],[-78.9,1.4],[-77.9,2.7],[-77.5,4.1],[-77.5,5.6],[-77.9,7.2],[-77.4,8.7],[-76.1,9.3],[-75.5,10.6],[-74.2,11.3],[-72.6,11.7],[-71.1,12.1],[-72.2,11.1],[-73.0,9.7],[-72.4,8.4],[-72.0,7.0],[-70.1,7.0],[-68.3,6.2],[-67.8,4.5],[-67.8,2.8],[-66.9,1.3],[-69.8,1.7],[-70.0,-0.2],[-69.4,-1.6],[-69.9,-4.3],[-70.0,-2.7],[-71.4,-2.3],[-73.1,-2.3],[-74.1,-1.0],[-75.4,-0.2]],[[-83.0,8.2],[-83.9,9.3],[-85.3,9.8],[-85.6,11.2],[-84.2,10.8],[-83.0,10.0],[-82.8,8.6]],[[-82.3,23.2],[-80.6,23.1],[-79.3,22.4],[-77.1,21.7],[-75.6,21.0],[-74.2,20.3],[-75.6,19.9],[-77.8,19.9],[-78.7,21.6],[-80.2,21.8],[-81.8,22.2],[-83.5,22.2],[-85.0,21.9],[-83.8,22.8],[-82.3,23.2]],[[17.0,48.6],[15.3,49.0],[13.6,48.9],[12.4,50.0],[14.1,50.9],[15.5,50.8],[16.9,50.5],[18.4,50.0],[17.5,48.8]],[[9.9,55.0],[10.9,54.0],[12.5,54.5],[14.1,53.8],[14.7,52.1],[13.3,50.7],[12.5,49.5],[13.0,47.6],[11.4,47.5],[9.9,47.6],[8.5,47.8],[6.7,49.2],[6.2,50.8],[6.8,52.2],[7.1,53.7],[8.8,54.0],[9.9,55.0]],[[10.9,56.5],[9.6,55.5],[8.1,55.5],[8.5,57.1],[10.6,57.7]],[[-71.7,19.7],[-70.2,19.6],[-68.8,19.0],[-70.1,18.2],[-71.4,17.6],[-71.6,19.2]],[[12.0,23.5],[8.6,21.6],[5.7,19.6],[4.3,19.2],[2.7,19.9],[-1.6,22.8],[-4.9,25.0],[-8.7,27.4],[-8.7,28.8],[-7.1,29.6],[-5.2,30.0],[-3.7,30.9],[-2.6,32.1],[-1.1,32.7],[-1.8,34.5],[-0.1,35.9],[1.5,36.6],[3.2,36.8],[4.8,36.9],[6.3,37.1],[7.7,36.9],[8.4,35.5],[7.5,34.1],[8.4,32.7],[9.5,30.3],[9.7,28.1],[9.7,26.5],[9.9,24.9],[11.6,24.1]],[[-80.3,-3.4],[-80.8,-2.0],[-80.4,-0.3],[-79.5,1.0],[-77.9,0.8],[-76.3,0.4],[-75.2,-0.9],[-76.6,-2.6],[-78.5,-3.9],[-80.0,-4.3]],[[34.9,29.5],[34.2,27.8],[32.4,29.9],[33.3,27.7],[34.1,26.1],[35.7,23.9],[36.7,22.2],[32.9,22],[29.0,22],[25,22],[25,25.7],[25,29.2],[25.0,30.7],[26.5,31.6],[28.5,31.0],[30.1,31.5],[31.7,31.4],[33.8,31.0],[34.9,29.5]],[[42.4,12.5],[41.2,13.8],[39.3,14.5],[37.9,15.0],[36.4,14.4],[36.8,16.3],[37.9,17.4],[39.3,15.9],[41.2,14.5],[42.3,13.3]],[[-9.0,41.9],[-8.0,43.7],[-5.4,43.6],[-3.5,43.5],[-1.9,43.4],[0.3,42.6],[1.8,42.3],[0.8,41.0],[-0.3,39.3],[-0.7,37.6],[-2.1,36.7],[-4.4,36.7],[-5.9,36.0],[-7.5,37.1],[-7.1,39.0],[-6.9,41.1],[-8.3,42.3]],[[24.3,57.8],[23.3,59.2],[25.9,59.6],[28.0,59.5],[27.7,57.8],[25.6,57.8]],[[37.9,15.0],[39.3,14.5],[40.9,14.1],[42.0,12.9],[41.7,11.4],[42.9,10.0],[46.9,8.0],[45.0,5.0],[42.8,4.3],[41.2,3.9],[39.6,3.4],[38.1,3.6],[36.9,4.4],[35.8,5.3],[34.7,6.6],[33.6,7.7],[34.0,9.6],[34.7,10.9],[35.9,12.6],[36.4,14.4],[37.9,15.0]],[[28.6,69.1],[30.0,67.7],[30.2,65.8],[30.4,64.2],[31.5,62.9],[30.2,61.8],[28.1,60.5],[26.3,60.4],[24.5,60.1],[22.9,59.8],[21.3,60.7],[21.1,62.6],[22.4,63.8],[24.7,64.9],[23.6,66.4],[23.5,67.9],[22.0,68.6],[20.6,69.1],[22.4,68.8],[24.7,68.6],[26.2,69.8],[27.7,70.2],[28.6,69.1]],[[-52.6,2.5],[-54.1,2.1],[-54.0,3.6],[-54.0,5.8],[-51.8,4.6],[-52.2,3.2]],[[3.6,50.4],[5.7,49.5],[8.1,49.0],[7.5,47.6],[6.0,46.7],[7.1,45.3],[7.4,43.7],[4.6,43.4],[3.1,43.1],[1.8,42.3],[0.3,42.6],[-1.5,43.0],[-1.2,46.0],[-2.2,47.1],[-4.5,48.0],[-3.3,48.9],[-1.6,48.6],[1.3,50.1],[2.5,51.1]],[[11.1,-4.0],[10.1,-3.0],[8.8,-1.1],[9.3,0.3],[11.3,1.1],[12.4,2.2],[14.0,1.4],[13.8,0.0],[14.4,-1.3],[13.1,-2.4],[11.5,-2.8]],[[-3.0,58.6],[-4.1,57.6],[-2.0,57.7],[-3.1,56.0],[-1.1,54.6],[0.2,53.3],[1.7,52.7],[1.4,51.3],[-0.8,50.8],[-2.5,50.5],[-4.5,50.3],[-3.4,51.4],[-5.0,51.6],[-4.6,53.5],[-3.1,53.4],[-4.8,54.8],[-5.6,56.3],[-5.8,57.8],[-4.2,58.6]],[[41.6,41.5],[40.9,43.0],[42.4,43.2],[43.8,42.7],[45.5,42.5],[46.6,41.2],[45.2,41.4],[43.6,41.1],[41.6,41.5]],[[1.1,5.9],[-0.5,5.3],[-2.0,4.7],[-3.2,6.3],[-2.6,8.2],[-2.8,9.6],[-2.9,11.0],[-1.2,11.0],[0.4,10.2],[0.5,8.7],[0.6,6.9]],[[-8.4,7.7],[-9.8,8.5],[-10.8,9.7],[-12.2,9.9],[-13.2,8.9],[-14.3,10.0],[-14.7,11.5],[-13.7,12.6],[-12.3,12.4],[-10.9,12.2],[-9.3,12.3],[-8.6,10.8],[-8.1,9.4],[-8.3,7.7]],[[-16.8,13.2],[-15.4,13.9],[-14.0,13.8],[-15.5,13.3]],[[-15.1,11.0],[-16.3,11.8],[-13.7,12.6],[-14.7,11.5]],[[26.6,41.6],[24.9,40.9],[23.3,40.0],[23.5,38.5],[23.2,36.4],[21.7,36.8],[21.1,38.3],[20.2,39.6],[21.0,40.8],[22.6,41.1],[24.5,41.6],[26.1,41.3]],[[-46.8,82.6],[-43.4,83.2],[-39.9,83.2],[-35.1,83.6],[-27.1,83.5],[-20.8,82.7],[-22.7,82.3],[-26.5,82.3],[-31.9,82.2],[-27.9,82.1],[-24.8,81.8],[-22.9,82.1],[-20.6,81.5],[-15.8,81.9],[-12.8,81.7],[-16.3,80.6],[-20.0,80.2],[-17.7,80.1],[-19.7,78.8],[-18.5,77.0],[-20.0,76.9],[-21.7,76.6],[-19.8,76.1],[-19.4,74.3],[-21.6,74.2],[-23.6,73.3],[-22.3,72.6],[-24.3,72.6],[-22.1,71.5],[-23.5,70.5],[-25.5,71.4],[-26.4,70.2],[-23.7,70.2],[-22.3,70.1],[-25.0,69.3],[-27.7,68.5],[-30.7,68.1],[-32.8,67.7],[-34.2,66.7],[-36.4,66.0],[-38.4,65.7],[-39.8,65.5],[-40.7,64.1],[-42.8,62.7],[-42.9,61.1],[-44.8,60.0],[-46.3,60.9],[-48.3,60.9],[-49.9,62.4],[-51.6,63.6],[-52.3,65.2],[-53.7,66.1],[-53.0,68.4],[-51.5,68.7],[-53.5,69.3],[-54.8,70.3],[-53.4,70.8],[-51.4,70.6],[-53.1,71.2],[-55,71.4],[-55.3,73.0],[-57.3,74.7],[-58.6,75.5],[-61.3,76.1],[-63.4,76.2],[-66.1,76.1],[-68.5,76.1],[-71.4,77.0],[-68.8,77.3],[-66.8,77.4],[-71.0,77.6],[-73.3,78.0],[-69.4,78.9],[-65.7,79.4],[-68.0,80.1],[-63.7,81.2],[-62.2,81.3],[-60.3,82.0],[-57.2,82.2],[-54.1,82.2],[-50.4,82.4],[-48.0,82.1],[-46.6,82.0],[-44.5,81.7],[-46.9,82.2]],[[-90.1,13.7],[-91.7,14.1],[-91.7,16.1],[-91.0,17.8],[-89.1,17.8],[-89.2,15.9],[-89.4,14.4]],[[-59.8,8.4],[-58.5,7.3],[-57.5,6.3],[-57.9,4.8],[-57.6,3.3],[-56.5,1.9],[-58.1,1.5],[-59.6,1.8],[-59.8,3.6],[-60.0,5.0],[-61.4,6.0],[-60.3,7.0],[-59.8,8.4]],[[-87.3,13.0],[-88.5,13.8],[-89.2,15.1],[-87.9,15.9],[-86.4,15.8],[-85.0,16.0],[-83.4,15.3],[-84.8,14.8],[-85.8,13.8],[-87.0,13.0]],[[18.8,45.9],[17.0,45.2],[16.9,43.7],[18.6,42.6],[16.9,43.2],[15.2,44.2],[13.7,45.1],[15.3,45.5],[16.6,46.5],[18.5,45.8]],[[-73.2,19.9],[-71.7,19.7],[-71.7,18.0],[-73.5,18.2],[-72.8,19.5]],[[16.2,46.9],[17.0,48.1],[18.7,47.9],[20.2,48.3],[21.9,48.3],[21.0,46.3],[19.6,46.2],[17.6,46.0],[16.4,46.8]],[[122.9,-8.1],[121.3,-8.9],[119.9,-8.8],[121.3,-8.5],[122.9,-8.1]],[[108.6,-6.8],[110.5,-6.9],[112.6,-6.9],[114.5,-7.8],[112.6,-8.4],[110.6,-8.1],[108.7,-7.6],[106.5,-7.4],[106.1,-5.9],[108.1,-6.3]],[[134.1,-1.2],[134.4,-2.8],[136.3,-2.3],[138.3,-1.7],[139.9,-2.4],[141.0,-5.9],[141.0,-9.1],[139.1,-8.1],[137.6,-8.4],[138.7,-7.3],[137.9,-5.4],[136.0,-4.5],[133.7,-3.5],[132.0,-2.8],[133.8,-2.5],[132.2,-2.2],[130.9,-1.4],[132.4,-0.4],[134.0,-0.8]],[[125.2,1.4],[123.7,0.2],[121.1,0.4],[120.0,-0.5],[121.5,-1.0],[123.3,-0.6],[121.5,-1.9],[122.5,-3.2],[123.2,-4.7],[121.7,-4.9],[120.9,-3.6],[120.4,-5.5],[119.5,-3.5],[119.2,-2.1],[119.8,0.2],[120.9,1.3],[122.9,0.9],[125.1,1.6]],[[117.9,1.8],[119.0,0.9],[117.5,0.1],[116.6,-1.5],[116.1,-4.0],[114.5,-3.5],[112.1,-3.5],[110.2,-2.9],[109.6,-1.3],[109.0,0.4],[109.7,2.0],[110.5,0.8],[112.4,1.4],[113.8,1.2],[115.1,2.8],[115.9,4.3],[117.9,4.1],[118.0,2.3]],[[105.8,-5.9],[103.9,-5.0],[102.6,-4.2],[101.4,-2.8],[100.1,-0.7],[99.0,1.0],[97.7,2.5],[96.4,3.9],[95.4,5.0],[97.5,5.2],[99.1,3.6],[100.6,2.1],[102.5,1.4],[103.8,0.1],[104.5,-1.8],[106.1,-3.1],[105.8,-5.9]],[[77.8,35.5],[78.9,34.3],[79.2,32.5],[79.7,30.9],[81.1,30.2],[80.1,28.8],[82.0,27.9],[84.7,27.2],[86.0,26.6],[88.1,26.4],[88.1,27.9],[89.7,26.7],[91.2,26.8],[92.5,27.9],[94.6,29.3],[96.1,29.5],[97.3,28.3],[95.1,26.6],[94.6,25.2],[93.3,24.1],[93.1,22.7],[91.9,23.6],[92.4,25.0],[90.9,25.1],[89.8,26.0],[88.2,25.8],[88.7,24.2],[89.0,22.1],[87.0,21.5],[85.1,19.5],[83.9,18.3],[82.2,17.0],[80.8,16.0],[80.2,13.8],[79.9,12.1],[79.9,10.4],[78.3,8.9],[76.6,8.9],[76.1,10.3],[75.4,11.8],[74.6,14.0],[73.5,16.0],[73.1,17.9],[72.8,20.4],[71.2,20.8],[69.2,22.1],[68.2,23.7],[71.0,24.4],[70.3,25.7],[69.5,26.9],[70.6,28.0],[72.8,29.0],[74.4,31.0],[75.3,32.3],[74.1,33.4],[75.8,34.5],[77.8,35.5]],[[-6.2,53.9],[-6.8,52.3],[-8.6,51.7],[-10.0,51.8],[-9.7,53.9],[-8.3,54.7],[-7.0,54.1]],[[53.9,37.2],[55.5,38.0],[57.3,38.0],[59.2,37.4],[60.4,36.5],[60.8,34.4],[60.5,33.0],[60.9,31.5],[60.9,29.8],[61.8,28.7],[62.8,27.4],[61.9,26.2],[59.6,25.4],[57.4,25.7],[56.5,27.1],[54.7,26.5],[52.5,27.6],[50.9,28.8],[50.1,30.1],[48.6,29.9],[47.7,31.0],[47.3,32.5],[45.4,34.0],[46.1,35.7],[44.8,37.2],[44.1,39.4],[45.5,38.9],[47.7,39.5],[48.6,38.3],[50.1,37.4],[52.3,36.7],[53.8,37.0]],[[45.4,36.0],[45.4,34.0],[47.3,32.5],[47.7,31.0],[48.6,29.9],[46.6,29.1],[44.7,29.2],[41.9,31.2],[40.4,31.9],[38.8,33.4],[41.0,34.4],[41.3,36.4],[42.8,37.4],[44.3,37.0],[45.4,36.0]],[[-14.5,66.5],[-13.6,65.1],[-14.9,64.4],[-17.8,63.7],[-20.0,63.6],[-22.8,64.0],[-24.0,64.9],[-22.2,65.1],[-24.3,65.6],[-22.1,66.4],[-20.6,65.7],[-19.1,66.3],[-16.2,66.5],[-14.5,66.5]],[[35.7,32.7],[34.9,31.4],[34.9,29.5],[34.3,31.2],[35.0,32.8]],[[15.5,38.2],[15.1,36.6],[12.4,37.6],[14.8,38.1]],[[12.4,46.8],[13.8,46.5],[12.3,45.4],[13.5,43.6],[15.1,42.0],[16.8,41.2],[18.4,40.4],[16.9,40.4],[17.1,38.9],[15.7,37.9],[15.7,39.5],[14.7,40.6],[12.9,41.3],[11.2,42.4],[10.2,43.9],[8.4,44.2],[7.0,44.3],[6.8,45.7],[8.3,46.2],[9.9,46.3],[11.2,46.9]],[[35.5,32.4],[38.8,33.4],[39.0,32.0],[37.0,31.5],[38.0,30.5],[36.7,29.9],[35.0,29.4],[35.4,31.1]],[[141.0,37.1],[140.3,35.1],[137.2,34.6],[135.8,33.5],[133.3,34.4],[131.0,33.9],[131.3,31.5],[129.8,32.6],[130.9,34.2],[132.6,35.4],[134.6,35.7],[136.7,37.3],[138.9,37.8],[140.1,39.4],[140.3,41.2],[141.9,40.0],[141.0,38.2]],[[143.9,44.2],[145.3,44.4],[144.1,43.0],[141.6,42.7],[140.0,41.6],[140.3,43.3],[141.7,44.8],[143.1,44.5]],[[71.0,42.3],[69.1,41.4],[66.7,41.2],[66.1,43.0],[63.2,43.7],[61.1,44.4],[58.7,45.5],[55.9,45.0],[56.0,41.3],[54.1,42.3],[52.5,41.8],[51.3,43.1],[50.3,44.3],[52.2,45.4],[53.0,46.9],[51.2,47.0],[49.1,46.4],[48.1,47.7],[46.5,48.4],[47.5,50.5],[50.8,51.7],[52.3,51.7],[54.5,51.0],[56.8,51.0],[58.4,51.1],[59.9,50.8],[61.6,51.3],[60.0,52.0],[61.7,53.0],[65.2,54.4],[68.2,55.0],[70.9,55.2],[72.2,54.4],[73.4,53.5],[76.9,54.5],[77.8,53.4],[80.0,50.9],[81.9,50.8],[83.4,51.1],[85.1,50.1],[86.8,49.8],[85.8,48.5],[85.2,47.0],[83.2,47.3],[82.5,45.5],[80.0,44.9],[80.9,43.2],[79.6,42.5],[77.7,43.0],[76.0,43.0],[74.2,43.3],[71.8,42.8]],[[41.0,-0.9],[40.6,-2.5],[39.8,-3.7],[37.8,-3.7],[34.1,-1.1],[34.2,0.5],[35.0,1.9],[34.5,3.6],[35.3,5.5],[36.2,4.4],[38.1,3.6],[39.6,3.4],[40.8,4.3],[41.0,2.8],[41.0,-0.9]],[[71.0,42.3],[73.5,42.5],[75.6,42.9],[77.7,43.0],[79.1,42.9],[78.5,41.6],[76.9,41.1],[75.5,40.6],[73.8,39.9],[71.8,39.3],[69.5,39.5],[71.0,40.2],[73.1,40.9],[71.2,41.1]],[[103.5,10.6],[102.6,12.2],[103.0,14.2],[105.2,14.3],[107.4,14.2],[107.5,12.3],[105.8,11.6],[104.3,10.5]],[[128.3,38.6],[129.2,37.4],[129.5,35.6],[128.2,34.9],[126.5,34.4],[126.1,36.7],[127.1,38.3]],[[48.0,30.0],[48.4,28.6],[46.6,29.1],[48.0,30.0]],[[105.2,14.3],[104.8,16.4],[104.0,18.2],[102.4,17.9],[101.0,18.4],[100.5,20.1],[101.2,21.4],[102.2,22.5],[103.2,20.8],[104.8,19.9],[105.9,17.5],[107.3,15.9],[107.4,14.2],[106.0,13.9]],[[-7.7,4.4],[-9.9,5.6],[-11.4,6.8],[-10.2,8.4],[-9.2,7.3],[-8.3,6.2],[-7.7,4.4]],[[14.9,22.9],[12.0,23.5],[10.8,24.6],[9.3,26.1],[9.8,27.7],[9.8,29.4],[10.1,31.0],[11.4,32.4],[13.1,32.9],[15.2,32.3],[16.6,31.2],[18.0,30.8],[19.6,30.5],[20.1,32.2],[21.5,32.8],[22.9,32.6],[24.9,31.9],[24.7,30.0],[25,25.7],[25,22],[25,20.0],[19.8,21.5],[15.9,23.4]],[[81.8,7.5],[81.2,6.2],[79.9,6.8],[79.7,8.2],[80.1,9.8],[81.3,8.6]],[[29.0,-29.0],[28.1,-30.5],[27.5,-29.2],[29.0,-29.0]],[[22.7,54.3],[21.3,55.2],[22.2,56.3],[23.9,56.3],[25.5,56.1],[26.6,55.2],[25.5,54.3],[23.5,53.9]],[[21.1,56.0],[21.6,57.4],[23.3,57.0],[25.2,58.0],[27.3,57.5],[28.2,56.2],[26.5,55.6],[25.0,56.2],[22.2,56.3]],[[-5.2,35.8],[-3.6,35.4],[-2.2,35.2],[-1.4,32.9],[-2.6,32.1],[-3.7,30.9],[-5.2,30.0],[-7.1,29.6],[-8.7,28.8],[-8.8,27.1],[-10.2,26.9],[-11.7,26.1],[-12.5,24.8],[-13.9,23.7],[-14.2,22.3],[-17.0,21.4],[-16.3,22.7],[-15.4,24.4],[-14.4,26.3],[-13.1,27.6],[-11.7,28.1],[-10.4,29.1],[-9.8,31.2],[-9.3,32.6],[-7.7,33.7],[-6.2,35.1]],[[26.6,48.2],[28.3,48.2],[29.4,47.3],[28.7,45.9],[27.6,47.4]],[[49.5,-12.5],[50.2,-14.8],[49.9,-16.5],[49.4,-18.0],[48.5,-20.5],[47.9,-22.4],[47.5,-23.8],[46.3,-25.2],[44.8,-25.3],[43.7,-23.6],[43.3,-22.1],[43.9,-20.8],[44.5,-19.4],[44.0,-17.4],[44.9,-16.2],[46.3,-15.8],[47.7,-14.6],[48.8,-13.1]],[[-97.1,25.9],[-97.7,24.3],[-97.8,22.9],[-97.4,21.4],[-96.5,19.9],[-94.8,18.6],[-92.8,18.5],[-91.4,18.9],[-90.5,20.7],[-88.5,21.5],[-87.1,21.5],[-87.6,19.6],[-88.5,18.5],[-90.1,17.8],[-91.5,17.3],[-90.4,16.4],[-92.2,15.3],[-93.9,15.9],[-95.3,16.1],[-97.3,15.9],[-98.9,16.6],[-100.8,17.2],[-102.5,18.0],[-103.9,18.7],[-105.5,19.9],[-105.3,21.4],[-106.0,22.8],[-107.9,24.5],[-109.3,25.6],[-110.4,27.2],[-111.8,28.5],[-112.8,30.0],[-113.9,31.6],[-114.7,30.2],[-113.6,29.1],[-112.8,27.8],[-111.6,26.7],[-111.0,25.3],[-109.8,23.8],[-111.7,24.5],[-112.3,26.0],[-113.5,26.8],[-115.1,27.7],[-114.9,29.3],[-116.3,30.8],[-117.1,32.5],[-114.7,32.7],[-113.3,32.0],[-111.0,31.3],[-109.0,31.3],[-106.5,31.8],[-105.0,30.6],[-103.9,29.3],[-102.5,29.8],[-101.0,29.4],[-100.1,28.1],[-99.3,26.8],[-97.5,25.8]],[[20.6,41.9],[22.4,42.3],[21.7,40.9],[20.6,41.9]],[[-12.2,14.6],[-10.7,15.1],[-5.5,15.5],[-6.0,20.6],[-6.5,25.0],[-4.9,25.0],[-1.6,22.8],[1.8,20.6],[3.1,19.7],[4.3,16.9],[3.6,15.6],[1.4,15.3],[-0.3,14.9],[-2.0,14.6],[-3.1,13.5],[-4.4,12.5],[-5.5,11.0],[-6.9,10.1],[-8.3,10.5],[-8.9,12.1],[-10.6,11.9],[-11.6,13.1],[-12.2,14.6]],[[99.5,20.2],[97.8,18.6],[98.5,16.8],[98.5,15.3],[99.1,13.8],[99.6,11.9],[98.6,9.9],[98.8,11.4],[98.5,13.1],[97.8,14.8],[97.2,16.9],[95.4,15.7],[94.5,17.3],[93.5,19.4],[92.4,20.7],[93.2,22.3],[93.3,24.1],[94.6,24.7],[95.2,26.0],[96.4,27.3],[97.9,28.3],[98.7,26.7],[97.7,25.1],[98.7,24.1],[99.5,22.9],[100.4,21.6],[99.5,20.2]],[[87.8,49.3],[90.7,50.3],[92.2,50.8],[94.1,50.5],[95.8,50.0],[97.3,49.7],[98.9,52.0],[100.9,51.5],[102.3,50.5],[103.7,50.1],[105.9,50.4],[107.9,49.8],[109.4,49.3],[111.6,49.4],[114.4,50.2],[116.7,49.9],[115.5,48.1],[117.3,47.7],[118.9,47.7],[117.4,46.7],[116.0,45.7],[114.5,45.3],[112.4,45.0],[111.8,43.7],[110.4,42.9],[107.7,42.5],[106.1,42.1],[104.5,41.9],[101.8,42.5],[99.5,42.5],[97.5,42.7],[95.8,43.3],[94.7,44.4],[92.1,45.1],[90.6,45.7],[90.3,47.7],[88.9,48.1],[87.8,49.3]],[[34.6,-11.5],[36.5,-11.7],[38.4,-11.3],[40.3,-10.3],[40.4,-11.8],[40.6,-14.2],[40.1,-16.1],[38.5,-17.1],[36.3,-18.7],[35.2,-19.6],[35.2,-21.3],[35.5,-23.1],[35.0,-24.5],[33.0,-25.4],[32.1,-26.7],[31.9,-24.4],[31.2,-22.3],[32.2,-21.1],[32.8,-19.7],[32.8,-18.0],[32.3,-16.4],[30.3,-15.9],[33.2,-14.0],[34.5,-14.6],[34.4,-16.2],[35.8,-15.9],[35.3,-13.9],[34.3,-12.3]],[[-12.2,14.6],[-13.4,16.0],[-15.1,16.6],[-16.5,16.1],[-16.1,18.1],[-16.4,19.6],[-17.1,21.0],[-12.9,21.3],[-13.1,22.8],[-12.0,25.9],[-8.7,25.9],[-8.7,27.4],[-4.9,25.0],[-6.5,25.0],[-6.0,20.6],[-5.5,16.3],[-9.6,15.5],[-11.3,15.4]],[[34.6,-11.5],[34.6,-13.6],[35.7,-14.6],[35.3,-16.1],[34.5,-14.6],[33.2,-14.0],[33.3,-12.4],[33.3,-10.8],[32.8,-9.2],[34.3,-10.2]],[[101.1,6.2],[103.0,5.5],[103.3,3.7],[104.2,1.6],[102.6,2.0],[101.4,2.8],[100.6,4.8],[100.1,6.5]],[[118.6,4.5],[117.0,4.3],[115.5,3.2],[114.6,1.4],[112.9,1.5],[111.2,1.0],[109.8,1.3],[111.2,1.9],[113.0,3.1],[114.2,4.5],[115.5,5.4],[116.7,6.9],[118.3,5.7]],[[16.3,-28.6],[15.2,-27.1],[14.7,-25.4],[14.4,-23.9],[14.3,-22.1],[13.4,-20.9],[12.6,-19.0],[11.7,-17.3],[13.5,-17.0],[18.3,-17.3],[21.4,-17.9],[23.2,-17.5],[24.7,-17.4],[23.6,-18.3],[21.7,-18.2],[20.9,-21.8],[19.9,-24.8],[19.9,-28.5],[18.5,-29.0],[17.2,-28.4]],[[165.8,-21.1],[167.1,-22.2],[165.5,-21.7],[164.2,-20.4],[165.8,-21.1]],[[2.2,11.9],[1.0,12.9],[0.3,14.4],[1.4,15.3],[3.6,15.6],[4.3,16.9],[4.3,19.2],[5.7,19.6],[8.6,21.6],[12.0,23.5],[13.6,23.0],[15.1,21.3],[15.7,20.0],[15.3,17.9],[14.0,15.7],[14.0,14.0],[14.2,12.5],[13.3,13.6],[11.5,13.3],[10.1,13.3],[7.8,13.3],[6.4,13.5],[4.4,13.7],[3.6,11.7],[2.2,11.9]],[[8.5,4.8],[7.1,4.5],[5.4,4.9],[4.3,6.3],[2.7,6.3],[2.7,7.9],[3.2,9.4],[3.8,10.7],[3.7,12.6],[5.4,13.9],[6.8,13.1],[9.0,12.8],[10.7,13.2],[12.3,13.0],[14.0,12.5],[13.6,10.8],[13.0,9.4],[12.1,7.8],[11.1,6.6],[9.5,6.5],[8.5,4.8]],[[-85.7,11.1],[-86.7,12.1],[-86.8,13.8],[-85.2,14.4],[-83.6,14.9],[-83.6,13.1],[-83.7,11.6],[-85.6,11.2]],[[6.1,53.5],[6.8,52.2],[6.2,50.8],[4.0,51.3],[4.7,53.1],[6.1,53.5]],[[28.2,71.2],[31.3,70.5],[29.4,69.2],[27.7,70.2],[26.2,69.8],[24.7,68.6],[22.4,68.8],[20.6,69.1],[18.0,68.6],[16.1,67.3],[15.1,66.2],[13.6,64.8],[11.9,63.1],[12.6,61.3],[11.5,59.4],[8.4,58.3],[7.0,58.1],[5.3,59.7],[5.0,62.0],[8.6,63.5],[10.5,64.5],[12.4,65.9],[14.8,67.8],[16.4,68.6],[19.2,69.8],[21.4,70.3],[23.0,70.2],[24.5,71.0],[26.4,71.0],[28.2,71.2]],[[24.7,77.9],[22.5,77.4],[20.7,77.7],[22.9,78.5],[24.7,77.9]],[[18.3,79.7],[21.5,79.0],[19.0,78.6],[17.6,77.6],[15.9,76.8],[13.8,77.4],[11.2,78.9],[13.2,80.0],[15.1,79.7],[17.0,80.1]],[[25.4,80.4],[27.4,80.1],[25.9,79.5],[23.0,79.4],[20.1,79.6],[18.5,79.9],[20.5,80.6],[21.9,80.4],[25.4,80.4]],[[88.1,27.9],[88.1,26.4],[86.0,26.6],[84.7,27.2],[83.3,27.4],[81.1,28.4],[80.5,29.7],[82.3,30.1],[83.9,29.3],[85.8,28.2],[88.1,27.9]],[[173.0,-40.9],[174.2,-41.8],[173.2,-43.0],[171.5,-44.2],[170.6,-45.9],[169.3,-46.6],[167.8,-46.3],[167.0,-45.1],[168.3,-44.1],[169.7,-43.6],[171.1,-42.5],[172.1,-41.0]],[[174.6,-36.2],[176.0,-37.6],[177.4,-38.0],[176.9,-39.4],[176.0,-41.3],[174.9,-39.9],[174.7,-38.0],[174.3,-36.5],[173.1,-35.2],[174.6,-36.2]],[[58.9,21.1],[57.8,20.2],[57.2,18.9],[55.7,17.9],[54.2,17.0],[52.8,17.3],[52.0,19.0],[55.0,20.0],[55.7,22.0],[55.5,23.5],[55.9,24.9],[57.4,23.9],[59.2,23.0],[59.3,21.4]],[[75.2,37.1],[76.2,35.9],[77.8,35.5],[75.8,34.5],[74.2,34.7],[74.5,32.8],[74.4,31.0],[72.8,29.0],[71.8,27.9],[69.5,26.9],[70.3,25.7],[71.0,24.4],[68.8,24.4],[67.4,23.9],[66.4,25.4],[64.5,25.2],[62.9,25.2],[61.5,25.1],[63.3,26.8],[62.7,28.3],[61.4,29.3],[63.6,29.5],[66.3,29.9],[66.9,31.3],[68.6,31.7],[69.7,33.1],[70.9,34.0],[71.5,35.7],[72.9,36.7],[74.6,37.0]],[[-77.9,7.2],[-78.6,8.7],[-80.2,8.3],[-81.5,7.7],[-82.8,8.3],[-81.4,8.8],[-79.9,9.3],[-78.5,9.4],[-77.2,7.9]],[[-69.6,-17.6],[-71.4,-17.8],[-73.4,-16.4],[-75.2,-15.3],[-76.4,-13.8],[-77.1,-12.2],[-78.1,-10.4],[-79.0,-8.4],[-79.8,-7.2],[-81.2,-6.1],[-81.4,-4.7],[-80.3,-3.4],[-79.2,-5.0],[-77.8,-3.0],[-75.5,-1.6],[-75.4,-0.2],[-74.1,-1.0],[-73.1,-2.3],[-71.4,-2.3],[-70.0,-2.7],[-69.9,-4.3],[-71.7,-4.6],[-73.0,-5.7],[-73.7,-7.3],[-73.0,-9.0],[-71.3,-10.1],[-70.1,-11.1],[-68.7,-12.6],[-68.9,-14.5],[-69.0,-16.5]],[[126.4,8.4],[126.2,6.3],[124.2,6.2],[123.6,7.8],[122.1,6.9],[122.9,8.3],[124.6,8.5],[125.4,9.8],[126.4,8.4]],[[118.5,9.3],[117.2,8.4],[118.4,9.7],[119.5,11.4],[119.0,10.0]],[[121.3,18.5],[122.5,17.1],[121.7,15.9],[121.7,14.3],[124.0,13.8],[122.7,13.2],[121.1,13.6],[120.1,15.0],[119.9,16.4],[120.7,18.5]],[[152.0,-5.5],[150.2,-6.3],[148.3,-5.7],[149.8,-5.5],[151.6,-4.8]],[[147.2,-7.4],[148.7,-9.1],[150.0,-9.7],[147.9,-10.1],[146.6,-8.9],[144.7,-7.6],[143.3,-8.2],[142.1,-9.2],[141.0,-5.9],[141.0,-2.6],[142.7,-3.3],[144.6,-3.9],[145.8,-4.9],[147.6,-6.1]],[[153.1,-4.5],[152.0,-3.5],[150.7,-2.7],[152.2,-3.2],[153.1,-4.5]],[[15.0,51.1],[14.4,52.6],[14.8,54.1],[16.4,54.5],[18.6,54.7],[20.9,54.3],[22.7,54.3],[23.8,53.1],[23.5,51.6],[22.5,49.5],[20.9,49.3],[19.3,49.6],[17.6,50.0],[16.2,50.4]],[[130.6,42.4],[129.7,40.9],[128.0,40.0],[128.3,38.6],[126.7,37.8],[125.3,37.7],[125.4,39.4],[126.2,41.1],[128.2,41.5],[129.6,42.4]],[[-9.0,41.9],[-7.4,41.8],[-6.9,40.3],[-7.4,38.4],[-7.9,36.8],[-8.8,38.3],[-9.0,39.8],[-8.8,41.2]],[[-62.7,-22.2],[-62.3,-20.5],[-60.0,-19.3],[-58.2,-19.9],[-57.9,-22.1],[-55.8,-22.4],[-55.4,-24.0],[-54.4,-25.2],[-54.8,-26.6],[-56.5,-27.5],[-58.6,-27.1],[-57.6,-25.6],[-58.8,-24.8],[-60.0,-24.0],[-62.7,-22.2]],[[22.7,47.9],[24.4,48.0],[25.9,48.0],[27.6,47.4],[28.1,45.9],[29.6,45.3],[28.6,43.7],[27.2,44.2],[25.6,43.7],[24.1,43.7],[22.7,44.2],[21.5,45.2],[20.2,46.1],[21.6,47.0],[22.7,47.9]],[[143.6,50.7],[144.7,49.0],[143.2,49.3],[142.6,47.9],[143.5,46.8],[142.1,46.0],[142.0,47.8],[142.1,49.6],[142.2,51.0],[141.7,53.3],[142.7,54.4],[143.3,52.7],[143.6,50.7]],[[-175.0,66.6],[-171.9,66.9],[-169.9,66.0],[-172.5,65.4],[-173.9,64.3],[-176.0,64.9],[-178.4,65.4],[-179.9,65.9],[-180,69.0],[-177.6,68.2],[-174.9,67.2]],[[143.6,73.2],[142.1,73.2],[140.0,73.3],[142.1,73.9],[143.5,73.5]],[[150.7,75.1],[148.0,74.8],[146.1,75.2],[148.2,75.3],[150.7,75.1]],[[145.1,75.6],[140.6,74.8],[139.0,74.6],[137.0,75.3],[138.8,76.1],[141.5,76.1],[145.1,75.6]],[[57.5,70.7],[53.7,70.8],[51.6,71.5],[52.4,72.8],[54.4,73.6],[55.9,74.6],[57.9,75.6],[61.2,76.3],[64.5,76.4],[66.2,76.8],[68.2,76.9],[64.6,75.7],[61.6,75.3],[58.5,74.3],[57.0,73.3],[55.4,72.4],[57.5,70.7]],[[107.0,77.0],[111.1,76.7],[113.3,76.2],[110.2,74.5],[112.1,73.8],[113.5,73.3],[115.6,73.8],[118.8,73.6],[123.2,73.0],[125.4,73.6],[127.0,73.6],[128.6,73.0],[129.7,71.2],[131.3,70.8],[132.3,71.8],[133.9,71.4],[135.6,71.7],[137.5,71.3],[139.9,71.5],[140.5,72.8],[149.5,72.2],[153.0,70.8],[157.0,71.0],[159.0,70.9],[160.9,69.4],[162.3,69.6],[164.1,69.7],[165.9,69.5],[167.8,69.6],[169.6,68.7],[170.5,70.1],[173.6,69.8],[175.7,69.9],[178.6,69.4],[180,69.0],[180,65.0],[177.4,64.6],[178.9,63.3],[177.4,62.5],[174.6,61.8],[172.2,61.0],[170.7,60.3],[168.9,60.6],[166.3,59.8],[164.9,59.7],[163.5,59.9],[162.0,58.2],[163.1,56.2],[161.7,55.3],[160.4,54.3],[158.5,53.0],[156.8,51.0],[156.0,53.2],[155.4,55.4],[155.9,56.8],[158.4,58.1],[160.2,59.3],[161.9,60.3],[163.7,61.1],[164.5,62.6],[162.7,61.6],[160.1,60.5],[159.3,61.8],[156.7,61.4],[154.2,59.8],[152.8,58.9],[151.3,58.8],[149.8,59.7],[145.5,59.3],[142.2,59.0],[139.0,57.1],[135.1,54.7],[136.7,54.6],[138.2,53.8],[139.9,54.2],[141.3,53.1],[140.6,51.2],[140.1,48.4],[138.6,47.0],[136.9,45.1],[135.5,44.0],[133.5,42.8],[130.9,42.6],[131.3,44.1],[133.1,45.1],[134.1,47.2],[135.0,48.5],[133.4,48.2],[131.0,47.8],[129.4,49.4],[127.7,49.8],[126.9,51.4],[125.9,52.8],[123.6,53.5],[122.2,53.4],[120.2,52.8],[119.3,50.6],[117.9,49.5],[115.5,49.8],[112.9,49.5],[110.7,49.1],[108.5,49.3],[106.9,50.3],[104.6,50.3],[102.3,50.5],[100.9,51.5],[98.9,52.0],[97.8,51.0],[95.8,50.0],[94.1,50.5],[92.2,50.8],[90.7,50.3],[88.8,49.5],[87.4,49.2],[85.5,49.7],[83.9,50.9],[81.9,50.8],[80.6,51.4],[77.8,53.4],[76.5,54.2],[74.4,53.5],[72.2,54.4],[70.9,55.2],[69.1,55.4],[65.7,54.6],[61.4,54.0],[60.7,52.7],[61.6,51.3],[59.9,50.8],[58.4,51.1],[56.8,51.0],[54.5,51.0],[52.3,51.7],[50.8,51.7],[48.7,50.6],[46.8,49.4],[47.3,47.7],[48.7,47.1],[47.7,45.6],[46.7,44.6],[47.5,43.0],[48.6,41.8],[46.7,41.8],[44.5,42.7],[42.4,43.2],[40.9,43.4],[38.7,44.3],[36.7,45.2],[38.2,46.2],[39.1,47.3],[39.7,48.8],[38.6,49.9],[36.6,50.2],[35.0,51.2],[33.8,52.3],[32.2,52.1],[32.4,53.6],[30.8,54.8],[29.4,55.7],[27.9,56.8],[27.4,58.7],[29.1,60.0],[30.2,61.8],[31.5,62.9],[30.0,63.6],[30.2,65.8],[29.1,66.9],[28.4,68.4],[31.1,69.6],[33.8,69.3],[36.5,69.1],[40.3,67.9],[40.0,66.3],[38.4,66.0],[33.9,66.8],[34.9,65.4],[36.2,64.1],[37.2,65.1],[39.6,64.5],[42.1,66.5],[43.9,66.1],[44.2,68.0],[46.2,68.2],[46.3,66.7],[47.9,66.9],[50.2,68.0],[53.7,68.9],[55.4,68.4],[57.3,68.5],[58.8,68.9],[61.1,68.9],[63.5,69.5],[64.9,69.2],[68.5,68.1],[66.9,69.5],[66.7,71.0],[68.5,71.9],[69.9,73.0],[72.6,72.8],[71.8,71.4],[72.8,70.4],[72.6,69.0],[73.2,67.7],[71.3,66.3],[72.8,66.5],[74.2,67.3],[74.9,69.0],[73.6,69.6],[73.1,71.4],[74.9,72.1],[76.4,71.2],[77.6,72.3],[79.7,72.3],[81.5,71.8],[80.5,73.6],[82.2,73.8],[84.7,73.8],[86.8,73.9],[88.3,75.1],[90.3,75.6],[92.9,75.8],[95.9,76.1],[98.9,76.4],[100.8,76.4],[102.0,77.3],[104.4,77.7],[106.1,77.4],[104.7,77.1],[107.0,77.0]],[[105.1,78.3],[99.4,77.9],[101.3,79.2],[102.8,79.3],[105.4,78.7]],[[51.1,80.5],[48.9,80.3],[46.5,80.2],[44.8,80.6],[46.8,80.8],[48.3,80.8],[50.0,80.9],[51.5,80.7]],[[99.9,78.9],[97.8,78.8],[95.0,79.0],[93.3,79.4],[91.2,80.3],[93.8,81.0],[95.9,81.3],[97.9,80.7],[100.2,79.8]],[[-8.8,27.1],[-12.0,25.9],[-11.9,23.4],[-12.9,21.3],[-16.8,21.3],[-14.8,21.5],[-13.9,23.7],[-12.5,24.8],[-11.7,26.1],[-10.6,27.0],[-8.8,27.1]],[[42.8,16.3],[41.8,17.8],[40.9,19.5],[39.1,21.3],[38.5,23.7],[37.2,24.9],[36.2,26.6],[35.1,28.1],[36.1,29.2],[37.5,30.0],[37.0,31.5],[39.0,32.0],[40.4,31.9],[41.9,31.2],[44.7,29.2],[46.6,29.1],[48.4,28.6],[49.3,27.5],[50.2,26.3],[50.8,24.8],[52.0,23.0],[55.0,22.5],[55.0,20.0],[52.0,19.0],[49.1,18.6],[47.5,17.1],[45.4,17.3],[43.8,17.3],[42.8,16.3]],[[34.0,9.5],[33.2,10.7],[33.2,12.2],[31.9,10.5],[30.0,10.3],[28.0,9.4],[26.5,9.6],[25.1,10.3],[24.5,8.9],[23.6,10.1],[22.9,11.4],[21.9,12.6],[22.5,14.1],[23.0,15.7],[23.8,19.6],[25,22],[29.0,22],[32.9,22],[36.9,22],[37.1,19.8],[37.9,18.4],[36.9,17.0],[36.3,14.8],[35.9,12.6],[34.8,11.3],[34.0,9.6]],[[34.0,9.5],[33.0,7.8],[34.3,6.8],[35.3,5.5],[34.0,4.2],[31.9,3.6],[30.0,4.2],[28.4,4.3],[27.2,5.6],[25.8,7.0],[24.6,8.2],[24.8,9.8],[26.5,9.6],[28.0,9.4],[29.5,9.8],[31.4,9.8],[32.4,11.1],[33.7,10.3]],[[-16.7,13.6],[-17.6,14.7],[-16.5,16.1],[-15.1,16.6],[-13.4,16.0],[-12.2,14.6],[-11.6,13.1],[-13.2,12.6],[-15.5,12.6],[-16.8,13.2],[-15.1,13.5],[-16.7,13.6]],[[-11.4,6.8],[-12.9,7.8],[-12.7,9.3],[-11.1,10.0],[-10.5,8.7],[-11.1,7.4]],[[48.9,9.5],[47.8,8.0],[43.7,9.2],[42.6,10.6],[44.1,10.4],[45.6,10.7],[47.5,11.1],[48.9,11.4],[48.9,10.0]],[[49.7,11.6],[51.1,12.0],[51.0,10.6],[50.6,9.2],[49.5,6.8],[48.6,5.3],[47.7,4.2],[46.6,2.9],[44.1,1.1],[42.0,-0.9],[41.0,2.8],[41.9,3.9],[43.7,5.0],[47.8,8.0],[48.9,9.5],[48.9,11.0]],[[20.9,45.4],[22.1,44.5],[23.0,43.2],[21.9,42.3],[20.8,43.3],[19.2,43.5],[19.4,44.9],[20.2,46.1]],[[-57.1,6.0],[-55.0,6.0],[-54.4,4.2],[-54.3,2.7],[-56.0,2.5],[-57.3,3.3],[-57.9,4.6],[-57.1,6.0]],[[18.9,49.5],[20.4,49.4],[22.6,49.1],[20.8,48.6],[19.2,48.1],[17.5,47.9],[18.2,49.3]],[[13.8,46.5],[16.0,46.7],[14.9,45.5],[13.8,46.5]],[[22.2,65.7],[21.4,64.4],[19.8,63.6],[17.8,62.7],[17.1,61.3],[18.8,60.1],[17.9,59.0],[16.4,57.0],[14.7,56.2],[12.9,55.4],[11.8,57.4],[11.0,58.9],[12.3,60.1],[12.0,61.8],[12.6,64.1],[15.1,66.2],[16.1,67.3],[17.7,68.0],[19.9,68.4],[22.0,68.6],[23.5,67.9],[23.6,66.4],[22.2,65.7]],[[38.8,33.4],[36.8,32.3],[35.8,33.3],[36.4,34.6],[36.7,36.3],[38.2,36.9],[40.7,37.1],[42.3,37.2],[41.4,35.6],[38.8,33.4]],[[14.5,12.9],[13.5,14.4],[15.2,16.6],[15.7,20.0],[15.1,21.3],[14.9,22.9],[19.8,21.5],[23.8,19.6],[23.9,15.6],[22.6,14.9],[22.3,13.4],[22.5,11.7],[21.0,9.5],[19.1,9.1],[18.0,7.9],[16.5,7.7],[15.1,8.4],[14.0,9.5],[15.5,10.0],[15.0,11.6]],[[1.9,6.1],[0.6,6.9],[0.7,8.3],[0.4,10.2],[1.5,9.3],[1.6,6.8]],[[102.6,12.2],[100.8,12.6],[99.5,10.8],[99.2,9.2],[100.3,8.3],[101.0,6.9],[99.5,7.3],[98.5,8.4],[98.6,9.9],[99.6,11.9],[99.2,13.3],[98.4,14.6],[98.9,16.2],[97.9,17.6],[98.3,19.7],[100.1,20.4],[101.3,19.5],[101.1,17.5],[103.0,18.0],[104.7,17.4],[105.6,15.6],[104.3,14.4],[102.3,13.4]],[[71.0,40.2],[69.6,40.1],[71.8,39.3],[73.7,39.4],[74.9,38.4],[73.9,37.4],[72.2,36.9],[71.2,38.0],[69.5,37.6],[68.1,37.0],[68.2,38.9],[69.0,40.1],[70.7,41.0]],[[61.2,35.7],[59.2,37.4],[57.3,38.0],[55.5,38.0],[53.9,37.2],[53.9,39.0],[52.7,40.0],[54.7,41.0],[53.7,42.1],[55.5,41.3],[57.1,41.3],[58.6,42.8],[60.0,42.2],[61.5,41.3],[62.4,40.1],[64.2,38.9],[66.5,38.0],[64.7,37.1],[63.2,35.9],[61.2,35.7]],[[9.5,30.3],[9.1,32.1],[7.6,33.3],[8.1,34.7],[8.2,36.4],[9.5,37.3],[11.0,37.1],[10.9,35.7],[10.1,34.3],[11.1,33.3],[10.6,31.8],[10.0,30.5]],[[36.9,41.3],[38.3,40.9],[40.4,41.0],[42.6,41.6],[43.8,40.7],[44.8,39.7],[44.4,38.3],[42.8,37.4],[41.2,37.1],[39.5,36.7],[37.1,36.6],[35.6,36.6],[34.0,36.2],[32.5,36.1],[30.6,36.7],[28.7,36.7],[27.0,37.7],[26.2,39.5],[27.3,40.4],[28.8,40.5],[31.1,41.1],[33.5,42.0],[35.2,42.0],[36.9,41.3]],[[27.2,40.7],[26.1,41.8],[28.0,42.0],[27.2,40.7]],[[33.9,-0.9],[37.7,-3.1],[39.2,-4.7],[38.8,-6.5],[39.3,-8.0],[39.9,-10.1],[38.4,-11.3],[36.8,-11.6],[35.3,-11.4],[34.3,-10.2],[32.8,-9.2],[31.2,-8.6],[30.2,-7.1],[29.4,-5.9],[29.3,-4.5],[30.5,-3.6],[30.8,-1.7],[33.9,-0.9]],[[31.9,-1.0],[30.4,-1.1],[29.9,0.6],[30.9,1.8],[30.8,3.5],[32.7,3.8],[34.5,3.6],[35.0,1.9],[34.2,0.5],[33.9,-0.9],[31.9,-1.0]],[[31.8,52.1],[33.8,52.3],[35.0,51.2],[36.6,50.2],[38.0,49.9],[40.1,49.6],[39.9,48.2],[38.3,47.5],[36.8,46.7],[35.0,46.3],[36.5,45.5],[35.2,44.9],[33.3,44.6],[33.3,46.1],[31.7,46.3],[29.6,45.3],[28.2,45.5],[29.8,46.3],[29.1,47.8],[27.5,48.5],[25.9,48.0],[24.4,48.0],[22.7,47.9],[22.5,49.5],[23.9,50.4],[24.6,51.9],[26.3,51.8],[28.2,51.6],[30.2,51.4],[31.8,52.1]],[[-57.6,-30.2],[-56.0,-30.9],[-54.6,-31.5],[-53.2,-32.7],[-53.8,-34.4],[-55.7,-34.8],[-57.1,-34.4],[-58.3,-33.3],[-57.9,-31.0]],[[-94.8,49.4],[-93.6,48.6],[-91.6,48.1],[-89.6,48.0],[-87.4,47.9],[-85.7,47.2],[-84.3,46.4],[-82.6,45.3],[-82.1,43.6],[-82.9,42.4],[-81.3,42.2],[-78.9,42.9],[-76.8,43.6],[-75.3,44.8],[-73.3,45.0],[-71.5,45.0],[-70.3,45.9],[-69.2,47.4],[-67.8,47.1],[-67.1,45.1],[-69.1,44.0],[-70.6,43.1],[-70.0,41.6],[-71.9,41.3],[-73.7,40.9],[-72.2,41.1],[-74.0,40.6],[-74.9,38.9],[-75.9,37.2],[-76.3,39.1],[-76.3,37.0],[-75.7,35.6],[-77.4,34.5],[-79.1,33.5],[-80.3,32.5],[-81.3,31.4],[-81.0,29.2],[-80.1,26.9],[-80.4,25.2],[-81.7,25.9],[-82.7,27.5],[-82.9,29.1],[-84.1,30.1],[-85.8,30.2],[-87.5,30.3],[-89.2,30.3],[-90.2,29.1],[-91.6,29.7],[-93.2,29.8],[-94.7,29.5],[-96.6,28.3],[-97.4,26.7],[-99.0,26.4],[-100.1,28.1],[-101.0,29.4],[-102.5,29.8],[-103.9,29.3],[-105.0,30.6],[-106.5,31.8],[-108.2,31.8],[-111.0,31.3],[-113.3,32.0],[-114.8,32.5],[-117.1,32.5],[-118.4,33.7],[-120.4,34.4],[-121.7,36.2],[-122.5,37.6],[-123.7,39.0],[-124.4,40.3],[-124.2,42.0],[-124.1,43.7],[-123.9,45.5],[-124.1,46.9],[-124.7,48.2],[-123.1,48.0],[-120,49],[-117.0,49],[-113,49],[-110.0,49],[-107.0,49],[-104.0,49.0],[-100.7,49],[-97.2,49.0],[-95.2,49]],[[-155.1,71.1],[-152.2,70.8],[-150.7,70.4],[-147.6,70.2],[-145.7,70.1],[-143.6,70.2],[-142.1,69.9],[-141.0,66.0],[-141.0,60.3],[-139.0,60.0],[-137.5,58.9],[-135.5,59.8],[-134.3,58.9],[-132.7,57.7],[-131.7,56.6],[-130.0,55.9],[-132.0,55.5],[-133.5,57.2],[-135.0,58.2],[-136.6,58.2],[-139.9,59.5],[-142.6,60.1],[-144.0,60.0],[-145.9,60.5],[-148.2,60.7],[-149.7,59.7],[-151.7,59.2],[-151.4,60.7],[-154.0,59.4],[-155.3,57.7],[-156.6,57.0],[-158.1,56.5],[-159.6,55.6],[-161.2,55.4],[-163.1,54.7],[-164.8,54.4],[-162.9,55.3],[-160.6,56.0],[-158.7,57.0],[-157.6,58.3],[-159.1,58.4],[-160.4,59.1],[-162.0,58.7],[-163.8,59.8],[-165.3,60.5],[-165.7,62.1],[-164.6,63.1],[-163.1,63.1],[-161.5,63.5],[-160.8,64.8],[-162.5,64.6],[-165.0,64.4],[-166.4,64.7],[-168.1,65.7],[-166.7,66.1],[-164.5,66.6],[-161.7,66.1],[-163.7,67.1],[-165.4,68.0],[-166.8,68.4],[-164.4,68.9],[-162.9,69.9],[-160.9,70.4],[-159.0,70.9],[-156.6,71.4],[-155.1,71.1]],[[66.5,37.4],[65.2,38.4],[63.5,39.4],[61.9,41.1],[60.5,41.2],[58.6,42.8],[56.9,41.8],[55.9,45.0],[58.5,45.6],[60.2,44.8],[62.0,43.5],[64.9,43.7],[66.0,42.0],[68.0,41.1],[70.4,42.1],[71.9,41.4],[71.0,40.2],[69.3,40.7],[68.5,39.5],[67.8,37.1]],[[-71.3,11.8],[-71.6,10.4],[-70.2,11.4],[-68.2,10.9],[-66.2,10.6],[-64.3,10.4],[-61.9,10.7],[-60.8,9.4],[-59.8,8.4],[-60.3,7.0],[-61.4,6.0],[-61.0,4.5],[-62.8,4.0],[-64.6,4.1],[-64.3,2.5],[-65.4,1.1],[-66.9,1.3],[-67.8,2.8],[-67.8,4.5],[-67.3,6.1],[-69.0,6.2],[-70.7,7.1],[-72.2,7.3],[-72.8,9.1],[-72.9,10.5],[-72.0,11.6]],[[108.1,21.6],[106.7,20.7],[105.7,19.1],[107.4,16.7],[108.9,15.3],[109.3,13.4],[109.2,11.7],[107.2,10.4],[105.2,8.6],[104.3,10.5],[106.2,11.0],[107.5,12.3],[107.4,14.2],[107.3,15.9],[105.9,17.5],[105.1,18.7],[104.4,20.8],[102.8,21.7],[104.5,22.8],[106.7,22.8],[108.1,21.6]],[[53.1,16.7],[52.2,15.6],[49.6,14.7],[48.2,13.9],[46.7,13.4],[45.1,13.0],[43.5,12.6],[43.1,14.1],[42.7,15.7],[43.1,17.1],[45.2,17.4],[46.7,17.3],[48.2,18.2],[52.0,19.0],[52.8,17.3]],[[31.5,-29.3],[30.6,-30.4],[28.9,-32.2],[27.5,-33.2],[25.9,-33.7],[23.6,-33.8],[21.5,-34.3],[20.1,-34.8],[18.4,-34.0],[17.9,-32.6],[17.6,-30.7],[16.3,-28.6],[17.8,-28.9],[19.9,-28.5],[19.9,-24.8],[20.8,-25.9],[22.6,-26.0],[24.2,-25.7],[25.7,-25.5],[26.8,-24.2],[28.0,-22.8],[29.4,-22.1],[31.2,-22.3],[31.7,-23.7],[31.8,-25.5],[30.7,-26.4],[31.9,-27.2],[32.2,-28.8]],[[32.8,-9.2],[33.5,-10.5],[33.3,-12.4],[32.7,-13.7],[30.2,-14.8],[28.9,-16.0],[27.6,-17.3],[25.3,-17.7],[23.2,-17.5],[21.9,-16.1],[21.9,-12.9],[24.0,-12.9],[24.0,-11.2],[25.4,-11.3],[27.2,-11.6],[28.5,-12.7],[28.5,-10.8],[28.4,-9.2],[30.3,-8.2],[31.6,-8.8]],[[31.2,-22.3],[29.8,-22.1],[28.0,-21.5],[26.2,-19.3],[25.3,-17.7],[26.7,-18.0],[28.5,-16.5],[30.3,-15.5],[31.6,-16.1],[32.8,-18.0],[32.6,-19.4],[32.2,-21.1],[31.2,-22.3]]];
function globeProject(lon,lat,cx,cy,r){let d=Math.PI/180,la=lat*d,lo=(lon-globeRotation.lon)*d,cl=Math.cos(la),x=cl*Math.sin(lo),y=Math.sin(la)*Math.cos(globeRotation.lat*d)-cl*Math.cos(lo)*Math.sin(globeRotation.lat*d),z=Math.sin(la)*Math.sin(globeRotation.lat*d)+cl*Math.cos(lo)*Math.cos(globeRotation.lat*d);return{x:cx+r*x,y:cy-r*y,z}}
function drawGlobe(){let canvas=document.getElementById('globeCanvas');if(!canvas)return;let box=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=box.width,h=box.height;if(w<2||h<2)return;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}let c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);let cx=w/2,cy=h/2-5,r=Math.min(w*.42,h*.44)*globeZoom,dark=matchMedia('(prefers-color-scheme:dark)').matches;let ocean=c.createRadialGradient(cx-r*.35,cy-r*.45,r*.08,cx,cy,r);ocean.addColorStop(0,dark?'#272735':'#e9edf2');ocean.addColorStop(.68,dark?'#1c1c27':'#dce4eb');ocean.addColorStop(1,dark?'#12121a':'#c9d4dd');c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.fillStyle=ocean;c.shadowColor=dark?'#5c587f':'#8aa8ba';c.shadowBlur=22;c.fill();c.shadowBlur=0;c.save();c.beginPath();c.arc(cx,cy,r-1,0,Math.PI*2);c.clip();c.strokeStyle=dark?'rgba(150,205,240,.14)':'rgba(255,255,255,.28)';c.lineWidth=.7;for(let lat=-60;lat<=60;lat+=30){c.beginPath();let pen=false;for(let lon=-180;lon<=180;lon+=3){let p=globeProject(lon,lat,cx,cy,r);if(p.z>0){pen?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);pen=true}else pen=false}c.stroke()}for(let lon=-180;lon<180;lon+=30){c.beginPath();let pen=false;for(let lat=-88;lat<=88;lat+=3){let p=globeProject(lon,lat,cx,cy,r);if(p.z>0){pen?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);pen=true}else pen=false}c.stroke()}c.fillStyle=dark?'#252532':'#d3d9de';c.strokeStyle=dark?'#55536a':'#9aa8b2';c.lineWidth=1;globeLand.forEach(poly=>{let visible=poly.map(q=>globeProject(q[0],q[1],cx,cy,r)).filter(q=>q.z>-.04);if(visible.length<3)return;c.beginPath();visible.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();c.fill();c.stroke()});let rows=globeData.rows.filter(x=>x.total>0&&!/(^|\\s)DIRECT(?:$|[-_\\s])|直连/i.test(x.name)),grouped={};rows.forEach((x,i)=>{let m=regions.find(v=>v[0].test(x.name)),label=m?m[2]:'其他',key=label==='其他'?label+i:label;if(!grouped[key])grouped[key]={label,total:0,count:0};grouped[key].total+=x.total;grouped[key].count++});let active=Object.values(grouped).sort((a,b)=>b.total-a.total).slice(0,12),hub=globeProject(...globeLocations['本机'],cx,cy,r);active.forEach((x,i)=>{let ll=globeLocations[x.label]||[i*37-150,(i%5)*18-35],p=globeProject(ll[0],ll[1],cx,cy,r),routeColors=['#7d70ee','#28a97b','#e7a329','#25a2c5','#df6470'],color=routeColors[i%routeColors.length];if(p.z<=0)return;if(hub.z>0){let qx=(hub.x+p.x)/2,qy=Math.min(hub.y,p.y)-22,offset=-((Date.now()/38+i*7)%18);c.save();c.beginPath();c.moveTo(hub.x,hub.y);c.quadraticCurveTo(qx,qy,p.x,p.y);c.setLineDash([1.2,3.1]);c.lineDashOffset=0;c.lineCap='round';c.lineWidth=1;c.strokeStyle=color;c.globalAlpha=.28;c.stroke();c.beginPath();c.moveTo(hub.x,hub.y);c.quadraticCurveTo(qx,qy,p.x,p.y);c.setLineDash([1.2,16.8]);c.lineDashOffset=offset;c.lineWidth=1.45;c.strokeStyle=color;c.globalAlpha=.95;c.shadowColor=color;c.shadowBlur=6;c.stroke();c.restore()}let size=Math.max(3,Math.min(8,3+Math.sqrt(x.total/Math.max(1,globeData.total))*12));c.beginPath();c.arc(p.x,p.y,size+5,0,Math.PI*2);c.fillStyle=color+'33';c.fill();c.beginPath();c.arc(p.x,p.y,size,0,Math.PI*2);c.fillStyle=color;c.fill();c.strokeStyle=dark?'#ddddea':'#ffffff';c.lineWidth=1.4;c.stroke();let right=p.x<cx,labelX=p.x+(right?10:-10);c.textAlign=right?'left':'right';c.font='600 11px -apple-system';c.lineWidth=3;c.strokeStyle=dark?'#16161e':'#edf1f4';c.fillStyle=dark?'#e7e5ed':'#30343a';let title=x.label+(x.count>1?' ×'+x.count:'');c.strokeText(title,labelX,p.y-3);c.fillText(title,labelX,p.y-3);c.font='10px -apple-system';c.fillStyle=dark?'#aaa6b2':'#66717a';let value=bytes(x.total);c.strokeText(value,labelX,p.y+9);c.fillText(value,labelX,p.y+9)});if(hub.z>0){c.beginPath();c.arc(hub.x,hub.y,5,0,Math.PI*2);c.fillStyle='#7d70ee';c.fill();c.textAlign='right';c.font='600 11px -apple-system';c.fillStyle=dark?'#e7e5ed':'#30343a';c.strokeStyle=dark?'#16161e':'#edf1f4';c.lineWidth=3;c.strokeText('本机',hub.x-8,hub.y-7);c.fillText('本机',hub.x-8,hub.y-7)}c.restore();let shine=c.createLinearGradient(cx-r,cy-r,cx+r,cy+r);shine.addColorStop(0,'rgba(255,255,255,.38)');shine.addColorStop(.45,'rgba(255,255,255,0)');shine.addColorStop(1,'rgba(0,0,0,.24)');c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.fillStyle=shine;c.fill();c.fillStyle=dark?'#aaa6b2':'#77757e';c.font='12px -apple-system';c.textAlign='center';c.fillText(globeZoom.toFixed(2)+'×',w-27,h-10)}
let globeFrame=0;function scheduleGlobeDraw(){if(globeFrame)return;globeFrame=requestAnimationFrame(()=>{globeFrame=0;drawGlobe()})}function bindGlobe(){let canvas=document.getElementById('globeCanvas');if(!canvas||canvas.dataset.bound)return;canvas.dataset.bound='1';canvas.addEventListener('pointerdown',e=>{globeDrag={x:e.clientX,y:e.clientY,lon:globeRotation.lon,lat:globeRotation.lat};canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(!globeDrag)return;globeRotation.lon=globeDrag.lon-(e.clientX-globeDrag.x)*.45;globeRotation.lat=Math.max(-70,Math.min(70,globeDrag.lat+(e.clientY-globeDrag.y)*.35));scheduleGlobeDraw()});let end=()=>globeDrag=null;canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);$('globeMinus').onclick=()=>{globeZoom=Math.max(.75,globeZoom-.15);drawGlobe()};$('globeReset').onclick=()=>{globeRotation={lon:-105,lat:-18};globeZoom=1;drawGlobe()};$('globePlus').onclick=()=>{globeZoom=Math.min(1.45,globeZoom+.15);drawGlobe()};let media=matchMedia('(prefers-color-scheme:dark)');if(!window.globeThemeBound){window.globeThemeBound=true;media.addEventListener?media.addEventListener('change',scheduleGlobeDraw):media.addListener(scheduleGlobeDraw)}if(!window.globeResizeBound){window.globeResizeBound=true;if(window.ResizeObserver)new ResizeObserver(scheduleGlobeDraw).observe($('world'));else window.addEventListener('resize',scheduleGlobeDraw)}}let globeRouteTimer=0;function setGlobeAnimating(enabled){if(globeRouteTimer){clearInterval(globeRouteTimer);globeRouteTimer=0}if(enabled&&!matchMedia('(prefers-reduced-motion:reduce)').matches)globeRouteTimer=setInterval(scheduleGlobeDraw,180)}
function renderGlobe(r,total){globeData={rows:r,total};let world=$('world');if(!document.getElementById('globeCanvas'))world.innerHTML='<canvas id="globeCanvas" aria-label="可旋转的全球节点流量地球"></canvas><div class="globeControls"><button id="globeMinus" aria-label="缩小">−</button><button id="globeReset" aria-label="复位">↶</button><button id="globePlus" aria-label="放大">＋</button></div>';bindGlobe();drawGlobe()}
function renderChart(){let p=state.history||[],w=350,h=135;if(p.length<2){$('chart').innerHTML='<p class="note" style="margin:35px 0;text-align:center;font-size:13px">运行一分钟后开始记录趋势</p>';return}let max=Math.max(...p.map(x=>x.memory))/1048576,min=Math.min(...p.map(x=>x.memory))/1048576,range=Math.max(1,max-min),points=p.map((x,i)=>{let X=8+i/(p.length-1)*334,Y=125-(x.memory/1048576-min)/range*105;return [X,Y]}),line=points.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '),area=line+' L '+points.at(-1)[0]+' 130 L 8 130 Z';$('chart').innerHTML='<svg viewBox="0 0 350 135"><path d="'+area+'" fill="var(--purple)" opacity=".16"/><path d="'+line+'" fill="none" stroke="var(--purple)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+points.at(-1)[0]+'" cy="'+points.at(-1)[1]+'" r="4" fill="var(--purple)"/></svg>'}function render(){let r=rows(),total=r.reduce((a,x)=>a+x.total,0),direct=r.filter(x=>/^DIRECT|直连/i.test(x.name)).reduce((a,x)=>a+x.total,0);$('updated').textContent=state.connected?'更新于 '+new Date(state.updatedAt).toLocaleTimeString('zh-CN',{hour12:false}):state.error;$('mode').textContent=mode(state.mode);$('memory').innerHTML=bytes(state.memory).replace(' ','<span class="unit"> ')+'</span>';$('uptime').textContent=uptime(state.uptime);$('download').textContent=bytes(state.downloadSpeed,'/s');$('active').textContent=Math.round(state.activeRequests||0);$('failed').textContent='失败率 '+Math.round((state.failedRequests||0)/Math.max(1,(state.activeRequests||0)+(state.failedRequests||0))*100)+'%（'+(state.failedRequests||0)+'）';$('chartValue').textContent=bytes(state.memory);$('dns').textContent=Math.round(state.dnsCacheEntries||0);$('vip').textContent=state.virtualIPs||0;$('temp').textContent=state.temporaryRules||0;$('ban').textContent=state.activeBans||0;$('modeLarge').textContent=mode(state.mode);$('online').textContent=state.connected?'Core 在线':'Core 离线';$('totalDown').textContent=bytes(r.reduce((a,x)=>a+x.download,0));$('totalUp').textContent=bytes(r.reduce((a,x)=>a+x.upload,0));$('downRate').textContent='当前 '+bytes(state.downloadSpeed,'/s');$('upRate').textContent='当前 '+bytes(state.uploadSpeed,'/s');renderGlobe(r,total);let globeMeta=$('world').querySelector('.globeMeta');if(globeMeta)globeMeta.remove();$('split').innerHTML='<div class="row"><strong>直连</strong><span class="right">'+bytes(direct)+' · '+(total?Math.round(direct/total*100):0)+'%</span></div><div class="bar"><div class="fill" style="width:'+(total?direct/total*100:0)+'%"></div></div><div class="row"><strong>代理</strong><span class="right">'+bytes(total-direct)+' · '+(total?Math.round((total-direct)/total*100):0)+'%</span></div><div class="bar"><div class="fill" style="width:'+(total?(total-direct)/total*100:0)+'%"></div></div>';$('groups').innerHTML=(state.groups||[]).map((g,i)=>'<article class="groupCard" data-group-index="'+i+'"><div class="groupTitle"><strong class="groupName">'+esc(g.name)+'</strong><span class="groupDelay">'+(g.latency?Math.round(g.latency)+' ms':'—')+'</span></div><span class="groupType">'+esc(g.type)+'</span><span class="groupCurrent">当前：'+esc(g.selected||'—')+'</span><span class="groupMembers">'+esc((g.policies||[]).slice(0,3).join(' · '))+((g.policies||[]).length>3?' · …':'')+'</span><span class="groupMeta">'+g.optionCount+' 个节点</span></article>').join('')||'<p class="note" style="grid-column:1/-1">当前接口未返回策略组详情</p>';document.querySelectorAll('.groupCard').forEach(card=>card.onclick=()=>openPolicyDetail(Number(card.dataset.groupIndex)));$('ranks').innerHTML=(expanded?r:r.slice(0,8)).map((x,i)=>'<div class="row"><span><strong>'+(i+1)+'. '+esc(x.name)+'</strong><small>↓ '+bytes(x.download)+'　↑ '+bytes(x.upload)+'</small></span><span class="right">'+bytes(x.total)+'<small>'+(total?(x.total/total*100).toFixed(1):0)+'%</small></span></div>').join('')||'<p class="note">暂无节点流量数据</p>';$('expand').style.display=r.length>8?'block':'none';$('expand').textContent=expanded?'收起节点':'显示全部 '+r.length+' 个节点';$('deviceInterfaces').innerHTML=(state.networkInterfaces||[]).map(x=>'<div class="row" style="align-items:flex-start"><span><strong>'+esc(x.name)+'</strong>'+(x.ipv4.length?'<small>IPv4 Address: '+esc(x.ipv4.join(' · '))+'</small>':'')+(x.ipv6.length?'<small>IPv6 Address: '+esc(x.ipv6.join(' · '))+'</small>':'')+'</span></div>').join('')||'<p class="note">Surge 当前未返回主网络接口</p>';$('trafficStartTime').textContent=state.trafficStartTime?new Date(state.trafficStartTime).toLocaleString('zh-CN',{hour12:false}):'—';$('trafficUptime').textContent=state.trafficStartTime?uptime((Date.now()-state.trafficStartTime)/1000):uptime(state.uptime);let interfaceName=n=>n==='lo0'?'回环网络':/^pdp_ip/.test(n)?'蜂窝网络':/^en\d+$/.test(n)?'Wi-Fi / Ethernet':n;$('realtimeInterfaces').innerHTML=(state.realtimeInterfaces||[]).map(x=>'<div class="row" style="align-items:flex-start"><span><strong>'+esc(interfaceName(x.name))+'</strong><small>'+esc(x.name)+' · ↓ '+bytes(x.download)+'　↑ '+bytes(x.upload)+'</small><small>当前：↓ '+bytes(x.downloadSpeed,'/s')+'　↑ '+bytes(x.uploadSpeed,'/s')+'</small><small>最大：↓ '+bytes(x.maxDownloadSpeed,'/s')+'　↑ '+bytes(x.maxUploadSpeed,'/s')+'</small></span><span class="right">总计 '+bytes(x.download+x.upload)+'</span></div>').join('')||'<p class="note">Surge /v1/traffic 未返回联网方式统计</p>';$('connectorStats').innerHTML=(state.connectorStats||[]).sort((a,b)=>(b.download+b.upload)-(a.download+a.upload)).map(x=>'<div class="row" style="align-items:flex-start"><span><strong>'+esc(x.name)+'</strong><small>↓ '+bytes(x.download)+'　↑ '+bytes(x.upload)+'</small><small>当前：↓ '+bytes(x.downloadSpeed,'/s')+'　↑ '+bytes(x.uploadSpeed,'/s')+'</small></span><span class="right">总计 '+bytes(x.download+x.upload)+'</span></div>').join('')||'<p class="note">Surge /v1/traffic 未返回策略统计</p>';$('interfaces').innerHTML=(state.interfaces||[]).map(x=>'<div class="row"><span><strong>'+esc(x.name)+'</strong><small>↓ '+bytes(x.download)+'　↑ '+bytes(x.upload)+'</small></span><span class="right">'+bytes(x.total)+'</span></div>').join('')||'<p class="note">暂无 Metrics 接口累计</p>';$('networkStatus').textContent=state.connected?'已连接':'未连接';$('source').textContent=state.source==='metrics'?'Metrics':state.source;$('core').innerHTML='<div class="row"><strong>平台</strong><span class="right">'+esc(state.engine.system)+'</span></div><div class="row"><strong>Surge 版本</strong><span class="right">'+esc(state.engine.version)+'</span></div><div class="row"><strong>Build</strong><span class="right">'+esc(state.engine.build)+'</span></div>';$('settings').innerHTML='<div class="row"><strong>API 地址</strong><span class="right">'+esc(state.config.apiBase)+'</span></div><div class="row"><strong>API 密钥</strong><span class="right">••••••••</span></div><div class="row"><strong>刷新间隔</strong><select id="refreshSeconds" class="refreshSelect">'+[5,10,15,20,25,30].map(s=>'<option value="'+s+'"'+(state.config.refreshSeconds===s?' selected':'')+'>'+s+' 秒</option>').join('')+'</select></div><div class="row"><strong>历史保留</strong><span class="right">24 小时</span></div><div class="row"><strong>数据来源</strong><span class="right">'+(state.source==='metrics'?'Surge /v1/metrics':state.source==='traffic'?'Surge /v1/traffic':'未连接')+'</span></div><div class="row"><strong>面板版本</strong><span class="right">V1.5.1</span></div>';let refreshSelect=$('refreshSeconds');if(refreshSelect)refreshSelect.onchange=()=>window.webkit.messageHandlers.native.postMessage('refreshSeconds:'+refreshSelect.value);renderChart()}function setTopAction(page){let button=$('topAction'),icon=$('topActionIcon'),isSettings=page==='settings';button.classList.toggle('min',isSettings);button.classList.remove('refreshing');button.setAttribute('aria-label',isSettings?'收起':'刷新');button.title=isSettings?'收起':'刷新';icon.innerHTML=isSettings?'<path d="m6 9 6 6 6-6"/>':'<path d="M20 11a8 8 0 1 1-2.34-5.66M20 4v7h-7"/>'}window.setActivePage=page=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===page));document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===page));setTopAction(page);setGlobeAnimating(page==='traffic');if(page==='traffic')requestAnimationFrame(()=>requestAnimationFrame(scheduleGlobeDraw));scrollTo(0,0)};render();window.setActivePage('overview');document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>window.setActivePage(b.dataset.tab));$('expand').onclick=()=>{expanded=!expanded;render()};$('clear').onclick=()=>window.webkit.messageHandlers.native.postMessage('clear');$('widgetSettings').onclick=()=>window.webkit.messageHandlers.native.postMessage('widgetSettings');$('reconfig').onclick=()=>window.webkit.messageHandlers.native.postMessage('reconfig');$('close').onclick=()=>window.webkit.messageHandlers.native.postMessage('close');$('topAction').onclick=()=>{let isSettings=document.querySelector('.tab.active').dataset.tab==='settings';if(isSettings){window.webkit.messageHandlers.native.postMessage('minimize');return}$('topAction').classList.add('refreshing');window.webkit.messageHandlers.native.postMessage('refresh')};$('testGroups').onclick=e=>{e.stopPropagation();window.webkit.messageHandlers.native.postMessage('testGroups:'+activePolicyGroup)};$('closePolicyDetail').onclick=closePolicyDetail;$('policyBackdrop').onclick=closePolicyDetail;function openPolicyDetail(index){let g=(state.groups||[])[index];if(!g)return;activePolicyGroup=g.name;$('policyDetailName').textContent=g.name;$('policyDetailSub').textContent=(g.type||'策略组')+' · 当前 '+(g.selected||'—')+' · '+(g.optionCount||0)+' 个节点';$('policyNodes').innerHTML=(g.nodes||g.policies||[]).map(n=>{let node=typeof n==='string'?{name:n,latency:0}:n;return '<article class="policyNode"><strong class="policyNodeName">'+esc(node.name)+'</strong><div class="policyNodeFoot"><span>'+(node.name===g.selected?'当前节点':'节点')+'</span><span class="policyNodeDelay'+(node.latency?' ok':'')+'">'+(node.latency?Math.round(node.latency)+' ms':'未测速')+'</span></div></article>'}).join('')||'<p>当前策略组没有节点</p>';$('policyDetail').classList.add('open');$('policyDetail').setAttribute('aria-hidden','false')}function closePolicyDetail(){activePolicyGroup='';$('policyDetail').classList.remove('open');$('policyDetail').setAttribute('aria-hidden','true')}window.setPolicyTestLoading=v=>{$('testGroups').disabled=!!v;$('testGroups').classList.toggle('testing',!!v);document.querySelectorAll('.policyNodeDelay').forEach(x=>{if(v){x.className='policyNodeDelay testing';x.textContent='测速中'}})};window.showPolicyTestError=m=>{window.setPolicyTestLoading(false);document.querySelectorAll('.policyNodeDelay').forEach(x=>{if(x.textContent==='测速中'){x.className='policyNodeDelay failed';x.textContent='失败'}});$('testGroups').title=m};window.applyNativeUpdate=m=>{state=m;$('topAction').classList.remove('refreshing');render();if(activePolicyGroup){let i=(state.groups||[]).findIndex(g=>g.name===activePolicyGroup);if(i>=0)openPolicyDetail(i)}};</script></body></html>`
}

function Dashboard({ config, onOpenSettings, onOpenWidgetSettings, onChangeRefreshSeconds }: { config: Config; onOpenSettings: () => void; onOpenWidgetSettings: () => void; onChangeRefreshSeconds: (seconds: number) => void }) {
  const initialModel = offlineModel(config, "正在读取 Surge Core…", loadHistory())
  const [model, setModel] = useState<PanelModel>(initialModel)
  const [selectedTab, setSelectedTab] = useState(0)
  const modelRef = useRef<PanelModel>(initialModel)
  const configRef = useRef(config)
  const refreshSecondsRef = useRef(config.refreshSeconds)
  const selectedTabRef = useRef(0)
  const previous = useRef<CoreSnapshot | null>(null)
  const refreshing = useRef(false)
  const policyTesting = useRef(false)
  const requestRevision = useRef(0)
  const webView = useRef(new WebViewController())
  const webLoaded = useRef(false)
  const dismiss = Navigation.useDismiss()
  configRef.current = config
  refreshSecondsRef.current = config.refreshSeconds

  const pushWebModel = async (next: PanelModel): Promise<void> => {
    if (!webLoaded.current) return
    try {
      await webView.current.evaluateJavaScript(`window.applyNativeUpdate && window.applyNativeUpdate(${webJSON(next)})`)
    } catch (error) {
      console.warn(`WebView 更新失败：${readableError(error)}`)
    }
  }

  const runWebScript = async (script: string): Promise<void> => {
    if (!webLoaded.current) return
    try { await webView.current.evaluateJavaScript(script) } catch (error) { console.warn(`WebView 命令失败：${readableError(error)}`) }
  }

  const commitModel = async (next: PanelModel, reloadWidgets = false): Promise<void> => {
    modelRef.current = next
    setModel(next)
    saveWidgetCache(next)
    if (reloadWidgets) Widget.reloadUserWidgets()
    await pushWebModel(next)
  }

  const preserveFailedDetails = (next: PanelModel, previousModel: PanelModel, details: Record<string, unknown | null>): PanelModel => ({
    ...next,
    mode: details.outbound == null ? previousModel.mode : next.mode,
    failedRequests: details.recent == null ? previousModel.failedRequests : next.failedRequests,
    rejectedRequests: details.recent == null ? previousModel.rejectedRequests : next.rejectedRequests,
    virtualIPs: details.dns == null ? previousModel.virtualIPs : next.virtualIPs,
    temporaryRules: details.rules == null ? previousModel.temporaryRules : next.temporaryRules,
    groups: details.groups == null ? previousModel.groups : next.groups,
    networkInterfaces: details.network == null ? previousModel.networkInterfaces : next.networkInterfaces,
    realtimeInterfaces: details.traffic == null ? previousModel.realtimeInterfaces : next.realtimeInterfaces,
    connectorStats: details.traffic == null ? previousModel.connectorStats : next.connectorStats,
    trafficStartTime: details.traffic == null ? previousModel.trafficStartTime : next.trafficStartTime,
  })

  const refreshPolicyLatencies = async (groupName?: string) => {
    if (policyTesting.current || refreshing.current) return
    policyTesting.current = true
    try {
      await runWebScript("window.setPolicyTestLoading && window.setPolicyTestLoading(true)")
      const currentConfig = configRef.current
      const before = await fetchDetails(currentConfig)
      const groupsBefore = sortGroupsLikeSurge(normalizeGroups(before.groups, [before.testResults, before.benchmarkResults], before.policies), before.profile)
      if (!groupsBefore.length) throw new Error("没有可测速的策略组")
      const targets = groupName ? groupsBefore.filter(group => group.name === groupName) : groupsBefore
      if (!targets.length) throw new Error("找不到当前策略组")
      let testResponse: unknown = null
      for (const group of targets) testResponse = await testPolicyGroup(currentConfig, group.name)
      let groups: PolicyGroup[] = []
      let savedResults: unknown = null
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (attempt > 0) await new Promise<void>(resolve => setTimeout(() => resolve(), 500))
        const [groupsRaw, latestResults, benchmarks, policies] = await Promise.all([
          safeJSON(currentConfig, "/v1/policy_groups"), safeJSON(currentConfig, "/v1/policy_groups/test_results"),
          safeJSON(currentConfig, "/v1/policies/benchmark_results"), safeJSON(currentConfig, "/v1/policies"),
        ])
        savedResults = latestResults
        groups = sortGroupsLikeSurge(normalizeGroups(groupsRaw, [testResponse, latestResults, benchmarks], policies), before.profile)
        const current = groupName ? groups.find(group => group.name === groupName) : undefined
        if ((current?.nodes || []).some(node => node.latency > 0)) break
      }
      const currentAfterGroupTest = groupName ? groups.find(group => group.name === groupName) : undefined
      if (currentAfterGroupTest && !currentAfterGroupTest.nodes.some(node => node.latency > 0)) {
        const policyResponse = await testPolicies(currentConfig, currentAfterGroupTest.policies)
        const [groupsRaw, benchmarks] = await Promise.all([
          safeJSON(currentConfig, "/v1/policy_groups"), safeJSON(currentConfig, "/v1/policies/benchmark_results"),
        ])
        groups = sortGroupsLikeSurge(normalizeGroups(groupsRaw, [testResponse, savedResults, benchmarks, policyResponse], null), before.profile)
      }
      if (groups.length) await commitModel({ ...modelRef.current, groups }, true)
    } catch (error) {
      await runWebScript(`window.showPolicyTestError && window.showPolicyTestError(${webJSON(readableError(error))})`)
    } finally {
      policyTesting.current = false
      await runWebScript("window.setPolicyTestLoading && window.setPolicyTestLoading(false)")
    }
  }

  const refresh = async () => {
    if (refreshing.current || policyTesting.current) return
    refreshing.current = true
    const revision = ++requestRevision.current
    try {
      const currentConfig = configRef.current
      const current = await captureCore(currentConfig)
      const details = await fetchDetails(currentConfig)
      let next = buildModel(current, previous.current, details, loadHistory(), currentConfig)
      next = preserveFailedDetails(next, modelRef.current, details)
      if (revision !== requestRevision.current) return
      previous.current = current
      saveHistory(next.history)
      await commitModel(next)
    } catch (error) {
      if (revision !== requestRevision.current) return
      const currentModel = modelRef.current
      const next = currentModel.hasSnapshot
        ? { ...currentModel, connected: false, error: `${readableError(error)} · 显示上次数据` }
        : offlineModel(configRef.current, error, loadHistory())
      await commitModel(next)
    } finally {
      refreshing.current = false
    }
  }

  useEffect(() => {
    Script.enableMinimize()
    const controller = webView.current
    let active = true
    let timer: number | undefined
    const syncSelectedPage = async () => {
      const page = ["overview", "policies", "traffic", "network", "settings"][selectedTabRef.current] || "overview"
      await runWebScript(`window.setActivePage && window.setActivePage(${webJSON(page)})`)
    }
    void (async () => {
      try {
        await controller.addScriptMessageHandler("native", (message?: string) => {
          if (message === "close") { dismiss(); return null }
          if (message === "minimize") { void Script.minimize(); return null }
          if (message === "refresh") { void refresh(); return null }
          if (message?.startsWith("refreshSeconds:")) { onChangeRefreshSeconds(normalizeRefreshSeconds(message.slice("refreshSeconds:".length))); return null }
          if (message === "clear") { Storage.remove(HISTORY_KEY); const next = { ...modelRef.current, history: [] }; void commitModel(next); return null }
          if (message === "reconfig") { onOpenSettings(); return null }
          if (message === "widgetSettings") { onOpenWidgetSettings(); return null }
          if (message === "testGroups" || message?.startsWith("testGroups:")) { void refreshPolicyLatencies(message.slice("testGroups:".length) || undefined); return null }
          return null
        })
        if (!active) return
        await controller.loadHTML(buildPanelHTML(modelRef.current))
        if (!active) return
        webLoaded.current = true
        await syncSelectedPage()
        const poll = async () => {
          try { await refresh() } catch (error) { console.warn(`轮询失败：${readableError(error)}`) }
          finally { if (active) timer = setTimeout(() => { void poll() }, refreshSecondsRef.current * 1000) }
        }
        await poll()
      } catch (error) {
        console.warn(`WebView 初始化失败：${readableError(error)}`)
      }
    })()
    return () => {
      active = false
      webLoaded.current = false
      requestRevision.current += 1
      if (timer != null) clearTimeout(timer)
      controller.dispose()
    }
  }, [])

  const selectTab = (index: number) => {
    selectedTabRef.current = index
    setSelectedTab(index)
    const page = ["overview", "policies", "traffic", "network", "settings"][index] || "overview"
    void runWebScript(`window.setActivePage && window.setActivePage(${webJSON(page)})`)
  }
  const panel = (index: number) => selectedTab === index ? <WebView controller={webView.current} ignoresSafeArea /> : <Spacer />

  return <TabView tabIndex={selectedTab} onTabIndexChanged={selectTab} tabBarMinimizeBehavior="never">
    <Tab title="总览" systemImage="square.grid.2x2.fill" value={0}>{panel(0)}</Tab>
    <Tab title="策略" systemImage="point.3.connected.trianglepath.dotted" value={1}>{panel(1)}</Tab>
    <Tab title="流量" systemImage="chart.bar.fill" value={2}>{panel(2)}</Tab>
    <Tab title="网络" systemImage="globe" value={3}>{panel(3)}</Tab>
    <Tab title="设置" systemImage="gearshape.fill" value={4}>{panel(4)}</Tab>
  </TabView>
}

function App() {
  const [config, setConfig] = useState<Config | null>(loadConfig())
  const openWidgetSettings = () => {
    void Navigation.present({
      element: <WidgetSettingsView initial={loadWidgetSettings()} onSave={() => {}} />,
      modalPresentationStyle: "pageSheet",
    })
  }
  return config ? <Dashboard config={config} onOpenSettings={() => setConfig(null)} onOpenWidgetSettings={openWidgetSettings} onChangeRefreshSeconds={seconds => setConfig(current => {
      if (!current) return current
      const next = { ...current, refreshSeconds: normalizeRefreshSeconds(seconds) }
      saveConfig(next)
      return next
    })} /> : <SetupView initial={loadConfig() || DEFAULT_CONFIG} onSave={setConfig} />
}

async function run() {
  try {
    await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" })
  } finally {
    Script.exit()
  }
}

void run()
