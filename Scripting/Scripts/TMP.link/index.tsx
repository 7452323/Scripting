import {
  Script, Navigation, NavigationStack, ScrollView,
  Button, Text, VStack, HStack, Image, Spacer,
  TabView, Tab, List, Divider,
  useObservable, useState, useCallback, useMemo, useEffect,
  fetch, FormData, TextField, Picker, ProgressView
} from "scripting"

// ──────────────────────────────────────────────
// Token (Storage-backed, 用户通过设置页面自行填入)
// ──────────────────────────────────────────────

const TOKEN_KEY = "tmp_link_token"

function getToken(): string {
  return Storage.get<string>(TOKEN_KEY) || ""
}
function saveToken(token: string): void {
  Storage.set(TOKEN_KEY, token)
}

// ──────────────────────────────────────────────
// SHA1
// ──────────────────────────────────────────────

function sha1(str: string): string {
  function rotateLeft(n: number, s: number): number {
    return (n << s) | (n >>> (32 - s))
  }
  const utf8 = unescape(encodeURIComponent(str))
  let len = utf8.length
  const words: number[] = []
  for (let i = 0; i < len; i++) {
    words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8)
  }
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8)
  words[((len + 8) >> 6) * 16 + 15] = len * 8

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0
  for (let block = 0; block < words.length; block += 16) {
    const w = words.slice(block, block + 16)
    for (let i = 16; i < 80; i++) {
      w[i] = rotateLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const temp = (rotateLeft(a, 5) + f + e + k + w[i]) & 0xFFFFFFFF
      e = d; d = c; c = rotateLeft(b, 30); b = a; a = temp
    }
    h0 = (h0 + a) & 0xFFFFFFFF
    h1 = (h1 + b) & 0xFFFFFFFF
    h2 = (h2 + c) & 0xFFFFFFFF
    h3 = (h3 + d) & 0xFFFFFFFF
    h4 = (h4 + e) & 0xFFFFFFFF
  }
  function toHex(n: number): string {
    const s = (n >>> 0).toString(16)
    return "00000000".slice(s.length) + s
  }
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4)
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface UploadedFile {
  id: string
  name: string
  size: number
  createdAt: string
  shareUrl: string
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
}

function formatDate(dateStr: string): string {
  // API 返回格式如 "2026-07-17 04:51:05"，直接截取
  const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  if (m) return `${m[1]} ${m[2]}`
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ──────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────

const STORAGE_KEY_FILES = "tmp_uploaded_files"

function loadFiles(): UploadedFile[] {
  const raw = Storage.get<string>(STORAGE_KEY_FILES)
  if (!raw) return []
  try { return JSON.parse(raw) } catch (_) { return [] }
}

function saveFiles(files: UploadedFile[]): void {
  Storage.set(STORAGE_KEY_FILES, JSON.stringify(files))
}

// ──────────────────────────────────────────────
// TMP.link API
// ──────────────────────────────────────────────

const API_SEC = "https://tmplink-sec.vxtrans.com/api_v2"

async function apiCall(url: string, body: Record<string, string>): Promise<any> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    params.append(key, value)
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://www.tmp.link",
      "Referer": "https://www.tmp.link/",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    body: params.toString(),
  })
  return resp.json()
}

// 从服务器拉取工作区文件列表（网页端上传的文件也会出现在这里）
async function fetchRemoteFiles(token: string): Promise<UploadedFile[]> {
  if (!token) throw new Error("请先点击首页右上角齿轮图标设置 Token")
  const result: UploadedFile[] = []
  for (let page = 0; page < 40; page++) {
    const rsp = await apiCall(API_SEC + "/file", {
      action: "workspace_filelist_page",
      page: page.toString(),
      token,
      sort_type: "send",
      sort_by: "0",
      photo: "0",
      search: "",
    })
    // status 101 = 工作区为空（非错误）
    if (rsp.status === 101) break
    if (rsp.status !== 1 || !Array.isArray(rsp.data)) {
      if (page === 0) throw new Error("获取文件列表失败: " + JSON.stringify(rsp))
      break
    }
    for (const f of rsp.data) {
      result.push({
        id: f.ukey,
        name: f.fname,
        size: Number(f.filesize ?? f.fsize) || 0,
        createdAt: f.ctime,
        shareUrl: `https://tmp.link/f/${f.ukey}`,
      })
    }
    if (rsp.data.length < 50) break
  }
  return result
}

// 从工作区删除文件（与网页端 workspace_del 相同的接口）
async function deleteRemoteFile(token: string, ukey: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "请先点击首页右上角齿轮图标设置 Token" }
  const rsp = await apiCall(API_SEC + "/file", {
    action: "remove_from_workspace",
    token,
    ukey,
  })
  if (rsp.status === 101) return { ok: false, error: "Token 无效或已过期，请重新设置" }
  return { ok: rsp.status === 1, error: rsp.status === 1 ? undefined : "服务器返回失败" }
}

async function recaptchaDo(): Promise<string> {
  const rsp = await apiCall(API_SEC + "/token", { action: "challenge" })
  if (rsp.status !== 1) throw new Error("captcha failed: " + JSON.stringify(rsp))
  return rsp.data as string
}

async function doUpload(token: string, filePath: string, fileName: string, filesize: number, model: number, onProgress?: (uploaded: number, total: number) => void): Promise<string> {
  const uid = "0"
  const sliceSize = 3 * 1024 * 1024

  const cap1 = await recaptchaDo()
  const slotResp = await apiCall(API_SEC + "/file", {
    action: "upload_request_select2",
    token,
    filesize: filesize.toString(),
    captcha: cap1,
  })
  if (slotResp.status !== 1) throw new Error("upload_request_select2 failed: " + JSON.stringify(slotResp))
  const utoken = slotResp.data.utoken as string
  const serverUrl = (slotResp.data.servers as any[])[0].url as string

  const uptoken = sha1(uid + fileName + filesize + sliceSize)

  let fileKey = ""
  let maxLoops = 20

  while (maxLoops-- > 0) {
    const prepareResp = await apiCall(serverUrl + "/app/upload_slice", {
      token,
      uptoken,
      action: "prepare",
      sha1: "0",
      filename: fileName,
      filesize: filesize.toString(),
      slice_size: sliceSize.toString(),
      utoken,
      mr_id: "0",
      model: model.toString(),
    })

    if (prepareResp.status === 8 || prepareResp.status === 1 || prepareResp.status === 6) {
      fileKey = prepareResp.data as string
      break
    }

    if (prepareResp.status === 3 && prepareResp.data) {
      const sliceInfo = prepareResp.data
      const index = sliceInfo.next || 0

      const fileData = Data.fromFile(filePath)
      if (!fileData) throw new Error("无法读取文件")

      const cap2 = await recaptchaDo()

      const form = new FormData()
      form.append("filedata", fileData, "application/octet-stream", "slice")
      form.append("uptoken", uptoken)
      form.append("filename", fileName)
      form.append("index", index.toString())
      form.append("action", "upload_slice")
      form.append("slice_size", sliceSize.toString())
      form.append("captcha", cap2)

      const uploadResp = await fetch(serverUrl + "/app/upload_slice", {
        method: "POST",
        body: form,
        headers: {
          "Origin": "https://www.tmp.link",
          "Referer": "https://www.tmp.link/",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        },
      })
      const uploadRsp = await uploadResp.json()
      if (uploadRsp.status !== 5) {
        throw new Error("upload_slice failed: " + JSON.stringify(uploadRsp))
      }
      onProgress?.(Math.min((index + 1) * sliceSize, filesize), filesize)
      continue
    }

    if (prepareResp.status === 2) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 5000))
      continue
    }

    throw new Error("prepare unexpected: " + JSON.stringify(prepareResp))
  }

  if (!fileKey) throw new Error("upload loop exhausted without file key")
  return fileKey
}

// ──────────────────────────────────────────────
// Home View
// ──────────────────────────────────────────────

function HomeView({ files }: { files: UploadedFile[] }) {
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  const handleOpenSettings = useCallback(() => {
    Navigation.present({ element: <SettingsView /> })
  }, [])

  return (
    <NavigationStack>
      <ScrollView>
        <VStack spacing={20} padding={{ horizontal: 16, top: 56, bottom: 100 }}>

          <HStack alignment="center">
            <VStack spacing={6}>
              <Text font={32} fontWeight="bold">TMP.link</Text>
              <Text font={15} foregroundStyle="secondaryLabel">公网文件分享，不限速，无限空间</Text>
            </VStack>
            <Spacer />
            <Button
              title=""
              systemImage="gearshape.circle.fill"
              action={handleOpenSettings}
              buttonStyle="plain"
              font={28}
            />
          </HStack>

          <Divider />

          <HStack spacing={0}>
            <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={4}>
              <Text font={28} fontWeight="bold">{files.length}</Text>
              <Text font={13} foregroundStyle="secondaryLabel">文件数</Text>
            </VStack>
            <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={4}>
              <Text font={28} fontWeight="bold">{formatSize(totalSize)}</Text>
              <Text font={13} foregroundStyle="secondaryLabel">总大小</Text>
            </VStack>
          </HStack>

        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ──────────────────────────────────────────────
// Settings View
// ──────────────────────────────────────────────

function SettingsView() {
  const tokenHint = "请输入Token"
  const [tokenValue, setTokenValue] = useState(getToken())
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(() => {
    const trimmed = tokenValue.trim()
    if (!trimmed) return
    saveToken(trimmed)
    setSaved(true)
  }, [tokenValue])

  return (
    <NavigationStack>
      <ScrollView>
        <VStack spacing={20} padding={{ horizontal: 16, top: 24, bottom: 50 }}>
          <VStack spacing={6}>
            <Text font={28} fontWeight="bold">设置</Text>
            <Text font={14} foregroundStyle="secondaryLabel">
              填入你的 TMP.link 工作区 Token
            </Text>
          </VStack>

          <Divider />

          <TextField
            title="Token"
            value={tokenValue}
            onChanged={(v) => { setTokenValue(v); setSaved(false) }}
            prompt={tokenHint}
          />

          <Text font={12} foregroundStyle="secondaryLabel">
            登录 tmp.link 后，浏览器 F12 → Application → Local Storage → app_token，复制填入此处。保存后返回首页下拉刷新即可生效。
          </Text>

          <Button
            title={saved ? "已保存 ✓" : "保存"}
            action={handleSave}
            buttonStyle="borderedProminent"
            controlSize="large"
            frame={{ maxWidth: "infinity" }}
            disabled={saved || !tokenValue.trim()}
          />
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ──────────────────────────────────────────────
// Files View
// ──────────────────────────────────────────────

const ICON_MAP: Record<string, string> = {
  "jpg": "photo.fill", "jpeg": "photo.fill", "png": "photo.fill",
  "gif": "photo.fill", "webp": "photo.fill", "heic": "photo.fill",
  "mp4": "video.fill", "mov": "video.fill", "mkv": "video.fill",
  "mp3": "music.note", "wav": "music.note", "flac": "music.note",
  "pdf": "doc.richtext.fill",
  "zip": "archivebox.fill", "rar": "archivebox.fill", "7z": "archivebox.fill",
  "doc": "doc.text.fill", "docx": "doc.text.fill",
  "xls": "tablecells.fill", "xlsx": "tablecells.fill",
  "txt": "doc.text.magnifyingglass",
}

const MODEL_OPTIONS: { label: string; model: number }[] = [
  { label: "24h", model: 0 },
  { label: "3天", model: 1 },
  { label: "7天", model: 2 },
  { label: "30天", model: 3 },
]

function FilesView({ files, onFilesChanged }: { files: UploadedFile[], onFilesChanged: () => Promise<void> }) {
  const [isUploading, setIsUploading] = useState(false)
  const [expireModel, setExpireModel] = useState<number>(1)
  const [sourceMode, setSourceMode] = useState<number>(0) // 0=相册, 1=文件
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number; done: boolean }>({ uploaded: 0, total: 0, done: false })
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  const handleUpload = useCallback(async () => {
    const token = getToken()
    if (!token) {
      await Dialog.alert({
        title: "未设置 Token",
        message: "请点击首页右上角齿轮图标设置 Token 后再上传",
        buttonLabel: "知道了",
      })
      return
    }

    try {
      let filePath: string
      let fileName: string

      if (sourceMode === 0) {
        // 从相册选
        const results = await Photos.pick({ limit: 1 })
        if (!results || results.length === 0) return
        const r = results[0]
        filePath = (await r.imagePath()) || (await r.videoPath()) || ""
        if (!filePath) throw new Error("无法读取相册文件")
        const parts = filePath.split("/")
        fileName = parts[parts.length - 1] || "photo"
      } else {
        // 从文件选
        const picked = await DocumentPicker.pickFiles()
        if (!picked || picked.length === 0) return
        filePath = picked[0]
        const parts = filePath.split("/")
        fileName = parts[parts.length - 1] || "file"
      }

      const stat = await FileManager.stat(filePath)
      setIsUploading(true)
      setUploadProgress({ uploaded: 0, total: stat.size, done: false })

      const fileKey = await doUpload(token, filePath, fileName, stat.size, expireModel, (uploaded, total) => {
        setUploadProgress({ uploaded, total, done: false })
      })
      const shareUrl = `https://tmp.link/f/${fileKey}`

      await onFilesChanged()

      await Dialog.alert({
        title: "上传成功",
        message: shareUrl,
        buttonLabel: "知道了",
      })
    } catch (err: any) {
      await Dialog.alert({
        title: "上传失败",
        message: err.message || "未知错误",
        buttonLabel: "知道了",
      })
    } finally {
      setIsUploading(false)
      setUploadProgress(p => ({ ...p, done: true }))
    }
  }, [onFilesChanged, expireModel, sourceMode])

  const handleDelete = useCallback(async (file: UploadedFile) => {
    try {
      const result = await deleteRemoteFile(getToken(), file.id)
      if (!result.ok) throw new Error(result.error || "服务器返回失败")
      await onFilesChanged()
    } catch (err: any) {
      await Dialog.alert({
        title: "删除失败",
        message: err.message || "未知错误",
        buttonLabel: "知道了",
      })
    }
  }, [onFilesChanged])

  const handleCopyLink = useCallback(async (file: UploadedFile) => {
    await Pasteboard.setString(file.shareUrl)
    await Dialog.alert({
      title: "已复制",
      message: file.shareUrl,
      buttonLabel: "知道了",
    })
  }, [])

  return (
    <NavigationStack>
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <VStack padding={{ horizontal: 16, vertical: 12 }}>
          <HStack alignment="center">
            <VStack spacing={2}>
              <Text font={28} fontWeight="bold">我的文件</Text>
              <Text font={14} foregroundStyle="secondaryLabel">
                {files.length === 0
                  ? "暂无文件"
                  : `共 ${files.length} 个 · ${formatSize(totalSize)}`}
              </Text>
            </VStack>
            <Spacer />
            <Button
              title={isUploading ? "上传中..." : "上传"}
              action={handleUpload}
              systemImage="plus.circle.fill"
              buttonStyle="bordered"
              controlSize="large"
              disabled={isUploading}
            />
          </HStack>
          <Picker
            title="来源"
            pickerStyle="segmented"
            value={sourceMode}
            onChanged={(v: number) => setSourceMode(v)}
          >
            <Text tag={0}>从相册</Text>
            <Text tag={1}>从文件</Text>
          </Picker>
          <Picker
            title="有效期"
            pickerStyle="segmented"
            value={expireModel}
            onChanged={(v: number) => setExpireModel(v)}
          >
            {MODEL_OPTIONS.map((opt) => (
              <Text key={opt.model} tag={opt.model}>{opt.label}</Text>
            ))}
          </Picker>
        </VStack>

        {(isUploading || uploadProgress.done) && (
          <VStack padding={{ horizontal: 16, vertical: 10 }} spacing={6}>
            <ProgressView
              progressViewStyle="linear"
              value={uploadProgress.done ? uploadProgress.total : uploadProgress.uploaded}
              total={uploadProgress.total}
              currentValueLabel={
                uploadProgress.done
                  ? <Text font={14} foregroundStyle="secondaryLabel">已上传成功</Text>
                  : <Text font={14} foregroundStyle="secondaryLabel">
                      {Math.round((uploadProgress.uploaded / uploadProgress.total) * 100)}% {formatSize(uploadProgress.uploaded)} / {formatSize(uploadProgress.total)}
                    </Text>
              }
            />
          </VStack>
        )}

        {files.length === 0 ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
        ) : (
          <List
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            refreshable={onFilesChanged}
          >
            {files.map((file) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || ""
              const icon = ICON_MAP[ext] || "doc.fill"

              return (
                <HStack
                  key={file.id}
                  alignment="center"
                  spacing={12}
                  padding={{ horizontal: 16, vertical: 12 }}
                  trailingSwipeActions={{
                    allowsFullSwipe: true,
                    actions: [
                      <Button
                        title="复制"
                        systemImage="doc.on.doc"
                        action={() => handleCopyLink(file)}
                      />,
                      <Button
                        title="删除"
                        systemImage="trash.fill"
                        role="destructive"
                        action={() => handleDelete(file)}
                      />,
                    ],
                  }}
                >
                  <Image systemName={icon} font={24} />
                  <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
                    <Text font={15} fontWeight="medium" lineLimit={1}>
                      {file.name}
                    </Text>
                    <HStack spacing={14}>
                      <Text font={12} foregroundStyle="secondaryLabel">{formatSize(file.size)}</Text>
                      <Text font={12} foregroundStyle="secondaryLabel">{formatDate(file.createdAt)}</Text>
                    </HStack>
                  </VStack>
                  <Image systemName="chevron.right" font={13} foregroundStyle="secondaryLabel" opacity={0.5} />
                </HStack>
              )
            })}
          </List>
        )}
      </VStack>
    </NavigationStack>
  )
}

// ──────────────────────────────────────────────
// Root View
// ──────────────────────────────────────────────

function RootView() {
  // 先显示本地缓存，随后从服务器拉取真实列表
  const [files, setFiles] = useState<UploadedFile[]>(() => loadFiles())

  const refreshFiles = useCallback(async () => {
    const token = getToken()
    if (!token) return  // 无 token 时静默不报错
    const remote = await fetchRemoteFiles(token)
    setFiles(remote)
    saveFiles(remote)
  }, [])

  useEffect(() => {
    refreshFiles().catch(err => {
      Dialog.alert({
        title: "获取文件列表失败",
        message: err.message || "未知错误",
        buttonLabel: "知道了",
      })
    })
  }, [])

  return (
    <TabView>
      <Tab title="首页" systemImage="house.fill" value="home">
        <HomeView files={files} />
      </Tab>
      <Tab title="文件" systemImage="folder.fill" value="files">
        <FilesView files={files} onFilesChanged={refreshFiles} />
      </Tab>
    </TabView>
  )
}

// ──────────────────────────────────────────────
// Entry
// ──────────────────────────────────────────────

async function run() {
  await Navigation.present({ element: <RootView /> })
  Script.exit()
}

run()
