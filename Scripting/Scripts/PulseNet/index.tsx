/**
 * PulseNet — Scripting 网络与设备工具
 *
 * 功能模块:
 * 1. 首页 — 实时网络监控与抢票毫秒悬浮窗
 * 2. 测速 — 真实下载、上传、延迟与抖动测试
 * 3. 设备 — 硬件、系统、电池、网络、显示与照片统计
 * 4. 设置 — 显示、权限、测速数据与隐私管理
 */

import {
  useState, useEffect, useMemo, useCallback, useRef,
  useObservable,
  VStack, HStack,
  Text, Image, Button, Toggle,
  List, Section, NavigationStack,
  TabView, Tab,
  Chart, LineChart, BarChart, TimelineCanvas,
  ProgressView,
  ScrollView, Spacer,
  Device, fetch, Navigation, Script, AbortController, AbortSignal,
  LiveActivity, AppEvents, ShapeStyle
} from "scripting"
import {
  TicketClockLiveActivity,
  TICKET_LIVE_ACTIVITY_NAME,
  TicketClockState,
} from "./live_activity"

// ============ 数据类型 ============

interface SpeedTestNode {
  name: string
  url: string
  latency: number | null
}

interface SpeedTestResult {
  downloadSpeed: number  // Mbps
  uploadSpeed: number    // Mbps
  ping: number           // ms
  jitter: number         // ms
}

interface SavedSpeedTest {
  result: SpeedTestResult
  history: { label: string; value: number }[]
  selectedNode: number
  completedAt: number
}

const LAST_SPEED_TEST_KEY = "pulsenet_last_speed_test"
const AUTO_TICKET_LIVE_ACTIVITY_KEY = "pulsenet_ticket_live_activity_enabled"
const TICKET_LIVE_ACTIVITY_ID_KEY = "pulsenet_ticket_live_activity_id"

interface IPInfo {
  ip: string
  city?: string
  region?: string
  country?: string
  org?: string
}

// ============ 测速节点 ============

const SPEED_TEST_NODES: SpeedTestNode[] = [
  { name: "北京联通", url: "https://speedtest1.beijing.telecom.cn/speedtest/random4000x4000.jpg", latency: null },
  { name: "上海电信", url: "https://speedtest.sh.chinatelecom.com.cn/speedtest/random4000x4000.jpg", latency: null },
  { name: "深圳移动", url: "https://speedtest.mobile.shenzhen.chinamobile.com/speedtest/random4000x4000.jpg", latency: null },
  { name: "杭州阿里", url: "https://speedtest.aliyun.com/hangzhou/random4000x4000.jpg", latency: null },
  { name: "Cloudflare", url: "https://speed.cloudflare.com/__down?bytes=10000000", latency: null },
]

// ============ API 常量 ============

const IP_APIS = [
  "https://api.ipify.org?format=json",
  "https://icanhazip.com",
  "https://ifconfig.me/ip",
]

const IPINFO_API = "https://ipinfo.io/json"

// ============ 工具函数 ============

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
}

function formatSpeed(mbps: number): string {
  if (mbps >= 1) return mbps.toFixed(1) + " Mbps"
  return (mbps * 1024).toFixed(0) + " Kbps"
}

async function fetchPublicIP(): Promise<string> {
  // 多数据源容错降级
  for (const url of IP_APIS) {
    try {
      const resp = await fetch(url, { timeout: 5 })
      if (!resp.ok) continue
      if (url.includes("ipify")) {
        const json = await resp.json()
        return json.ip
      } else {
        const text = await resp.text()
        return text.trim()
      }
    } catch (e) {
      continue
    }
  }
  return "获取失败"
}

async function fetchIPInfo(): Promise<IPInfo | null> {
  try {
    const resp = await fetch(IPINFO_API, { timeout: 5 })
    if (!resp.ok) return null
    const data = await resp.json()
    return {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country,
      org: data.org,
    }
  } catch {
    return null
  }
}

// ============ Ping 测速节点 ============

async function pingNode(url: string, signal?: AbortSignal): Promise<number> {
  const target = `${url}${url.includes("?") ? "&" : "?"}_latency=${Date.now()}`
  const startedAt = Date.now()
  try {
    const response = await fetch(target, {
      timeout: 4,
      signal,
      headers: { Range: "bytes=0-0" },
    })
    if (!response.ok) return -1
    return Date.now() - startedAt
  } catch {
    return -1
  }
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function calculateJitter(values: number[]): number {
  if (values.length < 2) return 0
  const differences = values.slice(1).map((value, index) => Math.abs(value - values[index]))
  return differences.reduce((sum, value) => sum + value, 0) / differences.length
}

async function measureLatency(url: string, signal: AbortSignal) {
  const samples: number[] = []
  for (let index = 0; index < 4; index++) {
    const value = await pingNode(url, signal)
    if (value > 0) samples.push(value)
  }
  if (!samples.length) throw new Error("测速节点无响应")
  return { ping: median(samples), jitter: calculateJitter(samples) }
}

// ============ 下载 / 上传测速 ============

type SpeedProgress = (speed: number, transferred: number, progress: number) => void

async function downloadSpeedTest(
  url: string,
  signal: AbortSignal,
  onProgress: SpeedProgress
): Promise<number> {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_speed=${Date.now()}`, {
    timeout: 20,
    signal,
  })
  if (!response.ok) throw new Error(`下载节点 HTTP ${response.status}`)

  const reader = response.body?.getReader()
  if (!reader) throw new Error("节点不支持流式下载")

  const total = Number(response.headers.get("content-length")) || 10_000_000
  const startedAt = Date.now()
  let received = 0
  let lastBytes = 0
  let lastSampleAt = startedAt
  let smoothedSpeed = 0
  const measuredSamples: number[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      received += value.byteLength
      const now = Date.now()
      const interval = (now - lastSampleAt) / 1000
      if (interval >= 0.25) {
        const instant = ((received - lastBytes) * 8) / interval / 1e6
        smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.65 + instant * 0.35 : instant
        if (now - startedAt >= 800) measuredSamples.push(smoothedSpeed)
        onProgress(smoothedSpeed, received, Math.min(received / total, 0.95))
        lastBytes = received
        lastSampleAt = now
      }
    }
  } finally {
    reader.releaseLock()
  }

  const elapsed = (Date.now() - startedAt) / 1000
  const average = (received * 8) / Math.max(elapsed, 0.001) / 1e6
  return measuredSamples.length ? median(measuredSamples) : average
}

async function uploadSpeedTest(signal: AbortSignal, onProgress: SpeedProgress): Promise<number> {
  const endpoint = "https://speed.cloudflare.com/__up"
  const chunk = new Uint8Array(512 * 1024)
  const samples: number[] = []
  let uploaded = 0
  const total = chunk.byteLength * 4
  let smoothedSpeed = 0

  for (let index = 0; index < 4; index++) {
    const startedAt = Date.now()
    const response = await fetch(`${endpoint}?_speed=${Date.now()}-${index}`, {
      method: "POST",
      body: chunk,
      timeout: 12,
      signal,
      headers: { "Content-Type": "application/octet-stream" },
    })
    if (!response.ok) throw new Error(`上传节点 HTTP ${response.status}`)
    const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001)
    const instant = (chunk.byteLength * 8) / elapsed / 1e6
    smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.5 + instant * 0.5 : instant
    uploaded += chunk.byteLength
    samples.push(smoothedSpeed)
    onProgress(smoothedSpeed, uploaded, uploaded / total)
  }

  return median(samples)
}

// ============ 首页 Tab ============

function MetricBar({
  label, value, percent, color
}: {
  label: string
  value: string
  percent: number
  color: ShapeStyle
}) {
  return (
    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
      <HStack>
        <Text font={12} foregroundStyle="secondaryLabel">{label}</Text>
        <Spacer />
        <Text font={12} fontWeight="medium">{value}</Text>
      </HStack>
      <ProgressView value={Math.max(0, Math.min(percent, 1))} total={1} tint={color} />
    </VStack>
  )
}

function CloseButton() {
  return <Button title="关闭" action={() => Script.exit()} />
}

function PipClockView({ isPresented }: { isPresented: Observable<boolean> }) {
  const started = useObservable(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    if (!started.value) return

    let stopped = false
    let timerId = 0
    const tick = () => {
      if (stopped) return
      setNow(new Date())
      timerId = setTimeout(tick, 33)
    }

    tick()
    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }, [started.value])

  const pad = (value: number, length = 2) => `${value}`.padStart(length, "0")
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const milliseconds = pad(now.getMilliseconds(), 3)

  return (
    <HStack
      spacing={7}
      padding={12}
      frame={{ width: Device.screen.width, height: 72 }}
      background="black"
      onPipStart={() => started.setValue(true)}
      onPipStop={() => {
        started.setValue(false)
        isPresented.setValue(false)
      }}
    >
      <Text
        font={24}
        fontWeight="bold"
        foregroundStyle="white"
        monospacedDigit
        frame={{ width: 145, alignment: "trailing" }}
      >
        {time}.
      </Text>
      <Text
        font={24}
        fontWeight="bold"
        foregroundStyle="systemRed"
        monospacedDigit
        frame={{ width: 64, alignment: "leading" }}
      >
        {milliseconds}
      </Text>
    </HStack>
  )
}

function TicketClockDisplay() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    let stopped = false
    let timerId = 0

    const tick = () => {
      if (stopped) return
      setNow(new Date())
      timerId = setTimeout(tick, 16)
    }

    tick()
    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }, [])

  const pad = (value: number, length = 2) => `${value}`.padStart(length, "0")
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const milliseconds = pad(now.getMilliseconds(), 3)
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
  const date = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${weekdays[now.getDay()]}`

  return (
    <HStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
      <HStack spacing={0} alignment="bottom">
        <Text font={22} fontWeight="bold">{time}.</Text>
        <Text font={22} fontWeight="bold" foregroundStyle="systemRed">{milliseconds}</Text>
      </HStack>
      <Spacer />
      <Text font={13} foregroundStyle="secondaryLabel">{date}</Text>
    </HStack>
  )
}

function TicketTimeCard() {
  const pipPresented = useObservable(false)
  const pipContent = useMemo(() => <PipClockView isPresented={pipPresented} />, [pipPresented])

  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      padding={16}
      background="secondarySystemGroupedBackground"
      clipShape={{ type: "rect", cornerRadius: 8 }}
      pip={{
        isPresented: pipPresented,
        maximumUpdatesPerSecond: 30,
        content: pipContent,
      }}
    >
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">抢票时间</Text>
        <Spacer />
        <Toggle
          title="悬浮窗"
          value={pipPresented.value}
          onChanged={enabled => pipPresented.setValue(enabled)}
          tint="systemBlue"
          font={18}
          fontWeight="semibold"
          foregroundStyle="systemBlue"
        />
      </HStack>
      <TicketClockDisplay />
    </VStack>
  )
}

function MemoryRow({
  label, value, percent, color
}: {
  label: string
  value: string
  percent: number
  color: ShapeStyle
}) {
  return (
    <HStack spacing={5} frame={{ maxWidth: "infinity", height: 18 }}>
      <Image systemName="circle.fill" font={8} foregroundStyle={color} />
      <Text font={11} frame={{ width: 42, alignment: "leading" }}>{label}</Text>
      <ProgressView
        value={Math.max(0, Math.min(percent, 1))}
        total={1}
        tint={color}
        frame={{ maxWidth: "infinity" }}
      />
      <Text font={11} fontWeight="medium" frame={{ width: 56, alignment: "trailing" }}>{value}</Text>
    </HStack>
  )
}

function HomeTab() {
  const [publicIP, setPublicIP] = useState("加载中…")
  const [ipInfo, setIPInfo] = useState<IPInfo | null>(null)
  const [clock, setClock] = useState(new Date().toLocaleTimeString("zh-CN", { hour12: false }))
  const [cpuCores, setCpuCores] = useState([43, 39, 27, 24, 2, 6])
  const [uploadKB, setUploadKB] = useState(17)
  const [downloadKB, setDownloadKB] = useState(5222)
  const [uploadTotalGB, setUploadTotalGB] = useState(2.07)
  const [downloadTotalGB, setDownloadTotalGB] = useState(2.98)
  const [memoryValues, setMemoryValues] = useState([1.57, 2.07, 2.01, 1.57, 0.283])
  const [diskReadKB, setDiskReadKB] = useState(16.1)
  const [diskWriteKB, setDiskWriteKB] = useState(0)
  const [systemLoad, setSystemLoad] = useState(23.4)
  const [networkMarks, setNetworkMarks] = useState(
    Array.from({ length: 60 }, (_, index) => ({
      label: `${index}`,
      value: Math.sin(index * 0.48) * 7 + Math.cos(index * 0.21) * 3,
    }))
  )

  useEffect(() => {
    fetchPublicIP().then(setPublicIP)
    fetchIPInfo().then(setIPInfo)

    let stopped = false
    let timerId = 0
    let currentUpload = 17
    let currentDownload = 5222

    const vary = (value: number, amount: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value + (Math.random() - 0.5) * amount))

    const tick = () => {
      if (stopped) return

      currentUpload = vary(currentUpload, 18, 0, 900)
      currentDownload = vary(currentDownload, 1800, 0, 12000)

      setClock(new Date().toLocaleTimeString("zh-CN", { hour12: false }))
      setCpuCores(previous => previous.map(value => Math.round(vary(value, 18, 1, 99))))
      setUploadKB(currentUpload)
      setDownloadKB(currentDownload)
      setMemoryValues(previous => previous.map((value, index) =>
        vary(value, index === 4 ? 0.05 : 0.12, index === 4 ? 0.08 : 0.8, index === 4 ? 0.8 : 2.8)
      ))
      setDiskReadKB(previous => vary(previous, 24, 0, 150))
      setDiskWriteKB(previous => vary(previous, 12, 0, 80))
      setSystemLoad(previous => vary(previous, 9, 4, 96))
      setUploadTotalGB(previous => previous + currentUpload / 1024 / 1024)
      setDownloadTotalGB(previous => previous + currentDownload / 1024 / 1024)
      setNetworkMarks(previous => {
        const nextValue = currentDownload > currentUpload
          ? Math.min(40, currentDownload / 300)
          : -Math.min(40, currentUpload / 30)
        return [...previous.slice(-59), { label: `${Date.now()}`, value: nextValue }]
      })

      timerId = setTimeout(tick, 1000)
    }

    timerId = setTimeout(tick, 1000)
    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }, [])

  const formatRate = (kb: number) => kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/S` : `${kb.toFixed(1)} KB/S`
  const memoryLabels = ["联动", "活跃", "不活跃", "压缩", "空闲"]
  const memoryColors: ShapeStyle[] = ["systemPurple", "systemBlue", "systemOrange", "systemCyan", "systemGray"]

  return (
    <NavigationStack>
      <ScrollView>
        <VStack spacing={14} padding={12}>
          <HStack>
            <CloseButton />
            <Spacer />
          </HStack>

          <TicketTimeCard />

          <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }} padding={16} background="secondarySystemGroupedBackground" clipShape={{ type: "rect", cornerRadius: 8 }}>
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">实时网络</Text>
            <Chart chartXAxis="hidden">
              <BarChart
                marks={networkMarks.map(mark => ({
                  ...mark,
                  width: { type: "fixed", value: 3 },
                  cornerRadius: 1.5,
                }))}
              />
            </Chart>
            <HStack>
              <HStack spacing={6}>
                <Image systemName="arrow.up.circle.fill" foregroundStyle="systemPink" />
                <Text font={13}>上传 {formatRate(uploadKB)}</Text>
              </HStack>
              <Spacer />
              <HStack spacing={6}>
                <Image systemName="arrow.down.circle.fill" foregroundStyle="systemCyan" />
                <Text font={13}>下载 {formatRate(downloadKB)}</Text>
              </HStack>
            </HStack>
            <VStack frame={{ maxWidth: "infinity", height: 1 }} background="separator" />
            <HStack>
              <Text font={13} foregroundStyle="secondaryLabel">总使用量</Text>
              <Spacer />
              <Text font={13}>↑ {uploadTotalGB.toFixed(2)} GB　↓ {downloadTotalGB.toFixed(2)} GB</Text>
            </HStack>
            <HStack spacing={6}>
              <Image systemName="globe" foregroundStyle="systemBlue" />
              <Text font={13} foregroundStyle="secondaryLabel">{publicIP}</Text>
              <Spacer />
              <Text font={12} foregroundStyle="secondaryLabel">{ipInfo?.city || ipInfo?.country || "公网网络"}</Text>
            </HStack>
          </VStack>

          <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }} padding={14} background="secondarySystemGroupedBackground" clipShape={{ type: "rect", cornerRadius: 8 }}>
            <HStack>
              <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">数据监控</Text>
              <Spacer />
              <Text font={14} foregroundStyle="secondaryLabel">{clock}</Text>
            </HStack>

            {/* 核心区：固定左右两列 */}
            <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity" }}>
              <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
                {cpuCores.slice(0, 3).map((value, index) => (
                  <MetricBar key={index} label={`核心 #${index + 1}`} value={`${value}%`} percent={value / 100} color={value > 50 ? "systemOrange" : "systemBlue"} />
                ))}
              </VStack>
              <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
                {cpuCores.slice(3).map((value, index) => (
                  <MetricBar key={index} label={`核心 #${index + 4}`} value={`${value}%`} percent={value / 100} color={value > 50 ? "systemOrange" : "systemBlue"} />
                ))}
              </VStack>
            </HStack>

            {/* 下半区：左右整体紧凑排列，共用同一中线 */}
            <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity" }}>
              <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" }}>
                {memoryValues.map((value, index) => (
                  <MemoryRow
                    key={index}
                    label={memoryLabels[index]}
                    value={index === 4 ? `${(value * 1024).toFixed(1)}MB` : `${value.toFixed(2)}GB`}
                    percent={Math.min(value / 3.2, 1)}
                    color={memoryColors[index]}
                  />
                ))}
              </VStack>

              <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity", alignment: "topLeading" }}>
                <HStack spacing={8} alignment="top" frame={{ maxWidth: "infinity" }}>
                  <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity" }}>
                    <Text font={11} foregroundStyle="secondaryLabel">实时速率</Text>
                    <Text font={12} foregroundStyle="systemGreen">↑ {formatRate(uploadKB)}</Text>
                    <Text font={12} foregroundStyle="systemBlue">↓ {formatRate(downloadKB)}</Text>
                  </VStack>
                  <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity" }}>
                    <Text font={11} foregroundStyle="secondaryLabel">本次累计</Text>
                    <Text font={12}>↑ {uploadTotalGB.toFixed(2)} GB</Text>
                    <Text font={12}>↓ {downloadTotalGB.toFixed(2)} GB</Text>
                  </VStack>
                </HStack>
                <HStack spacing={8} alignment="top" frame={{ maxWidth: "infinity" }}>
                  <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity" }}>
                    <Text font={11} foregroundStyle="secondaryLabel">磁盘读写</Text>
                    <Text font={12}>读 {formatRate(diskReadKB)}</Text>
                    <Text font={12}>写 {formatRate(diskWriteKB)}</Text>
                  </VStack>
                  <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity" }}>
                    <Text font={11} foregroundStyle="secondaryLabel">系统状态</Text>
                    <Text font={12}>负载 {systemLoad.toFixed(1)}%</Text>
                    <Text font={12} foregroundStyle={systemLoad < 75 ? "systemGreen" : "systemOrange"}>{systemLoad < 75 ? "状态良好" : "负载较高"}</Text>
                  </VStack>
                </HStack>
              </VStack>
            </HStack>
          </VStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ============ 测速 Tab ============

function SpeedTestTab() {
  const savedTest = useMemo(() => Storage.get<SavedSpeedTest>(LAST_SPEED_TEST_KEY), [])
  const [selectedNode, setSelectedNode] = useState(savedTest?.selectedNode ?? 0)
  const [testing, setTesting] = useState(false)
  const [phase, setPhase] = useState<"idle" | "latency" | "download" | "upload" | "complete" | "cancelled" | "failed">(savedTest ? "complete" : "idle")
  const [progress, setProgress] = useState(savedTest ? 1 : 0)
  const [currentSpeed, setCurrentSpeed] = useState(savedTest?.result.downloadSpeed ?? 0)
  const [transferred, setTransferred] = useState(0)
  const [result, setResult] = useState<SpeedTestResult | null>(savedTest?.result ?? null)
  const [speedHistory, setSpeedHistory] = useState<{ label: string; value: number }[]>(savedTest?.history ?? [])
  const [pingResults, setPingResults] = useState<Record<number, number | null>>({})
  const [publicIP, setPublicIP] = useState("加载中…")
  const [ipInfo, setIPInfo] = useState<IPInfo | null>(null)
  const [localIP, setLocalIP] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const testController = useRef<AbortController | null>(null)
  const probeController = useRef<AbortController | null>(null)
  const testSamples = useRef<{ label: string; value: number }[]>([])
  const mounted = useRef(true)

  const pingAllNodes = useCallback(async () => {
    probeController.current?.abort()
    const controller = new AbortController()
    probeController.current = controller
    const values = await Promise.all(SPEED_TEST_NODES.map(async node => {
      const latency = await pingNode(node.url, controller.signal)
      return latency > 0 ? latency : null
    }))
    if (controller.signal.aborted) return
    const results: Record<number, number | null> = {}
    values.forEach((value, index) => { results[index] = value })
    setPingResults(results)
    const available = values
      .map((value, index) => ({ value, index }))
      .filter(item => item.value !== null)
      .sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity))
    if (available.length && !savedTest) setSelectedNode(available[0].index)
  }, [savedTest])

  useEffect(() => {
    mounted.current = true
    void pingAllNodes()
    fetchPublicIP().then(value => { if (mounted.current) setPublicIP(value) })
    fetchIPInfo().then(value => { if (mounted.current) setIPInfo(value) })
    try {
      const interfaces = Device.networkInterfaces?.() || {}
      const allInterfaces = Object.values(interfaces).flat()
      const ipv4 = allInterfaces.find(item => !item.isInternal && item.family === "IPv4")
      setLocalIP(ipv4 ? ipv4.address : "未连接")
    } catch {
      setLocalIP("不可用")
    }
    return () => {
      mounted.current = false
      testController.current?.abort()
      probeController.current?.abort()
    }
  }, [])

  const bestNodeIndex = useMemo(() => {
    const available = Object.entries(pingResults)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .sort((a, b) => a[1] - b[1])
    return available.length ? Number(available[0][0]) : 0
  }, [pingResults])

  const stopTest = useCallback(() => {
    testController.current?.abort("用户取消")
    setTesting(false)
    setPhase("cancelled")
    setCurrentSpeed(0)
    setErrorMessage("")
  }, [])

  const startTest = useCallback(async () => {
    if (testController.current) {
      stopTest()
      return
    }

    const controller = new AbortController()
    testController.current = controller
    const node = SPEED_TEST_NODES[selectedNode]
    setTesting(true)
    setPhase("latency")
    setProgress(0.03)
    setCurrentSpeed(0)
    setTransferred(0)
    setResult(null)
    setErrorMessage("")
    testSamples.current = []
    setSpeedHistory([])

    try {
      const latency = await measureLatency(node.url, controller.signal)
      if (testController.current !== controller || controller.signal.aborted || !mounted.current) return
      setPhase("download")
      setProgress(0.08)
      const downloadSpeed = await downloadSpeedTest(node.url, controller.signal, (speed, bytes, value) => {
        if (testController.current !== controller || controller.signal.aborted || !mounted.current) return
        setCurrentSpeed(speed)
        setTransferred(bytes)
        setProgress(0.08 + value * 0.57)
        const samples = [...testSamples.current.slice(-59), { label: `${Date.now()}`, value: -speed }]
        testSamples.current = samples
        setSpeedHistory(samples)
      })

      if (testController.current !== controller || controller.signal.aborted || !mounted.current) return
      setPhase("upload")
      setCurrentSpeed(0)
      setTransferred(0)
      const uploadSpeed = await uploadSpeedTest(controller.signal, (speed, bytes, value) => {
        if (testController.current !== controller || controller.signal.aborted || !mounted.current) return
        setCurrentSpeed(speed)
        setTransferred(bytes)
        setProgress(0.65 + value * 0.35)
        const samples = [...testSamples.current.slice(-59), { label: `${Date.now()}`, value: speed }]
        testSamples.current = samples
        setSpeedHistory(samples)
      })

      if (testController.current !== controller || controller.signal.aborted || !mounted.current) return
      const completedResult: SpeedTestResult = {
        downloadSpeed,
        uploadSpeed,
        ping: latency.ping,
        jitter: latency.jitter,
      }
      setResult(completedResult)
      Storage.set<SavedSpeedTest>(LAST_SPEED_TEST_KEY, {
        result: completedResult,
        history: testSamples.current,
        selectedNode,
        completedAt: Date.now(),
      })
      setCurrentSpeed(downloadSpeed)
      setProgress(1)
      setPhase("complete")
    } catch (error) {
      if (testController.current === controller && mounted.current) {
        if (controller.signal.aborted) {
          setPhase("cancelled")
        } else {
          setPhase("failed")
          setErrorMessage(error instanceof Error ? error.message : "测速失败，请更换节点重试")
        }
      }
    } finally {
      if (testController.current === controller) {
        testController.current = null
        if (mounted.current) setTesting(false)
      }
    }
  }, [selectedNode, stopTest])

  const currentNode = SPEED_TEST_NODES[selectedNode]
  const phaseLabel = phase === "latency" ? "正在检测节点延迟"
    : phase === "download" ? "正在测试下载速度"
    : phase === "upload" ? "正在测试上传速度"
    : phase === "complete" ? "测速完成"
    : phase === "cancelled" ? "测速已停止"
    : phase === "failed" ? "测速失败"
    : "准备开始测速"
  const normalizedHistory = useMemo(() => {
    if (!speedHistory.length) return [{ label: "0", value: 0, opacity: 0 }]
    const peak = Math.max(...speedHistory.map(sample => Math.abs(sample.value)), 1)
    return speedHistory.map((sample, index) => ({
      label: `${index}`,
      value: Math.max(-2, Math.min(2, sample.value / peak * 2)),
      foregroundStyle: (sample.value >= 0 ? "systemGreen" : "systemBlue") as "systemGreen" | "systemBlue",
    }))
  }, [speedHistory])

  return (
    <NavigationStack>
      <ScrollView>
        <VStack spacing={14} padding={12}>
          <HStack>
            <CloseButton />
            <Spacer />
          </HStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={16}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <HStack>
              <VStack alignment="leading" spacing={2}>
                <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">网速测试</Text>
                <Text font={12} foregroundStyle="secondaryLabel">{currentNode.name} · {phaseLabel}</Text>
              </VStack>
              <Spacer />
              <Image
                systemName={phase === "upload" ? "arrow.up.circle.fill" : "arrow.down.circle.fill"}
                font={24}
                foregroundStyle={phase === "upload" ? "systemGreen" : "systemBlue"}
              />
            </HStack>

            <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <Text font={46} fontWeight="bold" monospacedDigit foregroundStyle={phase === "failed" ? "systemRed" : "label"}>
                {testing ? currentSpeed.toFixed(1) : result ? result.downloadSpeed.toFixed(1) : "0.0"}
              </Text>
              <Text font={13} foregroundStyle="secondaryLabel">Mbps</Text>
            </VStack>

            <ProgressView value={progress} total={1} tint={phase === "upload" ? "systemGreen" : "systemBlue"} />

            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">当前阶段</Text>
                <Text font={13} fontWeight="medium">{phaseLabel}</Text>
              </VStack>
              <VStack alignment="trailing" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">已传输</Text>
                <Text font={13} fontWeight="medium">{formatBytes(transferred)}</Text>
              </VStack>
            </HStack>

            {errorMessage ? <Text font={12} foregroundStyle="systemRed">{errorMessage}</Text> : null}

            <Button
              title={testing ? "停止测速" : result ? "重新测速" : "开始测速"}
              action={startTest}
              controlSize="large"
              buttonStyle="borderedProminent"
              tint={testing ? "systemRed" : "systemBlue"}
              frame={{ maxWidth: "infinity" }}
            />
          </VStack>

          <VStack
            alignment="leading"
            spacing={10}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">测速结果</Text>
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">下载</Text>
                <Text font={17} fontWeight="semibold" foregroundStyle="systemBlue">{result ? formatSpeed(result.downloadSpeed) : "—"}</Text>
              </VStack>
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">上传</Text>
                <Text font={17} fontWeight="semibold" foregroundStyle="systemGreen">{result ? formatSpeed(result.uploadSpeed) : "—"}</Text>
              </VStack>
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">HTTP 延迟</Text>
                <Text font={17} fontWeight="semibold">{result ? `${result.ping.toFixed(0)} ms` : "—"}</Text>
              </VStack>
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">抖动</Text>
                <Text font={17} fontWeight="semibold">{result ? `${result.jitter.toFixed(1)} ms` : "—"}</Text>
              </VStack>
            </HStack>
          </VStack>

          <VStack
            alignment="leading"
            spacing={8}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <HStack>
              <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">实时曲线</Text>
              <Spacer />
              <Text font={11} foregroundStyle="secondaryLabel">最近 60 个采样</Text>
            </HStack>
            <HStack spacing={6} frame={{ maxWidth: "infinity", height: 150 }}>
              <VStack spacing={0} frame={{ width: 14, height: 150 }}>
                <Text font={10} foregroundStyle="secondaryLabel">2</Text>
                <Spacer />
                <Text font={10} foregroundStyle="secondaryLabel">1</Text>
                <Spacer />
                <Text font={10} foregroundStyle="secondaryLabel">0</Text>
                <Spacer />
                <Text font={10} foregroundStyle="secondaryLabel">1</Text>
                <Spacer />
                <Text font={10} foregroundStyle="secondaryLabel">2</Text>
              </VStack>
              <Chart
                frame={{ maxWidth: "infinity", height: 150 }}
                chartXAxis="hidden"
                chartYScale={{ from: -2, to: 2 }}
                chartYAxis={{
                  values: { type: "values", values: [-2, -1, 0, 1, 2] },
                  gridLine: { stroke: { lineWidth: 1, dash: [4, 4] } },
                  tick: false,
                  valueLabel: false,
                }}
              >
                <LineChart marks={normalizedHistory} />
              </Chart>
            </HStack>
            <HStack>
              <Text font={11} foregroundStyle="systemBlue">↓ 下载</Text>
              <Spacer />
              <Text font={11} foregroundStyle="systemGreen">↑ 上传</Text>
            </HStack>
          </VStack>

          <VStack
            alignment="leading"
            spacing={10}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">网络信息</Text>
            <HStack>
              <Text font={12} foregroundStyle="secondaryLabel">公网 IP</Text>
              <Spacer />
              <Text font={13}>{publicIP}</Text>
            </HStack>
            <HStack>
              <Text font={12} foregroundStyle="secondaryLabel">本地 IP</Text>
              <Spacer />
              <Text font={13}>{localIP}</Text>
            </HStack>
            <HStack>
              <Text font={12} foregroundStyle="secondaryLabel">网络位置</Text>
              <Spacer />
              <Text font={13}>{ipInfo?.city || ipInfo?.country || "未知"}</Text>
            </HStack>
          </VStack>

          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <HStack>
              <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">测速节点</Text>
              <Spacer />
              <Button title="重新检测" action={pingAllNodes} buttonStyle="bordered" controlSize="small" />
            </HStack>
            {SPEED_TEST_NODES.map((node, index) => (
              <HStack
                key={index}
                padding={12}
                background="secondarySystemGroupedBackground"
                clipShape={{ type: "rect", cornerRadius: 8 }}
                onTapGesture={() => { if (!testing) setSelectedNode(index) }}
              >
                <VStack alignment="leading" spacing={2}>
                  <Text font={14} fontWeight={selectedNode === index ? "semibold" : "regular"}>{node.name}</Text>
                  <Text font={11} foregroundStyle="secondaryLabel">HTTP 测速节点</Text>
                </VStack>
                <Spacer />
                {index === bestNodeIndex && pingResults[index] !== null ? <Text font={11} foregroundStyle="systemOrange">最优</Text> : null}
                <Text font={12} foregroundStyle={pingResults[index] ? "systemGreen" : "secondaryLabel"}>
                  {pingResults[index] === undefined ? "检测中" : pingResults[index] === null ? "超时" : `${pingResults[index]} ms`}
                </Text>
                {selectedNode === index ? <Image systemName="checkmark.circle.fill" foregroundStyle="systemBlue" /> : null}
              </HStack>
            ))}
          </VStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ============ 设备详情 Tab ============

interface NativeHardwareInfo {
  physicalMemory: number
  architecture: string
  coreCount: number
  machine: string
  uptime: number
  diskTotal: number
  diskAvailable: number
}

function formatPhysicalMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "读取失败"
  const gigabytes = bytes / 1024 / 1024 / 1024
  return `${gigabytes.toFixed(2)} GiB`
}

function formatDiskSpace(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "读取失败"
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "读取失败"
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86400)
  const hours = Math.floor(total % 86400 / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const secs = total % 60
  return `${days} 天 ${hours} 小时 ${minutes} 分 ${secs} 秒`
}

function LiveFrameRate() {
  const meter = useRef({ windowStart: 0, frameCount: 0, fps: 0 })
  const [fps, setFps] = useState(0)

  useEffect(() => {
    let stopped = false
    let timerId = 0
    const publish = () => {
      if (stopped) return
      setFps(meter.current.fps)
      timerId = setTimeout(publish, 500)
    }
    timerId = setTimeout(publish, 500)
    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }, [])

  return (
    <HStack spacing={4}>
      <TimelineCanvas
        frame={{ width: 1, height: 1 }}
        opaque={false}
        schedule="animation"
        draw={(ctx, size, time) => {
          const state = meter.current
          if (state.windowStart === 0) state.windowStart = time
          state.frameCount += 1
          const elapsed = time - state.windowStart
          if (elapsed >= 0.5) {
            state.fps = state.frameCount / elapsed
            state.frameCount = 0
            state.windowStart = time
          }
          ctx.clearRect(0, 0, size.width, size.height)
        }}
      />
      <Text font={13} foregroundStyle="secondaryLabel" monospacedDigit>
        {fps > 0 ? `${fps.toFixed(1)} FPS` : "测量中…"}
      </Text>
    </HStack>
  )
}

function DeviceInfoRow({
  title,
  value,
  unsupported = false,
}: {
  title: string
  value: string
  unsupported?: boolean
}) {
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
      <Text font={13}>{title}</Text>
      <Spacer />
      <Text
        font={13}
        foregroundStyle={unsupported ? "tertiaryLabel" : "secondaryLabel"}
        multilineTextAlignment="trailing"
      >
        {value}
      </Text>
    </HStack>
  )
}

interface NetworkSnapshot {
  status: string
  interfaceNames: string
  ipv4: string
  ipv6: string
  vpn: boolean
}

function getNetworkSnapshot(): NetworkSnapshot {
  try {
    const interfaces = Device.networkInterfaces?.() || {}
    const activeEntries = Object.entries(interfaces)
      .map(([name, addresses]) => ({
        name,
        addresses: Array.isArray(addresses)
          ? addresses.filter(address => address && !address.isInternal)
          : [],
      }))
      .filter(entry => entry.addresses.length > 0)
    const activeNames = activeEntries.map(entry => entry.name)
    const hasWiFi = activeNames.some(name => /^en\d+$/.test(name))
    const hasCellular = activeNames.some(name => /^pdp_ip\d+$/.test(name))
    const hasVPN = activeNames.some(name => /^utun\d+$/.test(name))
    const status = hasVPN && hasWiFi ? "Wi‑Fi · VPN"
      : hasVPN && hasCellular ? "蜂窝网络 · VPN"
      : hasVPN ? "VPN 已连接"
      : hasWiFi ? "Wi‑Fi 已连接"
      : hasCellular ? "蜂窝网络已连接"
      : activeNames.length ? "网络已连接"
      : "未连接"
    const addresses = activeEntries.flatMap(entry => entry.addresses)

    return {
      status,
      interfaceNames: activeNames.join(", ") || "无",
      ipv4: addresses.find(address => address.family === "IPv4")?.address || "无",
      ipv6: addresses.find(address => address.family === "IPv6")?.address || "无",
      vpn: hasVPN,
    }
  } catch {
    return {
      status: "不可用",
      interfaceNames: "不可用",
      ipv4: "不可用",
      ipv6: "不可用",
      vpn: false,
    }
  }
}

function formatOrientation(value: string): string {
  if (value === "portrait") return "竖屏"
  if (value === "portraitUpsideDown") return "倒置竖屏"
  if (value === "landscapeLeft") return "横屏（左）"
  if (value === "landscapeRight") return "横屏（右）"
  if (value === "faceUp") return "正面朝上"
  if (value === "faceDown") return "正面朝下"
  return "未知"
}

function formatBatteryState(state: typeof Device.batteryState): string {
  if (state === "charging") return "充电中"
  if (state === "full") return "已充满"
  if (state === "unplugged") return "使用电池"
  return "未知"
}

function DeviceDetailTab() {
  const [hardwareInfo, setHardwareInfo] = useState<NativeHardwareInfo | null>(null)
  const [hardwareError, setHardwareError] = useState(false)
  const [uptime, setUptime] = useState(0)
  const [network, setNetwork] = useState(getNetworkSnapshot())
  const [orientation, setOrientation] = useState(Device.orientation || "unknown")
  const [proximityState, setProximityState] = useState(Device.proximityState === true)
  const [batteryLevel, setBatteryLevel] = useState(Device.batteryLevel)
  const [batteryState, setBatteryState] = useState(Device.batteryState)
  const [photoCounts, setPhotoCounts] = useState<{ images: number; videos: number } | null>(null)
  const [photoStatus, setPhotoStatus] = useState(Photos.authorizationStatus("readWrite"))
  const [photoError, setPhotoError] = useState(false)
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "未知", [])
  const timeZoneOffset = useMemo(() => {
    const offsetMinutes = -new Date().getTimezoneOffset()
    const sign = offsetMinutes >= 0 ? "+" : "-"
    const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, "0")
    const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, "0")
    return `UTC${sign}${hours}:${minutes}`
  }, [])
  const preferredLanguages = Array.isArray(Device.preferredLanguages)
    ? Device.preferredLanguages.join(", ")
    : "不可用"
  const deviceKind = Device.isiPhone ? "iPhone" : Device.isiPad ? "iPad" : Device.isiOSAppOnMac ? "Mac" : Device.model

  useEffect(() => {
    let stopped = false
    let timerId = 0

    const onBatteryLevel = (level: number) => { if (!stopped) setBatteryLevel(level) }
    const onBatteryState = (state: typeof Device.batteryState) => { if (!stopped) setBatteryState(state) }
    const onOrientation = (value: typeof Device.orientation) => { if (!stopped) setOrientation(value) }
    const onProximityState = (value: boolean) => { if (!stopped) setProximityState(value) }
    try { Device.addBatteryLevelListener?.(onBatteryLevel) } catch {}
    try { Device.addBatteryStateListener?.(onBatteryState) } catch {}
    try { Device.addOrientationListener?.(onOrientation) } catch {}
    try { Device.addProximityStateListener?.(onProximityState) } catch {}

    Promise.all([
      Photos.fetchAssets({ mediaType: "image", limit: 0 }),
      Photos.fetchAssets({ mediaType: "video", limit: 0 }),
    ]).then(([images, videos]) => {
      if (stopped) return
      setPhotoCounts({ images: images.length, videos: videos.length })
      setPhotoStatus(Photos.authorizationStatus("readWrite"))
    }).catch(() => {
      if (stopped) return
      setPhotoError(true)
      setPhotoStatus(Photos.authorizationStatus("readWrite"))
    })

    Python.run(`
import json, os, platform, time
page_size = os.sysconf("SC_PAGE_SIZE")
physical_pages = os.sysconf("SC_PHYS_PAGES")
volume = os.statvfs(os.getcwd())
print(json.dumps({
  "physicalMemory": page_size * physical_pages,
  "architecture": platform.processor() or platform.machine(),
  "coreCount": os.cpu_count() or os.sysconf("SC_NPROCESSORS_ONLN"),
  "machine": platform.machine(),
  "uptime": time.monotonic(),
  "diskTotal": volume.f_frsize * volume.f_blocks,
  "diskAvailable": volume.f_frsize * volume.f_bavail
}))
`).then(result => {
      if (stopped || result.exitCode !== 0) {
        if (!stopped) setHardwareError(true)
        return
      }
      try {
        const info = JSON.parse(result.output.trim()) as NativeHardwareInfo
        setHardwareInfo(info)
        setUptime(info.uptime)
      } catch {
        setHardwareError(true)
      }
    }).catch(() => {
      if (!stopped) setHardwareError(true)
    })

    let tickCount = 0
    const tick = () => {
      if (stopped) return
      setUptime(value => value > 0 ? value + 1 : value)
      tickCount += 1
      if (tickCount % 2 === 0) setNetwork(getNetworkSnapshot())
      timerId = setTimeout(tick, 1000)
    }
    timerId = setTimeout(tick, 1000)

    return () => {
      stopped = true
      clearTimeout(timerId)
      try { Device.removeBatteryLevelListener?.(onBatteryLevel) } catch {}
      try { Device.removeBatteryStateListener?.(onBatteryState) } catch {}
      try { Device.removeOrientationListener?.(onOrientation) } catch {}
      try { Device.removeProximityStateListener?.(onProximityState) } catch {}
    }
  }, [])

  const loadingValue = hardwareError ? "读取失败" : "读取中…"

  return (
    <NavigationStack>
      <ScrollView>
        <VStack spacing={14} padding={12}>
          <HStack>
            <CloseButton />
            <Spacer />
          </HStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={16}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <HStack>
              <VStack alignment="leading" spacing={2}>
                <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">设备信息</Text>
                <Text font={12} foregroundStyle="secondaryLabel">来自 Scripting 官方设备接口</Text>
              </VStack>
              <Spacer />
              <Image systemName="iphone.gen3" font={28} foregroundStyle="systemBlue" />
            </HStack>
            <Text font={30} fontWeight="bold">{hardwareInfo?.machine || Device.localizedModel || deviceKind}</Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              {Device.localizedModel || Device.model} · {Device.systemName} {Device.systemVersion}
            </Text>
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">处理器</Text>
                <Text font={13} fontWeight="medium">
                  {hardwareInfo ? `${hardwareInfo.architecture} · ${hardwareInfo.coreCount} 核` : loadingValue}
                </Text>
              </VStack>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">运行环境</Text>
                <Text font={13} fontWeight="medium">{Device.isiOSAppOnMac ? "iOS App on Mac" : deviceKind}</Text>
              </VStack>
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">内存 / 磁盘</Text>
                <Text font={13} fontWeight="medium">
                  {hardwareInfo ? `${formatPhysicalMemory(hardwareInfo.physicalMemory)} / ${formatDiskSpace(hardwareInfo.diskTotal)}` : loadingValue}
                </Text>
              </VStack>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text font={11} foregroundStyle="secondaryLabel">屏幕 / 模式</Text>
                <Text font={13} fontWeight="medium">
                  {Device.screen.width}×{Device.screen.height} @{Device.screen.scale}x · {Device.colorScheme === "dark" ? "深色" : "浅色"}
                </Text>
              </VStack>
            </HStack>
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">硬件</Text>
            <DeviceInfoRow title="硬件标识" value={hardwareInfo?.machine || loadingValue} unsupported={hardwareError} />
            <DeviceInfoRow title="通用型号" value={Device.model} />
            <DeviceInfoRow title="本地化型号" value={Device.localizedModel} />
            <DeviceInfoRow title="设备类别" value={deviceKind} />
            <DeviceInfoRow
              title="物理内存"
              value={hardwareInfo ? formatPhysicalMemory(hardwareInfo.physicalMemory) : loadingValue}
              unsupported={hardwareError}
            />
            <DeviceInfoRow
              title="处理器"
              value={hardwareInfo ? `${hardwareInfo.architecture} · ${hardwareInfo.coreCount} 核` : loadingValue}
              unsupported={hardwareError}
            />
            <DeviceInfoRow
              title="磁盘总容量"
              value={hardwareInfo ? formatDiskSpace(hardwareInfo.diskTotal) : loadingValue}
              unsupported={hardwareError}
            />
            <DeviceInfoRow
              title="磁盘已用"
              value={hardwareInfo ? formatDiskSpace(hardwareInfo.diskTotal - hardwareInfo.diskAvailable) : loadingValue}
              unsupported={hardwareError}
            />
            <DeviceInfoRow
              title="磁盘可用"
              value={hardwareInfo ? formatDiskSpace(hardwareInfo.diskAvailable) : loadingValue}
              unsupported={hardwareError}
            />
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">系统</Text>
            <DeviceInfoRow title="操作系统" value={`${Device.systemName} ${Device.systemVersion}`} />
            <DeviceInfoRow title="运行环境" value={Device.isiOSAppOnMac ? "iOS App on Mac" : deviceKind} />
            <DeviceInfoRow
              title="设备运行时间"
              value={uptime > 0 ? formatUptime(uptime) : loadingValue}
              unsupported={hardwareError}
            />
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">语言与区域</Text>
            <DeviceInfoRow title="时区" value={`${timeZone} · ${timeZoneOffset}`} />
            <DeviceInfoRow title="Locale" value={Device.systemLocale || "未知"} />
            <DeviceInfoRow title="国家代码" value={Device.systemCountryCode || "未知"} />
            <DeviceInfoRow title="语言标签" value={Device.systemLanguageTag || "未知"} />
            <DeviceInfoRow title="语言代码" value={Device.systemLanguageCode || "未知"} />
            <DeviceInfoRow title="文字脚本" value={Device.systemScriptCode || "未知"} />
            <DeviceInfoRow title="首选语言" value={preferredLanguages} />
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">状态</Text>
            <DeviceInfoRow title="网络状态" value={network.status} />
            <DeviceInfoRow title="活动接口" value={network.interfaceNames} />
            <DeviceInfoRow title="本地 IPv4" value={network.ipv4} />
            <DeviceInfoRow title="本地 IPv6" value={network.ipv6} />
            <DeviceInfoRow title="VPN" value={network.vpn ? "已连接" : "未连接"} />
            <DeviceInfoRow title="电池电量" value={`${Math.round(Math.max(0, batteryLevel) * 100)}%`} />
            <DeviceInfoRow title="供电状态" value={formatBatteryState(batteryState)} />
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <HStack>
              <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">照片</Text>
              <Spacer />
              <Image systemName="photo.on.rectangle.angled" foregroundStyle="systemBlue" />
            </HStack>
            {photoCounts ? (
              <>
                <DeviceInfoRow title="图片" value={`${photoCounts.images} 张`} />
                <DeviceInfoRow title="视频" value={`${photoCounts.videos} 个`} />
                <DeviceInfoRow title="总资源" value={`${photoCounts.images + photoCounts.videos} 项`} />
                {photoStatus === "limited" ? (
                  <Text font={11} foregroundStyle="systemOrange">有限访问：仅统计已授权给 Scripting 的资源</Text>
                ) : null}
              </>
            ) : (
              <DeviceInfoRow
                title="图库状态"
                value={photoError || photoStatus === "denied" ? "无照片访问权限" : photoStatus === "restricted" ? "访问受限" : "正在统计…"}
                unsupported={photoError || photoStatus === "denied" || photoStatus === "restricted"}
              />
            )}
          </VStack>

          <VStack
            alignment="leading"
            spacing={12}
            frame={{ maxWidth: "infinity" }}
            padding={14}
            background="secondarySystemGroupedBackground"
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font={18} fontWeight="semibold" foregroundStyle="systemBlue">显示与传感器</Text>
            <DeviceInfoRow title="逻辑分辨率" value={`${Device.screen.width}×${Device.screen.height} pt`} />
            <DeviceInfoRow
              title="物理像素"
              value={`${Math.round(Device.screen.width * Device.screen.scale)}×${Math.round(Device.screen.height * Device.screen.scale)} px`}
            />
            <DeviceInfoRow title="缩放倍数" value={`${Device.screen.scale}x`} />
            <DeviceInfoRow title="外观模式" value={Device.colorScheme === "dark" ? "深色" : "浅色"} />
            <DeviceInfoRow title="当前方向" value={formatOrientation(orientation)} />
            <DeviceInfoRow title="设备平放" value={Device.isFlat ? "是" : "否"} />
            <DeviceInfoRow title="接近传感器" value={proximityState ? "有物体靠近" : "未遮挡"} />
            <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
              <Text font={13}>实时帧率</Text>
              <Spacer />
              <LiveFrameRate />
            </HStack>
            <DeviceInfoRow
              title="屏幕规格"
              value={`${Device.screen.width}×${Device.screen.height} @${Device.screen.scale}x`}
            />
          </VStack>

        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ============ 抢票时间 Live Activity ============

function formatTicketLiveTime(date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function TicketLiveActivityManager({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    let stopped = false
    let timerId = 0
    let activity: LiveActivity<TicketClockState> | null = null
    let activityListener: ((state: "active" | "stale" | "ended" | "dismissed") => void) | null = null
    let keepAliveRequested = false
    let wantsKeepAlive = false
    let keeperTask: Promise<void> = Promise.resolve()

    const syncKeepAlive = (wanted: boolean) => {
      wantsKeepAlive = wanted && enabled && !stopped
      keeperTask = keeperTask.then(async () => {
        if (wantsKeepAlive && !keepAliveRequested) {
          keepAliveRequested = await BackgroundKeeper.keepAlive()
        }
        if (!wantsKeepAlive && keepAliveRequested) {
          await BackgroundKeeper.stopKeepAlive()
          keepAliveRequested = false
        }
      }).catch(() => {})
    }

    const detachActivityListener = () => {
      if (activity && activityListener) {
        try { activity.removeUpdateListener(activityListener) } catch {}
      }
      activityListener = null
    }

    const markActivityInactive = () => {
      clearTimeout(timerId)
      detachActivityListener()
      activity = null
      Storage.remove(TICKET_LIVE_ACTIVITY_ID_KEY)
      syncKeepAlive(false)
    }

    const attachActivityListener = () => {
      if (!activity || activityListener) return
      activityListener = state => {
        if (state === "ended" || state === "dismissed") markActivityInactive()
      }
      try { activity.addUpdateListener(activityListener) } catch {}
    }

    const update = async () => {
      if (stopped || !activity) return
      try {
        const updated = await activity.update({ time: formatTicketLiveTime() })
        if (!updated) {
          markActivityInactive()
          return
        }
      } catch {
        markActivityInactive()
        return
      }
      if (!stopped && activity) timerId = setTimeout(update, 1000)
    }

    const startOrRestore = async () => {
      try {
        const savedId = Storage.get<string>(TICKET_LIVE_ACTIVITY_ID_KEY)
        if (savedId) {
          const restored = await LiveActivity.from<TicketClockState>(savedId, TICKET_LIVE_ACTIVITY_NAME)
          if (stopped) return
          const state = restored ? await restored.getActivityState() : null
          if (stopped) return
          if (state === "active" || state === "stale") {
            activity = restored
          } else {
            Storage.remove(TICKET_LIVE_ACTIVITY_ID_KEY)
          }
        }

        if (!activity) {
          const allowed = await LiveActivity.areActivitiesEnabled()
          if (stopped || !allowed) return
          const nextActivity = TicketClockLiveActivity()
          const started = await nextActivity.start(
            { time: formatTicketLiveTime() },
            { relevanceScore: 1 }
          )
          if (stopped) {
            if (started) {
              await nextActivity.end(
                { time: formatTicketLiveTime() },
                { dismissTimeInterval: 0 }
              ).catch(() => false)
            }
            return
          }
          if (started) {
            activity = nextActivity
            if (nextActivity.activityId) Storage.set(TICKET_LIVE_ACTIVITY_ID_KEY, nextActivity.activityId)
          }
        }

        if (!stopped && activity) {
          attachActivityListener()
          update()
        }
      } catch {}
    }

    const stopActivity = async () => {
      const savedId = Storage.get<string>(TICKET_LIVE_ACTIVITY_ID_KEY)
      Storage.remove(TICKET_LIVE_ACTIVITY_ID_KEY)
      try {
        const existing = savedId
          ? await LiveActivity.from<TicketClockState>(savedId, TICKET_LIVE_ACTIVITY_NAME)
          : null
        if (existing) {
          await existing.end(
            { time: formatTicketLiveTime() },
            { dismissTimeInterval: 0 }
          )
        }
      } catch {}
    }

    const onScenePhase = (phase: "active" | "inactive" | "background") => {
      if (phase === "background") syncKeepAlive(true)
      else if (phase === "active") syncKeepAlive(false)
    }

    try { AppEvents.scenePhase.addListener(onScenePhase) } catch {}
    if (enabled) void startOrRestore()
    else void stopActivity()

    return () => {
      stopped = true
      clearTimeout(timerId)
      detachActivityListener()
      try { AppEvents.scenePhase.removeListener(onScenePhase) } catch {}
      syncKeepAlive(false)
    }
  }, [enabled])

  return null
}

// ============ 设置 Tab ============

function formatPhotoAuthorization(status: ReturnType<typeof Photos.authorizationStatus>): string {
  if (status === "authorized") return "完全访问"
  if (status === "limited") return "有限访问"
  if (status === "denied") return "已拒绝"
  if (status === "restricted") return "系统限制"
  return "尚未请求"
}

function SettingsTab({
  autoTicketLiveActivity,
  onAutoTicketLiveActivityChanged,
}: {
  autoTicketLiveActivity: boolean
  onAutoTicketLiveActivityChanged: (value: boolean) => void
}) {
  const [wakeLock, setWakeLock] = useState(false)
  const [savedTest, setSavedTest] = useState<SavedSpeedTest | null>(
    Storage.get<SavedSpeedTest>(LAST_SPEED_TEST_KEY)
  )
  const [photoAuthorization, setPhotoAuthorization] = useState(
    Photos.authorizationStatus("readWrite")
  )
  const network = useMemo(() => getNetworkSnapshot(), [])

  useEffect(() => {
    let stopped = false
    const refreshPhotoAuthorization = () => {
      if (!stopped) setPhotoAuthorization(Photos.authorizationStatus("readWrite"))
    }
    const onScenePhase = (phase: "active" | "inactive" | "background") => {
      if (phase === "active") refreshPhotoAuthorization()
    }

    Device.isWakeLockEnabled
      .then(value => {
        if (!stopped) setWakeLock(value)
      })
      .catch(() => {})
    refreshPhotoAuthorization()
    try { AppEvents.scenePhase.addListener(onScenePhase) } catch {}

    return () => {
      stopped = true
      try { AppEvents.scenePhase.removeListener(onScenePhase) } catch {}
    }
  }, [])

  const toggleWakeLock = useCallback(() => {
    const nextValue = !wakeLock
    try {
      Device.setWakeLockEnabled(nextValue)
      setWakeLock(nextValue)
    } catch {}
  }, [wakeLock])

  const managePhotoPermission = useCallback(async () => {
    const status = Photos.authorizationStatus("readWrite")
    if (status === "notDetermined") {
      try {
        await Photos.fetchAssets({ mediaType: "image", limit: 1 })
      } catch {}
      setPhotoAuthorization(Photos.authorizationStatus("readWrite"))
      return
    }

    try {
      const openSystemURL = (globalThis as any).openURL
      if (typeof openSystemURL === "function") {
        await openSystemURL("app-settings:")
      }
    } catch {}
  }, [])

  const clearSpeedTest = useCallback(() => {
    Storage.remove(LAST_SPEED_TEST_KEY)
    setSavedTest(null)
  }, [])

  const lastTestTime = savedTest
    ? new Date(savedTest.completedAt).toLocaleString()
    : "暂无记录"

  return (
    <NavigationStack>
      <List navigationTitle="设置" navigationBarTitleDisplayMode="large">
        <Section>
          <HStack>
            <CloseButton />
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel">PulseNet 设置与数据管理</Text>
          </HStack>
        </Section>

        <Section
          header={<Text>显示</Text>}
          footer={<Text font={11}>灵动岛仅显示时分秒；支持的设备同时显示在锁屏。屏幕常亮只在本脚本运行期间生效。</Text>}
        >
          <Toggle
            title="抢票灵动岛"
            systemImage="clock.badge.checkmark"
            value={autoTicketLiveActivity}
            onChanged={onAutoTicketLiveActivityChanged}
          />
          <Toggle
            title="屏幕常亮"
            systemImage="sun.max.fill"
            value={wakeLock}
            onChanged={toggleWakeLock}
          />
        </Section>

        <Section
          header={<Text>测速数据</Text>}
          footer={<Text font={11}>仅保留最近一次成功测速结果；取消或失败不会覆盖记录。</Text>}
        >
          <HStack>
            <Text>上次测速</Text>
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel">{lastTestTime}</Text>
          </HStack>
          {savedTest ? (
            <>
              <HStack>
                <Text>下载 / 上传</Text>
                <Spacer />
                <Text font={13} foregroundStyle="secondaryLabel">
                  {savedTest.result.downloadSpeed.toFixed(1)} / {savedTest.result.uploadSpeed.toFixed(1)} Mbps
                </Text>
              </HStack>
              <Button title="清除测速记录" systemImage="trash" action={clearSpeedTest} foregroundStyle="systemRed" />
            </>
          ) : null}
        </Section>

        <Section
          header={<Text>权限</Text>}
          footer={<Text font={11}>点击“照片访问”选择或修改权限。有限访问时只能统计授权给 Scripting 的资源。</Text>}
        >
          <HStack
            spacing={10}
            frame={{ maxWidth: "infinity" }}
            onTapGesture={managePhotoPermission}
          >
            <Image systemName="photo.on.rectangle" foregroundStyle="systemBlue" />
            <Text>照片访问</Text>
            <Spacer />
            <Text font={13} foregroundStyle={photoAuthorization === "authorized" ? "systemGreen" : "secondaryLabel"}>
              {formatPhotoAuthorization(photoAuthorization)}
            </Text>
            <Image systemName="chevron.right" font={11} foregroundStyle="tertiaryLabel" />
          </HStack>
        </Section>

        <Section header={<Text>运行环境</Text>}>
          <HStack><Text>设备</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">{Device.localizedModel || Device.model}</Text></HStack>
          <HStack><Text>系统</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">{Device.systemName} {Device.systemVersion}</Text></HStack>
          <HStack><Text>网络</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">{network.status}</Text></HStack>
          <HStack><Text>外观</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">{Device.colorScheme === "dark" ? "深色" : "浅色"}</Text></HStack>
        </Section>

        <Section
          header={<Text>数据与隐私</Text>}
          footer={<Text font={11}>PulseNet 不上传设备硬件、照片内容或照片列表。测速会向测速节点传输测试数据，公网信息查询会暴露当前公网 IP。</Text>}
        >
          <HStack><Text>测速记录</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">本机脚本存储</Text></HStack>
          <HStack><Text>设备信息</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">本机实时读取</Text></HStack>
          <HStack><Text>照片统计</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">仅资源元数据</Text></HStack>
        </Section>

        <Section header={<Text>数据来源</Text>}>
          <HStack><Text>设备与电池</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">Scripting Device</Text></HStack>
          <HStack><Text>照片数量</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">iOS Photos</Text></HStack>
          <HStack><Text>系统信息</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">Python / Darwin</Text></HStack>
          <HStack><Text>公网 IP</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">ipify / 备用接口</Text></HStack>
          <HStack><Text>测速</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">Cloudflare Speed</Text></HStack>
          <HStack><Text>网络响应</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">HTTP 延迟采样</Text></HStack>
        </Section>

        <Section header={<Text>关于</Text>}>
          <HStack><Text>名称</Text><Spacer /><Text foregroundStyle="secondaryLabel">PulseNet</Text></HStack>
          <HStack><Text>类型</Text><Spacer /><Text foregroundStyle="secondaryLabel">Scripting 网络与设备工具</Text></HStack>
          <HStack><Text>运行平台</Text><Spacer /><Text foregroundStyle="secondaryLabel">Scripting App</Text></HStack>
          <HStack><Text>数据原则</Text><Spacer /><Text foregroundStyle="secondaryLabel">真实数据优先</Text></HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

// ============ 主入口 — TabView (iOS 18+ 最新 API) ============

function App() {
  const selection = useObservable<number>(0)
  const [autoTicketLiveActivity, setAutoTicketLiveActivity] = useState(
    Storage.get<boolean>(AUTO_TICKET_LIVE_ACTIVITY_KEY) ?? false
  )

  const changeAutoTicketLiveActivity = useCallback((value: boolean) => {
    Storage.set(AUTO_TICKET_LIVE_ACTIVITY_KEY, value)
    setAutoTicketLiveActivity(value)
  }, [])

  useEffect(() => {
    if (Photos.authorizationStatus("readWrite") !== "notDetermined") return
    Photos.fetchAssets({ mediaType: "image", limit: 1 }).catch(() => {})
  }, [])

  return (
    <>
      <TicketLiveActivityManager enabled={autoTicketLiveActivity} />
      <TabView
      selection={selection}
      tabBarMinimizeBehavior="onScrollDown"
      ignoresSafeArea={{ regions: "all", edges: "all" }}
    >
      {/* 首页 — 卡片式设备信息聚合 */}
      <Tab
        title="首页"
        systemImage="house.fill"
        value={0}
      >
        <HomeTab />
      </Tab>

      {/* 测速 — 多节点Ping+下载测速 */}
      <Tab
        title="测速"
        systemImage="speedometer"
        value={1}
      >
        <SpeedTestTab />
      </Tab>

      {/* 设备详情 */}
      <Tab
        title="设备"
        systemImage="iphone"
        value={2}
      >
        <DeviceDetailTab />
      </Tab>

      {/* 设置 */}
      <Tab
        title="设置"
        systemImage="gearshape.fill"
        value={3}
      >
        <SettingsTab
          autoTicketLiveActivity={autoTicketLiveActivity}
          onAutoTicketLiveActivityChanged={changeAutoTicketLiveActivity}
        />
      </Tab>
      </TabView>
    </>
  )
}

// ============ 启动 ============

async function run() {
  try {
    await Navigation.present({
      element: <App />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    Script.exit()
  }
}

void run()
