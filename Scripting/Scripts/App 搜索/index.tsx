// ============================================================
// App Search — 搜索 App Store 应用
// 搜索框 + 搜索结果 + App 详情页
// ============================================================
import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Text,
  HStack,
  VStack,
  Image,
  TextField,
  Section,
  Button,
  Picker,
  useState,
  useEffect,
  useRef,
  Group,
  NavigationLink,
  ScrollView,
  ZStack,
  Spacer
} from "scripting"
import { fetch } from "scripting"

// ============================================================
// 类型定义
// ============================================================

interface SearchResultApp {
  // 核心标识
  trackId: number
  trackName: string
  artistId: number
  artistName: string
  bundleId: string
  // 价格
  price: number
  formattedPrice: string
  currency: string
  // 评分
  averageUserRating?: number
  userRatingCount?: number
  averageUserRatingForCurrentVersion?: number
  userRatingCountForCurrentVersion?: number
  // 图标
  artworkUrl60: string
  artworkUrl100: string
  artworkUrl512: string
  // 分类
  primaryGenreName: string
  primaryGenreId?: number
  genreIds?: string[]
  genres?: string[]
  // 链接
  trackViewUrl: string
  artistViewUrl?: string
  sellerUrl?: string
  // 提供者
  sellerName?: string
  sellerId?: number
  // 版本
  version: string
  minimumOsVersion: string
  // 描述
  description?: string
  // 截图
  screenshotUrls: string[]
  ipadScreenshotUrls?: string[]
  appletvScreenshotUrls?: string[]
  // 语言
  languageCodesISO2A?: string[]
  // 大小
  fileSizeBytes?: string
  // 日期
  releaseDate?: string
  currentVersionReleaseDate?: string
  releaseNotes?: string
  // 年龄分级
  contentAdvisoryRating?: string
  trackContentRating?: string
  // 版权
  copyright?: string
  // 特性
  features?: string[]
  supportedDevices?: string[]
  advisories?: string[]
  isGameCenterEnabled?: boolean
  kind?: string
  wrapperType?: string
  trackCensoredName?: string
  isVppDeviceBasedLicensingEnabled?: boolean
}

interface ITunesSearchResponse {
  resultCount: number
  results: any[]
}

// ============================================================
// 国家/地区
// ============================================================

const countries: string[] = [
  "中国", "美国", "日本", "英国", "香港",
  "韩国", "台湾", "德国", "法国", "加拿大",
  "澳大利亚", "新加坡", "俄罗斯", "巴西", "印度",
]

const countryCodes: string[] = [
  "cn", "us", "jp", "gb", "hk",
  "kr", "tw", "de", "fr", "ca",
  "au", "sg", "ru", "br", "in",
]

// ============================================================
// 搜索缓存
// key = 搜索词
// ============================================================

const searchCache = new Map<string, SearchResultApp[]>()

// iTunes Search API
// https://itunes.apple.com/search?term=...&entity=software&country=...

async function searchApps(
  term: string,
  country: string,
  limit: number = 15
): Promise<SearchResultApp[]> {
  const key = term.toLowerCase().trim()
  const cached = searchCache.get(key)
  if (cached) {
    return cached
  }

  const encoded = encodeURIComponent(term.trim())
  const url = `https://itunes.apple.com/search?term=${encoded}&entity=software&country=${country}&limit=${limit}`

  const response = await fetch(url, { method: "GET" })
  if (!response.ok) {
    throw new Error(`搜索请求失败 (HTTP ${response.status})`)
  }

  const data: ITunesSearchResponse = await response.json()
  const results = (data.results || []).filter(
    (r: any) => r.trackId && r.bundleId
  ) as SearchResultApp[]

  searchCache.set(key, results)
  return results
}

// ============================================================
// 评分组件
// ============================================================

function StarRating({ rating, count }: { rating?: number; count?: number }) {
  if (rating == null) return null

  const full = Math.floor(rating)
  const stars = "⭐".repeat(full) + (rating - full >= 0.5 ? "🌟" : "")
  const label = `${rating.toFixed(1)}${
    count != null && count > 0
      ? ` (${count >= 1000 ? (count / 1000).toFixed(1) + "k" : count})`
      : ""
  }`

  return (
    <HStack spacing={3}>
      <Text>{stars || "☆"}</Text>
      <Text>{label}</Text>
    </HStack>
  )
}

// ============================================================
// App 详情页
// ============================================================

function AppDetailView({ appId, country }: { appId: number; country: string }) {
  const [app, setApp] = useState<SearchResultApp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<{
    key: string
    time: number
  } | null>(null)

  useEffect(() => {
    loadDetail()
  }, [])

  async function loadDetail() {
    setLoading(true)
    setError(null)
    try {
      const url = `https://itunes.apple.com/lookup?id=${appId}&country=${country}`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json()
        const r = data.results?.[0]
        if (r) {
          setApp(r as SearchResultApp)
        } else {
          setError("未找到 App 信息")
        }
      } else {
        setError("无法获取 App 数据")
      }
    } catch (err: any) {
      setError(err.message || "加载失败")
    }
    setLoading(false)
  }

  async function copyToClipboard(text: string, label: string) {
    await Pasteboard.setString(text)
    setCopyFeedback({ key: label, time: Date.now() })
    setTimeout(() => setCopyFeedback(null), 1500)
  }

  function openInAppStore() {
    Safari.present(`https://apps.apple.com/${country}/app/id${appId}`)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={app?.trackName || "App 详情"}
        navigationBarTitleDisplayMode="inline"
      >
        {loading ? (
          <Section>
            <HStack>
              <Text>加载中…</Text>
            </HStack>
          </Section>
        ) : error ? (
          <Section>
            <HStack>
              <Text foregroundStyle="systemRed">{error}</Text>
            </HStack>
            <HStack>
              <Button
                title="重试"
                action={loadDetail}
              />
            </HStack>
          </Section>
        ) : app ? (
          <>
            <Section>
              <HStack spacing={14}>
                <Image
                  imageUrl={app.artworkUrl100?.replace("100x100bb", "64x64bb")}
                  frame={{ width: 64, height: 64 }}
                  clipShape={{ type: 'rect', cornerRadius: 14 }}
                />
                <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
                  <Text>{app.trackName}</Text>
                  <Text>{app.sellerName || app.artistName}</Text>
                  <StarRating
                    rating={app.averageUserRating}
                    count={app.userRatingCount}
                  />
                </VStack>
              </HStack>
            </Section>

            {app.description ? (
              <Section title="简介">
                <Text>{app.description}</Text>
              </Section>
            ) : null}

            {app.screenshotUrls && app.screenshotUrls.length > 0 ? (
              <Section title="截图">
                <ScrollView axes="horizontal">
                  <HStack spacing={8}>
                    {app.screenshotUrls.slice(0, 5).map((url, i) => (
                      <Button key={i} action={() =>
                        Navigation.present(
                          <ScreenshotGalleryView
                            urls={app.screenshotUrls.slice(0, 5)}
                            initialIndex={i}
                          />
                        )
                      }>
                        <Image
                          imageUrl={url.replace("392x696bb", "300x533bb")}
                          frame={{ width: 80, height: 142 }}
                          resizable
                          clipShape={{ type: 'rect', cornerRadius: 8 }}
                        />
                      </Button>
                    ))}
                  </HStack>
                </ScrollView>
              </Section>
            ) : null}

            <Section title="识别码">
              <DetailRow
                label="Bundle ID"
                value={app.bundleId}
                onCopy={() => copyToClipboard(app.bundleId, "Bundle ID")}
                copied={copyFeedback?.key === "Bundle ID"}
              />
              <DetailRow
                label="App ID"
                value={String(app.trackId)}
                onCopy={() => copyToClipboard(String(app.trackId), "App ID")}
                copied={copyFeedback?.key === "App ID"}
              />
              <DetailRow
                label="开发者 ID"
                value={String(app.artistId)}
                onCopy={() => copyToClipboard(String(app.artistId), "开发者 ID")}
                copied={copyFeedback?.key === "开发者 ID"}
              />
              {app.sellerId != null ? (
                <DetailRow
                  label="卖家 ID"
                  value={String(app.sellerId)}
                  onCopy={() => copyToClipboard(String(app.sellerId), "卖家 ID")}
                  copied={copyFeedback?.key === "卖家 ID"}
                />
              ) : null}
              {app.primaryGenreId != null ? (
                <DetailRow
                  label="主分类 ID"
                  value={String(app.primaryGenreId)}
                  onCopy={() => copyToClipboard(String(app.primaryGenreId), "主分类 ID")}
                  copied={copyFeedback?.key === "主分类 ID"}
                />
              ) : null}
              {app.genreIds && app.genreIds.length > 0 ? (
                <DetailRow
                  label="全部分类 IDs"
                  value={app.genreIds.join(", ")}
                  onCopy={() => copyToClipboard(app.genreIds!.join(", "), "全部分类 IDs")}
                  copied={copyFeedback?.key === "全部分类 IDs"}
                />
              ) : null}
            </Section>

            <Section title="基本信息">
              <DetailRow label="开发者" value={app.artistName} />
              {app.sellerName && app.sellerName !== app.artistName ? (
                <DetailRow label="提供者" value={app.sellerName} />
              ) : null}
              <DetailRow label="分类" value={app.primaryGenreName} />
              {app.genres && app.genres.length > 1 ? (
                <DetailRow label="全部分类" value={app.genres.join("、")} />
              ) : null}
              <DetailRow label="版本" value={app.version} />
              <DetailRow label="最低系统" value={app.minimumOsVersion} />
              {app.fileSizeBytes ? (
                <DetailRow
                  label="大小"
                  value={`${(Number(app.fileSizeBytes) / 1048576).toFixed(1)} MB`}
                />
              ) : null}
              {app.languageCodesISO2A && app.languageCodesISO2A.length > 0 ? (
                <DetailRow
                  label="语言"
                  value={app.languageCodesISO2A.join("、")}
                />
              ) : null}
            </Section>

            <Section title="年龄与版权">
              {app.contentAdvisoryRating ? (
                <DetailRow label="年龄分级" value={app.contentAdvisoryRating} />
              ) : null}
              {app.trackContentRating ? (
                <DetailRow label="内容评级" value={app.trackContentRating} />
              ) : null}
              {app.copyright ? (
                <DetailRow label="版权" value={app.copyright} />
              ) : null}
            </Section>

            <Section title="评价">
              <DetailRow
                label="综合评分"
                value={
                  app.averageUserRating != null
                    ? `${app.averageUserRating.toFixed(1)}（${app.userRatingCount || 0} 条评价）`
                    : "暂无"
                }
              />
              {app.averageUserRatingForCurrentVersion != null ? (
                <DetailRow
                  label="当前版本评分"
                  value={`${app.averageUserRatingForCurrentVersion.toFixed(1)}（${app.userRatingCountForCurrentVersion || 0} 条）`}
                />
              ) : null}
            </Section>

            {app.releaseNotes ? (
              <Section title="更新说明">
                <Text>{app.releaseNotes}</Text>
              </Section>
            ) : null}

            <Section title="操作">
              <Button title="在 App Store 中打开" action={openInAppStore} />
              <Button
                title={copyFeedback?.key === "Bundle ID" ? "✓ 已复制 Bundle ID" : "复制 Bundle ID"}
                action={async () => await copyToClipboard(app.bundleId, "Bundle ID")}
              />
              <Button
                title={copyFeedback?.key === "App ID" ? "✓ 已复制 App ID" : "复制 App ID"}
                action={async () => await copyToClipboard(String(app.trackId), "App ID")}
              />
            </Section>
          </>
        ) : null}
      </List>
    </NavigationStack>
  )
}

// 截图画廊 — 全屏预览 + 左右翻页

function ScreenshotGalleryView({ urls, initialIndex }: { urls: string[]; initialIndex: number }) {
  const [images, setImages] = useState<(UIImage | null)[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(
          urls.map(async (u) => {
            const resp = await fetch(u.replace("392x696bb", "750x1334bb"))
            const data = await resp.data()
            return UIImage.fromData(data)
          })
        )
        setImages(results)
        setLoading(false)
      } catch (e) {
        setError(String(e))
        setLoading(false)
      }
    })()
  }, [])

  const image = images[currentIndex]
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < images.length - 1

  return (
    <NavigationStack>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {/* 顶部栏 */}
        <HStack
          frame={{ maxWidth: "infinity" }}
          padding={12}
        >
          <Button
            title="分享"
            action={async () => {
              if (image) {
                await ShareSheet.present([image])
              }
            }}
            disabled={!image}
          />
          <Spacer />
          <Text foregroundStyle="secondaryLabel" font={16}>
            {currentIndex + 1} / {urls.length}
          </Text>
          <Spacer />
          <Button title="关闭" action={dismiss} />
        </HStack>

        {/* 图片区域 */}
        <ZStack
          frame={{ maxWidth: "infinity" }}
          alignment="center"
        >
          {loading ? (
            <Text>加载中…</Text>
          ) : error ? (
            <Text foregroundStyle="systemRed">加载失败: {error}</Text>
          ) : image ? (
            <Image
              image={image}
              frame={{ maxWidth: "infinity" }}
              resizable
              aspectRatio={{ contentMode: "fit" }}
              clipShape={{
                type: "rect",
                cornerRadius: 8,
              }}
            />
          ) : (
            <Text foregroundStyle="secondaryLabel">图片加载失败</Text>
          )}

          {/* 左右翻页按钮 */}
          {images.length > 1 && !loading ? (
            <HStack
              frame={{ maxWidth: "infinity" }}
              spacing={0}
            >
              <Button
                action={() => setCurrentIndex(currentIndex - 1)}
                disabled={!hasPrev}
                frame={{ width: 60, height: 60 }}
              >
                <Text
                  foregroundStyle={hasPrev ? "white" : "clear"}
                  font={36}
                >
                  ‹
                </Text>
              </Button>
              <VStack frame={{ maxWidth: "infinity" }} />
              <Button
                action={() => setCurrentIndex(currentIndex + 1)}
                disabled={!hasNext}
                frame={{ width: 60, height: 60 }}
              >
                <Text
                  foregroundStyle={hasNext ? "white" : "clear"}
                  font={36}
                >
                  ›
                </Text>
              </Button>
            </HStack>
          ) : null}
        </ZStack>
      </VStack>
    </NavigationStack>
  )
}


function DetailRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value: string
  onCopy?: () => void
  copied?: boolean
}) {
  return (
    <HStack>
      <Text
        foregroundStyle="secondaryLabel"
        frame={{ width: 100, alignment: "leading" }}
      >{label}</Text>
      {onCopy ? (
        <Button action={onCopy}>
          <HStack spacing={4}>
            <Text>{value}</Text>
            {copied ? <Text foregroundStyle="systemGreen"> ✓</Text> : null}
          </HStack>
        </Button>
      ) : (
        <HStack spacing={4}>
          <Text>{value}</Text>
          {copied ? <Text foregroundStyle="systemGreen"> ✓</Text> : null}
        </HStack>
      )}
    </HStack>
  )
}

// ============================================================
// 搜索结果行
// ============================================================

function SearchResultRow({ app }: { app: SearchResultApp }) {
  return (
    <HStack>
      <Image
        imageUrl={app.artworkUrl60?.replace("60x60bb", "48x48bb")}
        placeholder={
          <HStack>
            <Text>{app.trackName.slice(0, 2).toUpperCase()}</Text>
          </HStack>
        }
        frame={{ width: 48, height: 48 }}
        clipShape={{ type: 'rect', cornerRadius: 10 }}
      />
      <VStack spacing={2} frame={{ maxWidth: "infinity" }}>
        <Text lineLimit={1}>{app.trackName}</Text>
        <Text font={12} foregroundStyle="secondaryLabel">{app.bundleId}</Text>
        <HStack spacing={6}>
          <Text>{app.artistName}</Text>
          {app.averageUserRating != null ? (
            <Text>★ {app.averageUserRating.toFixed(1)}</Text>
          ) : null}
        </HStack>
      </VStack>
      <VStack spacing={4} alignment="trailing">
        <Text font={14} foregroundStyle={app.price === 0 ? "systemGreen" : "label"}>
          {app.price === 0
            ? "免费"
            : app.formattedPrice || `$${app.price.toFixed(2)}`}
        </Text>
        <Text foregroundStyle="tertiaryLabel" font={18}>›</Text>
      </VStack>
    </HStack>
  )
}

// ============================================================
// 主搜索视图
// ============================================================

function SearchView() {
  const [searchText, setSearchText] = useState("")
  const [results, setResults] = useState<SearchResultApp[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [selectedCountryIndex, setSelectedCountryIndex] = useState(0)

  const dismiss = Navigation.useDismiss()

  const country = countryCodes[selectedCountryIndex]

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 防抖搜索 — 文本变更或切换国家都会触发
  useEffect(() => {
    const trimmed = searchText.trim()
    if (!trimmed) {
      setResults([])
      setSearched(false)
      setError(null)
      return
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const apps = await searchApps(trimmed, country)
        setResults(apps)
        setSearched(true)
      } catch (err: any) {
        setError(err.message || "搜索失败")
        setResults([])
        setSearched(true)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchText, country])

  // 清空结果
  function onCancelSearch() {
    setSearchText("")
    setResults([])
    setSearched(false)
    setError(null)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="App Search"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarTrailing: <Button title="关闭" action={dismiss} />,
        }}
      >
        {/* 搜索框 + 取消按钮 */}
        <Section>
          <VStack spacing={8}>
            <HStack spacing={8}>
              <HStack frame={{ maxWidth: "infinity" }}>
                <TextField
                  title=""
                  value={searchText}
                  onChanged={setSearchText}
                  prompt="搜索 App 名称..."
                />
              </HStack>
              {searchText.trim().length > 0 ? (
                <Button title="取消" action={onCancelSearch} />
              ) : null}
            </HStack>

            {/* 国家/地区选择器 */}
            <Picker
              title="国家/地区"
              value={selectedCountryIndex}
              onChanged={(v: number) => {
                setSelectedCountryIndex(v)
              }}
              pickerStyle="menu"
            >
              {countries.map((name, i) => (
                <Text key={i} tag={i}>{name} ({countryCodes[i].toUpperCase()})</Text>
              ))}
            </Picker>
          </VStack>
        </Section>

        {/* 搜索前显示提示文字 */}
        {!searched && !searchText.trim() ? (
          <Section>
            <HStack>
              <Text>搜索 App Store 应用，支持按国家/地区筛选</Text>
            </HStack>
          </Section>
        ) : null}

        {/* 加载转圈 */}
        {loading ? (
          <Section>
            <HStack>
              <Text>搜索中…</Text>
            </HStack>
          </Section>
        ) : null}

        {/* 错误提示 */}
        {error ? (
          <Section>
            <HStack>
              <Text foregroundStyle="systemRed">{error}</Text>
            </HStack>
          </Section>
        ) : null}

        {/* 搜索结果列表 */}
        {searched && !loading ? (
          <Section
            header={results.length > 0 ? <Text>搜索结果 ({results.length})</Text> : undefined}
          >
            {results.length === 0 ? (
              <HStack>
                <Text>未找到匹配的 App，试试其他关键词</Text>
              </HStack>
            ) : (
              results.map((app) => (
                <NavigationLink
                  key={app.trackId}
                  title={app.trackName}
                  destination={
                    <AppDetailView appId={app.trackId} country={country} />
                  }
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button
                          title="复制 Bundle ID"
                          action={async () => {
                            await Pasteboard.setString(app.bundleId)
                          }}
                        />
                        <Button
                          title="复制 App ID"
                          action={async () => {
                            await Pasteboard.setString(String(app.trackId))
                          }}
                        />
                      </Group>
                    ),
                  }}
                >
                  <SearchResultRow app={app} />
                </NavigationLink>
              ))
            )}
          </Section>
        ) : null}
      </List>

    </NavigationStack>
  )
}

// ============================================================
// 入口
// ============================================================

async function run() {
  await Navigation.present(<SearchView />)
  Script.exit()
}

run()
