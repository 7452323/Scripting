/**
 * 🐣 UnStamp - intent.tsx
 * Share Sheet 接入：从任意 App 分享链接 → 自动解析 → 下载 → 保存相册
 * 
 * 配置：Intent 输入类型选「URLs」
 */

import {
  Button, List, Navigation, NavigationStack, Section, Text, VStack,
  ScrollView, ScrollViewReader, Rectangle,
  ProgressView, fetch, useState, useEffect, useRef,
  Script, Intent
} from "scripting"

declare const Pasteboard: {
  getString(): Promise<string | null>
  setString(text: string): void
}
declare const Photos: {
  saveVideo(data_or_path: Data | string, options?: { fileName?: string; shouldMoveFile?: boolean }): Promise<boolean>
  savePhoto(data: Data, options?: { fileName?: string }): Promise<boolean>
}
declare const FileManager: {
  documentsDirectory: string
  writeAsBytes(path: string, data: Data): Promise<void>
  removeSync(path: string): void
}

interface MediaResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  video_url?: string | null
  images?: string[]
  cover_url?: string | null
  link?: string
  error?: string
}

// ─── 平台检测 ──────────────────────────────────────────

const PLATFORMS: [string, RegExp[]][] = [
  ['douyin',      [/douyin\.com/i, /iesdouyin/i, /v\.douyin/i]],
  ['twitter',     [/twitter\.com/i, /x\.com\//i]],
  ['xiaohongshu', [/xiaohongshu\.com/i, /xhslink\.com/i]],
  ['instagram',   [/instagram\.com/i]],
  ['bilibili',    [/bilibili\.com/i, /b23\.tv/i]],
  ['tiktok',      [/tiktok\.com/i]],
  ['kuaishou',    [/kuaishou\.com/i]],
]

function extractFirstURL(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i)
  return match ? match[0] : null
}

function detectPlatform(text: string): { platform: string; url: string } | null {
  for (const [platform, patterns] of PLATFORMS) {
    for (const p of patterns) {
      const m = text.match(p)
      if (m) {
        const start = Math.max(0, (m.index || 0) - 50)
        const urlMatch = text.slice(start).match(/https?:\/\/[^\s<>"']+/)
        if (urlMatch) {
          let clean = urlMatch[0].replace(/[\?&]s=\d+/g, '').replace(/[\?&]$/, '')
          return { platform, url: clean }
        }
      }
    }
  }
  return null
}

// ─── 轻量解析器 ────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function parseTwitter(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  try {
    const tweetId = url.match(/\/status\/(\d+)/)?.[1]
    if (!tweetId) { result.error = '无法提取推文ID'; return result }
    const resp = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const data = await resp.json()
    const tweet = data.tweet || data
    result.title = tweet.text || ''
    result.author = tweet.author?.screen_name || tweet.user_screen_name || ''
    result.platform = 'twitter'; result.link = url
    const media = tweet.media?.all || tweet.media_extended || []
    for (const m of media) {
      if ((m.type === 'video' || m.type === 'gif') && m.url) {
        result.video_url = m.url.replace(/\?tag=\d+/, '')
        result.cover_url = result.cover_url || m.thumbnail_url
      }
      if (m.type === 'photo' && m.url) {
        if (!result.images) result.images = []
        result.images.push(m.url)
        result.cover_url = result.cover_url || m.url
      }
    }
    if (!result.video_url && tweet.mediaURLs?.length) result.video_url = tweet.mediaURLs[0]
    result.success = !!(result.video_url || result.images?.length)
    if (!result.success) {
      const pageResp = await fetch(url)
      const html = await pageResp.text()
      const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)
      if (ogVideo) { result.video_url = ogVideo[1]; result.success = true }
    }
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

async function parseDouyin(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
  result.platform = 'douyin'; result.link = url
  try {
    let targetUrl = url
    if (url.match(/v\.douyin\.com/i)) {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 10 })
      targetUrl = resp.headers.get('location') || resp.headers.get('Location') || url
    }

    try {
      const pageResp = await fetch(targetUrl, { headers: { 'User-Agent': UA }, timeout: 10 })
      const html = await pageResp.text()
      const rdMatch = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([^<]+)<\/script>/)
      if (rdMatch) {
        try {
          const data = JSON.parse(decodeURIComponent(rdMatch[1]))
          const item = data?.app?.videoInfoRes?.item_list?.[0]
          if (item) {
            result.title = item.desc || ''; result.author = item.author?.nickname || ''
            result.cover_url = item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0] || ''
            const urls = item.video?.play_addr?.url_list || []
            if (urls.length) { result.video_url = urls[0].replace(/playwm/g, 'play'); result.success = true }
            return result
          }
        } catch {}
      }
    } catch {}

    // WebView 兜底
    const webView = new WebViewController({ ephemeral: true })
    try {
      webView.setCustomUserAgent(UA)
      await webView.loadURL(targetUrl)
      await webView.waitForLoad()
      await sleep(4000)
      const item = await webView.evaluateJavaScript<any>(`
        try {
          if (typeof window._ROUTER_DATA !== 'undefined') {
            for (const v of Object.values(window._ROUTER_DATA.loaderData || {})) {
              const items = v?.videoInfoRes?.item_list
              if (items?.[0]) return JSON.parse(JSON.stringify(items[0]))
            }
          }
        } catch(e) {}
        return null
      `)
      if (item) {
        result.title = item.desc || ''; result.author = item.author?.nickname || ''
        result.cover_url = item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0] || ''
        for (const key of ['play_addr', 'play_addr_h264']) {
          const urls = (item.video as any)[key]?.url_list || []
          if (urls.length) { result.video_url = urls[0].replace(/playwm/g, 'play'); result.success = true; break }
        }
      }
    } finally { webView.dispose() }
    if (!result.success) result.error = '无法从页面提取视频'
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

async function parseGeneric(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  try {
    const pageResp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile/15E148' } })
    const html = await pageResp.text()
    const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)
    if (ogVideo) { result.video_url = ogVideo[1]; result.success = true }
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
    if (ogImage) result.cover_url = ogImage[1]
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
    if (ogTitle) result.title = ogTitle[1]
    result.platform = 'unknown'; result.link = url
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

const PARSERS: Record<string, (url: string) => Promise<MediaResult>> = {
  douyin: parseDouyin, twitter: parseTwitter,
  xiaohongshu: parseGeneric, instagram: parseGeneric,
  bilibili: parseGeneric, tiktok: parseGeneric, kuaishou: parseGeneric,
}

async function parse(url: string): Promise<MediaResult> {
  const detected = detectPlatform(url)
  if (!detected) return { success: false, error: '未识别到支持的平台链接' }
  const parser = PARSERS[detected.platform]
  if (!parser) return { success: false, error: `平台 "${detected.platform}" 暂不支持` }
  const result = await parser(detected.url)
  result.platform = detected.platform
  return result
}

// ─── 下载保存 ──────────────────────────────────────────

function safeFileName(input: string | undefined, fallback: string): string {
  return (input || fallback).trim().replace(/[\/:*?"<>|\n\r]+/g, '_').slice(0, 80) || fallback
}

async function saveVideo(videoUrl: string, title?: string, link?: string): Promise<string> {
  const resp = await fetch(videoUrl, {
    method: 'GET', timeout: 300,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer': link || '',
    }
  })
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`)
  const ab = await resp.arrayBuffer()
  const data = Data.fromArrayBuffer(ab)
  if (!data) throw new Error('下载数据为空')
  const baseName = safeFileName(title, `video_${Date.now()}`)
  const fileName = baseName.toLowerCase().endsWith('.mp4') ? baseName : baseName + '.mp4'
  const destPath = FileManager.documentsDirectory + '/' + fileName
  try { FileManager.removeSync(destPath) } catch {}
  await FileManager.writeAsBytes(destPath, data)
  const saved = await Photos.saveVideo(destPath, { fileName, shouldMoveFile: false })
  if (saved) return '视频已保存到系统相册'
  const savedSimple = await (Photos as any).saveVideo(destPath)
  if (savedSimple === true || savedSimple == null) return '视频已保存到系统相册'
  throw new Error('保存到相册失败')
}

// ─── Intent 解析 ───────────────────────────────────────

function resolveInputURL(): string | null {
  if (Intent.urlsParameter?.length) return Intent.urlsParameter[0]
  if (Intent.textsParameter?.length) {
    for (const t of Intent.textsParameter) { const f = extractFirstURL(t); if (f) return f }
  }
  const sc = Intent.shortcutParameter
  if (sc?.type === 'fileURL' && typeof sc.value === 'string') return sc.value
  if (sc?.type === 'text' && typeof sc.value === 'string') return extractFirstURL(sc.value)
  return null
}

// ─── UI ────────────────────────────────────────────────

const PLATFORM_ICON: Record<string, string> = {
  douyin: '🎵', twitter: '🐦', xiaohongshu: '📕',
  instagram: '📸', bilibili: '📺', tiktok: '🎶', kuaishou: '📱'
}
const PLATFORM_NAME: Record<string, string> = {
  douyin: '抖音', twitter: 'Twitter/X', xiaohongshu: '小红书',
  instagram: 'Instagram', bilibili: 'Bilibili', tiktok: 'TikTok', kuaishou: '快手'
}

function IntentDownloadView(props: { url: string }) {
  const logProxyRef = useRef<any>()
  const logsRef = useRef<string[]>([])
  const [status, setStatus] = useState('准备开始下载。')
  const [progress, setProgress] = useState<{ fraction: number; stage: string }>({
    fraction: 0.02, stage: '准备开始',
  })
  const [logs, setLogs] = useState<string[]>([])

  const appendLog = (message: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const next = [...logsRef.current, `[${ts}] ${message}`].slice(-80)
    logsRef.current = next; setLogs(next)
  }

  useEffect(() => {
    const scroll = () => { try { logProxyRef.current?.scrollTo?.('intentLogBottom', 'bottom') } catch {} }
    scroll()
    const t = setTimeout(scroll, 120)
    return () => clearTimeout(t)
  }, [logs.length])

  useEffect(() => {
    void (async () => {
      try {
        appendLog(`收到分享下载任务：${props.url}`)
        setProgress({ fraction: 0.1, stage: '正在解析链接...' })
        setStatus('正在解析链接...')

        const detected = detectPlatform(props.url)
        if (!detected) throw new Error('未识别到支持的平台链接')

        const icon = PLATFORM_ICON[detected.platform] || '🔗'
        const name = PLATFORM_NAME[detected.platform] || detected.platform
        appendLog(`检测到平台：${icon} ${name}`)

        setProgress({ fraction: 0.25, stage: `正在解析 ${name} 链接...` })
        const r = await parse(detected.url)
        if (!r.success) throw new Error(`解析失败: ${r.error || '未知错误'}`)

        appendLog(`解析成功！标题：${r.title || '(无标题)'}`)
        if (r.author) appendLog(`作者：${r.author}`)

        if (r.video_url) {
          setProgress({ fraction: 0.5, stage: '下载视频中...' })
          setStatus('下载视频中...')
          appendLog('开始下载视频...')

          const msg = await saveVideo(r.video_url, r.title, r.link)

          setProgress({ fraction: 1, stage: '全部完成' })
          setStatus(msg)
          appendLog(`✅ ${msg}`)

          Script.exit(Intent.json({
            ok: true, message: msg,
            title: r.title, platform: detected.platform,
            videoURL: r.video_url, coverURL: r.cover_url,
            pageURL: detected.url,
            logs: logsRef.current,
          }))
        } else if (r.images && r.images.length > 0) {
          appendLog(`获取到 ${r.images.length} 张图片（Share Sheet 模式暂不支持批量下载图片，请使用主应用）`)
          throw new Error('Share Sheet 暂不支持图片下载，请使用主应用')
        } else {
          throw new Error('未找到可下载的媒体地址')
        }
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)
        setProgress({ fraction: 0, stage: '失败' })
        appendLog(`❌ ${message}`)
        setStatus(`执行失败：${message}`)
        await Pasteboard.setString(message)
        setTimeout(() => {
          Script.exit(Intent.text(`下载失败：${message}`))
        }, 1500)
      }
    })()
  }, [])

  return (
    <NavigationStack>
      <List navigationTitle="去水印下载" navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => Script.exit(Intent.text('已取消下载。'))} />,
        }}
      >
        <Section title="进度">
          <VStack alignment="leading" spacing={8}>
            <ProgressView value={progress.fraction} total={1} />
            <Text>{progress.stage}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">当前进度：{Math.round(progress.fraction * 100)}%</Text>
          </VStack>
        </Section>

        <Section title="状态">
          <Text foregroundStyle="secondaryLabel">{status}</Text>
        </Section>

        <Section title="下载日志">
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: 'infinity', height: 260 }}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: 'infinity', alignment: 'leading' as any }}>
                    {logs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">正在准备日志...</Text>
                    ) : (
                      logs.map((log: string, i: number) => (
                        <Text key={`${i}-${log}`} font="caption" foregroundStyle="secondaryLabel">{log}</Text>
                      ))
                    )}
                    <Rectangle key="intentLogBottom" foregroundStyle="clear" frame={{ maxWidth: 'infinity', height: 1 }} />
                  </VStack>
                </ScrollView>
              )
            }}
          </ScrollViewReader>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  try {
    const url = resolveInputURL()
    if (!url) throw new Error('未收到有效的分享链接')

    await Navigation.present({ element: <IntentDownloadView url={url} /> })
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    await Pasteboard.setString(message)
    Script.exit(Intent.text(`下载失败：${message}`))
  }
}

run()