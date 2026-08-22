import {
  Button,
  HStack,
  VStack,
  Spacer,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Text,
  TextField,
  Toggle,
  Link,
  useState,
  useEffect,
  fetch,
  Script,
} from "scripting"

type AppOffer = {
  uuid: string
  name: string
  icon: string
  description?: string
  price?: string | number
  original_price?: string | number
  kind?: number
  updated_at?: number
  track_url?: string
  app_id?: number
  track_id?: string | number
}

type ApiResult = { data?: AppOffer[] }

type Filter = "all" | "ios" | "mac"

const API_URL = "https://api.gofans.cn/v1/m/app_records?page=1&limit=50"

async function enrichOffers(items: AppOffer[]): Promise<AppOffer[]> {
  return Promise.all(items.map(async (item) => {
    try {
      const response = await fetch(`https://api.gofans.cn/v1/m/apps/${item.uuid}`, { headers: { Origin: "https://m.gofans.cn" } })
      if (!response.ok) return item
      const detail = await response.json() as AppOffer
      return { ...item, ...detail }
    } catch {
      return item
    }
  }))
}

function storeURL(item: AppOffer): string {
  if (item.track_url) return item.track_url
  if (item.track_id) return `https://apps.apple.com/app/id${item.track_id}`
  return "https://apps.apple.com/"
}

function priceText(item: AppOffer): string {
  const current = Number(item.price ?? 0)
  const original = Number(item.original_price ?? 0)
  const currentText = current > 0 ? `¥${current}` : "免费"
  return original > 0 ? `¥${original} → ${currentText}` : currentText
}

function OfferRow({ item }: { item: AppOffer }) {
  const destination = storeURL(item)
  return (
    <Link url={destination}>
      <HStack spacing={12} padding={{ vertical: 8 }}>
        <Image
          imageUrl={item.icon}
          resizable={true}
           clipShape={{ type: "rect", cornerRadius: 12 }}
          frame={{ width: 52, height: 52 }}
          aspectRatio={{ value: 1, contentMode: "fill" }}
          placeholder={<ProgressView />}
        />
        <VStack alignment="leading" spacing={4}>
          <HStack spacing={6}>
            <Text font="headline" lineLimit={1}>{item.name}</Text>
            <Spacer />
            <Text foregroundStyle={Number(item.price ?? 0) > 0 ? "orange" : "green"} font="subheadline">
              {priceText(item)}
            </Text>
          </HStack>
          <Text foregroundStyle="secondaryLabel" lineLimit={2}>{item.description || "暂无应用简介"}</Text>
          <Text foregroundStyle="secondaryLabel" font="caption2">
            {item.kind === 1 ? "Mac 应用" : "iPhone / iPad 应用"}
          </Text>
        </VStack>
      </HStack>
    </Link>
  )
}

function AppView() {
  const dismiss = Navigation.useDismiss()
  const [offers, setOffers] = useState<AppOffer[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [keyword, setKeyword] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [onlyFree, setOnlyFree] = useState(false)

  const loadOffers = async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(API_URL, { headers: { Origin: "https://m.gofans.cn" } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as ApiResult
      setOffers(await enrichOffers(result.data || []))
    } catch (e) {
      setError("加载失败，请检查网络后重试")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOffers()
  }, [])

  const visible = offers.filter((item) => {
    const matchesType = filter === "all" || (filter === "mac" ? item.kind === 1 : item.kind === 2)
    const matchesKeyword = !keyword.trim() || `${item.name} ${item.description || ""}`.toLowerCase().includes(keyword.toLowerCase().trim())
    const matchesPrice = !onlyFree || Number(item.price ?? 0) === 0
    return matchesType && matchesKeyword && matchesPrice
  })

  return (
    <NavigationStack>
      <List
        navigationTitle="App 限免优惠"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          primaryAction: <Button title="刷新" systemImage="arrow.clockwise" action={loadOffers} />,
        }}
      >
        <Section title="筛选">
          <TextField title="搜索应用" prompt="名称或简介" value={keyword} onChanged={setKeyword} />
          <Picker title="设备类型" value={filter} onChanged={(value: string) => setFilter(value as Filter)}>
            <Text tag="all">全部</Text>
            <Text tag="ios">iPhone / iPad</Text>
            <Text tag="mac">Mac</Text>
          </Picker>
          <Toggle title="只看免费" systemImage="gift.fill" value={onlyFree} onChanged={setOnlyFree} />
        </Section>

        <Section title={loading ? "正在加载" : `${visible.length} 个优惠应用`}>
          {loading && <ProgressView />}
          {!loading && error !== "" && (
            <VStack alignment="leading" spacing={8} padding={{ vertical: 12 }}>
              <Text foregroundStyle="red">{error}</Text>
              <Button title="重新加载" action={loadOffers} />
            </VStack>
          )}
          {!loading && error === "" && visible.length === 0 && <Text foregroundStyle="secondaryLabel">没有符合条件的应用</Text>}
          {!loading && error === "" && visible.map((item) => <OfferRow key={item.uuid} item={item} />)}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<AppView />)
  Script.exit()
}

run()
