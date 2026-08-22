import {
  Navigation, Script, TabView, Tab,
  VStack, HStack, Text, Button, TextField,
  Spacer, ScrollView, Image, LazyVGrid, ProgressView,
  useState, useEffect, fetch, VideoPlayer,
  NavigationStack, List, Section, GeometryReader,
} from "scripting"

// (download 函数运行时不存在，已改用 fetch + Data + FileManager)
// Data.fromArrayBuffer 由运行时 Data 类提供，无需 custom declare

const KEY_SEC_UID = "douyin_sec_uid"
const KEY_HISTORY = "douyin_history"
const KEY_SAVED_USERS = "douyin_saved_users"
const KEY_COOKIE = "douyin_cookie"

// 运行时全局对象
declare const screen: { width: number; height: number; scale: number } | undefined

interface VideoInfo {
  aweme_id: string; desc: string; create_time: number; cover: string
  play_url: string; duration: number; digg_count: number
  comment_count: number; author_nickname: string; author_avatar: string; unique_id: string; author_ip_location: string
  images: ImageInfo[]
}
interface ImageInfo {
  url: string        // 静态图片 URL
  videoUrl?: string  // 动图视频 URL（API 中部分图片带此字段）
}
interface HistoryItem extends VideoInfo { viewed_at: number }
interface SavedUser { id: string; nickname: string; avatar: string; savedAt: number; shortId?: string; totalFavorited?: number; followingCount?: number; followerCount?: number; signature?: string; ipLocation?: string; gender?: number }

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const ANDROID_UA = "Mozilla/5.0 (Android; Mobile; rv:54.0) Gecko/54.0 Firefox/54.0"
const POST_PAGE_SIZE = 30

// ─── 工具函数 ───
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
function pickFirstUrl(urls?: string[]): string { if (!urls || urls.length === 0) return ""; const h = urls.find((u) => u.startsWith("https://")); return h || urls[0] || "" }

/** 检测是否是 GIF 动图 URL（通过路径扩展名） */
function isGifUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    return path.endsWith(".gif")
  } catch {
    const path = url.split("?")[0].split("#")[0].toLowerCase()
    return path.endsWith(".gif")
  }
}


/**
 * 检测 Data 是否为 GIF 动图（通过 magic bytes）。
 * GIF89a / GIF87a 开头即为 GIF。
 */
function isGifData(data: Data): boolean {
  try {
    const bytes = data.toUint8Array()
    if (!bytes || bytes.length < 6) return false
    // GIF89a = 0x47 0x49 0x46 0x38 0x39 0x61
    // GIF87a = 0x47 0x49 0x46 0x38 0x37 0x61
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
           bytes[3] === 0x38 && (bytes[4] === 0x39 || bytes[4] === 0x37) && bytes[5] === 0x61
  } catch { return false }
}

/** 取 url_list 中最高画质的 URL（通常最后一个是最高画质 CDN） */
function pickBestUrl(urls?: string[]): string {
  if (!urls || urls.length === 0) return ""
  const https = urls.filter((u) => u.startsWith("https://"))
  return https.length > 0 ? https[https.length - 1] : (urls[0] || "")
}
function formatDuration(ms: number): string { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}` }
function formatCount(n: number): string { if (n >= 10000) return (n / 10000).toFixed(1) + "w"; if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return String(n) }
function getGridCardWidth(): number {
  const screenWidth = (typeof screen !== 'undefined' && typeof screen?.width === 'number') ? screen.width : 390
  // List/Section 会吃掉一部分可用宽度；这里用保守值，避免 hit area 压到相邻 cell。
  const horizontalPadding = 64
  const columnSpacing = 14 * 2
  return Math.floor((screenWidth - horizontalPadding - columnSpacing) / 3)
}

async function writeDataFile(path: string, data: Data): Promise<void> {
  if (await FileManager.exists(path)) {
    await FileManager.remove(path)
  }
  try {
    // @ts-ignore
    await FileManager.writeAsData(path, data)
  } catch (writeErr: any) {
    throw new Error(`写入文件失败: ${writeErr?.message || String(writeErr)}`)
  }
}

async function createLivePhotoPairFromVideoPath(videoPath: string, baseName: string) {
  const basePath = FileManager.documentsDirectory + baseName
  const imagePath = `${basePath}.jpg`
  const liveVideoPath = `${basePath}.mov`
  if (await FileManager.exists(imagePath)) await FileManager.remove(imagePath)
  if (await FileManager.exists(liveVideoPath)) await FileManager.remove(liveVideoPath)
  return await LivePhoto.createFromVideo({
    videoPath,
    imageOutputPath: imagePath,
    videoOutputPath: liveVideoPath,
    stillTime: 0,
    maxDuration: 10,
    imageFormat: "jpeg",
    quality: 0.9,
    includeAudio: false,
  })
}

/** 从 aweme_id 构造抖音分享链接 */
function getShareUrl(video: VideoInfo): string {
  return `https://www.douyin.com/video/${video.aweme_id}`
}

/**
 * 安全解析 JSON（容错多种格式）
 */
function safeJSONParse(text: string | null | undefined): unknown | null {
  if (!text) return null
  const candidates = [
    text,
    text.trim(),
    text.replace(/\u2028|\u2029/g, ""),
    text.replace(/\\u002F/g, "/"),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === "string") {
        try { return JSON.parse(parsed) } catch { return parsed }
      }
      return parsed
    } catch {}
  }
  return null
}

/**
 * 从 aweme_detail 中提取无水印视频 URL
 * 将 /playwm/ 替换为 /play/ 获取无水印版本
 */
function extractVideoUrlFromAweme(awemeDetail: any): string | null {
  if (!awemeDetail?.video) return null
  const video = awemeDetail.video
  
  // 优先使用 play_addr_h264 > play_addr > play_addr_265
  let urlList = video.play_addr_h264?.url_list || []
  if (!urlList.length) urlList = video.play_addr?.url_list || []
  if (!urlList.length) urlList = video.play_addr_265?.url_list || []
  
  if (urlList.length > 0) {
    // 取最高画质（最后一个）的 URL
    let url = urlList[urlList.length - 1] || urlList[0]
    // playwm → play 转换获取无水印版本
    if (url.includes("/playwm/")) {
      url = url.replace("/playwm/", "/play/")
    }
    return url
  }
  
  // 尝试 bit_rate
  if (video.bit_rate?.length > 0) {
    for (const br of video.bit_rate) {
      if (br.play_addr?.url_list?.length > 0) {
        let url = br.play_addr.url_list[br.play_addr.url_list.length - 1]
        if (url.includes("/playwm/")) {
          url = url.replace("/playwm/", "/play/")
        }
        return url
      }
    }
  }
  
  return null
}

/**
 * 从 aweme_detail 中提取图片 URL 列表（图文作品）
 */
function extractImagesFromAweme(awemeDetail: any): string[] {
  if (!awemeDetail?.images || !Array.isArray(awemeDetail.images)) return []
  
  const urls: string[] = []
  for (const img of awemeDetail.images) {
    if (img?.url_list?.length > 0) {
      // 取最高画质（最后一个 HTTPS URL）
      const httpsUrls = img.url_list.filter((u: string) => u.startsWith("https://"))
      urls.push(httpsUrls.length > 0 ? httpsUrls[httpsUrls.length - 1] : img.url_list[0])
    }
  }
  return urls
}

/**
 * 从 _ROUTER_DATA 中提取 aweme_detail
 * 支持多种嵌套结构：
 * - loaderData.*.videoInfoRes.data.aweme_detail
 * - loaderData.*.aweme_detail
 * - 直接 aweme_detail
 */
function extractAwemeFromRouterData(routerData: any): any {
  if (!routerData) return null
  
  // 直接包含 aweme_detail
  if (routerData.aweme_detail) return routerData.aweme_detail
  
  // 从 loaderData 中提取
  const loaderData = routerData.loaderData || {}
  for (const key of Object.keys(loaderData)) {
    const loader = loaderData[key]
    if (!loader || typeof loader !== "object") continue
    
    // videoInfoRes 路径
    if (loader.videoInfoRes?.data?.aweme_detail) {
      return loader.videoInfoRes.data.aweme_detail
    }
    // 直接 aweme_detail
    if (loader.aweme_detail) {
      return loader.aweme_detail
    }
  }
  
  return null
}

/**
 * 通过 WebView 加载抖音分享页面，解析 _ROUTER_DATA 获取无水印资源 URL
 * 替代不稳定的第三方去水印 API
 * 
 * @param video 视频信息（需要 aweme_id）
 * @param isImage 是否提取图片（可选，自动检测）
 * @returns { url: 无水印URL, imageUrls: 图文作品的图片列表 }
 */
async function extractNoWatermarkUrl(
  video: VideoInfo,
  isImage?: boolean,
  imageIndex: number = 0
): Promise<{ url: string; imageUrls: string[] }> {
  const shareUrl = getShareUrl(video)
  const webView = new WebViewController({ ephemeral: true })
  
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    await webView.loadURL(shareUrl)
    await webView.waitForLoad()
    // 等待 JS 渲染和数据加载
    await sleep(3000)
    
    // 提取页面中的 _ROUTER_DATA 和 video 元素
    const extracted = await webView.evaluateJavaScript<{
      routerDataJSON: string | null
      videoSrc: string | null
      pageTitle: string
    }>(`
      (function() {
        let routerDataJSON = null
        try {
          if (typeof window._ROUTER_DATA !== 'undefined') {
            routerDataJSON = JSON.stringify(window._ROUTER_DATA)
          }
        } catch (e) {}
        
        let videoSrc = null
        try {
          var videoEl = document.querySelector('video')
          if (videoEl) {
            videoSrc = videoEl.currentSrc || videoEl.src || null
          }
        } catch (e) {}
        
        return {
          routerDataJSON,
          videoSrc,
          pageTitle: document.title || ''
        }
      })()
    `)
    
    // 解析 _ROUTER_DATA
    if (extracted?.routerDataJSON) {
      const routerData = safeJSONParse(extracted.routerDataJSON)
      const awemeDetail = extractAwemeFromRouterData(routerData)
      
      if (awemeDetail) {
        // 检测是否是图文作品
        const hasImages = awemeDetail.images && awemeDetail.images.length > 0
        const hasVideo = awemeDetail.video && (awemeDetail.video.play_addr || awemeDetail.video.play_addr_h264)
        
        // 提取图片
        const imageUrls = extractImagesFromAweme(awemeDetail)
        
        // 如果是图文作品或明确要求图片，返回图片 URL
        if ((isImage || (hasImages && !hasVideo)) && imageUrls.length > 0) {
          return { url: imageUrls[imageIndex] || imageUrls[0], imageUrls }
        }
        
        // 提取视频 URL
        const videoUrl = extractVideoUrlFromAweme(awemeDetail)
        if (videoUrl) {
          return { url: videoUrl, imageUrls }
        }
      }
    }
    
    // 回退：使用页面 video 元素的 src
    if (extracted?.videoSrc) {
      let url = extracted.videoSrc
      if (url.includes("/playwm/")) {
        url = url.replace("/playwm/", "/play/")
      }
      return { url, imageUrls: [] }
    }
    
    return { url: "", imageUrls: [] }
  } finally {
    webView.dispose()
  }
}

/**
 * 格式化字节数为人类可读格式
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + "G"
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "M"
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + "K"
  return bytes + "B"
}

/**
 * 带实时进度的分块下载函数
 * 使用 Range header 分块下载，每下载一块更新进度
 * 如果服务器不支持 Range，回退到普通下载
 */
async function downloadWithProgress(
  url: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number) => void
): Promise<Data> {
  const CHUNK_SIZE = 1024 * 512 // 512KB 每块
  
  const downloadDirect = async (): Promise<Data> => {
    onProgress(0, 0)
    const resp = await fetch(url, { headers })
    if (!resp.ok) throw new Error(`下载 HTTP ${resp.status}`)
    const arrayBuf = await resp.arrayBuffer()
    const data = Data.fromArrayBuffer(arrayBuf)
    if (!data) throw new Error("下载数据转换失败")
    onProgress(data.size, data.size)
    return data
  }

  // 1. 优先用 HEAD 探测大小，避免正式下载前多拉一次完整文件
  let totalSize = 0
  try {
    const headResp = await fetch(url, { method: "HEAD", headers })
    if (headResp.ok) {
      const contentLengthStr = headResp.headers?.get?.("Content-Length") || headResp.headers?.get?.("content-length")
      totalSize = contentLengthStr ? parseInt(contentLengthStr) : 0
    }
  } catch {}
  
  // 如果无法获取文件大小，回退普通下载
  if (!totalSize) {
    return await downloadDirect()
  }
  
  // 2. 分块下载
  const chunks: Data[] = []
  let downloaded = 0
  
  while (downloaded < totalSize) {
    const end = Math.min(downloaded + CHUNK_SIZE - 1, totalSize - 1)
    const rangeHeader = { ...headers, Range: `bytes=${downloaded}-${end}` }
    
    const chunkResp = await fetch(url, { headers: rangeHeader })
    if (chunkResp.status !== 206) {
      // 服务器忽略 Range 或返回异常状态，回退普通下载
      return await downloadDirect()
    }
    
    const chunkArrayBuf = await chunkResp.arrayBuffer()
    const chunkData = Data.fromArrayBuffer(chunkArrayBuf)
    if (!chunkData || chunkData.size === 0) throw new Error("分块下载返回空数据")
    
    chunks.push(chunkData)
    downloaded += chunkData.size
    
    // 更新进度
    onProgress(downloaded, totalSize)
    
    // 防止 UI 更新过快，小延时
    if (totalSize > 1024 * 1024) {
      await sleep(50)
    }
  }
  
  // 3. 合并所有块
  let totalBytes = 0
  const byteChunks: Uint8Array[] = []
  for (const chunk of chunks) {
    const bytes = chunk.toUint8Array()
    if (!bytes) throw new Error("分块数据转换失败")
    byteChunks.push(bytes)
    totalBytes += bytes.length
  }

  const mergedBytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const bytes of byteChunks) {
    mergedBytes.set(bytes, offset)
    offset += bytes.length
  }

  const mergedData = Data.fromArrayBuffer(mergedBytes.buffer)
  if (!mergedData) throw new Error("合并下载数据失败")
  return mergedData
}

/**
 * 展示保存/分享选择界面
 */
async function shareVideo(video: VideoInfo, isImage: boolean, animIdx?: number) {
  const shareUrl = getShareUrl(video)
  // 如果传入了图片索引，使用该索引的图片信息
  const imgInfo = animIdx !== undefined ? video.images[animIdx] : video.images[0]
  await Navigation.present(
    <ShareProgressView
      video={video}
      shareUrl={shareUrl}
      isImage={isImage}
      originalUrl={isImage ? (imgInfo?.url || "") : video.play_url}
      imageVideoUrl={isImage ? (imgInfo?.videoUrl || "") : ""}
      imageIndex={animIdx ?? 0}
    />
  )
}

const EXPORT_STEPS = ["解析", "下载", "保存"]

function ExportStepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <HStack frame={{ maxWidth: "infinity" }} spacing={8} padding={{ horizontal: 4 }}>
      {EXPORT_STEPS.map((label, idx) => {
        const order = idx + 1
        const done = currentStep > order
        const active = currentStep === order
        return (
          <HStack key={label} spacing={6} frame={{ maxWidth: "infinity" }}>
            <VStack frame={{ width: 22, height: 22 }} alignment="center" background={done ? "systemGreen" : (active ? "systemBlue" : "systemGray5")} clipShape={{ type: "rect", cornerRadius: 11 }}>
              <Text font="caption2" foregroundStyle={done || active ? "white" : "secondaryLabel"}>{done ? "✓" : String(order)}</Text>
            </VStack>
            <Text font="caption" foregroundStyle={active ? "label" : "secondaryLabel"}>{label}</Text>
          </HStack>
        )
      })}
    </HStack>
  )
}

// ─── 分享进度视图 ───
function ShareProgressView({ video, shareUrl, isImage, originalUrl, imageVideoUrl, imageIndex }: {
  video: VideoInfo
  shareUrl: string
  isImage: boolean
  originalUrl: string
  imageVideoUrl: string
  imageIndex: number
}) {
  const dismiss = Navigation.useDismiss()
  const [step, setStep] = useState(0)         // 0=准备, 1=去水印, 2=下载, 3=保存, 4=完成, -1=失败
  const [progressText, setProgressText] = useState("准备导出...")
  const [statusTitle, setStatusTitle] = useState("准备导出")
  const [errorMsg, setErrorMsg] = useState("")
  const [detailLines, setDetailLines] = useState<string[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [progressRatio, setProgressRatio] = useState(0)
  const addDetail = (line: string) => setDetailLines(prev => [...prev.slice(-7), line])

  useEffect(() => {
    ;(async () => {
      try {
        // 步骤1：通过 WebView 解析抖音页面获取无水印资源
        setStep(1)
        setProgressRatio(0.08)
        setStatusTitle("正在解析资源")
        setProgressText("正在获取无水印地址")
        addDetail(`分享页: ${shareUrl}`)
        
        // 使用 WebView 解析抖音页面内嵌数据（不依赖第三方 API）
        const result = await extractNoWatermarkUrl(video, isImage, imageIndex)
        
        addDetail(`页面解析完成，资源地址长度 ${result.url.length}`)
        
        let targetUrl = result.url || ""
        
        // 如果解析失败，回退到原始地址
        if (!targetUrl) {
          addDetail("未解析到无水印地址，使用原始地址")
          targetUrl = originalUrl
        } else {
          addDetail(`已获取无水印地址${result.imageUrls.length > 0 ? "，图文共 " + result.imageUrls.length + " 张" : ""}`)
        }
        
        if (!targetUrl) {
          throw new Error("无法获取下载地址（原始地址也为空）")
        }
        // 锁定 targetUrl 为不可变常量，方便后续窄化
        const finalTargetUrl = targetUrl
        addDetail(`下载地址已确认，长度 ${finalTargetUrl.length}`)
        
        // 动图处理：如果图片有伴随的视频 URL，下载视频后转换为 Live Photo
        const isAnimatedImage = isImage && imageVideoUrl.length > 0
        const downloadUrl = isAnimatedImage ? imageVideoUrl : finalTargetUrl
        if (isAnimatedImage) {
          addDetail("检测到动态图视频源，将保存为 Live Photo")
        }
        
        // 步骤2：下载文件（带百分比进度）
        setStep(2)
        setProgressRatio(0.18)
        setStatusTitle("正在下载")
        setProgressText("正在下载媒体文件")
        
        // 检测是否是 GIF 动图
        const isGif = !isAnimatedImage && isGifUrl(downloadUrl)
        const ext = isAnimatedImage ? "mp4" : (isImage ? (isGif ? "gif" : "jpg") : "mp4")
        const fileName = `${video.aweme_id}${isAnimatedImage ? "_video" : (isGif ? "_" + (originalUrl || "").split("/").pop()?.split("?")[0].replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) : "")}.${ext}`
        
        addDetail(`文件名: ${fileName}${isGif ? "，GIF" : ""}`)
        
        // 使用分块下载获取实时进度（512KB/块）
        const data = await downloadWithProgress(
          downloadUrl,
          { "User-Agent": MOBILE_UA },
          (downloaded, total) => {
            if (total > 0) {
              // 有总大小时显示 "36.5/50.0 M" 格式
              const ratio = downloaded / total
              setProgressRatio(0.18 + ratio * 0.62)
              setProgressText(`${formatBytes(downloaded)} / ${formatBytes(total)} (${(ratio * 100).toFixed(0)}%)`)
            } else {
              // 无总大小时显示已下载量
              setProgressText(`已下载 ${formatBytes(downloaded)}`)
            }
          }
        )
        
        if (!data) {
          throw new Error("下载数据为空")
        }
        
        setProgressRatio(0.82)
        addDetail(`下载完成，共 ${formatBytes(data.size)}`)
        
        // 如果下载后发现是 GIF（magic bytes 检测），修正扩展名
        const actuallyGif = isGif || isGifData(data)
        const finalExt = isAnimatedImage ? "mp4" : (isImage ? (actuallyGif ? "gif" : "jpg") : "mp4")
        // 重新生成正确的文件名
        const baseFileName = `${video.aweme_id}${isAnimatedImage ? "_video" : (actuallyGif ? "_gif" : "")}`
        const finalFileName = `${baseFileName}.${finalExt}`
        
        if (actuallyGif && ext !== finalExt) {
          addDetail("下载后检测到 GIF，已修正文件格式")
        }
        
        // 步骤3：写入 Documents + 保存到相册
        setStep(3)
        setProgressRatio(0.88)
        setStatusTitle("正在保存")
        setProgressText("正在写入相册")
        
        const docPath = FileManager.documentsDirectory + finalFileName
        await writeDataFile(docPath, data)
        addDetail(`已写入临时文件，${data.size} 字节`)
        
        // 保存到相册：
        // 1. 动图（带视频URL的）→ 转换并保存为 Live Photo，失败时回退 MP4
        // 2. GIF 动图 → Data 模式保存保留动画
        // 3. 普通图片 → 路径模式保存
        // 4. 视频 → 路径模式保存
        let savedOk = false
        if (isAnimatedImage) {
          try {
            setProgressText("正在生成 Live Photo")
            addDetail("正在生成 Live Photo 资源")
            const pair = await createLivePhotoPairFromVideoPath(docPath, `${video.aweme_id}_livephoto_${Date.now()}`)
            await Photos.saveLivePhoto({ imagePath: pair.imagePath, videoPath: pair.videoPath, shouldMoveFile: true })
            savedOk = true
            addDetail(`Live Photo 已保存，${pair.duration.toFixed(1)}s${pair.reencoded ? "，已重编码" : ""}`)
            try { await FileManager.remove(docPath) } catch {}
          } catch (liveErr: any) {
            addDetail(`Live Photo 保存失败，回退 MP4: ${liveErr?.message || String(liveErr)}`)
            savedOk = await Photos.saveVideo(docPath, { fileName: finalFileName, shouldMoveFile: true })
            addDetail(`动态图已回退保存为 MP4${savedOk ? "" : "，失败"}`)
          }
        } else if (actuallyGif) {
          // GIF 动图：用 Data 直接保存，保留动画
          savedOk = await Photos.savePhoto(data, { fileName: finalFileName })
          if (savedOk) {
            try { await FileManager.remove(docPath) } catch {}
          }
          addDetail(`GIF 动图已保存${savedOk ? "" : "，失败"}`)
        } else if (isImage) {
          savedOk = await Photos.savePhoto(docPath, { fileName: finalFileName, shouldMoveFile: true })
          addDetail(`图片已保存${savedOk ? "" : "，失败"}`)
        } else {
          savedOk = await Photos.saveVideo(docPath, { fileName: finalFileName, shouldMoveFile: true })
          addDetail(`视频已保存${savedOk ? "" : "，失败"}`)
        }
        addDetail(`保存${savedOk ? "成功" : "失败"}`)
        
        let sharedOk = false
        if (!savedOk) {
          addDetail("Photos 保存失败，打开系统分享")
          sharedOk = await ShareSheet.present([docPath])
          if (!sharedOk) throw new Error("相册保存失败，且未完成系统分享")
        }
        
        setStep(4)
        setProgressRatio(1)
        setStatusTitle(savedOk ? "已保存到相册" : "已通过系统分享")
        setProgressText(isAnimatedImage && savedOk ? "动态照片已保存" : (savedOk ? "导出完成" : "分享已完成"))
        
      } catch (e: any) {
        setStep(-1)
        const msg = (e?.message || String(e) || JSON.stringify(e) || "未知错误").substring(0, 200)
        setProgressRatio(0)
        setStatusTitle("导出失败")
        setErrorMsg(msg)
        addDetail(`失败: ${msg}`)
      }
    })()
  }, [])

  const isBusy = step > 0 && step < 4
  const iconName = step === 4 ? "checkmark.circle.fill" : (step === -1 ? "xmark.circle.fill" : "arrow.down.circle")
  const iconColor = step === 4 ? "systemGreen" : (step === -1 ? "systemRed" : "systemBlue")
  const progressWidth = Math.max(8, Math.min(260, 260 * progressRatio))

  return (
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground" padding={24} spacing={18} alignment="center">
      <Spacer />
      <VStack frame={{ width: 72, height: 72 }} alignment="center" background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 36 }}>
        {isBusy ? <ProgressView foregroundStyle="systemBlue" /> : <Image systemName={iconName} font="largeTitle" foregroundStyle={iconColor} />}
      </VStack>
      <Text font="title3" bold>{statusTitle}</Text>
      <Text font="subheadline" foregroundStyle={step === -1 ? "systemRed" : "secondaryLabel"} multilineTextAlignment="center" lineLimit={3}>
        {step === -1 ? errorMsg : progressText}
      </Text>
      {step > 0 && step !== -1 ? <ExportStepIndicator currentStep={step} /> : null}
      {isBusy ? (
        <VStack frame={{ width: 260, height: 6, alignment: "leading" }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 3 }}>
          <VStack frame={{ width: progressWidth, height: 6 }} background="systemBlue" clipShape={{ type: "rect", cornerRadius: 3 }} />
        </VStack>
      ) : null}
      {detailLines.length > 0 ? (
        <VStack frame={{ maxWidth: "infinity" }} spacing={8} padding={{ top: 6 }}>
          <Button action={() => setShowDetails(!showDetails)}>
            <HStack spacing={6}>
              <Image systemName={showDetails ? "chevron.up" : "chevron.down"} font="caption" foregroundStyle="secondaryLabel" />
              <Text font="caption" foregroundStyle="secondaryLabel">诊断信息</Text>
            </HStack>
          </Button>
          {showDetails ? (
            <ScrollView frame={{ maxWidth: "infinity", maxHeight: 140 }}>
              <VStack spacing={4} frame={{ maxWidth: "infinity" }} alignment="leading">
                {detailLines.map((s, i) => <Text key={i} font="caption2" foregroundStyle="tertiaryLabel" lineLimit={3}>{s}</Text>)}
              </VStack>
            </ScrollView>
          ) : null}
        </VStack>
      ) : null}
      <Spacer />
      {step >= 4 || step === -1 ? <Button title="关闭" action={() => dismiss()} /> : null}
    </VStack>
  )}

// ─── 动图/图片单页组件 ──—
function FloatingIconButton({ systemName, onTap, opacity = 0.58 }: { systemName: string; onTap: () => void; opacity?: number }) {
  return (
    <Button action={onTap}>
      <VStack frame={{ width: 38, height: 38 }} alignment="center" background="black" opacity={opacity} clipShape={{ type: "rect", cornerRadius: 19 }}>
        <Image systemName={systemName} font="body" foregroundStyle="white" />
      </VStack>
    </Button>
  )
}

function ImagePageOverlay({ badgeText, pageWidth, pageHeight, onExport, loading }: {
  badgeText: string
  pageWidth: number
  pageHeight: number
  onExport: () => void
  loading: boolean
}) {
  return (
    <VStack frame={{ width: pageWidth, height: pageHeight }} alignment="center" padding={{ horizontal: 16, bottom: 14 }}>
      {loading ? (
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center">
          <ProgressView foregroundStyle="white" />
        </VStack>
      ) : <Spacer />}
      <HStack frame={{ maxWidth: "infinity" }} spacing={12}>
        <HStack padding={{ horizontal: 8, vertical: 4 }} background="black" opacity={0.58} clipShape={{ type: "rect", cornerRadius: 6 }}>
          <Text font="caption2" foregroundStyle="white">{badgeText}</Text>
        </HStack>
        <Spacer />
        <FloatingIconButton systemName="square.and.arrow.down" onTap={onExport} />
      </HStack>
    </VStack>
  )
}

function AnimatedImagePage({ imgInfo, pageWidth, pageHeight, index, total, onExport }: {
  imgInfo: ImageInfo
  pageWidth: number
  pageHeight: number
  index: number
  total: number
  onExport: () => void
}) {
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [videoError, setVideoError] = useState(false)
  const isAnimatedVideo = !!imgInfo.videoUrl

  useEffect(() => {
    if (!imgInfo.videoUrl) return
    const p = new AVPlayer()
    p.volume = 0
    p.numberOfLoops = -1
    p.onReadyToPlay = () => {
      setPlayer(p)
      p.play()
    }
    p.onError = () => setVideoError(true)
    const sourceSet = p.setSource(imgInfo.videoUrl, {
      headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }
    })
    if (!sourceSet) setVideoError(true)
    SharedAudioSession.setCategory('playback', [])
    SharedAudioSession.setActive(true)
    return () => {
      try { p.stop(); p.dispose() } catch {}
    }
  }, [])

  const badgeText = isAnimatedVideo ? "动图" : `${index + 1}/${total}`
  const overlay = <ImagePageOverlay badgeText={badgeText} pageWidth={pageWidth} pageHeight={pageHeight} onExport={onExport} loading={isAnimatedVideo && !player && !videoError} />

  if (isAnimatedVideo && player && !videoError) {
    return (
      <VStack frame={{ width: pageWidth, height: pageHeight }} background="black" alignment="center" clipped>
        <VideoPlayer player={player} frame={{ width: pageWidth, height: pageHeight }} overlay={overlay} />
      </VStack>
    )
  }

  return (
    <VStack frame={{ width: pageWidth, height: pageHeight }} background="black" alignment="center" clipped>
      <Image
        imageUrl={imgInfo.url}
        resizable
        aspectRatio={{ value: null, contentMode: 'fit' }}
        frame={{ width: pageWidth, height: pageHeight }}
        clipped
        opacity={isAnimatedVideo && !videoError ? 0.45 : 1}
        overlay={{ alignment: "center", content: overlay }}
      />
    </VStack>
  )
}

// ─── 视频播放 ───
function VideoPreviewView({ video }: { video: VideoInfo }) {
  const dismiss = Navigation.useDismiss()
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [error, setError] = useState("")
  const isImagePost = video.images.length > 0

  useEffect(() => {
    if (isImagePost) return
    if (!video.play_url) { setError("无可播放地址"); return }
    const p = new AVPlayer()
    p.onReadyToPlay = () => {
      setPlayer(p)
      p.play()
    }
    p.onError = () => { setError("播放失败") }
    const sourceSet = p.setSource(video.play_url, {
      headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }
    })
    if (!sourceSet) setError("播放地址加载失败")
    SharedAudioSession.setCategory('playback', [])
    SharedAudioSession.setActive(true)
    return () => {
      try { p.stop(); p.dispose() } catch {}
    }
  }, [])

  return (
    <GeometryReader>{({ size: { width, height } }) => (
      <VStack frame={{ width, height }} background="black">
        {isImagePost ? (
          <VStack frame={{ width, height }} spacing={0}>
            <ScrollView axes="horizontal" scrollTargetBehavior="paging" frame={{ width, height: height - 56 }}>
              <HStack spacing={0} frame={{ height: height - 56 }}>
                {video.images.map((imgInfo, i) => (
                  <AnimatedImagePage
                    key={i}
                    imgInfo={imgInfo}
                    pageWidth={width}
                    pageHeight={height - 56}
                    index={i}
                    total={video.images.length}
                    onExport={() => shareVideo(video, true, i)}
                  />
                ))}
              </HStack>
            </ScrollView>
            <HStack frame={{ width, height: 56 }} padding={{ horizontal: 16, vertical: 8 }} spacing={16}>
              <Spacer />
              <Button action={dismiss}>
                <Image systemName="xmark.circle.fill" font="title" foregroundStyle="white" opacity={0.86} />
              </Button>
            </HStack>
          </VStack>
        ) : player ? (
          <VideoPlayer
            player={player}
            frame={{ width, height }}
            overlay={
              <VStack frame={{ width, height }} padding={{ horizontal: 16, top: 16, bottom: 14 }} alignment="center">
                <HStack frame={{ maxWidth: "infinity" }}>
                  <Spacer />
                  <FloatingIconButton systemName="xmark" opacity={0.62} onTap={() => { try { player.stop(); player.dispose() } catch (_) {} dismiss() }} />
                </HStack>
                <Spacer />
                <HStack frame={{ maxWidth: "infinity" }}>
                  <Spacer />
                  <FloatingIconButton systemName="square.and.arrow.down" onTap={() => shareVideo(video, false)} />
                </HStack>
              </VStack>
            }
          />
        ) : error ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center" spacing={12}>
            <Image systemName="exclamationmark.triangle.fill" font="largeTitle" foregroundStyle="white" opacity={0.6} />
            <Text foregroundStyle="white" opacity={0.6}>{error}</Text>
            <Button title="关闭" action={() => { dismiss() }} />
          </VStack>
        ) : (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center">
            {video.cover ? (
              <Image imageUrl={video.cover} resizable aspectRatio={{ value: null, contentMode: 'fit' }} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} opacity={0.3} />
            ) : null}
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center">
              <ProgressView foregroundStyle="white" />
            </VStack>
          </VStack>
        )}
      </VStack>
    )}</GeometryReader>
  )
}

// ─── 打开视频（防双击） ───
let _openingVideo = false
async function openVideo(video: VideoInfo, _idx?: number) {
  if (_openingVideo) return
  _openingVideo = true
  try {
    addToHistory(video)
    await Navigation.present(<VideoPreviewView video={video} />)
  } finally {
    _openingVideo = false
  }
}

// ─── Storage ───
function loadSecUid(): string { return Storage.get<string>(KEY_SEC_UID) || "" }
function saveSecUid(uid: string) { Storage.set(KEY_SEC_UID, uid) }

function loadHistory(): HistoryItem[] {
  try { const raw = Storage.get<string>(KEY_HISTORY); if (!raw) return []; return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [] }
  catch { return [] }
}
function saveHistory(items: HistoryItem[]) { Storage.set(KEY_HISTORY, JSON.stringify(items.slice(0, 500))) }
function addToHistory(video: VideoInfo) {
  const history = loadHistory(); const idx = history.findIndex((h) => h.aweme_id === video.aweme_id)
  if (idx >= 0) history.splice(idx, 1)
  history.unshift({ ...video, viewed_at: Date.now() }); saveHistory(history)
}
function loadSavedUsers(): SavedUser[] {
  try { const raw = Storage.get<string>(KEY_SAVED_USERS); if (!raw) return []; return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [] }
  catch { return [] }
}
function loadCurrentSavedUser(): SavedUser | null {
  const uid = loadSecUid()
  if (!uid) return null
  return loadSavedUsers().find((u) => u.id === uid) || null
}
function saveUser(user: SavedUser) {
  const users = loadSavedUsers(); const idx = users.findIndex((u) => u.id === user.id)
  if (idx >= 0) users.splice(idx, 1); users.unshift(user)
  Storage.set(KEY_SAVED_USERS, JSON.stringify(users.slice(0, 20)))
}

// ─── 抖音号解析 ───
function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0].replace(/[),.;!?，。；！？）】]+$/, "") : text.trim()
}

// ─── iesdouyin API + Cookie 直调 ───
// 有 Cookie 时带上，可能 API 需要认证才能正确返回 JSON
async function resolveViaIesdouyin(uniqueId: string): Promise<{ secUid: string; nickname: string; avatar: string; shortId: string; totalFavorited: number; followingCount: number; followerCount: number; signature: string; ipLocation: string; gender: number } | null> {
  try {
    const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
    const headers: Record<string, string> = { "User-Agent": ANDROID_UA, Referer: "https://www.iesdouyin.com/" }
    if (cookie) headers["Cookie"] = cookie
    const url = `https://www.iesdouyin.com/web/api/v2/user/info/?unique_id=${encodeURIComponent(uniqueId)}`
    const resp = await timeoutFetch(fetch(url, { method: "GET", headers }), 5000)
    if (!resp.ok) return null
    const text = await resp.text()
    let data: any
    try { data = JSON.parse(text) } catch { return null }
    const info = data?.user_info
    if (!info || !info.sec_uid) return null
    return {
      secUid: info.sec_uid,
      nickname: info.nickname || "",
      avatar: pickFirstUrl(info.avatar_thumb?.url_list) || pickFirstUrl(info.avatar_larger?.url_list) || "",
      shortId: info.unique_id || "",
      totalFavorited: parseInt(info.total_favorited) || 0,
      followingCount: info.following_count || 0,
      followerCount: info.follower_count || 0,
      signature: info.signature || info.desc || "",
      ipLocation: info.ip_location || info.ip_loc || info.region || "",
      gender: info.gender ?? 0,
    }
  } catch {
    return null
  }
}

async function resolveViaWebView(url: string): Promise<string> {
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    await webView.loadURL(url)
    await webView.waitForLoad()
    // 等待页面重定向和 JS 渲染完成
    let prevUrl = url
    for (let i = 0; i < 6; i++) {
      await sleep(1500)
      const currentUrl = await webView.evaluateJavaScript<string>("location.href")
      if (currentUrl && currentUrl !== prevUrl) {
        prevUrl = currentUrl
        // URL 变了（重定向了），额外等一会儿让新页面渲染
        await sleep(2000)
        break
      }
    }
    const extracted = await webView.evaluateJavaScript<string>(`
      (function(){
        var h=location.href;
        // 1. 优先从 URL 提取：/user/xxx 或 /share/user/xxx
        var m=h.match(/\/user\/([A-Za-z0-9_\-\.@]+)/);
        if(m&&m[1].length>15)return m[1];
        m=h.match(/sec_user_id=([^&#]+)/);
        if(m)return decodeURIComponent(m[1]);
        // 2. 从 _ROUTER_DATA 提取
        try{var v=Object.values(window._ROUTER_DATA?.loaderData||{});for(var i=0;i<v.length;i++){if(v[i]?.userPage?.sec_uid)return v[i].userPage.sec_uid;if(v[i]?.sec_uid)return v[i].sec_uid}}catch(e){}
        // 3. 从 __INITIAL_STATE__ 提取
        try{var s=window.__INITIAL_STATE__;if(s?.user?.sec_uid)return s.user.sec_uid}catch(e){}
        // 4. 从 __NEXT_DATA__ 提取
        try{var nd=JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent||'{}');if(nd?.props?.pageProps?.user?.sec_uid)return nd.props.pageProps.user.sec_uid;if(nd?.props?.pageProps?.sec_uid)return nd.props.pageProps.sec_uid}catch(e){}
        // 5. 从所有 script 标签搜索 sec_uid
        try{var sc=document.scripts;for(var j=0;j<sc.length;j++){m=(sc[j].textContent||'').match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]+)"/);if(m&&m[1].length>15)return m[1]}}catch(e){}
        // 6. 从 SSR state 提取
        try{var ssr=window.__SSR_RENDER_DATA__||window.__STORE__||window.__PREFETCH_DATA__;if(ssr&&typeof ssr==='object'){var json=JSON.stringify(ssr);m=json.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]+)"/);if(m&&m[1].length>15)return m[1]}}catch(e){}
        return''})()
    `)
    return typeof extracted === "string" ? extracted : ""
  } finally { webView.dispose() }
}

async function resolveSecUid(input: string): Promise<{ secUid: string; nickname?: string; avatar?: string; shortId?: string; totalFavorited?: number; followingCount?: number; followerCount?: number; signature?: string; ipLocation?: string; gender?: number; error?: string }> {
  let val = extractUrl(input)
  if (!val) return { secUid: "", error: "输入为空" }
  if (/v\.douyin\.com/.test(val)) {
    try {
      const uid = await resolveViaWebView(val)
      if (uid) return { secUid: uid }
      return { secUid: "", error: "无法解析该短链接" }
    }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  const mShare = val.match(/douyin\.com\/share\/user\/([A-Za-z0-9_\-\.]+)/)
  if (mShare) {
    const shareName = mShare[1]
    // 先用 Cookie 解析，不行再用 WebView
    try {
      const info = await resolveViaIesdouyin(shareName)
      if (info) return { secUid: info.secUid, nickname: info.nickname, avatar: info.avatar, shortId: shareName, totalFavorited: info.totalFavorited, followingCount: info.followingCount, followerCount: info.followerCount, signature: info.signature, ipLocation: info.ipLocation, gender: info.gender }
    } catch {}
    try {
      const uid = await resolveViaSharePage(shareName)
      if (uid) return { secUid: uid }
    } catch {}
    try {
      const uid = await resolveViaWebView(val)
      if (uid) return { secUid: uid }
    } catch {}
    return { secUid: "", error: "无法解析该分享链接" }
  }
  const m1 = val.match(/sec_user_id=([^&#]+)/)
  if (m1) return { secUid: decodeURIComponent(m1[1]) }
  const m2 = val.match(/douyin\.com\/user\/([A-Za-z0-9_\-\.]+)/)
  if (m2) return { secUid: m2[1] }
  if (val.length > 20 && /^[A-Za-z0-9_\-\.]{20,}$/.test(val)) return { secUid: val }
  if (/^[A-Za-z0-9_.]{3,30}$/.test(val) && !/^https?:\/\//.test(val)) {
    try {
      // 1. 原始 iesdouyin API + Cookie（最快，返回完整资料）
      const info = await resolveViaIesdouyin(val)
      if (info) return { secUid: info.secUid, nickname: info.nickname, avatar: info.avatar, shortId: val, totalFavorited: info.totalFavorited, followingCount: info.followingCount, followerCount: info.followerCount, signature: info.signature, ipLocation: info.ipLocation, gender: info.gender }
      // 2. SSR 分享页面 + Cookie
      const uid2 = await resolveViaSharePage(val)
      if (uid2) return { secUid: uid2, shortId: val }
      // 3. 最终兜底：WebView
      const uid3 = await resolveViaWebView(`https://www.douyin.com/share/user/${encodeURIComponent(val)}`)
      if (uid3) return { secUid: uid3, shortId: val }
      return { secUid: "", error: "无法解析该抖音号" }
    }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  if (/^https?:\/\//.test(val)) {
    try { const uid = await resolveViaWebView(val); if (uid) return { secUid: uid }; return { secUid: "", error: "无法从该链接解析" } }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  return { secUid: val }
}

// ─── 通过 Cookie 请求 SSR 分享页面解析抖音号 ───
// 原理：douyin.com/share/user/{抖音号} 是服务端渲染页面，HTML 中包含用户数据的 JSON
// 比 WebView 快（单次 HTTP 请求），比搜索 API 可靠
async function resolveViaSharePage(keyword: string): Promise<string> {
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!cookie) return ""
  try {
    const url = `https://www.douyin.com/share/user/${encodeURIComponent(keyword)}`
    const resp = await timeoutFetch(fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": MOBILE_UA,
        "Cookie": cookie,
        "Referer": "https://www.douyin.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      }
    }), 5000)
    if (!resp.ok) return ""
    const html = await resp.text()

    // 1. 尝试从 __INITIAL_STATE__ 提取
    const m1 = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.*?});?\s*<\/script>/)
    if (m1) {
      try {
        const state = JSON.parse(m1[1])
        // 不同页面结构：{ user: { sec_uid } } 或 { userPage: { sec_uid } }
        if (state?.user?.sec_uid) return state.user.sec_uid
        if (state?.userPage?.sec_uid) return state.userPage.sec_uid
      } catch {}
    }

    // 2. 直接用正则搜索所有 script 中的 "sec_uid":"xxxx"
    const m2 = html.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]{10,})"/)
    if (m2) return m2[1]

    // 3. 从任意 script 内容里提取
    const scriptRe = /<script[^>]*>([^<]{0,50000}?"sec_uid"[^<]*?)<\/script>/g
    let sm
    while ((sm = scriptRe.exec(html)) !== null) {
      const m = sm[1].match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]{10,})"/)
      if (m) return m[1]
    }
  } catch {}
  return ""
}

// ─── API ───
function parseAwemeResponse(rawJson: string): { videos: VideoInfo[]; maxCursor: number; hasMore: boolean } {
  let data: any
  try { data = JSON.parse(rawJson) } catch { throw new Error("JSON 解析失败") }
  if (data.status_code !== 0) throw new Error(`API 错误: ${data.status_msg || data.status_code}`)
  let awemeList: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : []
  if (awemeList.length === 0) {
    function findAwemeList(obj: any): any[] | null {
      if (!obj || typeof obj !== 'object') return null
      if (Array.isArray(obj.aweme_list)) return obj.aweme_list
      for (const k of Object.keys(obj)) { const v = obj[k]; if (v && typeof v === 'object') { if (Array.isArray(v.aweme_list)) return v.aweme_list; const r = findAwemeList(v); if (r) return r } }
      return null
    }
    const found = findAwemeList(data)
    if (found) awemeList = found
  }
  const videos: VideoInfo[] = awemeList.map((item: any) => ({
    aweme_id: item.aweme_id || "", desc: item.desc || "", create_time: item.create_time || 0,
    cover: pickBestUrl(item.video?.origin_cover?.url_list) || pickBestUrl(item.video?.cover?.url_list),
    play_url: pickBestUrl(item.video?.play_addr?.url_list) || pickBestUrl(item.video?.download_addr?.url_list) || "",
    duration: item.video?.duration || 0, digg_count: item.statistics?.digg_count || 0,
    comment_count: item.statistics?.comment_count || 0,
    author_nickname: item.author?.nickname || "",
    author_avatar: pickBestUrl(item.author?.avatar_larger?.url_list) || pickBestUrl(item.author?.avatar_medium?.url_list) || pickBestUrl(item.author?.avatar_thumb?.url_list),
    unique_id: item.author?.unique_id || "",
    author_ip_location: item.author?.ip_location || item.author?.ip_loc || item.author?.region || "",
    images: (item.images || []).map((img: any) => ({
      url: pickBestUrl(img.url_list),
      videoUrl: pickBestUrl(img.video?.play_addr?.url_list) || undefined,
    })).filter((img: ImageInfo) => img.url),
  }))
  return { videos, maxCursor: data.max_cursor || 0, hasMore: data.has_more === 1 }
}

async function fetchViaWebView(secUid: string, cursor: number = 0): Promise<string> {
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=web&aid=6383&sec_user_id=${encodeURIComponent(secUid)}&count=${POST_PAGE_SIZE}&max_cursor=${cursor}&cookie_enabled=true&platform=web&downlink=10`
  const webView = new WebViewController({ ephemeral: false })
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    await webView.loadURL("https://www.douyin.com/")
    await webView.waitForLoad()
    let sig = ""
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      try {
        sig = await webView.evaluateJavaScript<string>("(document.cookie.match(/__ac_signature=([^;]+)/)||[])[1]||''")
        if (sig && sig.length > 5) break
      } catch {}
    }
    if (!sig || sig.length <= 5) {
      try {
        await webView.loadURL(`https://www.douyin.com/user/${encodeURIComponent(secUid)}`)
        await webView.waitForLoad()
        await sleep(3000)
        for (let i = 0; i < 10; i++) {
          await sleep(2000)
          try {
            sig = await webView.evaluateJavaScript<string>("(document.cookie.match(/__ac_signature=([^;]+)/)||[])[1]||''")
            if (sig && sig.length > 5) break
          } catch {}
        }
      } catch {}
    }
    if (!sig || sig.length <= 5) {
      throw new Error("WebView 未获取到 __ac_signature。请在设置页填写 douyin.com Cookie 即可跳过此步骤。")
    }
    await webView.evaluateJavaScript(`
      (function(){window.__API_DONE=0;window.__API_DATA='';try{
        var x=new XMLHttpRequest();
        x.open('GET','${apiUrl.replace(/'/g, "\\'")}',true);
        x.setRequestHeader('Accept','application/json, text/plain, */*');
        x.onload=function(){window.__API_DATA=x.responseText;window.__API_DONE=2};
        x.onerror=function(){window.__API_DONE=1;window.__API_ERR='onerror'};
        x.ontimeout=function(){window.__API_DONE=1;window.__API_ERR='timeout'};
        x.timeout=20000;x.send()
      }catch(e){window.__API_DONE=1;window.__API_ERR=String(e)}})()
    `)
    for (let i = 0; i < 15; i++) {
      await sleep(1500)
      try {
        const done = await webView.evaluateJavaScript<string>("String(window.__API_DONE)")
        if (done === "2") return await webView.evaluateJavaScript<string>("window.__API_DATA") || ""
        if (done === "1") break
      } catch {}
    }
    try {
      const err = await webView.evaluateJavaScript<string>("window.__API_ERR || ''")
      throw new Error(`WebView XHR 失败: ${err || '请求超时或无响应'}`)
    } catch { throw new Error("WebView XHR 请求失败") }
  } finally { webView.dispose() }
}

async function fetchViaCookie(secUid: string, cursor: number = 0): Promise<string> {
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!cookie || cookie.length < 50) throw new Error("未配置 Cookie 或长度不足")
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=web&aid=6383&sec_user_id=${encodeURIComponent(secUid)}&count=${POST_PAGE_SIZE}&max_cursor=${cursor}&cookie_enabled=true&platform=web&downlink=10`
  const resp = await fetch(apiUrl, {
    headers: { "User-Agent": MOBILE_UA, "Referer": `https://www.douyin.com/user/${encodeURIComponent(secUid)}`, "Cookie": cookie, "Accept": "application/json" },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.text()
}

async function fetchUserPosts(secUid: string, cursor: number = 0): Promise<{ videos: VideoInfo[]; maxCursor: number; hasMore: boolean }> {
  const rawJson = await fetchViaCookie(secUid, cursor)
  return parseAwemeResponse(rawJson)
}

// ─── 获取用户完整资料 ───
function timeoutFetch<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ])
}

async function fetchUserProfile(secUid: string): Promise<Partial<SavedUser> | null> {
  let result: Partial<SavedUser> = {}
  let shortId = ""

  // 1. 用 sec_uid 调 iesdouyin（基础数据）+ Cookie
  try {
    const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
    const headers: Record<string, string> = { "User-Agent": ANDROID_UA, Referer: "https://www.iesdouyin.com/" }
    if (cookie) headers["Cookie"] = cookie
    const url = `https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid=${encodeURIComponent(secUid)}`
    const resp = await fetch(url, { method: "GET", headers })
    if (resp.ok) {
      const data = await resp.json()
      const info = data?.user_info
      if (info && info.sec_uid) {
        result = {
          nickname: info.nickname || "",
          avatar: pickFirstUrl(info.avatar_thumb?.url_list) || pickFirstUrl(info.avatar_larger?.url_list) || "",
          shortId: info.unique_id || "",
          totalFavorited: parseInt(info.total_favorited) || 0,
          followingCount: info.following_count || 0,
          followerCount: info.follower_count || 0,
          signature: info.signature || info.desc || "",
          ipLocation: info.ip_location || info.ip_loc || info.region || "",
          gender: info.gender ?? 0,
        }
      }
    }
  } catch {}
  // 2. 从已保存数据拿 shortId
  if (!shortId) {
    const existing = loadSavedUsers().find((u) => u.id === secUid)
    if (existing?.shortId) shortId = existing.shortId
  }

  // 3. 从作品 API 的 author 提取 unique_id
  if (!shortId) {
    try {
      const rawJson = await timeoutFetch(fetchViaCookie(secUid, 0), 15000)
      const data = JSON.parse(rawJson)
      const author = data?.aweme_list?.[0]?.author
      if (author?.unique_id) shortId = author.unique_id
    } catch {}
  }



  // 4. 尝试抖音官方用户资料 API（需要 Cookie）— 补充任何缺失字段
  if (!result.totalFavorited || !result.signature || !result.ipLocation || !result.gender) {
    try {
      const cookie = Storage.get<string>(KEY_COOKIE) || ""
      if (cookie && cookie.length >= 50) {
        const url = `https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${encodeURIComponent(secUid)}&device_platform=web&aid=6383&cookie_enabled=true&platform=web`
        const resp = await timeoutFetch(fetch(url, {
          method: "GET",
          headers: { "User-Agent": ANDROID_UA, "Cookie": cookie, "Referer": "https://www.douyin.com/" }
        }), 15000)
        if (resp.ok) {
          const data = await resp.json()
          const user = data?.user
          if (user) {
            const avatar = pickFirstUrl(user.avatar_thumb?.url_list) || pickFirstUrl(user.avatar_larger?.url_list) || ""
            result = {
              nickname: user.nickname || result.nickname || "",
              avatar: avatar || result.avatar || "",
              shortId: user.unique_id || result.shortId || "",
              totalFavorited: parseInt(user.total_favorited) || result.totalFavorited || 0,
              followingCount: user.following_count || result.followingCount || 0,
              followerCount: user.follower_count || result.followerCount || 0,
              signature: user.signature || user.desc || result.signature || "",
              ipLocation: user.ip_location || user.ip_loc || user.region || result.ipLocation || "",
              gender: user.gender ?? result.gender ?? 0,
            }
            // 不要 return — 后面还有从 author 数据补 IP 的步骤
          }
        }
      }
    } catch {}
  }

  // 5.5 如果 IP 地区仍为空，尝试从保存的用户数据中提取（不额外请求 API）
  if (!result.ipLocation) {
    // 从已保存的用户列表里找同一个人
    const existing = loadSavedUsers().find((u) => u.id === secUid)
    if (existing?.ipLocation) result.ipLocation = existing.ipLocation
  }

  // 6. 最终回退：直接从 author 数据
  if (!result.totalFavorited) {
    try {
      const rawJson = await timeoutFetch(fetchViaCookie(secUid, 0), 15000)
      const data = JSON.parse(rawJson)
      const author = data?.aweme_list?.[0]?.author
      if (author) {
        result = {
          nickname: author.nickname || result.nickname || "",
          avatar: pickFirstUrl(author.avatar_thumb?.url_list) || pickFirstUrl(author.avatar_larger?.url_list) || result.avatar || "",
          shortId: author.unique_id || result.shortId || "",
          totalFavorited: parseInt(author.total_favorited) || result.totalFavorited || 0,
          followingCount: author.following_count || result.followingCount || 0,
          followerCount: author.follower_count || result.followerCount || 0,
          signature: author.signature || result.signature || "",
          ipLocation: author.ip_location || author.ip_loc || author.region || result.ipLocation || "",
          gender: author.gender ?? result.gender ?? 0,
        }
      }
    } catch {}
  }

  return Object.keys(result).length > 0 ? result : null
}


// ─── 切换用户弹窗 ───
function SwitchUserView({ onSwitch, currentUid }: { onSwitch: (uid: string) => void; currentUid: string }) {
  const dismiss = Navigation.useDismiss()
  const users = loadSavedUsers()
  const [switching, setSwitching] = useState(false)

  return (
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground">
      <NavigationStack>
        <List navigationTitle="切换抖音号">
          {users.length === 0 ? (
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={16}>
              <Image systemName="person.2.slash" font="largeTitle" foregroundStyle="tertiaryLabel" />
              <Text font="title3" bold foregroundStyle="secondaryLabel">还没有保存的抖音号</Text>
              <Text font="callout" foregroundStyle="tertiaryLabel">去「设置」标签页添加</Text>
            </VStack>
          ) : (
            <Section>
              {/* 用网格展示 */}
              <VStack>
                <LazyVGrid columns={[
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                ]} spacing={16} padding={16}>
                  {users.map((u) => (
                    <VStack key={u.id} spacing={6} alignment="center" frame={{ maxWidth: "infinity" }} onTapGesture={() => {
                      if (u.id === currentUid) { dismiss(); return }
                      setSwitching(true); saveSecUid(u.id); dismiss(); onSwitch(u.id)
                    }}>
                      {u.avatar ? (
                        <Image imageUrl={u.avatar} resizable scaleToFill frame={{ width: 64, height: 64 }} clipShape={{ type: "rect", cornerRadius: 32 }} />
                      ) : (
                        <VStack frame={{ width: 64, height: 64 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 32 }} alignment="center">
                          <Image systemName="person.fill" font="title2" foregroundStyle="secondaryLabel" />
                        </VStack>
                      )}
                      <Text font="caption" lineLimit={1}>{u.nickname || u.id.slice(0, 10)}</Text>
                      {u.id === currentUid ? <Text font="caption2" foregroundStyle="systemBlue">当前</Text> : null}
                    </VStack>
                  ))}
                </LazyVGrid>
              </VStack>
            </Section>
          )}
        </List>
      </NavigationStack>
    </VStack>
  )
}

// ─── Cookie 工具函数 ───

function hasDouyinAuthCookie(cookie: string): boolean {
  return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt)=([^;]{6,})/.test(cookie)
}

async function validateCookieString(cookie: string): Promise<{ valid: boolean; detail: string }> {
  const trimmed = cookie.trim()
  if (!trimmed || trimmed.length < 50 || !hasDouyinAuthCookie(trimmed)) {
    return { valid: false, detail: "未检测到登录 Cookie" }
  }
  try {
    const resp = await fetch(
      "https://www.douyin.com/aweme/v1/web/im/user/info/",
      {
        method: "GET",
        headers: {
          "User-Agent": MOBILE_UA,
          "Cookie": trimmed,
          "Referer": "https://www.douyin.com/",
          "Accept": "application/json",
        },
      }
    )
    const text = await resp.text()
    if (!resp.ok) return { valid: false, detail: `检查失败: HTTP ${resp.status}` }
    if (!text || text.trim().startsWith("<") || /login|passport/i.test(text)) {
      return { valid: false, detail: "Cookie 未通过登录校验" }
    }
    let json: any
    try { json = JSON.parse(text) } catch { return { valid: false, detail: "Cookie 校验返回异常" } }
    if (json.status_code === 0) return { valid: true, detail: "Cookie 有效" }
    if (json.status_code === 3 || json.status_code === -99) return { valid: false, detail: "Cookie 已过期，请重新登录" }
    return { valid: false, detail: `Cookie 校验失败: ${json.status_code ?? "未知状态"}` }
  } catch (e: any) {
    return { valid: false, detail: `检查失败: ${e.message || e}` }
  }
}

function VideoGridCard({ video, cardWidth, onOpen }: { video: VideoInfo; cardWidth: number; onOpen: () => void }) {
  const coverWidth = cardWidth - 8
  return (
    <VStack key={video.aweme_id} spacing={5} padding={{ horizontal: 4, vertical: 3 }} frame={{ width: cardWidth }} background="systemBackground">
      <VStack frame={{ width: coverWidth, height: 200 }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 8 }} clipped overlay={{ alignment: "center", content: (
        <VStack frame={{ width: coverWidth, height: 200 }} background="black" opacity={0.001} onTapGesture={onOpen} />
      )}}>
        {video.cover ? <Image imageUrl={video.cover} resizable scaleToFill frame={{ width: coverWidth, height: 200 }} clipped allowsHitTesting={false} overlay={{ alignment: "bottom", content: (
          <VStack padding={3} spacing={3}>
            <HStack>
              {video.duration > 0 ? (
                <HStack padding={{ horizontal: 6, vertical: 2 }} background="black" opacity={0.6} clipShape={{ type: "rect", cornerRadius: 4 }} spacing={3}>
                  <Image systemName="play.fill" font="caption2" foregroundStyle="white" />
                  <Text font="caption2" foregroundStyle="white">{formatDuration(video.duration)}</Text>
                </HStack>
              ) : null}
              {video.images.length > 0 ? (
                <HStack padding={{ horizontal: 6, vertical: 2 }} background="black" opacity={0.6} clipShape={{ type: "rect", cornerRadius: 4 }} spacing={3}>
                  <Image systemName="photo.on.rectangle" font="caption2" foregroundStyle="white" />
                  <Text font="caption2" foregroundStyle="white">{video.images.length}</Text>
                </HStack>
              ) : null}
            </HStack>
            <HStack>
              <HStack spacing={2}>
                <Image systemName="heart.fill" font="caption2" foregroundStyle="systemPink" />
                <Text font="caption2" foregroundStyle="white">{formatCount(video.digg_count)}</Text>
              </HStack>
            </HStack>
          </VStack>
        )}} />
        : <VStack frame={{ width: coverWidth, height: 200 }} alignment="center" allowsHitTesting={false}><Image systemName="play.rectangle" font="largeTitle" foregroundStyle="tertiaryLabel" /></VStack>}
      </VStack>
      <Text font="caption2" lineLimit={2} padding={{ horizontal: 2 }}>{video.desc}</Text>
    </VStack>
  )
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

// ─── 主页 ───
function HomeView({ dismissApp, isActive }: { dismissApp: () => void; isActive: boolean }) {
  const gridCardWidth = getGridCardWidth()
  const [secUid, setSecUid] = useState(() => loadSecUid())
  const [videos, setVideos] = useState<VideoInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [cursor, setCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [userInfo, setUserInfo] = useState<{ nickname: string; avatar: string }>({ nickname: "", avatar: "" })

  async function doLoadVideos(reset: boolean, uidParam?: string) {
    const targetUid = uidParam || loadSecUid()
    if (!targetUid) { setError("请先设置抖音号"); return }
    const c = reset ? 0 : cursor
    if (reset) { setLoading(true); setVideos([]) } else { setLoadingMore(true) }
    setError("")
    try {
      const result = await fetchUserPosts(targetUid, c)
      if (reset) setVideos(result.videos)
      else setVideos((prev) => {
        const existingIds = new Set(prev.map((v) => v.aweme_id))
        return [...prev, ...result.videos.filter((v) => !existingIds.has(v.aweme_id))]
      })
      setCursor(result.maxCursor)
      setHasMore(result.hasMore)
      if (result.videos.length > 0) {
        const first = result.videos[0]
        const info = { nickname: first.author_nickname, avatar: first.author_avatar }
        setUserInfo(info)
        // 保留已保存用户的已有字段，同时从作品数据提取 IP 地区
        const users = loadSavedUsers()
        const existing = users.find((u) => u.id === targetUid)
        const ipLoc = first.author_ip_location || ""
        if (existing) {
          saveUser({ ...existing, nickname: info.nickname, avatar: info.avatar, ipLocation: ipLoc || existing.ipLocation || "" })
        } else {
          saveUser({ id: targetUid, ...info, savedAt: Date.now(), ipLocation: ipLoc || "" })
        }
      }
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
    }
    if (reset) setLoading(false)
    else setLoadingMore(false)
  }

  useEffect(() => {
    if (!isActive) return
    const activeUid = loadSecUid()
    if (activeUid !== secUid) setSecUid(activeUid)
    doLoadVideos(true, activeUid)
  }, [isActive])

  function handleSwitchUser(uid: string) {
    setSecUid(uid)
    doLoadVideos(true, uid)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={userInfo.nickname || "抖音作品"}
        toolbar={{
          topBarLeading: <Button title="关闭" action={() => dismissApp()} />,
          topBarTrailing: (
            <HStack spacing={8}>
              <Button title="刷新" action={() => doLoadVideos(true)} disabled={loading} />
              {userInfo.avatar ? (
                <Image
                  imageUrl={userInfo.avatar}
                  resizable scaleToFill
                  frame={{ width: 28, height: 28 }}
                  clipShape={{ type: "rect", cornerRadius: 14 }}
                  onTapGesture={() => {
                    Navigation.present(<SwitchUserView onSwitch={handleSwitchUser} currentUid={secUid} />)
                  }}
                />
              ) : (
                <Image
                  systemName="person.circle"
                  font="title2"
                  foregroundStyle="systemBlue"
                  onTapGesture={() => {
                    Navigation.present(<SwitchUserView onSwitch={handleSwitchUser} currentUid={secUid} />)
                  }}
                />
              )}
            </HStack>
          ),
        }}
      >
        {error ? (
          <Section>
            <VStack padding={{ vertical: 8, horizontal: 4 }} spacing={8} frame={{ maxWidth: "infinity" }}>
              <HStack spacing={6}>
                <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemRed" font="subheadline" />
                <Text font="subheadline" foregroundStyle="systemRed">{error}</Text>
              </HStack>
              {error.includes("Cookie") || error.includes("__ac_signature") ? (
                <VStack padding={12} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 10 }} spacing={6}>
                  <Text font="caption" bold>💡 建议：</Text>
                  <Text font="caption">在「设置」标签页填入有效的 douyin.com Cookie，可跳过 WebView 直接加载，速度快且稳定。</Text>
                  <Text font="caption" foregroundStyle="tertiaryLabel">获取 Cookie：在 Safari 打开 douyin.com 并登录 → 开发者工具 → 复制 Cookie 字符串</Text>
                </VStack>
              ) : null}
            </VStack>
          </Section>
        ) : null}

        {loading ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={12}>
              <ProgressView />
              <Text font="callout" foregroundStyle="secondaryLabel">加载中...</Text>
            </VStack>
          </Section>
        ) : videos.length === 0 ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={8}>
              <Image systemName="video.slash" font="title" foregroundStyle="tertiaryLabel" />
              <Text font="callout" foregroundStyle="secondaryLabel" padding={{ top: 4 }}>暂无作品</Text>
            </VStack>
          </Section>
        ) : (
          <Section>
            <VStack padding={{ horizontal: 12 }} spacing={16}>
              {chunkItems(videos, 3).map((row, rowIndex) => (
                <HStack key={rowIndex} spacing={14} frame={{ maxWidth: "infinity" }}>
                  {row.map((v, colIndex) => {
                    const itemIndex = rowIndex * 3 + colIndex
                    return <VideoGridCard key={v.aweme_id} video={v} cardWidth={gridCardWidth} onOpen={() => openVideo(v, itemIndex)} />
                  })}
                  {row.length < 3 ? Array.from({ length: 3 - row.length }).map((_, emptyIndex) => (
                    <VStack key={`empty-${rowIndex}-${emptyIndex}`} frame={{ width: gridCardWidth }} />
                  )) : null}
                </HStack>
              ))}
              {hasMore ? (
                <VStack padding={{ vertical: 16 }} frame={{ maxWidth: "infinity" }} alignment="center">
                  {loadingMore ? (
                    <HStack spacing={8}><ProgressView /><Text font="caption" foregroundStyle="secondaryLabel">加载更多...</Text></HStack>
                  ) : (
                    <Button action={() => doLoadVideos(false)}>
                      <HStack padding={{ horizontal: 20, vertical: 10 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 8 }} spacing={6}>
                        <Image systemName="arrow.down.circle" font="caption" />
                        <Text font="subheadline">加载更多</Text>
                      </HStack>
                    </Button>
                  )}
                </VStack>
              ) : videos.length > 0 ? (
                <VStack padding={{ vertical: 16 }} frame={{ maxWidth: "infinity" }} alignment="center">
                  <Text font="caption" foregroundStyle="tertiaryLabel">已加载全部作品</Text>
                </VStack>
              ) : null}
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

function HistoryItemCard({ item, idx, history, setHistory, cardWidth }: { item: HistoryItem; idx: number; history: HistoryItem[]; setHistory: (h: HistoryItem[]) => void; cardWidth: number }) {
  const coverWidth = cardWidth - 8
  const [confirmDelete, setConfirmDelete] = useState(false)
  const onPlay = () => openVideo(item, idx)
  const onDelete = () => { const u = history.filter((h) => h.aweme_id !== item.aweme_id); saveHistory(u); setHistory(u); setConfirmDelete(false) }
  return (
    <VStack spacing={5} padding={{ horizontal: 4, vertical: 3 }} frame={{ width: cardWidth }} background="systemBackground" onLongPressGesture={{ minDuration: 600, perform: () => setConfirmDelete(true) }} confirmationDialog={{
      title: "删除这条历史？",
      isPresented: confirmDelete,
      onChanged: setConfirmDelete,
      message: <Text>删除后不会影响作品本身。</Text>,
      actions: <VStack>
        <Button title="删除" role="destructive" action={onDelete} />
        <Button title="取消" role="cancel" action={() => setConfirmDelete(false)} />
      </VStack>,
    }}>
      <VStack frame={{ width: coverWidth, height: 200 }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 8 }} clipped overlay={{ alignment: "center", content: (
        <VStack frame={{ width: coverWidth, height: 200 }}>
          <VStack frame={{ width: coverWidth, height: 200 }} background="black" opacity={0.001} onTapGesture={onPlay} />

        </VStack>
      )}}>
        {item.cover ? (
          <Image imageUrl={item.cover} resizable scaleToFill frame={{ width: coverWidth, height: 200 }} clipped allowsHitTesting={false} />
        ) : (
          <VStack frame={{ width: coverWidth, height: 200 }} alignment="center" allowsHitTesting={false}><Image systemName="play.rectangle" font="largeTitle" foregroundStyle="tertiaryLabel" /></VStack>
        )}
      </VStack>
      <Text font="caption2" lineLimit={2} padding={{ horizontal: 2 }}>{item.desc}</Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 2 }}>{new Date(item.viewed_at).toLocaleDateString("zh-CN")}</Text>
    </VStack>
  )
}

// ─── 历史 ───
function HistoryView({ dismissApp, isActive }: { dismissApp: () => void; isActive: boolean }) {
  const gridCardWidth = getGridCardWidth()
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  useEffect(() => {
    if (!isActive) return
    const h = loadHistory()
    setHistory(h)
  }, [isActive])

  return (
    <NavigationStack>
      <List
        navigationTitle="观看历史"
        toolbar={{
          topBarLeading: <Button title="关闭" action={() => dismissApp()} />,
          topBarTrailing: history.length > 0 ? (
            <Button title="清空" action={() => { saveHistory([]); setHistory([]) }} />
          ) : undefined,
        }}
      >
        {history.length === 0 ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={12}>
              <Image systemName="clock.badge.questionmark" font="largeTitle" foregroundStyle="tertiaryLabel" />
              <Text font="title3" bold foregroundStyle="secondaryLabel">暂无观看历史</Text>
              <Text font="callout" foregroundStyle="tertiaryLabel">在主页点击任意作品后自动记录</Text>
            </VStack>
          </Section>
        ) : (
          <Section>
            <VStack padding={{ horizontal: 12 }}>
              <LazyVGrid columns={[
                { size: gridCardWidth, spacing: 14 },
                { size: gridCardWidth, spacing: 14 },
                { size: gridCardWidth, spacing: 14 },
              ]} spacing={16}>
                {history.map((item, idx) => (
                  <HistoryItemCard key={item.aweme_id} item={item} idx={idx} history={history} setHistory={setHistory} cardWidth={gridCardWidth} />
                ))}
              </LazyVGrid>
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ─── 设置 ───
function SettingsView({ isActive }: { isActive: boolean }) {
  const [inputValue, setInputValue] = useState("")
  const [cookieValue, setCookieValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: string; text: string }>({ type: "", text: "" })
  const [cookieStatus, setCookieStatus] = useState<{ checking: boolean; valid: boolean; detail: string }>({ checking: true, valid: false, detail: "检查中..." })
  const [savingCookie, setSavingCookie] = useState(false)
  // 首次渲染直接读取作品页已写入的当前用户，避免等 effect 后顶部仍是空白。
  const [savedInfo, setSavedInfo] = useState<SavedUser | null>(() => loadCurrentSavedUser())
  const [savedUsers, setSavedUsers] = useState<SavedUser[]>(() => loadSavedUsers())
  const [currentUid, setCurrentUid] = useState(() => loadSecUid())

  function refreshSavedUsers() {
    const users = loadSavedUsers()
    setSavedUsers(users)
    const uid = loadSecUid()
    setCurrentUid(uid)
    if (uid) {
      const users = loadSavedUsers(); const found = users.find((u) => u.id === uid)
      if (found) {
        setSavedInfo(found)
        // 缺资料时异步获取
        if (!found.totalFavorited || !found.shortId || !found.signature || !found.ipLocation) {
          fetchUserProfile(uid).then((profile) => {
            if (profile) {
              const all = loadSavedUsers().map((u) => u.id === uid ? {
                ...u,
                ...(profile.nickname ? { nickname: profile.nickname } : {}),
                ...(profile.avatar ? { avatar: profile.avatar } : {}),
                ...(profile.shortId ? { shortId: profile.shortId } : {}),
                ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
                ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
                ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
                ...(profile.signature ? { signature: profile.signature } : {}),
                ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
                ...(profile.gender ? { gender: profile.gender } : {}),
                id: u.id, savedAt: u.savedAt,
              } : u)
              Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
          const newUsers = loadSavedUsers()
              setSavedUsers(newUsers)
              const updated = newUsers.find((u) => u.id === uid)
              if (updated && loadSecUid() === uid) setSavedInfo(updated)
            }
          }).catch(() => {})
        }
      }
      else {
        // 兼容只有当前 uid、尚未写入用户列表的旧数据：立即显示占位并主动补齐资料。
        const placeholder: SavedUser = { id: uid, nickname: "", avatar: "", savedAt: Date.now() }
        setSavedInfo(placeholder)
        fetchUserProfile(uid).then((profile) => {
          if (!profile || loadSecUid() !== uid) return
          const user: SavedUser = {
            ...placeholder,
            ...profile,
            id: uid,
            savedAt: placeholder.savedAt,
            nickname: profile.nickname || "",
            avatar: profile.avatar || "",
          }
          saveUser(user)
          const newUsers = loadSavedUsers()
          setSavedUsers(newUsers)
          if (loadSecUid() === uid) setSavedInfo(newUsers.find((u) => u.id === uid) || user)
        }).catch(() => {})
      }
    } else { setSavedInfo(null) }
  }

  useEffect(() => {
    if (isActive) refreshSavedUsers()
  }, [isActive])

  // 检查 Cookie 状态
  useEffect(() => {
    const checkedCookie = Storage.get<string>(KEY_COOKIE) || ""
    ;(async () => {
      const result = await validateCookieString(checkedCookie)
      if ((Storage.get<string>(KEY_COOKIE) || "") === checkedCookie) {
        setCookieStatus({ checking: false, valid: result.valid, detail: result.detail })
      }
    })()
  }, [])

  async function handleCookieSave() {
    const candidate = cookieValue.trim()
    if (!candidate) {
      setCookieStatus({ checking: false, valid: false, detail: "请输入 Cookie" })
      return
    }
    setSavingCookie(true)
    setCookieStatus({ checking: true, valid: false, detail: "正在校验..." })
    const result = await validateCookieString(candidate)
    if (result.valid) {
      Storage.set(KEY_COOKIE, candidate)
      setCookieValue("")
    }
    setCookieStatus({ checking: false, valid: result.valid, detail: result.detail })
    setSavingCookie(false)
  }

  function handleCookieClear() {
    Storage.remove(KEY_COOKIE)
    setCookieValue("")
    setCookieStatus({ checking: false, valid: false, detail: "Cookie 已清除" })
  }

  async function handleSave() {
    const t = inputValue.trim()
    if (!t) { setStatus({ type: "error", text: "请输入抖音号" }); return }
    setSaving(true); setStatus({ type: "", text: "" })
    try {
      const r = await resolveSecUid(t)
      if (r.error) { setStatus({ type: "error", text: r.error }); setSaving(false); return }
      saveSecUid(r.secUid)
      let nn = r.nickname || ""; let av = r.avatar || ""
      let fullUser: SavedUser = {
        id: r.secUid, nickname: nn, avatar: av, savedAt: Date.now(),
        shortId: r.shortId || "", totalFavorited: r.totalFavorited || 0,
        followingCount: r.followingCount || 0, followerCount: r.followerCount || 0,
        signature: r.signature || "", ipLocation: r.ipLocation || "", gender: r.gender ?? 0,
      }
      if (!nn) {
        try { const posts = await fetchUserPosts(r.secUid, 0); if (posts.videos.length > 0) { const p = posts.videos[0]; nn = p.author_nickname; av = p.author_avatar; fullUser.nickname = nn; fullUser.avatar = av } } catch { /* ignore */ }
      }
      // 异步补充资料：不阻塞保存
      fetchUserProfile(r.secUid).then((profile) => {
        if (profile) {
          const all = loadSavedUsers().map((u) => u.id === r.secUid ? {
            ...u,
            ...(profile.nickname ? { nickname: profile.nickname } : {}),
            ...(profile.avatar ? { avatar: profile.avatar } : {}),
            ...(profile.shortId ? { shortId: profile.shortId } : {}),
            ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
            ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
            ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
            ...(profile.signature ? { signature: profile.signature } : {}),
            ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
            ...(profile.gender ? { gender: profile.gender } : {}),
            id: u.id, savedAt: u.savedAt,
          } : u)
          Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
          setSavedUsers(loadSavedUsers())
          const updated = loadSavedUsers().find((x) => x.id === r.secUid)
          if (updated && loadSecUid() === r.secUid) setSavedInfo(updated)
        }
      }).catch(() => {})
      saveUser(fullUser)
      setSavedInfo(fullUser); setInputValue("")
      refreshSavedUsers()
    } catch (e) { setStatus({ type: "error", text: (e as Error).message }) }
    setSaving(false)
  }

  return (
    <NavigationStack>
      <List navigationTitle="设置">
        <Section>
          <VStack padding={16} spacing={12} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <Text font="headline" bold>当前用户</Text>
              <Spacer />
              {savedInfo ? (
                <Image systemName="arrow.clockwise" font="headline" foregroundStyle="systemBlue" onTapGesture={() => {
                  const uid = loadSecUid()
                  if (uid) {
                    fetchUserProfile(uid).then((profile) => {
                      if (profile) {
                        const all = loadSavedUsers().map((u) => u.id === uid ? {
                          ...u,
                          ...(profile.nickname ? { nickname: profile.nickname } : {}),
                          ...(profile.avatar ? { avatar: profile.avatar } : {}),
                          ...(profile.shortId ? { shortId: profile.shortId } : {}),
                          ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
                          ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
                          ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
                          ...(profile.signature ? { signature: profile.signature } : {}),
                          ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
                          ...(profile.gender ? { gender: profile.gender } : {}),
                          id: u.id, savedAt: u.savedAt,
                        } : u)
                        Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
                        const newUsers = loadSavedUsers()
                        setSavedUsers(newUsers)
                        const updated = newUsers.find((x) => x.id === uid)
                        if (updated) setSavedInfo(updated)
                      }
                    }).catch(() => {})
                  }
                }} />
              ) : null}
            </HStack>
            {savedInfo ? (
              <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={12}>
                  {savedInfo.avatar ? <Image imageUrl={savedInfo.avatar} resizable scaleToFill frame={{ width: 56, height: 56 }} clipShape={{ type: "rect", cornerRadius: 28 }} /> : <VStack frame={{ width: 56, height: 56 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 28 }} alignment="center"><Image systemName="person.fill" font="title2" foregroundStyle="tertiaryLabel" /></VStack>}
                  <VStack spacing={2} alignment="leading">
                    <Text font="title3" bold>{savedInfo.nickname || "抖音用户"}</Text>
                    {savedInfo.shortId ? <Text font="subheadline" foregroundStyle="secondaryLabel">抖音号: {savedInfo.shortId}</Text> : null}
                  </VStack>
                </HStack>
                {(savedInfo.totalFavorited || savedInfo.followingCount || savedInfo.followerCount) ? (
                  <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.totalFavorited || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">获赞</Text>
                    </VStack>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.followingCount || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">关注</Text>
                    </VStack>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.followerCount || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">粉丝</Text>
                    </VStack>
                  </HStack>
                ) : null}
                {savedInfo.signature ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={3}>{savedInfo.signature}</Text> : null}
                {(savedInfo.ipLocation || savedInfo.gender) ? (
                  <HStack spacing={16}>
                    {savedInfo.ipLocation ? <HStack spacing={4}><Image systemName="location.fill" font="caption" foregroundStyle="tertiaryLabel" /><Text font="caption" foregroundStyle="tertiaryLabel">{savedInfo.ipLocation}</Text></HStack> : null}
                    {savedInfo.gender === 1 ? <Text font="caption" foregroundStyle="tertiaryLabel">♂ 男</Text> : savedInfo.gender === 2 ? <Text font="caption" foregroundStyle="tertiaryLabel">♀ 女</Text> : null}
                  </HStack>
                ) : null}
              </VStack>
            ) : (
              <Text foregroundStyle="secondaryLabel">尚未设置</Text>
            )}
          </VStack>
        </Section>

        <Section title="添加/修改抖音号">
          <TextField
            title="抖音号"
            prompt="粘贴抖音号 / 链接 / sec_uid"
            value={inputValue}
            onChanged={(val: string) => setInputValue(val)}
          />
          <Button
            title={saving ? "解析中..." : "保存"}
            action={handleSave}
            disabled={saving || !inputValue.trim()}
          />
          {status.text ? (
            <Text font="caption" foregroundStyle={status.type === "error" ? "systemRed" : "systemGreen"}>
              {status.text}
            </Text>
          ) : null}
        </Section>

        <Section title="Cookie 配置">
          <VStack padding={12} spacing={12} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              {cookieStatus.checking ? (
                <ProgressView foregroundStyle="systemBlue" />
              ) : (
                <Image
                  systemName={cookieStatus.valid ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
                  foregroundStyle={cookieStatus.valid ? "systemGreen" : "systemOrange"}
                  font="body"
                />
              )}
              <VStack spacing={0} alignment="leading">
                <Text font="body" bold>{cookieStatus.checking ? "正在校验..." : (cookieStatus.valid ? "Cookie 有效" : "Cookie 无效")}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">{cookieStatus.checking ? "" : cookieStatus.detail}</Text>
              </VStack>
              <Spacer />
            </HStack>

            {cookieStatus.valid ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <Spacer />
                <Button title="清除 Cookie" role="destructive" action={handleCookieClear} />
              </HStack>
            ) : (
              <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
                <TextField
                  title="Cookie"
                  prompt="粘贴抖音 Cookie"
                  value={cookieValue}
                  onChanged={(val: string) => setCookieValue(val)}
                />
                <HStack frame={{ maxWidth: "infinity" }}>
                  <Spacer />
                  <Button title={savingCookie ? "校验中..." : "校验并保存"} action={handleCookieSave} disabled={savingCookie || !cookieValue.trim()} />
                </HStack>
              </VStack>
            )}
          </VStack>
        </Section>

        <Section title={`已保存用户（${savedUsers.length}）`}>
          {savedUsers.length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel">暂无已保存的用户</Text>
          ) : (
            savedUsers.map((u) => (
              <HStack
                key={u.id}
                spacing={12}
                padding={{ vertical: 8, leading: 0, trailing: 0 }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button tint="systemRed" action={() => {
                      const users = loadSavedUsers().filter((x) => x.id !== u.id)
                      Storage.set(KEY_SAVED_USERS, JSON.stringify(users))
                      if (u.id === loadSecUid()) {
                        if (users.length > 0) saveSecUid(users[0].id)
                        else Storage.remove(KEY_SEC_UID)
                      }
                      refreshSavedUsers()
                    }}>
                      <VStack spacing={2}>
                        <Image systemName="trash" font="body" />
                        <Text font="caption" foregroundStyle="tertiaryLabel">删除</Text>
                      </VStack>
                    </Button>,
                  ],
                }}
              >
                <HStack spacing={12} frame={{ maxWidth: "infinity" }} onTapGesture={() => {
                  if (u.id !== currentUid) { saveSecUid(u.id); refreshSavedUsers() }
                }}>
                  {u.avatar ? <Image imageUrl={u.avatar} resizable scaleToFill frame={{ width: 36, height: 36 }} clipShape={{ type: "rect", cornerRadius: 18 }} /> : <VStack frame={{ width: 36, height: 36 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 18 }} alignment="center"><Image systemName="person.fill" font="caption" foregroundStyle="tertiaryLabel" /></VStack>}
                  <VStack spacing={0} frame={{ maxWidth: "infinity" }} alignment="leading">
                    <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{u.nickname || "未命名"}</Text>
                  </VStack>
                  {u.id === currentUid ? (
                    <Text font="caption" foregroundStyle="systemBlue">当前</Text>
                  ) : null}
                </HStack>
              </HStack>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 主入口 ───
function App() {
  const dismiss = Navigation.useDismiss()
  const [tabIndex, setTabIndex] = useState(0)

  function handleTabIndexChanged(index: number) {
    setTabIndex(index)
  }

  return (
    <TabView tabIndex={tabIndex} onTabIndexChanged={handleTabIndexChanged}>
      <Tab title="作品" systemImage="rectangle.grid.2x2" value={0}>
        <HomeView dismissApp={() => dismiss()} isActive={tabIndex === 0} />
      </Tab>
      <Tab title="历史" systemImage="clock" value={1}>
        <HistoryView dismissApp={() => dismiss()} isActive={tabIndex === 1} />
      </Tab>
      <Tab title="设置" systemImage="gear" value={2}>
        <SettingsView isActive={tabIndex === 2} />
      </Tab>
    </TabView>
  )
}

async function run() {
  try {
    await Navigation.present({
      element: <App />,
      modalPresentationStyle: 'overFullScreen',
    })
  } finally {
    Script.exit()
  }
}

run()
