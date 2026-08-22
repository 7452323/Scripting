import { Widget, VStack, HStack, Text, Image, Spacer, Link, fetch } from "scripting"

type AppOffer = {
  uuid: string
  name: string
  icon: string
  description?: string
  price?: string | number
  original_price?: string | number
  kind?: number
  track_url?: string
  app_id?: number
  track_id?: string | number
}

type ApiResult = { data?: AppOffer[] }
const API_URL = "https://api.gofans.cn/v1/m/app_records?page=1&limit=50"

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

function Offer({ item }: { item: AppOffer }) {
  return (
    <Link url={storeURL(item)}>
      <HStack spacing={8} padding={{ vertical: 5 }}>
        <Image imageUrl={item.icon} resizable clipShape={{ type: "rect", cornerRadius: 7 }} frame={{ width: 30, height: 30 }} aspectRatio={{ value: 1, contentMode: "fill" }} />
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" lineLimit={1}>{item.name}</Text>
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{item.description || "限时优惠"}</Text>
        </VStack>
        <Spacer />
        <Text font="caption2" foregroundStyle={Number(item.price ?? 0) > 0 ? "systemOrange" : "systemGreen"}>{priceText(item)}</Text>
      </HStack>
    </Link>
  )
}

async function load(): Promise<AppOffer[]> {
  try {
    const response = await fetch(API_URL, { headers: { Origin: "https://m.gofans.cn" } })
    if (!response.ok) return []
    const result = await response.json() as ApiResult
    const items = (result.data || []).filter((item) => item.kind !== 1).slice(0, Widget.family === "systemSmall" ? 3 : 6)
    return await Promise.all(items.map(async (item) => {
      try {
        const detailResponse = await fetch(`https://api.gofans.cn/v1/m/apps/${item.uuid}`, { headers: { Origin: "https://m.gofans.cn" } })
        if (!detailResponse.ok) return item
        return { ...item, ...(await detailResponse.json() as AppOffer) }
      } catch {
        return item
      }
    }))
  } catch {
    return []
  }
}

function presentWidget(data: AppOffer[]) {
  if (data.length === 0) {
    Widget.present(
      <VStack spacing={6} padding={12}>
        <Image systemName="app.badge" imageScale="large" />
        <Text font="headline">App 限免</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">暂无数据，请稍后刷新</Text>
      </VStack>
    )
    return
  }

  Widget.present(
    <VStack alignment="leading" spacing={4} padding={{ horizontal: 10, vertical: 8 }}>
      <HStack>
        <Image systemName="gift.fill" foregroundStyle="systemBlue" />
        <Text font="headline">App 限免</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="secondaryLabel">今日优惠</Text>
      </HStack>
      {data.map((item) => <Offer key={item.uuid} item={item} />)}
    </VStack>
  )
}

load().then(presentWidget).catch(() => presentWidget([]))
