import {
  Widget,
  Script,
  fetch,
  VStack,
  HStack,
  ZStack,
  Spacer,
  Text,
  Image,
  Rectangle,
  RoundedRectangle,
  Gauge,
  Chart,
  BarChart,
  LineChart,
  gradient,
} from "scripting"

type WorkerStat = {
  name: string
  requests: number
  errors: number
}

type TrendPoint = {
  label: string
  requests: number
}

type WidgetConfig = {
  authMode: string
  token: string
  email: string
  apiKey: string
  accountId: string
  accountName: string
}

type WidgetData = {
  workers: WorkerStat[]
  totalRequests: number
  totalErrors: number
  todayWorkers: number
  todayPages: number
  dailyLimit: number
  trend: TrendPoint[]
  updatedAt: Date
}

const CF_API = "https://api.cloudflare.com/client/v4"
const CONFIG_PATH = FileManager.appGroupDocumentsDirectory + "/cf_widget_config.json"

const CF_ORANGE = "#F6821F"
const CF_ORANGE_LIGHT = "#FFB86B"
const DAILY_LIMIT = 100_000
const PRIMARY_TEXT = { light: "#16171A", dark: "#F7F7F8" } as const
const SECONDARY_TEXT = { light: "#74777E", dark: "#969AA3" } as const
const CARD_BACKGROUND = { light: "#F5F5F7", dark: "#111216" } as const

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return String(Math.round(n))
}

function formatQuota(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}M`
  }
  if (n >= 1_000) {
    const value = n / 1_000
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}k`
  }
  return String(Math.max(0, Math.round(n)))
}

function cfHeaders(cfg: WidgetConfig): Record<string, string> {
  if (cfg.authMode === "global") {
    return {
      "X-Auth-Email": cfg.email,
      "X-Auth-Key": cfg.apiKey,
      "Content-Type": "application/json",
    }
  }
  return {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  }
}

function readConfig(): WidgetConfig | null {
  try {
    if (!FileManager.existsSync(CONFIG_PATH)) return null
    const raw = FileManager.readAsStringSync(CONFIG_PATH)
    return JSON.parse(raw) as WidgetConfig
  } catch (e) {
    return null
  }
}

async function loadWidgetData(cfg: WidgetConfig): Promise<WidgetData> {
  // 1) 拉取 Workers 脚本列表
  const scriptsRes = await fetch(
    `${CF_API}/accounts/${cfg.accountId}/workers/scripts`,
    { headers: cfHeaders(cfg), timeout: 15 }
  )
  const scriptsJson = await scriptsRes.json()
  if (!scriptsJson.success) {
    throw new Error(scriptsJson.errors?.[0]?.message ?? `获取 Workers 失败（HTTP ${scriptsRes.status}）`)
  }
  const scriptNames: string[] = (scriptsJson.result ?? []).map((s: any) => s.id)

  // 2) GraphQL Analytics：近 7 天趋势 + 今日 Workers / Pages 配额
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayStart = today.toISOString()
  const now = new Date().toISOString()
  const query = `{
    viewer {
      accounts(filter: {accountTag: "${cfg.accountId}"}) {
        workers7d: workersInvocationsAdaptive(
          limit: 5000
          filter: {datetime_geq: "${since}"}
          orderBy: [datetime_ASC]
        ) {
          sum { requests errors subrequests }
          dimensions { datetime scriptName }
        }
        workersToday: workersInvocationsAdaptive(
          limit: 5000
          filter: {datetime_geq: "${todayStart}", datetime_leq: "${now}"}
        ) {
          sum { requests errors }
        }
        pagesToday: pagesFunctionsInvocationsAdaptiveGroups(
          limit: 1000
          filter: {datetime_geq: "${todayStart}", datetime_leq: "${now}"}
        ) {
          sum { requests }
        }
      }
    }
  }`

  const gqlRes = await fetch(`${CF_API}/graphql`, {
    method: "POST",
    headers: cfHeaders(cfg),
    body: JSON.stringify({ query }),
    timeout: 20,
  })
  const gqlJson = await gqlRes.json()
  if (gqlJson.errors?.length) {
    throw new Error(gqlJson.errors[0]?.message ?? "统计接口错误")
  }
  const accountData = gqlJson?.data?.viewer?.accounts?.[0] ?? {}
  const rows: any[] = accountData.workers7d ?? []
  const todayWorkers = (accountData.workersToday ?? []).reduce(
    (sum: number, row: any) => sum + (row?.sum?.requests ?? 0),
    0
  )
  const todayPages = (accountData.pagesToday ?? []).reduce(
    (sum: number, row: any) => sum + (row?.sum?.requests ?? 0),
    0
  )

  // 3) 聚合：按 worker、按天
  const perWorker = new Map<string, { requests: number; errors: number }>()
  const perDay = new Map<string, number>()
  let totalRequests = 0
  let totalErrors = 0

  for (const row of rows) {
    const name: string = row?.dimensions?.scriptName ?? "unknown"
    const req: number = row?.sum?.requests ?? 0
    const err: number = row?.sum?.errors ?? 0
    totalRequests += req
    totalErrors += err

    const w = perWorker.get(name) ?? { requests: 0, errors: 0 }
    w.requests += req
    w.errors += err
    perWorker.set(name, w)

    const day: string = (row?.dimensions?.datetime ?? "").slice(0, 10)
    if (day) perDay.set(day, (perDay.get(day) ?? 0) + req)
  }

  // 无 GraphQL 数据时回退到脚本列表本身（统计为零）
  if (perWorker.size === 0) {
    for (const name of scriptNames) {
      perWorker.set(name, { requests: 0, errors: 0 })
    }
  }

  const workers: WorkerStat[] = [...perWorker.entries()]
    .map(([name, s]) => ({ name, requests: s.requests, errors: s.errors }))
    .sort((a, b) => b.requests - a.requests)

  const trend: TrendPoint[] = [...perDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, requests]) => ({
      label: day.slice(5), // MM-DD
      requests,
    }))

  return {
    workers,
    totalRequests,
    totalErrors,
    todayWorkers,
    todayPages,
    dailyLimit: DAILY_LIMIT,
    trend,
    updatedAt: new Date(),
  }
}

// ── 背景 ─────────────────────────────────────────────────────────────────────

function WidgetBackground({ children }: { children: any }) {
  return (
    <ZStack>
      <Rectangle
        fill={gradient("linear", {
          colors: ["#081521", "#10263A", "#202343"],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        })}
        widgetBackground={gradient("linear", {
          colors: ["#081521", "#10263A", "#202343"],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        })}
        ignoresSafeArea
      />
      <VStack
        alignment="leading"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ horizontal: 14, vertical: 12 }}
      >
        {children}
      </VStack>
    </ZStack>
  )
}

function Header() {
  return (
    <HStack spacing={5}>
      <Image
        systemName="cloud.bolt.fill"
        foregroundStyle={CF_ORANGE}
        frame={{ width: 13, height: 13 }}
      />
      <Text font={11} fontWeight="semibold" foregroundStyle="white">
        CF Workers
      </Text>
    </HStack>
  )
}

function QuotaBackground({ children }: { children: any }) {
  return (
    <ZStack>
      <Rectangle fill={CARD_BACKGROUND} widgetBackground={CARD_BACKGROUND} ignoresSafeArea />
      <VStack
        alignment="leading"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ horizontal: 14, vertical: 12 }}
      >
        {children}
      </VStack>
    </ZStack>
  )
}

function QuotaHeader({ subtitle }: { subtitle?: string }) {
  return (
    <HStack spacing={6}>
      <Image
        systemName="cloud.fill"
        foregroundStyle={CF_ORANGE}
        frame={{ width: 15, height: 15 }}
      />
      <Text font={13} fontWeight="bold" foregroundStyle={PRIMARY_TEXT}>
        Cloudflare
      </Text>
      <Spacer />
      {subtitle ? (
        <Text font={8} foregroundStyle={SECONDARY_TEXT}>{subtitle}</Text>
      ) : null}
    </HStack>
  )
}

function Metric({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={3}>
        <Image systemName={icon} foregroundStyle={CF_ORANGE} frame={{ width: 9, height: 9 }} />
        <Text font={9} foregroundStyle={SECONDARY_TEXT}>{label}</Text>
      </HStack>
      <Text font={15} fontWeight="bold" foregroundStyle={PRIMARY_TEXT} monospacedDigit>
        {formatCompact(value)}
      </Text>
    </VStack>
  )
}

function UsageBlocks({ remaining, total }: { remaining: number; total: number }) {
  const count = 10
  const filled = total > 0 ? Math.ceil(Math.max(0, Math.min(1, remaining / total)) * count) : 0
  return (
    <HStack spacing={3} frame={{ maxWidth: "infinity" }}>
      {Array.from({ length: count }, (_, index) => (
        <RoundedRectangle
          key={String(index)}
          cornerRadius={2}
          fill={index < filled ? CF_ORANGE : { light: "#D9DADE", dark: "#34363C" }}
          frame={{ maxWidth: "infinity", height: 7 }}
        />
      ))}
    </HStack>
  )
}

function ErrorView({ message }: { message: string }) {
  return (
    <WidgetBackground>
      <Header />
      <Spacer />
      <Image systemName="exclamationmark.triangle.fill" foregroundStyle="#FFB86B" />
      <Text font={11} foregroundStyle="#FFD9B3" lineLimit={3}>
        {message}
      </Text>
      <Spacer />
    </WidgetBackground>
  )
}

function NoConfigView() {
  return (
    <WidgetBackground>
      <Header />
      <Spacer />
      <Image systemName="key.fill" foregroundStyle="#FFB86B" />
      <Text font={11} foregroundStyle="#FFD9B3" multilineTextAlignment="center">
        请在 Worker 面板保存 API Token 后刷新
      </Text>
      <Spacer />
    </WidgetBackground>
  )
}

// ── 小尺寸 ───────────────────────────────────────────────────────────────────

function SmallView({ data }: { data: WidgetData }) {
  const used = data.todayWorkers + data.todayPages
  const remaining = Math.max(0, data.dailyLimit - used)
  const date = data.updatedAt.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })

  return (
    <QuotaBackground>
      <QuotaHeader />
      <Spacer />
      <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
        <Metric icon="square.stack.3d.up.fill" label="Pages" value={data.todayPages} />
        <Spacer />
        <Metric icon="bolt.horizontal.fill" label="Workers" value={data.todayWorkers} />
      </HStack>
      <Spacer />
      <HStack spacing={4}>
        <Image systemName="network" foregroundStyle={CF_ORANGE} frame={{ width: 9, height: 9 }} />
        <Text font={9} foregroundStyle={SECONDARY_TEXT}>Remaining</Text>
        <Spacer />
        <Image systemName="clock" foregroundStyle={SECONDARY_TEXT} frame={{ width: 8, height: 8 }} />
        <Text font={8} foregroundStyle={SECONDARY_TEXT}>{date}</Text>
      </HStack>
      <Text font={14} fontWeight="bold" foregroundStyle={PRIMARY_TEXT} monospacedDigit>
        {formatQuota(remaining)} / {formatQuota(data.dailyLimit)}
      </Text>
      <UsageBlocks remaining={remaining} total={data.dailyLimit} />
    </QuotaBackground>
  )
}

// ── 中尺寸 ───────────────────────────────────────────────────────────────────

function MediumView({ data }: { data: WidgetData }) {
  const used = data.todayWorkers + data.todayPages
  const remaining = Math.max(0, data.dailyLimit - used)
  const percentUsed = data.dailyLimit > 0 ? Math.min(1, used / data.dailyLimit) : 0
  const successRate = data.totalRequests > 0
    ? Math.max(0, Math.min(1, 1 - data.totalErrors / data.totalRequests))
    : 1
  const date = data.updatedAt.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })

  return (
    <QuotaBackground>
      <QuotaHeader subtitle={`更新于 ${date}`} />
      <Spacer />
      <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
        <Metric icon="square.stack.3d.up.fill" label="Pages 今日调用" value={data.todayPages} />
        <Spacer />
        <Metric icon="bolt.horizontal.fill" label="Workers 今日调用" value={data.todayWorkers} />
        <Spacer />
        <VStack alignment="leading" spacing={2}>
          <Text font={9} foregroundStyle={SECONDARY_TEXT}>成功率</Text>
          <Text font={15} fontWeight="bold" foregroundStyle={successRate > 0.99 ? "#32B768" : CF_ORANGE} monospacedDigit>
            {(successRate * 100).toFixed(1)}%
          </Text>
        </VStack>
      </HStack>
      <Spacer />
      <HStack spacing={6}>
        <VStack alignment="leading" spacing={1}>
          <Text font={9} foregroundStyle={SECONDARY_TEXT}>Remaining</Text>
          <Text font={16} fontWeight="bold" foregroundStyle={PRIMARY_TEXT} monospacedDigit>
            {formatQuota(remaining)} / {formatQuota(data.dailyLimit)}
          </Text>
        </VStack>
        <Spacer />
        <Text font={9} foregroundStyle={SECONDARY_TEXT} monospacedDigit>
          已用 {(percentUsed * 100).toFixed(2)}%
        </Text>
      </HStack>
      <UsageBlocks remaining={remaining} total={data.dailyLimit} />
    </QuotaBackground>
  )
}

// ── 大尺寸 ───────────────────────────────────────────────────────────────────

function LargeView({ data }: { data: WidgetData }) {
  const successRate =
    data.totalRequests > 0
      ? Math.max(0, Math.min(1, 1 - data.totalErrors / data.totalRequests))
      : 1
  const bars = data.workers.slice(0, 6).map((w) => ({
    label: w.name.length > 16 ? w.name.slice(0, 15) + "…" : w.name,
    value: w.requests,
    foregroundStyle: gradient("linear", {
      colors: [CF_ORANGE, CF_ORANGE_LIGHT],
      startPoint: "bottom",
      endPoint: "top",
    }),
    cornerRadius: 3,
  }))
  const lines = data.trend.map((t) => ({
    label: t.label,
    value: t.requests,
    foregroundStyle: "#FFB86B" as const,
    symbolSize: 3,
  }))

  return (
    <WidgetBackground>
      <HStack spacing={8}>
        <Header />
        <Spacer />
        <Text font={9} foregroundStyle="#FFD9B3">
          {data.updatedAt.toLocaleTimeString()} 更新
        </Text>
      </HStack>

      <HStack spacing={16}>
        <VStack alignment="leading" spacing={2}>
          <Text font={10} foregroundStyle="#FFD9B3">总调用</Text>
          <Text font={24} fontWeight="bold" foregroundStyle="white" monospacedDigit>
            {formatCompact(data.totalRequests)}
          </Text>
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font={10} foregroundStyle="#FFD9B3">错误</Text>
          <Text font={24} fontWeight="bold" foregroundStyle="#FF8A80" monospacedDigit>
            {formatCompact(data.totalErrors)}
          </Text>
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font={10} foregroundStyle="#FFD9B3">成功率</Text>
          <Text font={24} fontWeight="bold" foregroundStyle="#7CF29C" monospacedDigit>
            {(successRate * 100).toFixed(1)}%
          </Text>
        </VStack>
      </HStack>

      <Spacer />

      <Text font={11} fontWeight="semibold" foregroundStyle="#FFD9B3">
        各 Worker 调用量（近 7 天）
      </Text>
      <Chart frame={{ height: 110 }}>
        <BarChart labelOnYAxis={true} marks={bars} />
      </Chart>

      <Spacer />

      <Text font={11} fontWeight="semibold" foregroundStyle="#FFD9B3">
        调用趋势
      </Text>
      {data.trend.length > 1 ? (
        <Chart frame={{ height: 90 }}>
          <LineChart marks={lines} />
        </Chart>
      ) : (
        <Text font={11} foregroundStyle="#FFD9B3">
          暂无趋势数据
        </Text>
      )}
    </WidgetBackground>
  )
}

// ── 锁屏附件 ─────────────────────────────────────────────────────────────────

function AccessoryRectView({ data }: { data: WidgetData }) {
  const successRate =
    data.totalRequests > 0
      ? Math.max(0, Math.min(1, 1 - data.totalErrors / data.totalRequests))
      : 1
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={4}>
        <Image systemName="cloud.bolt.fill" frame={{ width: 12, height: 12 }} />
        <Text font={11} fontWeight="semibold">CF Workers</Text>
      </HStack>
      <Text font={13} monospacedDigit>
        调用 {formatCompact(data.totalRequests)} · 错误 {formatCompact(data.totalErrors)}
      </Text>
      <Text font={11} foregroundStyle="#A6B7CC">
        成功率 {(successRate * 100).toFixed(1)}% · {data.workers.length} 脚本
      </Text>
    </VStack>
  )
}

function AccessoryCircView({ data }: { data: WidgetData }) {
  const successRate =
    data.totalRequests > 0
      ? Math.max(0, Math.min(1, 1 - data.totalErrors / data.totalRequests))
      : 1
  return (
    <Gauge
      value={successRate}
      label={<Text font={8}>成功率</Text>}
      max={1}
      gaugeStyle="accessoryCircularCapacity"
      currentValueLabel={
        <Text font={9} fontWeight="bold">
          {(successRate * 100).toFixed(0)}%
        </Text>
      }
    />
  )
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

function WidgetView({ data, error, configured }: { data: WidgetData | null; error: string | null; configured: boolean }) {
  if (!configured) {
    return <NoConfigView />
  }
  if (error) return <ErrorView message={error} />
  if (!data) {
    return (
      <WidgetBackground>
        <Header />
        <Spacer />
        <Text font={12} foregroundStyle="#FFD9B3">加载中…</Text>
        <Spacer />
      </WidgetBackground>
    )
  }

  const family = Widget.family
  if (family === "systemMedium") return <MediumView data={data} />
  if (family === "systemLarge") return <LargeView data={data} />
  if (family === "accessoryRectangular") return <AccessoryRectView data={data} />
  if (family === "accessoryCircular") return <AccessoryCircView data={data} />
  return <SmallView data={data} />
}

async function run() {
  try {
    const cfg = readConfig()
    if (!cfg || !cfg.token) {
      Widget.present(<WidgetView configured={false} data={null} error={null} />, {
        reloadPolicy: { policy: "after", date: new Date(Date.now() + 60 * 60 * 1000) },
      })
      return
    }

    let data: WidgetData | null = null
    let error: string | null = null
    try {
      data = await loadWidgetData(cfg)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    Widget.present(<WidgetView configured={true} data={data} error={error} />, {
      reloadPolicy: {
        policy: "after",
        date: new Date(Date.now() + 15 * 60 * 1000),
      },
    })
  } finally {
    Script.exit()
  }
}

run()
