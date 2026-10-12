import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Section,
  Picker,
  VStack,
  HStack,
  Text,
  Button,
  Image,
  useState,
  useObservable,
  useEffect,
  fetch,
} from "scripting"

/* ==================== 首次使用 / 版本更新说明（底部 Sheet） ==================== */

const __releaseNotesVersion = "1.6.0"
const __releaseNotesStorageKey = "release-notes-version"
const __releaseNotesItems = [
  "底部「使用步骤」改为「关于」：写清用途、扫码时客户端名的显示规则、以及网页版工具必须用 web Cookie。",
  "「关于」里显示当前版本号。",
  "按钮文案调整：「重新获取」→「重获Cookie」，「清除保存的 Cookie」→「清除 Cookie」。",
  "去掉登录设备下面那段说明文字。",
  "纠正上一个版本的错误：之前以为「二维码要按所选设备生成」。实测 + 上游作者确认：115 的 token 接口固定用网页端，扫码时 App 上显示的客户端名是 115 固定的提示，本来就不会跟着选择变。",
  "真正决定绑定哪个客户端的是「换取 Cookie」的请求，这一步一直是按你选的设备走的。",
  "界面加了解释文字，避免再被二维码里的客户端提示误导。",
  "新增「检测 Cookie」按钮：直接向 115 校验当前 Cookie 是否还有效，失效时展示 115 返回的原因。",
  "检测结果不写盘，每次打开需手动点一次，避免看到过期的「有效」。",
  "新增「登录设备」选择：支持 web / android / ios / linux / mac / windows / tv / 支付宝小程序 / 微信小程序 / qandroid 共 10 种客户端。",
  "切换设备后用同一张二维码即可换取对应客户端的 Cookie，已保存的 Cookie 不会被误清除。",
  "获取失败时直接展示 115 返回的原因；若 web 端被限制会自动改试 qandroid。",
  "已标注坑点：非 web 客户端拿到的是 App Cookie（UID 带 _A1_），网页版 115 工具只认 web Cookie（_F1_）。",
  "非 web 客户端不再遗漏 Cookie 字段（原实现只保留 UID/CID/KID/SEID/LT）。",
]

function ReleaseNotesGate({ children }: { children: any }) {
  const [showReleaseNotes, setShowReleaseNotes] = useState(
    () => Storage.get<string>(__releaseNotesStorageKey) !== __releaseNotesVersion
  )
  const [title] = useState(() =>
    Storage.contains(__releaseNotesStorageKey) ? "本次更新" : "首次使用"
  )

  const dismissReleaseNotes = () => {
    Storage.set(__releaseNotesStorageKey, __releaseNotesVersion)
    setShowReleaseNotes(false)
  }

  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={
        showReleaseNotes
          ? {
              isPresented: true,
              onChanged: (visible: boolean) => {
                if (!visible) dismissReleaseNotes()
              },
              content: (
                <VStack
                  alignment="leading"
                  spacing={16}
                  padding={22}
                  presentationDetents={[380]}
                  presentationDragIndicator="visible"
                >
                  <Text font={20} fontWeight="bold">
                    {title} · v{__releaseNotesVersion}
                  </Text>
                  {title === "首次使用" ? (
                    <Text font={15} lineSpacing={4}>
                      选择要绑定的登录设备，再用 115 App 扫描二维码；扫码确认后 Cookie 会自动保存并复制到剪贴板。
                    </Text>
                  ) : null}
                  <VStack alignment="leading" spacing={10}>
                    {__releaseNotesItems.map((item, index) => (
                      <Text key={index} font={14} lineSpacing={4}>
                        • {item}
                      </Text>
                    ))}
                  </VStack>
                  <Button
                    title="开始使用"
                    systemImage="arrow.right.circle.fill"
                    buttonStyle="borderedProminent"
                    action={dismissReleaseNotes}
                  />
                </VStack>
              ),
            }
          : undefined
      }
    >
      {children}
    </VStack>
  )
}

/* ==================== 115 API ==================== */

/**
 * 二维码 token 固定用网页端接口。
 * 上游作者原话：“第一步获取一个 token，我用的网页端的接口，这不影响最终绑定的客户端，只是会看上去误解”
 * —— 115 App 扫码时显示的客户端名是固定的，不会跟着选择变。
 * 真正决定“绑定哪个客户端”的是下面换 Cookie 的 loginUrl(app)。
 */
const QRCODE_TOKEN_URL = "https://qrcodeapi.115.com/api/1.0/web/1.0/token/"
const QRCODE_STATUS_URL = "https://qrcodeapi.115.com/get/status/"
const loginUrl = (app: string) => `https://passportapi.115.com/app/1.0/${app}/1.0/login/qrcode/`

const COOKIE_STORAGE_KEY = "115_cookie_result"
const COOKIE_SAVED_AT_KEY = "115_cookie_saved_at"
const COOKIE_APP_KEY = "115_cookie_app"
const APP_STORAGE_KEY = "115_login_app"

const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"

/**
 * 115 扫码登录可绑定的客户端（来源：gist ChenyangGao/qrcode_cookie_115）
 * 二维码 token 接口固定用 web 那份，只有换取 Cookie 的接口按 app 变化。
 */
const APP_OPTIONS: { id: string; label: string }[] = [
  { id: "web", label: "网页版（web）" },
  { id: "android", label: "安卓 App（android）" },
  { id: "ios", label: "iOS App（ios）" },
  { id: "linux", label: "Linux 客户端（linux）" },
  { id: "mac", label: "macOS 客户端（mac）" },
  { id: "windows", label: "Windows 客户端（windows）" },
  { id: "tv", label: "TV 版（tv）" },
  { id: "alipaymini", label: "支付宝小程序（alipaymini）" },
  { id: "wechatmini", label: "微信小程序（wechatmini）" },
  { id: "qandroid", label: "115生活（qandroid）" },
]

const DEFAULT_APP = "web"
const appLabel = (id: string) => APP_OPTIONS.find(option => option.id === id)?.label ?? id

interface QrCodeData {
  uid: string
  time: number
  sign: string
  qrcode: string
}

function haptic(kind: "selection" | "success" | "error" = "selection") {
  try {
    if (kind === "success") HapticFeedback.notificationSuccess()
    else if (kind === "error") HapticFeedback.notificationError()
    else HapticFeedback.selection()
  } catch {
    // 忽略：裸调触感在部分场景会抛错
  }
}

/** 校验 Cookie：state === true 才有效；失效时 115 返回 errno 990001「登录超时」 */
const COOKIE_CHECK_URL = "https://webapi.115.com/files?cid=0&limit=1&offset=0&show_dir=1"

/** 认 Cookie 类型：web 版 UID 带 _F1_，App 版带 _A1_（网页接口不认） */
function cookieKind(cookie: string): "web" | "app" | "unknown" {
  const match = cookie.match(/(?:^|;\s*)UID=([^;]+)/i)
  if (!match) return "unknown"
  if (/_A1_/i.test(match[1])) return "app"
  if (/_F1_/i.test(match[1])) return "web"
  return "unknown"
}

async function getQrCodeToken(): Promise<QrCodeData> {
  const res = await fetch(QRCODE_TOKEN_URL)
  const json = await res.json()
  if (json.state !== 1 || !json.data) {
    throw new Error("获取二维码失败: " + (json.message || JSON.stringify(json)))
  }
  return json.data as QrCodeData
}

/** 返回 status: 0=等待, 1=已扫描, 2=已登录, -1=过期, -2=取消 */
async function checkStatus(data: QrCodeData): Promise<number> {
  const url = `${QRCODE_STATUS_URL}?uid=${data.uid}&time=${data.time}&sign=${data.sign}`
  const res = await fetch(url)
  const json = await res.json()
  if (json.data?.status === undefined && json.state !== 1) {
    throw new Error(json.message || "查询扫码状态失败")
  }
  return json.data?.status ?? 0
}

async function postQrcodeLogin(uid: string, app: string) {
  const res = await fetch(loginUrl(app), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `app=${encodeURIComponent(app)}&account=${encodeURIComponent(uid)}`,
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = {}
  }
  return { res, json }
}

/** 从响应里拼出 cookie 串：优先 JSON 里的 data.cookie，其次 Set-Cookie 响应头 */
function extractCookie(res: any, json: any): string {
  const parts: string[] = []

  const setCookie = res.headers.get("set-cookie")
  if (setCookie) {
    for (const entry of String(setCookie).split(",")) {
      const match = entry.trim().match(/^([^=]+=[^;]+)/)
      if (match && !match[1].startsWith("acw_tc=") && !match[1].startsWith("USERSESSIONID=")) {
        parts.push(match[1])
      }
    }
  }

  const cookie = json.data?.cookie
  if (typeof cookie === "string") {
    parts.push(cookie)
  } else if (cookie && typeof cookie === "object") {
    // 不同客户端返回的字段不完全一样，全量保留（web 常见 UID/CID/KID/SEID/LT）
    for (const [key, value] of Object.entries(cookie)) {
      if (value !== null && value !== undefined && value !== "") {
        parts.push(`${key}=${value}`)
      }
    }
  }

  return [...new Set(parts)].join("; ")
}

/**
 * 用扫码结果换取 Cookie。
 * 40101017（老乡验证失败）会自动改试 qandroid —— 部分账号 web 端会被限制。
 */
async function getCookies(data: QrCodeData, app: string): Promise<{ cookie: string; app: string }> {
  const candidates = app === "qandroid" ? [app] : [app, "qandroid"]
  const tried: string[] = []
  let lastMessage = ""

  for (const candidate of candidates) {
    tried.push(candidate)
    const { res, json } = await postQrcodeLogin(data.uid, candidate)
    if (json.state === 1 || json.code === 0) {
      const cookie = extractCookie(res, json)
      if (!cookie) throw new Error("登录成功但未取到 Cookie")
      return { cookie, app: candidate }
    }
    lastMessage = json.message || json.error || `code=${json.code}`
    if (json.code !== 40101017) break
  }

  throw new Error(`${lastMessage}（已尝试：${tried.join(" → ")}）`)
}

/* ==================== 界面 ==================== */

function View() {
  const dismiss = Navigation.useDismiss()

  // 惰性初始化：渲染期不重复读磁盘
  const [savedCookie] = useState<string>(() => Storage.get<string>(COOKIE_STORAGE_KEY) || "")
  const [savedAt] = useState<number>(() => Storage.get<number>(COOKIE_SAVED_AT_KEY) || 0)
  const [savedApp] = useState<string>(() => Storage.get<string>(COOKIE_APP_KEY) || DEFAULT_APP)

  const app = useObservable<string>(() => Storage.get<string>(APP_STORAGE_KEY) || DEFAULT_APP)
  const qrImage = useObservable<UIImage | null>(null)
  const statusText = useObservable(() => (savedCookie ? "✅ 已加载上次获取的 Cookie" : "正在获取二维码..."))
  const isScanning = useObservable(!savedCookie)
  const cookieResult = useObservable(savedCookie)
  const cookieSavedAt = useObservable(savedAt)
  const cookieApp = useObservable(savedApp)
  const cookieCopied = useObservable(false)
  const errorText = useObservable("")
  const checking = useObservable(false)
  const checkState = useObservable<number>(0) // 0=未检测 1=有效 2=失效
  const checkMessage = useObservable("")
  const checkTime = useObservable(0)
  let pollTimer: number | null = null

  const resetCheck = () => {
    checkState.setValue(0)
    checkMessage.setValue("")
    checkTime.setValue(0)
  }

  const stopPolling = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  const copyToClipboard = (text: string) => {
    Pasteboard.setString(text)
    cookieCopied.setValue(true)
    setTimeout(() => cookieCopied.setValue(false), 3000)
  }

  const checkCookie = async () => {
    if (checking.value) return
    const cookie = cookieResult.value
    if (!cookie) return
    checking.setValue(true)
    checkState.setValue(0)
    checkMessage.setValue("正在检测...")
    checkTime.setValue(0)
    try {
      const res = await fetch(COOKIE_CHECK_URL, {
        headers: { Cookie: cookie, "User-Agent": USER_AGENT },
      })
      const json = await res.json()
      checkTime.setValue(Date.now())
      if (json.state === true) {
        checkState.setValue(1)
        checkMessage.setValue(`Cookie 有效（根目录 ${json.count ?? 0} 项）`)
        haptic("success")
      } else {
        checkState.setValue(2)
        const reason = json.error || json.message || `errno=${json.errno ?? json.code ?? "?"}`
        checkMessage.setValue(
          cookieKind(cookie) === "app"
            ? `Cookie 已失效：${reason}。注意 UID 带 _A1_ 的是 App 版 Cookie，网页接口本来就不认；要填给网页版工具请切回「网页版（web）」重新获取。`
            : `Cookie 已失效：${reason}`
        )
        haptic("error")
      }
    } catch (e) {
      checkState.setValue(2)
      checkMessage.setValue("检测失败：" + String(e))
      haptic("error")
    } finally {
      checking.setValue(false)
    }
  }

  const clearSavedCookie = () => {
    Storage.remove(COOKIE_STORAGE_KEY)
    Storage.remove(COOKIE_SAVED_AT_KEY)
    Storage.remove(COOKIE_APP_KEY)
    cookieResult.setValue("")
    cookieSavedAt.setValue(0)
    cookieCopied.setValue(false)
    resetCheck()
    statusText.setValue("已清除保存的 Cookie")
  }

  const doGetCookies = async (data: QrCodeData) => {
    statusText.setValue(`登录成功，正在获取「${appLabel(app.value)}」的 Cookie...`)
    try {
      const { cookie, app: usedApp } = await getCookies(data, app.value)
      const now = Date.now()
      Storage.set(COOKIE_STORAGE_KEY, cookie)
      Storage.set(COOKIE_SAVED_AT_KEY, now)
      Storage.set(COOKIE_APP_KEY, usedApp)
      cookieResult.setValue(cookie)
      cookieSavedAt.setValue(now)
      cookieApp.setValue(usedApp)
      resetCheck()
      statusText.setValue(`✅ 已获取「${appLabel(usedApp)}」的 Cookie`)
      copyToClipboard(cookie)
    } catch (e) {
      const msg = String(e)
      errorText.setValue(msg)
      statusText.setValue("❌ Cookie 获取失败")
    }
  }

  const startPolling = (data: QrCodeData) => {
    const poll = async () => {
      if (!isScanning.value) return
      try {
        const status = await checkStatus(data)
        if (status === 2) {
          isScanning.setValue(false)
          doGetCookies(data)
          return
        }
        if (status === -1) {
          statusText.setValue("二维码已过期")
          isScanning.setValue(false)
          return
        }
        if (status === -2) {
          statusText.setValue("用户取消了登录")
          isScanning.setValue(false)
          return
        }
        if (status === 1) {
          statusText.setValue("👆 请在手机上确认登录")
        } else {
          statusText.setValue("📱 请使用 115 App 扫码")
        }
        pollTimer = setTimeout(poll, 2000) as unknown as number
      } catch (e) {
        errorText.setValue(String(e))
        pollTimer = setTimeout(poll, 3000) as unknown as number
      }
    }
    poll()
  }

  const refreshQrCode = async () => {
    statusText.setValue("正在获取二维码...")
    errorText.setValue("")
    resetCheck()
    cookieResult.setValue("")
    cookieSavedAt.setValue(0)
    cookieCopied.setValue(false)
    isScanning.setValue(true)
    qrImage.setValue(null)
    stopPolling()
    try {
      const data = await getQrCodeToken()
      const image = await QRCode.generate(data.qrcode)
      if (!image) throw new Error("二维码生成失败")
      const thumb = image.width > 260 ? image.preparingThumbnail({ width: 260, height: 260 }) : null
      qrImage.setValue(thumb || image)
      statusText.setValue(`📱 请使用 115 App 扫码，绑定到「${appLabel(app.value)}」`)
      startPolling(data)
    } catch (e) {
      statusText.setValue("获取失败")
      errorText.setValue(String(e))
      isScanning.setValue(false)
    }
  }

  const changeApp = (next: string) => {
    if (next === app.value) return
    app.setValue(next)
    Storage.set(APP_STORAGE_KEY, next)
    haptic()
    stopPolling()
    isScanning.setValue(false)
    qrImage.setValue(null)
    errorText.setValue("")
    if (cookieResult.value) {
      // 已有结果时只提示，避免把已保存的 Cookie 清掉
      statusText.setValue(`已切换到「${appLabel(next)}」，点「重获Cookie」重新扫码`)
    } else {
      statusText.setValue("已切换登录设备，正在生成新二维码...")
      refreshQrCode()
    }
  }

  useEffect(() => {
    if (!savedCookie) {
      refreshQrCode()
    }
    return () => stopPolling()
  }, [])

  return (
    <NavigationStack>
      <List
        navigationTitle="115 获取Cookie"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        {/* ====== 登录设备 ====== */}
        <Section>
          <Picker
            title="登录设备"
            systemImage="laptopcomputer.and.iphone"
            value={app.value}
            onChanged={changeApp}
            pickerStyle="menu"
          >
            {APP_OPTIONS.map(option => (
              <Text key={option.id} tag={option.id}>
                {option.label}
              </Text>
            ))}
          </Picker>
        </Section>

        {/* ====== 状态 / 二维码 ====== */}
        <Section>
          <VStack alignment="center" spacing={16}>
            <Text font="title3">{statusText.value}</Text>

            {qrImage.value && isScanning.value ? (
              <VStack alignment="center" spacing={6}>
                <Image image={qrImage.value} />
                <Text font="caption">使用 115 App 扫一扫登录</Text>
              </VStack>
            ) : null}
          </VStack>
        </Section>

        {/* ====== 重获 Cookie（无结果时） ====== */}
        {!isScanning.value && !cookieResult.value ? (
          <Button title="重获Cookie" systemImage="arrow.clockwise" action={refreshQrCode} />
        ) : null}

        {/* ====== Cookie 结果 ====== */}
        {cookieResult.value ? (
          <Section>
            <VStack alignment="leading" spacing={8}>
              <HStack alignment="center" spacing={6}>
                <Image systemName="lock.shield" />
                <Text font="headline">Cookie</Text>
              </HStack>
              <Text font="caption">登录设备：{appLabel(cookieApp.value)}</Text>
              {cookieSavedAt.value ? (
                <Text font="caption">保存时间：{new Date(cookieSavedAt.value).toLocaleString()}</Text>
              ) : null}
              <Text font="body">{cookieResult.value}</Text>
            </VStack>
            <Button
              title={checking.value ? "检测中..." : "检测 Cookie"}
              systemImage="checkmark.shield"
              action={checkCookie}
            />
            {checkMessage.value ? (
              <VStack alignment="leading" spacing={4}>
                <HStack alignment="top" spacing={6}>
                  <Image
                    systemName={
                      checkState.value === 1
                        ? "checkmark.circle.fill"
                        : checkState.value === 2
                        ? "exclamationmark.triangle.fill"
                        : "clock"
                    }
                  />
                  <Text
                    font="caption"
                    foregroundStyle={
                      checkState.value === 1
                        ? "green"
                        : checkState.value === 2
                        ? "orange"
                        : undefined
                    }
                  >
                    {checkMessage.value}
                  </Text>
                </HStack>
                {checkTime.value ? (
                  <Text font="caption2">
                    检测时间：{new Date(checkTime.value).toLocaleTimeString()}
                  </Text>
                ) : null}
              </VStack>
            ) : null}
            <Button
              title={cookieCopied.value ? "已复制" : "复制 Cookie"}
              systemImage="doc.on.doc"
              action={() => copyToClipboard(cookieResult.value)}
            />
            <Button title="重获Cookie" systemImage="arrow.clockwise" action={refreshQrCode} />
            <Button
              title="清除 Cookie"
              systemImage="trash"
              role="destructive"
              action={clearSavedCookie}
            />
          </Section>
        ) : null}

        {/* ====== 错误信息 ====== */}
        {errorText.value && !cookieResult.value ? (
          <Section>
            <Text font="caption">{errorText.value}</Text>
            <Button title="重试" systemImage="arrow.clockwise" action={refreshQrCode} />
          </Section>
        ) : null}

        {/* ====== 关于 ====== */}
        <Section header={<Text font="subheadline">关于</Text>}>
          <VStack alignment="leading" spacing={10}>
            <Text font="caption">
              用 115 App 扫码获取 Cookie，可以选绑定到哪个客户端（web / android / ios / linux / mac / windows / tv / 支付宝小程序 / 微信小程序 / 115生活）。
            </Text>
            <Text font="caption">
              ⚠️ 扫码时 115 App 上显示的客户端名是固定的，不会跟着这里的选择变（115 的提示如此）。这里只决定发给你哪个客户端的 Cookie、以及会踢掉哪个设备的登录。
            </Text>
            <Text font="caption">
              要给网页版 115 工具（AList、115 云下载等）用必须选 web：App 登录产生的 Cookie（UID 带 _A1_）网页接口不认，会报「登录超时」。
            </Text>
            <Text font="caption">
              Cookie 只保存在本机，可随时点「检测 Cookie」验证是否还有效。
            </Text>
            <Text font="caption2">版本 {__releaseNotesVersion}</Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(
    <ReleaseNotesGate>
      <View />
    </ReleaseNotesGate>
  )
  Script.exit()
}

run()
