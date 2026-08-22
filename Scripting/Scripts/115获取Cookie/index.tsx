import { Script, Navigation, NavigationStack, List, VStack, HStack, Text, Button, Image, useObservable, useEffect, fetch } from "scripting"

// 115 API 端点
const QRCODE_TOKEN_URL = "https://qrcodeapi.115.com/api/1.0/web/1.0/token/"
const QRCODE_STATUS_URL = "https://qrcodeapi.115.com/get/status/"
const QRCODE_LOGIN_URL = "https://passportapi.115.com/app/1.0/web/1.0/login/qrcode/"
const COOKIE_STORAGE_KEY = "115_cookie_result"
const COOKIE_SAVED_AT_KEY = "115_cookie_saved_at"

interface QrCodeData {
  uid: string
  time: number
  sign: string
  qrcode: string
}

async function getQrCodeToken(): Promise<QrCodeData> {
  const res = await fetch(QRCODE_TOKEN_URL)
  const json = await res.json()
  if (json.state !== 1 || !json.data) {
    throw new Error("获取二维码失败: " + (json.message || JSON.stringify(json)))
  }
  return json.data as QrCodeData
}

async function checkStatus(data: QrCodeData): Promise<number> {
  const url = `${QRCODE_STATUS_URL}?uid=${data.uid}&time=${data.time}&sign=${data.sign}`
  const res = await fetch(url)
  const json = await res.json()
  // 返回 status: 0=等待, 1=已扫描, 2=已登录, -1=过期, -2=取消
  return json.data?.status ?? 0
}

async function getCookies(data: QrCodeData): Promise<string> {
  const res = await fetch(QRCODE_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    body: `app=web&account=${data.uid}`,
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = {} }

  if (json.state !== 1 && json.code !== 0) {
    // 如果 web 被限制，尝试用 qandroid
    if (json.code === 40101017) {
      const res2 = await fetch("https://passportapi.115.com/app/1.0/qandroid/1.0/login/qrcode/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        },
        body: `app=qandroid&account=${data.uid}`,
      })
      const text2 = await res2.text()
      try { json = JSON.parse(text2) } catch { json = {} }
      if (json.state !== 1) {
        throw new Error(json.message || JSON.stringify(json))
      }
    } else {
      throw new Error(json.message || JSON.stringify(json))
    }
  }

  // 提取 Cookie
  const cookieParts: string[] = []

  // 从 Set-Cookie 响应头提取
  if (res.headers.get("set-cookie")) {
    const entries = (res.headers.get("set-cookie") || "").split(",")
    for (const entry of entries) {
      const match = entry.trim().match(/^([^=]+=[^;]+)/)
      if (match && !match[1].startsWith("acw_tc=") && !match[1].startsWith("USERSESSIONID=")) {
        cookieParts.push(match[1])
      }
    }
  }

  // 从 JSON body 提取
  const dataCookies = json.data || {}
  if (dataCookies.cookie) {
    const c = dataCookies.cookie
    if (typeof c === "string") {
      cookieParts.push(c)
    } else {
      for (const key of ["UID", "CID", "KID", "SEID", "LT"]) {
        if (c[key]) cookieParts.push(`${key}=${c[key]}`)
      }
    }
  }

  // 去重
  return [...new Set(cookieParts)].join("; ")
}

function View() {
  const dismiss = Navigation.useDismiss()

  const savedCookie = Storage.get<string>(COOKIE_STORAGE_KEY) || ""
  const savedAt = Storage.get<number>(COOKIE_SAVED_AT_KEY) || 0

  const qrImage = useObservable<UIImage | null>(null)
  const statusText = useObservable(savedCookie ? "✅ 已加载上次获取的 Cookie" : "正在获取二维码...")
  const isScanning = useObservable(!savedCookie)
  const cookieResult = useObservable(savedCookie)
  const cookieSavedAt = useObservable(savedAt)
  const cookieCopied = useObservable(false)
  const errorText = useObservable("")
  let pollTimer: number | null = null

  const copyToClipboard = (text: string) => {
    Pasteboard.setString(text)
    cookieCopied.setValue(true)
    setTimeout(() => cookieCopied.setValue(false), 3000)
  }

  const clearSavedCookie = () => {
    Storage.remove(COOKIE_STORAGE_KEY)
    Storage.remove(COOKIE_SAVED_AT_KEY)
    cookieResult.setValue("")
    cookieSavedAt.setValue(0)
    cookieCopied.setValue(false)
    statusText.setValue("已清除保存的 Cookie")
  }

  const doGetCookies = async (data: QrCodeData) => {
    statusText.setValue("登录成功，获取 Cookie 中...")
    try {
      const cookies = await getCookies(data)
      const now = Date.now()
      Storage.set(COOKIE_STORAGE_KEY, cookies)
      Storage.set(COOKIE_SAVED_AT_KEY, now)
      cookieResult.setValue(cookies)
      cookieSavedAt.setValue(now)
      statusText.setValue("✅ Cookie 获取成功，已保存")
      copyToClipboard(cookies)
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
        pollTimer = setTimeout(poll, 3000) as unknown as number
      }
    }
    poll()
  }

  const refreshQrCode = async () => {
    statusText.setValue("正在获取二维码...")
    errorText.setValue("")
    cookieResult.setValue("")
    cookieSavedAt.setValue(0)
    cookieCopied.setValue(false)
    isScanning.setValue(true)
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    try {
      const data = await getQrCodeToken()
      const image = await QRCode.generate(data.qrcode)
      if (image) {
        const thumb = image.preparingThumbnail({ width: 260, height: 260 })
        qrImage.setValue(thumb || image)
      }
      statusText.setValue("📱 请使用 115 App 扫码")
      startPolling(data)
    } catch (e) {
      statusText.setValue("获取失败")
      errorText.setValue(String(e))
      isScanning.setValue(false)
    }
  }

  useEffect(() => {
    if (!savedCookie) {
      refreshQrCode()
    }
    return () => {
      if (pollTimer !== null) clearTimeout(pollTimer)
    }
  }, [])

  return (
    <NavigationStack>
      <List
        navigationTitle="115 获取Cookie"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />
        }}
      >
        {/* ====== 状态 / 二维码区域 ====== */}
        <VStack alignment="center" spacing={16}>
          <Text font="title3">{statusText.value}</Text>

          {qrImage.value && isScanning.value ? (
            <VStack alignment="center" spacing={6}>
              <Image image={qrImage.value} />
              <Text font="caption">使用 115 App 扫一扫登录</Text>
            </VStack>
          ) : null}
        </VStack>

        {/* ====== 重新获取按钮（单独一行） ====== */}
        {!isScanning.value && !cookieResult.value ? (
          <Button title="重新获取" systemImage="arrow.clockwise" action={refreshQrCode} />
        ) : null}

        {/* ====== Cookie 标题 + 内容 ====== */}
        {cookieResult.value ? (
          <VStack alignment="leading" spacing={8}>
            <HStack alignment="center" spacing={6}>
              <Image systemName="lock.shield" />
              <Text font="headline">Cookie</Text>
            </HStack>
            {cookieSavedAt.value ? (
              <Text font="caption">保存时间：{new Date(cookieSavedAt.value).toLocaleString()}</Text>
            ) : null}
            <Text font="body">{cookieResult.value}</Text>
          </VStack>
        ) : null}

        {/* ====== 复制 Cookie 按钮（独占一行） ====== */}
        {cookieResult.value ? (
          <Button
            title={cookieCopied.value ? "✅ 已复制" : "📋 复制 Cookie"}
            systemImage={cookieCopied.value ? "checkmark" : "doc.on.doc"}
            action={() => copyToClipboard(cookieResult.value)}
          />
        ) : null}

        {/* ====== 重新获取按钮（独占一行） ====== */}
        {cookieResult.value ? (
          <Button title="重新获取" systemImage="arrow.clockwise" action={refreshQrCode} />
        ) : null}

        {/* ====== 清除保存按钮（独占一行） ====== */}
        {cookieResult.value ? (
          <Button title="清除保存的 Cookie" systemImage="trash" role="destructive" action={clearSavedCookie} />
        ) : null}

        {/* ====== 错误信息 ====== */}
        {errorText.value && !cookieResult.value ? (
          <Text font="caption">{errorText.value}</Text>
        ) : null}

        {/* ====== 重试按钮（独占一行） ====== */}
        {errorText.value && !cookieResult.value ? (
          <Button title="重试" systemImage="arrow.clockwise" action={refreshQrCode} />
        ) : null}

        {/* ====== 使用说明 ====== */}
        <VStack alignment="leading" spacing={2}>
          <Text font="subheadline">使用步骤</Text>
          <Text font="caption">1. 打开 115 App</Text>
          <Text font="caption">2. 扫描上方二维码</Text>
          <Text font="caption">3. 在手机上确认登录</Text>
          <Text font="caption">4. 自动获取、保存并复制 Cookie</Text>
          <Text font="caption">5. 下次打开会直接显示已保存 Cookie</Text>
        </VStack>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<View />)
  Script.exit()
}

run()
