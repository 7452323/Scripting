import {
  Navigation,
  NavigationStack,
  Script,
  Widget,
  Editor,
  Chart,
  LineChart,
  Form,
  Section,
  SecureField,
  TextField,
  LabeledContent,
  NavigationLink,
  VStack,
  HStack,
  Button,
  Text,
  Image,
  ProgressView,
  ContentUnavailableView,
  Picker,
  useState,
  useEffect,
  fetch,
  useMemo,
} from "scripting"

type AccountInfo = {
  id: string
  name: string
  type: string
}

type WorkerScript = {
  id: string
  created_on: string
  modified_on: string
  usage_model?: string
}

type WorkerSource = {
  code: string
  metadata: Record<string, unknown>
  editable: boolean
  reason?: string
}

type WorkerAnalytics = {
  totalRequests: number
  totalErrors: number
  totalSubrequests: number
  cpuP50: number
  cpuP99: number
  points: Array<{ label: string; requests: number }>
}

function parseWorkerParts(raw: string, contentType: string): WorkerSource {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2]
  if (!boundary) {
    return { code: raw, metadata: {}, editable: true }
  }

  const parts = raw.replace(/\r\n/g, "\n").split(`--${boundary}`)
  let code = ""
  let metadata: Record<string, unknown> = {}
  let contentParts = 0

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === "--") continue
    const split = trimmed.indexOf("\n\n")
    if (split < 0) continue
    const headers = trimmed.slice(0, split).toLowerCase()
    const body = trimmed.slice(split + 2).replace(/\n--$/, "").trimEnd()
    if (headers.includes("name=\"metadata\"") || headers.includes("metadata.json")) {
      try { metadata = JSON.parse(body) as Record<string, unknown> } catch { /* keep empty metadata */ }
      continue
    }
    if (
      headers.includes("javascript") ||
      headers.includes("worker.js") ||
      headers.includes("index.js") ||
      headers.includes("script")
    ) {
      contentParts += 1
      if (!code) code = body
    }
  }

  const editable = contentParts <= 1
  return {
    code: code || raw,
    metadata,
    editable,
    reason: editable ? undefined : "检测到多个 Worker 模块或资源文件，当前编辑器不会回写，以避免丢失依赖文件。",
  }
}

async function readWorkerSource(
  accountId: string,
  scriptName: string,
  headers: Record<string, string>
): Promise<WorkerSource> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/content/v2`,
    { headers, timeout: 20 }
  )
  if (!res.ok) throw new Error(`读取 Worker 源码失败（HTTP ${res.status}）`)
  const raw = await res.text()
  return parseWorkerParts(raw, res.headers.get("content-type") ?? "")
}

async function readWorkerSettings(
  accountId: string,
  scriptName: string,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
    { headers, timeout: 20 }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.errors?.[0]?.message ?? "读取 Worker 配置失败")
  return (json.result ?? {}) as Record<string, unknown>
}

function buildWorkerMultipart(code: string, metadata: Record<string, unknown>): { boundary: string; body: Data } {
  const boundary = `----WorkerPanel${Date.now().toString(36)}`
  const nextMetadata = { ...metadata }
  const moduleName = typeof nextMetadata.main_module === "string" ? nextMetadata.main_module : "script"
  if (moduleName === "script") {
    delete nextMetadata.main_module
    nextMetadata.body_part = "script"
  } else {
    delete nextMetadata.body_part
    nextMetadata.main_module = moduleName
  }
  const contentType = moduleName === "script" ? "application/javascript" : "application/javascript+module"
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="metadata"; filename="metadata.json"`,
    "Content-Type: application/json",
    "",
    JSON.stringify(nextMetadata),
    `--${boundary}`,
    `Content-Disposition: form-data; name="${moduleName}"; filename="${moduleName}"`,
    `Content-Type: ${contentType}`,
    "",
    code.replace(/\r\n?/g, "\n"),
    `--${boundary}--`,
    "",
  ].join("\r\n")
  const body = Data.fromRawString(payload, "utf-8")
  if (!body) throw new Error("构建部署请求失败")
  return { boundary, body }
}

async function deployWorkerSource(
  accountId: string,
  scriptName: string,
  code: string,
  metadata: Record<string, unknown>,
  headers: Record<string, string>
): Promise<void> {
  const multipart = buildWorkerMultipart(code, metadata)
  const res = await fetch(
    `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` },
      body: multipart.body,
      timeout: 30,
    }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.errors?.[0]?.message ?? `部署失败（HTTP ${res.status}）`)
}

async function fetchWorkerAnalytics(
  accountId: string,
  scriptName: string,
  headers: Record<string, string>
): Promise<WorkerAnalytics> {
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const query = `{
    viewer {
      accounts(filter: {accountTag: "${accountId}"}) {
        workersInvocationsAdaptive(
          limit: 5000
          filter: {datetime_geq: "${start}", scriptName: "${scriptName}"}
          orderBy: [datetime_ASC]
        ) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
          dimensions { datetime }
        }
      }
    }
  }`
  const res = await fetch(`${CF_API_BASE}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    timeout: 25,
  })
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "获取分析数据失败")
  const rows: any[] = json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
  let totalRequests = 0
  let totalErrors = 0
  let totalSubrequests = 0
  let cpuP50 = 0
  let cpuP99 = 0
  const points = rows.map((row: any) => {
    totalRequests += Number(row?.sum?.requests ?? 0)
    totalErrors += Number(row?.sum?.errors ?? 0)
    totalSubrequests += Number(row?.sum?.subrequests ?? 0)
    cpuP50 = Math.max(cpuP50, Number(row?.quantiles?.cpuTimeP50 ?? 0))
    cpuP99 = Math.max(cpuP99, Number(row?.quantiles?.cpuTimeP99 ?? 0))
    return {
      label: String(row?.dimensions?.datetime ?? "").slice(5, 16).replace("T", " "),
      requests: Number(row?.sum?.requests ?? 0),
    }
  }).slice(-24)
  return { totalRequests, totalErrors, totalSubrequests, cpuP50, cpuP99, points }
}

async function deleteWorkerScript(
  accountId: string,
  scriptName: string,
  headers: Record<string, string>
): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`,
    { method: "DELETE", headers, timeout: 20 }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.errors?.[0]?.message ?? `删除失败（HTTP ${res.status}）`)
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4"
const WIDGET_CONFIG_PATH =
  FileManager.appGroupDocumentsDirectory + "/cf_widget_config.json"

function persistWidgetConfig() {
  const authMode = Storage.get<string>("cf_auth_mode") ?? "token"
  const token = Keychain.get("cf_api_token") ?? ""
  const email = Keychain.get("cf_email") ?? ""
  const apiKey = Keychain.get("cf_global_key") ?? ""
  const accountId = Storage.get<string>("cf_account_id") ?? ""
  const accountName = Storage.get<string>("cf_account_name") ?? ""
  try {
    FileManager.writeAsStringSync(
      WIDGET_CONFIG_PATH,
      JSON.stringify({
        authMode,
        token,
        email,
        apiKey,
        accountId,
        accountName,
      })
    )
  } catch (e) {
    console.log("persist widget config failed", e)
  }
}

function removeWidgetConfig() {
  try {
    if (FileManager.existsSync(WIDGET_CONFIG_PATH)) {
      FileManager.removeSync(WIDGET_CONFIG_PATH)
    }
  } catch (e) {
    console.log("remove widget config failed", e)
  }
}

function cfHeaders(
  authMode: string,
  token: string,
  email: string,
  apiKey: string
): Record<string, string> {
  if (authMode === "global") {
    return {
      "X-Auth-Email": email,
      "X-Auth-Key": apiKey,
      "Content-Type": "application/json",
    }
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

async function fetchAccounts(headers: Record<string, string>): Promise<AccountInfo[]> {
  const res = await fetch(`${CF_API_BASE}/accounts`, { headers, timeout: 20 })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message ?? `获取账户失败（HTTP ${res.status}）`)
  }
  return json.result as AccountInfo[]
}

async function fetchWorkers(
  accountId: string,
  headers: Record<string, string>
): Promise<WorkerScript[]> {
  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/workers/scripts`, {
    headers,
    timeout: 20,
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message ?? `获取 Workers 失败（HTTP ${res.status}）`)
  }
  return json.result as WorkerScript[]
}

function formatDate(iso: string): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleString()
}

function WorkerDetail({
  script,
  account,
}: {
  script: WorkerScript
  account: AccountInfo | undefined
}) {
  const [source, setSource] = useState<WorkerSource | null>(null)
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [working, setWorking] = useState<boolean>(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<WorkerAnalytics | null>(null)

  const authMode = Storage.get<string>("cf_auth_mode") ?? "token"
  const token = Keychain.get("cf_api_token") ?? ""
  const email = Keychain.get("cf_email") ?? ""
  const apiKey = Keychain.get("cf_global_key") ?? ""
  const headers = cfHeaders(authMode, token, email, apiKey)

  async function loadDetails() {
    if (!account?.id) return
    setLoading(true)
    setDetailError(null)
    try {
      const [nextSource, nextSettings] = await Promise.all([
        readWorkerSource(account.id, script.id, headers),
        readWorkerSettings(account.id, script.id, headers),
      ])
      setSource(nextSource)
      setSettings(nextSettings)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetails()
  }, [])

  async function openAnalytics() {
    if (!account?.id) return
    setWorking(true)
    try {
      setAnalytics(await fetchWorkerAnalytics(account.id, script.id, headers))
    } catch (e) {
      await Dialog.alert({ title: "分析失败", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setWorking(false)
    }
  }

  async function openSettingsEditor() {
    if (!settings) return
    Navigation.present(
      <WorkerJsonEditor
        scriptName={script.id}
        initialValue={settings}
        onSave={async (nextSettings) => {
          setWorking(true)
          try {
            const settingsUrl = `${CF_API_BASE}/accounts/${encodeURIComponent(account?.id ?? "")}/workers/scripts/${encodeURIComponent(script.id)}/settings`
            const res = await fetch(settingsUrl, {
              method: "PATCH",
              headers,
              body: JSON.stringify(nextSettings),
              timeout: 20,
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.errors?.[0]?.message ?? `保存配置失败（HTTP ${res.status}）`)
            await Dialog.alert({ message: "Worker 配置已保存" })
            await loadDetails()
          } finally {
            setWorking(false)
          }
        }}
      />
    )
  }

  async function openEditor() {
    if (!source) return
    if (!source.editable) {
      await Dialog.alert({ title: "暂不支持编辑", message: source.reason ?? "检测到多模块 Worker。" })
      return
    }
    Navigation.present(
      <WorkerCodeEditor
        scriptName={script.id}
        initialCode={source.code}
        onSave={async (nextCode: string) => {
          setWorking(true)
          try {
            await deployWorkerSource(account?.id ?? "", script.id, nextCode, settings ?? {}, headers)
            await Dialog.alert({ message: "Worker 已保存并部署" })
            await loadDetails()
          } finally {
            setWorking(false)
          }
        }}
      />
    )
  }

  async function deleteScript() {
    const confirmed = await Dialog.confirm({
      title: "删除 Worker",
      message: `确定删除「${script.id}」吗？此操作不可恢复。`,
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (!confirmed || !account?.id) return
    setWorking(true)
    try {
      await deleteWorkerScript(account.id, script.id, headers)
      await Dialog.alert({ message: "Worker 已删除，请返回列表刷新。" })
    } catch (e) {
      await Dialog.alert({ title: "删除失败", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setWorking(false)
    }
  }

  const bindingCount = Array.isArray(settings?.bindings) ? settings?.bindings.length : 0

  return (
    <Form formStyle="grouped" navigationTitle={script.id} navigationBarTitleDisplayMode="inline">
      <Section header={<Text>脚本信息</Text>}>
        <LabeledContent title="脚本名称" value={script.id} />
        <LabeledContent title="用量模型" value={String(settings?.usage_model ?? script.usage_model ?? "-")} />
        <LabeledContent title="绑定数量" value={String(bindingCount)} />
        <LabeledContent title="源码状态" value={loading ? "读取中…" : source ? (source.editable ? "可编辑" : "多模块，仅可查看") : "未读取"} />
      </Section>
      <Section header={<Text>部署信息</Text>}>
        <LabeledContent title="创建时间" value={formatDate(script.created_on)} />
        <LabeledContent title="最后修改" value={formatDate(script.modified_on)} />
        {settings?.compatibility_date ? <LabeledContent title="兼容日期" value={String(settings.compatibility_date)} /> : null}
      </Section>
      <Section header={<Text>所属账户</Text>}>
        <LabeledContent title="账户名称" value={account?.name ?? "-"} />
        <LabeledContent title="账户 ID" value={account?.id ?? "-"} />
        <LabeledContent title="账户类型" value={account?.type ?? "-"} />
      </Section>
      <Section header={<Text>源码管理</Text>} footer={source?.reason ? <Text>{source.reason}</Text> : undefined}>
        {detailError ? <Text foregroundStyle="red">{detailError}</Text> : null}
        <Button title="刷新详情" systemImage="arrow.clockwise" action={loadDetails} disabled={loading || working} />
        <Button title="查看源码" systemImage="eye" action={() => {
          if (source) Navigation.present(<WorkerCodeViewer scriptName={script.id} code={source.code} />)
        }} disabled={!source || loading || working} />
        <Button title="编辑并部署" systemImage="pencil" action={openEditor} disabled={!source || !source.editable || loading || working} />
      </Section>
      <Section header={<Text>请求分析</Text>}>
        <Button title="加载近 7 天统计" systemImage="chart.xyaxis.line" action={openAnalytics} disabled={working || loading} />
        {analytics ? (
          <>
            <LabeledContent title="请求总数" value={String(analytics.totalRequests)} />
            <LabeledContent title="错误数" value={String(analytics.totalErrors)} />
            <LabeledContent title="错误率" value={`${analytics.totalRequests ? ((analytics.totalErrors / analytics.totalRequests) * 100).toFixed(2) : "0.00"}%`} />
            <LabeledContent title="子请求" value={String(analytics.totalSubrequests)} />
            <LabeledContent title="CPU P50 / P99" value={`${analytics.cpuP50} / ${analytics.cpuP99}`} />
            {analytics.points.length > 1 ? (
              <Chart frame={{ height: 120 }} chartYAxis="hidden">
                <LineChart marks={analytics.points.map(point => ({ label: point.label, value: point.requests, foregroundStyle: "#F6821F", symbolSize: 3 }))} />
              </Chart>
            ) : null}
          </>
        ) : null}
      </Section>
      <Section header={<Text>绑定与配置</Text>} footer={<Text>高级编辑会直接提交当前 Worker settings，请确认 JSON 字段含义后再保存。</Text>}>
        <Button title="查看配置 JSON" systemImage="curlybraces" action={() => {
          if (settings) Navigation.present(<WorkerCodeViewer scriptName={`${script.id}-settings`} code={JSON.stringify(settings, null, 2)} />)
        }} disabled={!settings || loading || working} />
        <Button title="编辑配置 JSON" systemImage="slider.horizontal.3" action={openSettingsEditor} disabled={!settings || loading || working} />
      </Section>
      <Section header={<Text>危险操作</Text>}>
        <Button title="删除 Worker" systemImage="trash" role="destructive" action={deleteScript} disabled={working} />
      </Section>
    </Form>
  )
}

function WorkerCodeViewer({ scriptName, code }: { scriptName: string; code: string }) {
  const controller = useMemo(() => new EditorController({ content: code, ext: "js", readOnly: true }), [])
  useEffect(() => () => controller.dispose(), [controller])
  return <Editor controller={controller} scriptName={scriptName} showAccessoryView={true} searchEnabled={true} exportEnabled={true} />
}

function WorkerJsonEditor({
  scriptName,
  initialValue,
  onSave,
}: {
  scriptName: string
  initialValue: Record<string, unknown>
  onSave: (value: Record<string, unknown>) => Promise<void>
}) {
  const [saving, setSaving] = useState<boolean>(false)
  const initialJson = JSON.stringify(initialValue, null, 2)
  const controller = useMemo(() => new EditorController({ content: initialJson, ext: "json", readOnly: false }), [])
  useEffect(() => () => controller.dispose(), [controller])

  async function save() {
    let parsed: unknown
    try {
      parsed = JSON.parse(controller.content)
    } catch (e) {
      await Dialog.alert({ title: "JSON 无效", message: e instanceof Error ? e.message : "请检查 JSON 格式" })
      return
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      await Dialog.alert({ message: "配置必须是 JSON 对象" })
      return
    }
    setSaving(true)
    try {
      await onSave(parsed as Record<string, unknown>)
      await controller.dismiss()
    } catch (e) {
      await Dialog.alert({ title: "保存配置失败", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Editor
      controller={controller}
      scriptName={`${scriptName}-settings`}
      showAccessoryView={true}
      searchEnabled={true}
      toolbar={{
        topBarTrailing: [saving ? <ProgressView /> : <Button title="保存" systemImage="checkmark" action={save} />],
      }}
    />
  )
}

function WorkerCodeEditor({
  scriptName,
  initialCode,
  onSave,
}: {
  scriptName: string
  initialCode: string
  onSave: (code: string) => Promise<void>
}) {
  const [saving, setSaving] = useState<boolean>(false)
  const controller = useMemo(() => new EditorController({ content: initialCode, ext: "js", readOnly: false }), [])
  useEffect(() => () => controller.dispose(), [controller])

  async function save() {
    setSaving(true)
    try {
      await onSave(controller.content)
      await controller.dismiss()
    } catch (e) {
      await Dialog.alert({ title: "部署失败", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Editor
      controller={controller}
      scriptName={scriptName}
      showAccessoryView={true}
      searchEnabled={true}
      toolbar={{
        topBarTrailing: [
          saving ? <ProgressView /> : <Button title="部署" systemImage="arrow.up.circle" action={save} />,
        ],
      }}
    />
  )
}

function CFWorkersPanel() {
  const [authMode, setAuthMode] = useState<string>("token")
  const [token, setToken] = useState<string>("")
  const [email, setEmail] = useState<string>("")
  const [apiKey, setApiKey] = useState<string>("")
  const [accountId, setAccountId] = useState<string>("")
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [workers, setWorkers] = useState<WorkerScript[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [hasCredential, setHasCredential] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)

  async function loadData(mode: string, tk: string, em: string, ak: string, accId: string) {
    const headers = cfHeaders(mode, tk, em, ak)
    const accs = await fetchAccounts(headers)
    setAccounts(accs)
    const target = accId && accs.some(a => a.id === accId) ? accId : (accs[0]?.id ?? "")
    setAccountId(target)
    Storage.set("cf_account_id", target)
    const acc = accs.find(a => a.id === target)
    Storage.set("cf_account_name", acc?.name ?? "")
    persistWidgetConfig()
    if (target) {
      setWorkers(await fetchWorkers(target, headers))
    } else {
      setWorkers([])
    }
  }

  useEffect(() => {
    const savedMode = Storage.get<string>("cf_auth_mode") ?? "token"
    const savedToken = Keychain.get("cf_api_token")
    const savedEmail = Keychain.get("cf_email")
    const savedApiKey = Keychain.get("cf_global_key")
    const savedAccountId = Storage.get<string>("cf_account_id") ?? ""
    if (savedToken || (savedEmail && savedApiKey)) {
      setAuthMode(savedMode)
      if (savedToken) setToken(savedToken)
      if (savedEmail) setEmail(savedEmail)
      if (savedApiKey) setApiKey(savedApiKey)
      setAccountId(savedAccountId)
      setHasCredential(true)
      setLoading(true)
      setError(null)
      loadData(savedMode, savedToken ?? "", savedEmail ?? "", savedApiKey ?? "", savedAccountId)
        .catch(e => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false))
    }
  }, [])

  async function saveCredentials() {
    if (authMode === "token" && !token.trim()) {
      setError("请先输入 API Token")
      return
    }
    if (authMode === "global" && (!email.trim() || !apiKey.trim())) {
      setError("请先输入账户邮箱和 Global API Key")
      return
    }
    setLoading(true)
    setError(null)
    try {
      if (authMode === "token") {
        Keychain.set("cf_api_token", token.trim())
      } else {
        Keychain.set("cf_email", email.trim())
        Keychain.set("cf_global_key", apiKey.trim())
      }
      Storage.set("cf_auth_mode", authMode)
      setHasCredential(true)
      await loadData(authMode, token.trim(), email.trim(), apiKey.trim(), accountId.trim())
      persistWidgetConfig()
      try { Widget.reloadUserWidgets() } catch (e) { console.log("reload widgets failed", e) }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function selectAccount(id: string) {
    setAccountId(id)
    Storage.set("cf_account_id", id)
    setLoading(true)
    setError(null)
    try {
      setWorkers(await fetchWorkers(id, cfHeaders(authMode, token, email, apiKey)))
      const account = accounts.find(item => item.id === id)
      Storage.set("cf_account_name", account?.name ?? "")
      persistWidgetConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    if (!hasCredential) return
    setLoading(true)
    setError(null)
    try {
      await loadData(authMode, token, email, apiKey, accountId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function clearCredentials() {
    Keychain.remove("cf_api_token")
    Keychain.remove("cf_email")
    Keychain.remove("cf_global_key")
    Storage.remove("cf_account_id")
    Storage.remove("cf_account_name")
    Storage.remove("cf_auth_mode")
    setToken("")
    setEmail("")
    setApiKey("")
    setAccountId("")
    setAccounts([])
    setWorkers([])
    setError(null)
    setHasCredential(false)
    removeWidgetConfig()
    try { Widget.reloadUserWidgets() } catch (e) { console.log("reload widgets failed", e) }
  }

  const currentAccount = accounts.find(a => a.id === accountId)

  const errorSection = error ? (
    <Section>
      <HStack spacing={8}>
        <Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" />
        <Text foregroundStyle="red">{error}</Text>
      </HStack>
    </Section>
  ) : null

  const credentialSection = (
    <>
      <Section header={<Text>API 凭据</Text>} footer={<Text>Token 仅保存在本机钥匙串中，不会上传。</Text>}>
        <Picker title="认证方式" value={authMode} onChanged={(v: string | number) => setAuthMode(String(v))} pickerStyle="segmented">
          <Text tag="token">API Token</Text>
          <Text tag="global">Global Key</Text>
        </Picker>
        {authMode === "token" ? (
          <SecureField title="API Token" value={token} onChanged={setToken} prompt="粘贴 Cloudflare API Token" />
        ) : (
          <>
            <TextField title="账户邮箱" value={email} onChanged={setEmail} prompt="name@example.com" />
            <SecureField title="Global API Key" value={apiKey} onChanged={setApiKey} prompt="粘贴 Global API Key" />
          </>
        )}
        <Button title="保存并验证" systemImage="checkmark.circle.fill" action={saveCredentials} />
        {hasCredential ? <Button title="清除凭据" systemImage="trash" role="destructive" action={clearCredentials} /> : null}
      </Section>
      {errorSection}
    </>
  )

  const accountAndWorkersSections = (
    <>
      {errorSection}
      {hasCredential && accounts.length > 0 ? (
        <Section header={<Text>账户</Text>}>
          {loading ? <ProgressView title="加载中…" progressViewStyle="circular" /> : (
            <>
              <Picker title="账户" pickerStyle="menu" value={accountId} onChanged={(v: string | number) => selectAccount(String(v))}>
                {accounts.map(acc => <Text key={acc.id} tag={acc.id}>{acc.name}</Text>)}
              </Picker>
              <LabeledContent title="账户名称" value={currentAccount?.name ?? "-"} />
              <LabeledContent title="账户 ID" value={accountId || "-"} />
            </>
          )}
        </Section>
      ) : null}
      {hasCredential && accounts.length > 0 && workers.length > 0 ? (
        <Section header={<Text>Workers 脚本（{workers.length}）</Text>}>
          {loading ? <ProgressView title="加载中…" progressViewStyle="circular" /> : workers.map(script => (
            <NavigationLink key={script.id} destination={<WorkerDetail script={script} account={currentAccount} />}>
              <HStack spacing={10}>
                <Image systemName="shippingbox.fill" />
                <VStack alignment="leading" spacing={2}>
                  <Text foregroundStyle="label" lineLimit={1}>{script.id}</Text>
                  <Text font={11} foregroundStyle="#8E8E93" lineLimit={1}>修改于 {formatDate(script.modified_on)}</Text>
                </VStack>
              </HStack>
            </NavigationLink>
          ))}
        </Section>
      ) : null}
      {hasCredential && accounts.length > 0 && workers.length === 0 && !loading ? (
        <Section header={<Text>Workers 脚本</Text>}>
          <ContentUnavailableView title="暂无 Worker" systemImage="cube.box" description="该账户下没有部署 Workers 脚本" />
        </Section>
      ) : null}
    </>
  )

  return (
    <NavigationStack>
      <Form
        formStyle="grouped"
        navigationTitle={showSettings ? "设置" : "CF Workers 面板"}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: showSettings ? (
            <Button title="返回" systemImage="chevron.left" action={() => setShowSettings(false)} />
          ) : (
            <Button title="设置" systemImage="gearshape" action={() => setShowSettings(true)} />
          ),
          topBarTrailing: showSettings ? [] : [
            <Button title="刷新" systemImage="arrow.clockwise" action={refresh} />,
          ],
        }}
      >
        {showSettings ? credentialSection : accountAndWorkersSections}
      </Form>
    </NavigationStack>
  )
}

async function run() {
  try {
    await Navigation.present({ element: <CFWorkersPanel /> })
  } finally {
    Script.exit()
  }
}

run()
