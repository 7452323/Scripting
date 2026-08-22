import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  Text,
  VStack,
  fetch,
  useState,
} from "scripting"

const COOKIE_KEY = "douyin_cookie"
const COOKIE_HISTORY_KEY = "douyin_cookie_history"
const MAX_COOKIE_HISTORY = 10
const LOGIN_URL = "https://www.douyin.com/"

const AUTH_COOKIE_NAMES = new Set(["sessionid", "sessionid_ss", "sid_guard", "sid_tt", "uid_tt"])

type Status = "idle" | "opening" | "checking" | "valid" | "invalid" | "error"
type CookieRecord = { cookie: string; savedAt: number }
type WebCookie = { name: string; value: string; domain: string; path?: string }

function cookiesToString(cookies: WebCookie[]): string {
  const values = new Map<string, string>()
  for (const cookie of cookies) {
    if (!cookie.domain.includes("douyin.com") && !cookie.domain.includes("iesdouyin.com")) continue
    values.set(cookie.name, cookie.value)
  }
  return Array.from(values.entries()).map(([name, value]) => `${name}=${value}`).join("; ")
}

function hasAuthCookie(cookies: WebCookie[]): boolean {
  return cookies.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name) && cookie.value.length > 5)
}

async function validateCookie(cookie: string): Promise<{ valid: boolean; detail: string }> {
  if (!cookie || cookie.length < 50) return { valid: false, detail: "没有获取到完整 Cookie" }
  try {
    const response = await fetch("https://www.douyin.com/aweme/v1/web/im/user/info/", {
      headers: {
        "Cookie": cookie,
        "Referer": "https://www.douyin.com/",
        "Accept": "application/json",
      },
    })
    const text = await response.text()
    if (!response.ok) return { valid: false, detail: `校验失败: HTTP ${response.status}` }
    if (!text || text.trim().startsWith("<") || /login|passport/i.test(text)) {
      return { valid: false, detail: "Cookie 未通过登录校验" }
    }
    let json: any
    try { json = JSON.parse(text) } catch { return { valid: false, detail: "校验接口返回异常" } }
    if (json.status_code === 0) return { valid: true, detail: "Cookie 已通过抖音接口校验" }
    return { valid: false, detail: `Cookie 无效: ${json.status_code ?? "未知状态"}` }
  } catch (error: any) {
    return { valid: false, detail: `校验失败: ${error?.message || String(error)}` }
  }
}

function App() {
  const [status, setStatus] = useState<Status>("idle")
  const [detail, setDetail] = useState("点击下方按钮打开抖音，完成登录后手动关闭网页。")
  const [cookie, setCookie] = useState(Storage.get<string>(COOKIE_KEY) || "")

  async function copyCookie(value: string) {
    await Pasteboard.setString(value)
    setDetail("Cookie 已复制。请到镜花水月的手动 Cookie 配置中粘贴并保存。")
  }

  async function inspectCookies(webView: WebViewController) {
    setStatus("checking")
    setDetail("正在读取并校验登录 Cookie...")
    const cookies = await webView.getCookies("https://www.douyin.com/")
    if (!hasAuthCookie(cookies)) {
      setStatus("invalid")
      setDetail("没有检测到登录 Cookie。请重新打开网页并完成登录。")
      return
    }
    const cookieString = cookiesToString(cookies)
    const result = await validateCookie(cookieString)
    if (!result.valid) {
      setStatus("invalid")
      setDetail(result.detail)
      return
    }
    const history = Storage.get<CookieRecord[]>(COOKIE_HISTORY_KEY) || []
    const nextHistory: CookieRecord[] = [
      { cookie: cookieString, savedAt: Date.now() },
      ...history.filter((item) => item.cookie !== cookieString),
    ].slice(0, MAX_COOKIE_HISTORY)
    Storage.set(COOKIE_KEY, cookieString)
    Storage.set(COOKIE_HISTORY_KEY, nextHistory)
    setCookie(cookieString)
    setStatus("valid")
    await Pasteboard.setString(cookieString)
    setDetail("Cookie 校验通过，已自动保存并复制。下次打开可直接一键复制。")
  }

  async function openLogin() {
    setStatus("opening")
    setDetail("正在打开抖音登录页...")
    const webView = new WebViewController({ ephemeral: false })
    try {
      // 使用 WebView 默认 User-Agent，避免抖音页面判定环境异常
      await webView.loadURL(LOGIN_URL)
      await webView.waitForLoad()
      // 保持登录页原始布局和系统自适应颜色，只补充移动视口。
      // 页面保持原样，由抖音自行渲染登录界面
      setDetail("请在抖音网页中点击登录并完成登录，然后点网页左上角关闭。关闭后会自动读取 Cookie。")
      await webView.present({ fullscreen: true, navigationTitle: "登录抖音" })
      await inspectCookies(webView)
    } catch (error: any) {
      setStatus("error")
      setDetail(`获取失败: ${error?.message || String(error)}`)
    } finally {
      webView.dispose()
    }
  }

  const isBusy = status === "opening" || status === "checking"
  const isValid = status === "valid"

  return (
    <NavigationStack>
      <List navigationTitle="抖音 Cookie 获取">
        <Section>
          <VStack padding={{ vertical: 20, horizontal: 12 }} spacing={12} frame={{ maxWidth: "infinity" }} alignment="center">
            {isBusy ? (
              <ProgressView />
            ) : (
              <Image
                systemName={isValid ? "checkmark.seal.fill" : (status === "invalid" || status === "error" ? "exclamationmark.triangle.fill" : "key.fill")}
                font="largeTitle"
                foregroundStyle={isValid ? "systemGreen" : (status === "invalid" || status === "error" ? "systemOrange" : "systemBlue")}
              />
            )}
            <Text font="headline">{isValid ? "Cookie 有效" : (isBusy ? "处理中..." : "获取登录 Cookie")}</Text>
            <Text font="callout" foregroundStyle="secondaryLabel" multilineTextAlignment="center">{detail}</Text>
          </VStack>
        </Section>

        <Section>
          <Button title={cookie ? "重新登录并获取" : "打开抖音登录"} action={openLogin} disabled={isBusy} />
          <Text font="caption" foregroundStyle="secondaryLabel">点击我的进行登录</Text>
          {cookie ? <Button title="复制 Cookie" action={() => copyCookie(cookie)} disabled={isBusy} /> : null}
        </Section>

        {cookie ? (
          <Section title="当前 Cookie">
            <Button title="一键复制最近 Cookie" action={() => copyCookie(cookie)} disabled={isBusy} />
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={5}>{cookie}</Text>
          </Section>
        ) : null}

        {(Storage.get<CookieRecord[]>(COOKIE_HISTORY_KEY) || []).length > 0 ? (
          <Section title="已保存记录">
            {(Storage.get<CookieRecord[]>(COOKIE_HISTORY_KEY) || []).map((item, index) => (
              <Button
                key={`${item.savedAt}-${index}`}
                title={`${index === 0 ? "最近一次" : `第 ${index + 1} 次`} · ${new Date(item.savedAt).toLocaleString()}`}
                action={() => copyCookie(item.cookie)}
                disabled={isBusy}
              />
            ))}
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}

async function run() {
  try {
    await Navigation.present(<App />)
  } finally {
    Script.exit()
  }
}

run()
