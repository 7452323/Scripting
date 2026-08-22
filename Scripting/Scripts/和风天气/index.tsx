import { Script, Navigation, NavigationStack, List, Section, VStack, HStack, Text, Image, Button, TextField, Spacer, useState, useEffect, fetch } from 'scripting'

const KEY = "qweather_api_key"
function load(): string { return Storage.get<string>(KEY) || "" }

const DAY_G = { colors: ["rgba(26,115,232,1)", "rgba(79,195,247,1)"], startPoint: "top", endPoint: "bottom" } as any
const NIGHT_G = { colors: ["rgba(12,20,69,1)", "rgba(26,26,46,1)"], startPoint: "top", endPoint: "bottom" } as any

function icon(c: string, n: boolean): string {
  const v = parseInt(c)
  if (v === 100) return n ? "moon.stars.fill" : "sun.max.fill"
  if (v >= 101 && v <= 103) return n ? "cloud.moon.fill" : "cloud.sun.fill"
  if (v >= 200 && v <= 399) return "cloud.drizzle.fill"
  if (v >= 400 && v <= 499) return "wind"
  if (v >= 500 && v <= 599) return "cloud.fog.fill"
  if (v >= 700 && v <= 799) return "cloud.rain.fill"
  if (v >= 800 && v <= 899) return "cloud.snow.fill"
  return "cloud.sun.fill"
}

function aqic(lv: string): any {
  const n = parseInt(lv)
  if (n <= 1) return "rgba(0,228,0,1)"; if (n <= 2) return "rgba(248,197,10,1)"
  if (n <= 3) return "rgba(255,126,0,1)"; if (n <= 4) return "rgba(255,0,0,1)"
  return "rgba(186,0,51,1)"
}

interface WD { temp: string; feelsLike: string; icon: string; text: string; windDir: string; windScale: string; humidity: string; precip: string; vis: string; tempMax: string; tempMin: string }
interface AD { aqi: string; level: string; category: string }
interface HH { fxTime: string; temp: string; icon: string }
interface DD { fxDate: string; tempMax: string; tempMin: string; iconDay: string }

async function fetchAll(key: string): Promise<{ now: WD; aqi: AD | null; hourly: HH[]; daily: DD[]; city: string } | null> {
  try {
    await Location.setAccuracy("best")
    const loc = await Location.requestCurrent({ forceRequest: false })
    if (!loc) return null
    const pos = `${loc.longitude.toFixed(4)},${loc.latitude.toFixed(4)}`
    const [nr, ar, hr, dr, gr] = await Promise.all([
      fetch(`https://devapi.qweather.com/v7/weather/now?location=${pos}&key=${key}`),
      fetch(`https://devapi.qweather.com/v7/air/now?location=${pos}&key=${key}`),
      fetch(`https://devapi.qweather.com/v7/weather/24h?location=${pos}&key=${key}`),
      fetch(`https://devapi.qweather.com/v7/weather/7d?location=${pos}&key=${key}`),
      fetch(`https://geoapi.qweather.com/v2/city/lookup?location=${pos}&key=${key}`),
    ])
    const nd = await nr.json()
    if (nd.code !== "200") return null
    const hd = await hr.json()
    const dd = await dr.json()
    const gd = await gr.json()
    const city = (gd.code === "200" && gd.location?.length) ? gd.location[0].name : "当前位置"
    const aj = await ar.json()
    const aqi = (aj.code === "200" && aj.now) ? { aqi: aj.now.aqi, level: aj.now.level, category: aj.now.category } : null
    return { now: nd.now, aqi, hourly: hd.hourly || [], daily: dd.daily || [], city }
  } catch { return null }
}

const D = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
const D2 = ["明天", "后天", "大后天"]

function DetailItem({ val, label }: { val: string; label: string }) {
  return (
    <VStack spacing={1} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Text font="caption2" foregroundStyle="label" fontWeight="medium">{val}</Text>
      <Text font="caption2" foregroundStyle="label" opacity={0.4}>{label}</Text>
    </VStack>
  )
}

function Page() {
  const [k, setK] = useState(load())
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState("")
  const [data, setData] = useState<{ now: WD; aqi: AD | null; hourly: HH[]; daily: DD[]; city: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const dismiss = Navigation.useDismiss()
  const has = load().length > 0

  useEffect(() => {
    const key = load()
    if (!key) return
    setLoading(true)
    fetchAll(key).then(r => { if (r) setData(r); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  function doSave() {
    const v = k.trim()
    if (!v) { setErr("请输入 API Key"); return }
    if (v.length < 10) { setErr("Key 格式不正确"); return }
    Storage.set(KEY, v.trim())
    setSaved(true); setErr("")
    setData(null); setLoading(true)
    fetchAll(v.trim()).then(r => { if (r) setData(r); setLoading(false) }).catch(() => setLoading(false))
    setTimeout(() => setSaved(false), 2500)
  }

  function doClear() { Storage.remove(KEY); setK(""); setSaved(false); setErr(""); setData(null) }

  const nd = new Date()
  const n = nd.getHours() < 6 || nd.getHours() >= 18
  const w = data?.now
  const aqi = data?.aqi
  const hourly = data?.hourly || []
  const daily = data?.daily || []
  const city = data?.city || ""
  const t = w ? Math.round(parseFloat(w.temp)) : null
  const f = w ? Math.round(parseFloat(w.feelsLike)) : null

  return (
    <NavigationStack>
      <List
        navigationTitle="和风天气"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section>
          <VStack
            spacing={0}
            frame={{ maxWidth: "infinity" }}
            padding={{ top: 14, leading: 14, bottom: 12, trailing: 14 }}
          >
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="headline" foregroundStyle="label" fontWeight="medium">{city || "当前位置"}</Text>
              <Spacer />
              <Text font="callout" foregroundStyle="label" opacity={0.8}>{nd.getFullYear()}年{nd.getMonth()+1}月{nd.getDate()}日 {D[nd.getDay()]}</Text>
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <Image systemName={w ? icon(w.icon, n) : "sun.max.fill"} frame={{ width: 40, height: 40 }} foregroundStyle="label" />
              <HStack alignment="firstTextBaseline" spacing={0}>
                <Text font={52} foregroundStyle="label" fontWeight="regular">{t !== null ? t : "--"}</Text>
                <Text font={20} foregroundStyle="label" opacity={0.5}>°</Text>
              </HStack>
              <Spacer />
              <VStack spacing={0} alignment="trailing">
                <Text font="title2" foregroundStyle="label" fontWeight="semibold">{w ? `${Math.round(parseFloat(w.tempMax))}°` : "--"}</Text>
                <Text font="subheadline" foregroundStyle="label" opacity={0.6}>{w ? `${Math.round(parseFloat(w.tempMin))}°` : "--"}</Text>
              </VStack>
            </HStack>
            <Spacer minLength={6} />
            {aqi ? (
              <HStack spacing={4} background={aqic(aqi.level)} padding={{ horizontal: 8, vertical: 2 }}>
                <Text font="caption" foregroundStyle="label" fontWeight="bold">{aqi.aqi} · {aqi.category}</Text>
                <Spacer />
              </HStack>
            ) : null}
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <DetailItem val={f !== null ? `${f}°` : "--"} label="体感" />
              <DetailItem val={w ? `${w.humidity}%` : "--"} label="湿度" />
              <DetailItem val={w ? w.windDir : "--"} label={w ? `${w.windScale}级` : "风向"} />
              <DetailItem val={w ? `${w.vis}km` : "--"} label="能见度" />
              <DetailItem val={w ? `${w.precip}mm` : "--"} label="降水" />
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              {hourly.slice(0, 6).map((h, i) => (
                <VStack key={i} spacing={2} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="caption2" foregroundStyle="label" opacity={0.5}>{i === 0 ? "现在" : h.fxTime.slice(11, 13).replace(/^0/, "") + "时"}</Text>
                  <Image systemName={icon(h.icon, n)} frame={{ width: 14, height: 14 }} foregroundStyle="label" opacity={0.8} />
                  <Text font="caption2" foregroundStyle="label" fontWeight="medium">{Math.round(parseFloat(h.temp))}°</Text>
                </VStack>
              ))}
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              {daily.slice(1, 4).map((d, i) => (
                <VStack key={i} spacing={2} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="caption2" foregroundStyle="label" opacity={0.7} fontWeight="medium">{D2[i]}</Text>
                  <Image systemName={icon(d.iconDay, false)} frame={{ width: 16, height: 16 }} foregroundStyle="label" opacity={0.8} />
                  <HStack spacing={3}>
                    <Text font="caption2" foregroundStyle="label" opacity={0.45}>{Math.round(parseFloat(d.tempMin))}°</Text>
                    <Text font="caption2" foregroundStyle="label" fontWeight="semibold">{Math.round(parseFloat(d.tempMax))}°</Text>
                  </HStack>
                </VStack>
              ))}
            </HStack>
            <Spacer minLength={4} />
            <Text font="footnote" foregroundStyle="label" opacity={0.4} frame={{ maxWidth: "infinity", alignment: "center" }}>
              {loading ? "加载中…" : w ? w.text : "保存 API Key 后自动加载"}
            </Text>
          </VStack>
        </Section>

        <Section
          header={<Text font="headline">API Key</Text>}
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">和风天气开发密钥，用于拉取实时气象数据</Text>}
        >
          <TextField
            title="API Key"
            value={k}
            onChanged={(v) => { setK(v); setErr("") }}
            prompt="粘贴和风天气 API Key"
          />
          {err ? (
            <HStack spacing={4}>
              <Image systemName="exclamationmark.triangle.fill" frame={{ width: 12, height: 12 }} foregroundStyle="systemRed" />
              <Text font="caption" foregroundStyle="systemRed">{err}</Text>
            </HStack>
          ) : null}
          <Button title={saved ? "已保存 ✓" : "保存"} action={doSave} />
          {has ? <Button title="清除" action={doClear} role="destructive" /> : null}
          {has && !err ? (
            <HStack spacing={6}>
              <Image systemName="checkmark.circle.fill" frame={{ width: 14, height: 14 }} foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="systemGreen">已就绪 {city ? `· ${city}` : ""}</Text>
            </HStack>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()
