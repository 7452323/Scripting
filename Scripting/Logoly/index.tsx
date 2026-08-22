// Logoly — Pornhub / OnlyFans 风格 Logo 生成器
// 灵感来自 https://github.com/bestony/logoly
// 三种风格：PH 横版 / PH 竖版 / OnlyFans 手写体
// 实时预览 + 自定义颜色/字号 + PNG/SVG 导出
// UI 全部使用系统语义色，跟随系统深浅模式自适应

import {
  Button,
  Canvas,
  ColorPicker,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  RoundedRectangle,
  Script,
  ScreenshotMaker,
  Section,
  Slider,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

// ─────────────────────────── 类型 & 常量 ───────────────────────────

type StyleKey = "ph" | "phv" | "of"
type Weight =
  | "ultraLight" | "thin" | "light" | "regular" | "medium"
  | "semibold" | "bold" | "heavy" | "black"

interface StyleMeta {
  label: string
  accent: string
  prefixFontName: string | null
  prefixWeight: Weight
  suffixFontName: string | null
  suffixWeight: Weight
  hasSuffixBg: boolean
  hasReverse: boolean
  defaultPrefixColor: string
  defaultSuffixColor: string
  defaultSuffixBg: string
  defaultPrefix: string
  defaultSuffix: string
}

const STYLES: Record<StyleKey, StyleMeta> = {
  ph: {
    label: "横版",
    accent: "#FF9900",
    prefixFontName: "HelveticaNeue-CondensedBlack",
    prefixWeight: "black",
    suffixFontName: "HelveticaNeue-CondensedBlack",
    suffixWeight: "black",
    hasSuffixBg: true,
    hasReverse: true,
    defaultPrefixColor: "#FFFFFF",
    defaultSuffixColor: "#000000",
    defaultSuffixBg: "#FF9900",
    defaultPrefix: "My",
    defaultSuffix: "Hub",
  },
  phv: {
    label: "竖版",
    accent: "#FF9900",
    prefixFontName: "HelveticaNeue-CondensedBlack",
    prefixWeight: "black",
    suffixFontName: "HelveticaNeue-CondensedBlack",
    suffixWeight: "black",
    hasSuffixBg: true,
    hasReverse: true,
    defaultPrefixColor: "#FFFFFF",
    defaultSuffixColor: "#000000",
    defaultSuffixBg: "#FF9900",
    defaultPrefix: "My",
    defaultSuffix: "Hub",
  },
  of: {
    label: "手写体",
    accent: "#00AFF0",
    prefixFontName: null,
    prefixWeight: "ultraLight",
    suffixFontName: "SnellRoundhand",
    suffixWeight: "regular",
    hasSuffixBg: false,
    hasReverse: false,
    defaultPrefixColor: "#FFFFFF",
    defaultSuffixColor: "#00AFF0",
    defaultSuffixBg: "rgba(0,0,0,0)",
    defaultPrefix: "Only",
    defaultSuffix: "Fans",
  },
}

const STYLE_ORDER: StyleKey[] = ["ph", "phv", "of"]

const PH_PALETTES: { prefix: string; suffix: string; bg: string }[] = [
  { prefix: "#FFFFFF", suffix: "#000000", bg: "#FF9900" }, // 经典橙
  { prefix: "#FFFFFF", suffix: "#1A0000", bg: "#E82127" }, // 午夜红
  { prefix: "#FFFFFF", suffix: "#150028", bg: "#A855F7" }, // 霓虹紫
  { prefix: "#FFFFFF", suffix: "#00281B", bg: "#00D68F" }, // 薄荷绿
  { prefix: "#FFFFFF", suffix: "#00263A", bg: "#00AFF0" }, // 湖光蓝
  { prefix: "#FFFFFF", suffix: "#3D0020", bg: "#FF5E8A" }, // 樱花粉
  { prefix: "#1A1A1A", suffix: "#1A1A1A", bg: "#FFD60A" }, // 柠檬黄
  { prefix: "#FFFFFF", suffix: "#FFD60A", bg: "#161616" }, // 暗夜金
]

const OF_COLORS: string[] = [
  "#00AFF0", "#7C4DFF", "#00E5A0", "#FF5E8A",
  "#FFB300", "#FF3B6B", "#18C0DF", "#8B5CF6",
]

const STORAGE_KEY = "logoly_state_v1"
const STAGE_H = 250

interface AppState {
  style: StyleKey
  prefix: string
  suffix: string
  prefixColor: string
  suffixColor: string
  suffixBg: string
  fontSize: number
  transparent: boolean
  reverse: boolean
  exportScale: number
}

const DEFAULT_STATE: AppState = {
  style: "ph",
  prefix: "My",
  suffix: "Hub",
  prefixColor: "#FFFFFF",
  suffixColor: "#000000",
  suffixBg: "#FF9900",
  fontSize: 64,
  transparent: false,
  reverse: false,
  exportScale: 1,
}

function loadState(): AppState {
  try {
    const saved = Storage.get<Partial<AppState>>(STORAGE_KEY)
    if (saved && typeof saved === "object") {
      return { ...DEFAULT_STATE, ...saved }
    }
  } catch (e) {
    // 忽略读取失败
  }
  return { ...DEFAULT_STATE }
}

const INITIAL_STATE = loadState()

// ─────────────────────────── 工具函数 ───────────────────────────

function sanitizeName(s: string): string {
  const c = s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "")
  return c || "logo"
}

function svgEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

interface LogoMetrics {
  prefixW: number
  suffixW: number
  stageW: number
}

interface Geometry {
  padX: number
  padY: number
  pillPadX: number
  pillPadY: number
  pillR: number
  bgR: number
  prefixW: number
  suffixW: number
  lineH: number
  pillH: number
  blockW: number
  contentW: number
  contentH: number
  totalW: number
  totalH: number
  vertical: boolean
  hasSuffixBg: boolean
}

// 计算 logo 全部几何参数（基于某一基准字号 size，测量值按 baseSize 等比缩放）
function geometryFor(
  style: StyleKey,
  prefix: string,
  suffix: string,
  size: number,
  m: LogoMetrics,
  baseSize: number
): Geometry {
  const meta = STYLES[style]
  const vertical = style === "phv"
  const scale = size / Math.max(1, baseSize)
  const padX = Math.max(6, Math.round(size * 0.28))
  const padY = Math.max(4, Math.round(size * 0.14))
  const pillPadX = Math.round(size * 0.22)
  const pillPadY = Math.round(size * 0.07)
  const pillR = Math.max(4, Math.round(size * 0.12))
  const bgR = Math.max(4, Math.round(size * 0.06))
  const measuredPW = m.prefixW * scale
  const measuredSW = m.suffixW * scale
  const prefixW =
    measuredPW > 4
      ? Math.round(measuredPW)
      : Math.max(8, Math.round(prefix.length * size * 0.6))
  const suffixW =
    measuredSW > 4
      ? Math.round(measuredSW)
      : Math.max(8, Math.round(suffix.length * size * (style === "of" ? 0.5 : 0.55)))
  const lineH = Math.round(size * 1.2)
  const pillH = Math.round(size * 1.18)
  const blockW = meta.hasSuffixBg ? suffixW + pillPadX * 2 : suffixW
  const contentW = vertical ? Math.max(prefixW, blockW) : prefixW + blockW
  const contentH = vertical ? lineH + pillH : Math.max(lineH, meta.hasSuffixBg ? pillH : lineH)
  const totalW = padX * 2 + contentW
  const totalH = padY * 2 + contentH
  return {
    padX, padY, pillPadX, pillPadY, pillR, bgR,
    prefixW, suffixW, lineH, pillH, blockW,
    contentW, contentH, totalW, totalH,
    vertical, hasSuffixBg: meta.hasSuffixBg,
  }
}

// 计算「适配舞台」后的实际渲染字号
function fitSize(
  style: StyleKey,
  prefix: string,
  suffix: string,
  fontSize: number,
  m: LogoMetrics,
  stageW: number,
  stageH: number
): { fitted: number; g: Geometry } {
  const baseG = geometryFor(style, prefix, suffix, fontSize, m, fontSize)
  const availW = Math.max(120, stageW - 48)
  const availH = Math.max(80, stageH - 48)
  const fit = Math.min(
    1,
    availW / Math.max(1, baseG.totalW),
    availH / Math.max(1, baseG.totalH)
  )
  const fitted = Math.max(14, Math.round(fontSize * Math.max(0.12, Math.min(1, fit))))
  const g = geometryFor(style, prefix, suffix, fitted, m, fontSize)
  return { fitted, g }
}

// ─────────────────────────── SVG 生成 ───────────────────────────

function buildSVG(
  state: AppState,
  fitted: number,
  g: Geometry
): string {
  const meta = STYLES[state.style]
  const W = g.totalW
  const H = g.totalH
  const prefixText = svgEscape(state.reverse ? state.suffix : state.prefix)
  const suffixText = svgEscape(state.reverse ? state.prefix : state.suffix)

  const prefixFont =
    meta.prefixFontName != null
      ? `font-family="HelveticaNeue-CondensedBlack, Helvetica Neue, Arial, sans-serif" font-weight="900"`
      : `font-family="Helvetica Neue, Arial, sans-serif" font-weight="200"`
  const suffixFont =
    meta.suffixFontName != null
      ? `font-family="'Snell Roundhand', 'SnellRoundhand', cursive"`
      : prefixFont

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  )
  if (!state.transparent) {
    parts.push(
      `<rect x="0" y="0" width="${W}" height="${H}" rx="${g.bgR}" fill="#000000"/>`
    )
  }

  if (g.vertical) {
    // 竖版：前缀在上、后缀块在下
    const prefixY = g.padY + g.lineH / 2
    const pillY = g.padY + g.lineH
    const pillX = Math.round((W - g.blockW) / 2)
    const suffixY = pillY + g.pillH / 2
    parts.push(
      `<text x="${Math.round(W / 2)}" y="${prefixY}" ${prefixFont} font-size="${fitted}" fill="${state.prefixColor}" text-anchor="middle" dominant-baseline="central">${prefixText}</text>`
    )
    if (g.hasSuffixBg) {
      parts.push(
        `<rect x="${pillX}" y="${pillY}" width="${g.blockW}" height="${g.pillH}" rx="${g.pillR}" fill="${state.suffixBg}"/>`
      )
    }
    parts.push(
      `<text x="${Math.round(W / 2)}" y="${suffixY}" ${suffixFont} font-size="${fitted}" fill="${state.suffixColor}" text-anchor="middle" dominant-baseline="central">${suffixText}</text>`
    )
  } else {
    // 横版：前缀居左，后缀块紧随
    const cy = Math.round(H / 2)
    const prefixCX = g.padX + g.prefixW / 2
    const pillX = g.padX + g.prefixW
    const pillY = Math.round((H - g.pillH) / 2)
    const suffixCX = g.padX + g.prefixW + g.pillPadX + g.suffixW / 2
    parts.push(
      `<text x="${prefixCX}" y="${cy}" ${prefixFont} font-size="${fitted}" fill="${state.prefixColor}" text-anchor="middle" dominant-baseline="central">${prefixText}</text>`
    )
    if (g.hasSuffixBg) {
      parts.push(
        `<rect x="${pillX}" y="${pillY}" width="${g.blockW}" height="${g.pillH}" rx="${g.pillR}" fill="${state.suffixBg}"/>`
      )
      parts.push(
        `<text x="${suffixCX}" y="${cy}" ${suffixFont} font-size="${fitted}" fill="${state.suffixColor}" text-anchor="middle" dominant-baseline="central">${suffixText}</text>`
      )
    } else {
      const ofSuffixCX = g.padX + g.prefixW + g.suffixW / 2
      parts.push(
        `<text x="${ofSuffixCX}" y="${cy}" ${suffixFont} font-size="${fitted}" fill="${state.suffixColor}" text-anchor="middle" dominant-baseline="central">${suffixText}</text>`
      )
    }
  }

  parts.push(`</svg>`)
  return parts.join("\n")
}

// ─────────────────────────── Logo 渲染 ───────────────────────────

function LogoMark(props: {
  style: StyleKey
  prefix: string
  suffix: string
  prefixColor: string
  suffixColor: string
  suffixBg: string
  transparent: boolean
  reverse: boolean
  fittedSize: number
  g: Geometry
  shotRef: any
}) {
  const {
    style, prefix, suffix, prefixColor, suffixColor, suffixBg,
    transparent, reverse, fittedSize, g, shotRef,
  } = props
  const meta = STYLES[style]
  const pText = reverse ? suffix : prefix
  const sText = reverse ? prefix : suffix

  const prefixFont = meta.prefixFontName != null
    ? { name: meta.prefixFontName, size: fittedSize }
    : fittedSize
  const suffixFont = meta.suffixFontName != null
    ? { name: meta.suffixFontName, size: fittedSize }
    : fittedSize
  const sidePad = Math.max(1, Math.round(fittedSize * 0.04))

  const prefixNode = (
    <Text
      font={prefixFont}
      fontWeight={meta.prefixWeight}
      foregroundStyle={prefixColor as any}
      lineLimit={1}
      minScaleFactor={0.25}
      allowsTightening
      padding={{ horizontal: sidePad }}
    >
      {pText}
    </Text>
  )

  const suffixNode = g.hasSuffixBg ? (
    <Text
      font={suffixFont}
      fontWeight={meta.suffixWeight}
      foregroundStyle={suffixColor as any}
      lineLimit={1}
      minScaleFactor={0.25}
      allowsTightening
      padding={{ horizontal: g.pillPadX, vertical: g.pillPadY }}
      background={<RoundedRectangle cornerRadius={g.pillR} fill={suffixBg as any} />}
    >
      {sText}
    </Text>
  ) : (
    <Text
      font={suffixFont}
      fontWeight={meta.suffixWeight}
      foregroundStyle={suffixColor as any}
      lineLimit={1}
      minScaleFactor={0.25}
      allowsTightening
      padding={{ horizontal: sidePad }}
    >
      {sText}
    </Text>
  )

  const content = g.vertical ? (
    <VStack spacing={0} alignment="center">
      {prefixNode}
      {suffixNode}
    </VStack>
  ) : (
    <HStack spacing={0} alignment="center">
      {prefixNode}
      {suffixNode}
    </HStack>
  )

  return (
    <VStack
      screenshotRef={shotRef}
      spacing={0}
      alignment="center"
      padding={{ horizontal: g.padX, vertical: g.padY }}
      background={
        transparent ? undefined : <RoundedRectangle cornerRadius={g.bgR} fill="#000000" />
      }
    >
      {content}
    </VStack>
  )
}

// ─────────────────────────── 通用 UI 组件 ───────────────────────────

function ColorRow(props: {
  title: string
  value: string
  onChanged: (c: string) => void
}) {
  return (
    <ColorPicker value={props.value as any} onChanged={props.onChanged} supportsOpacity={false}>
      <HStack padding={{ vertical: 10 }}>
        <Text font="subheadline" foregroundStyle="label">{props.title}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel" fontDesign="monospaced">
          {props.value}
        </Text>
        <RoundedRectangle
          cornerRadius={6}
          fill={props.value as any}
          stroke={{ shapeStyle: "systemGray3" as any, strokeStyle: { lineWidth: 1 } }}
          frame={{ width: 26, height: 26 }}
        />
      </HStack>
    </ColorPicker>
  )
}

// ─────────────────────────── 主界面 ───────────────────────────

function App() {
  const dismiss = Navigation.useDismiss()

  const [style, setStyle] = useState<StyleKey>(INITIAL_STATE.style)
  const [prefix, setPrefix] = useState(INITIAL_STATE.prefix)
  const [suffix, setSuffix] = useState(INITIAL_STATE.suffix)
  const [prefixColor, setPrefixColor] = useState(INITIAL_STATE.prefixColor)
  const [suffixColor, setSuffixColor] = useState(INITIAL_STATE.suffixColor)
  const [suffixBg, setSuffixBg] = useState(INITIAL_STATE.suffixBg)
  const [fontSize, setFontSize] = useState(INITIAL_STATE.fontSize)
  const [transparent, setTransparent] = useState(INITIAL_STATE.transparent)
  const [reverse, setReverse] = useState(INITIAL_STATE.reverse)
  const [exportScale, setExportScale] = useState(INITIAL_STATE.exportScale)
  const [exportAction, setExportAction] = useState("none")
  const [toastMsg, setToastMsg] = useState("")
  const [toastVisible, setToastVisible] = useState(false)

  const shotRef = useRef<ScreenshotMaker>()
  const metrics = useRef<LogoMetrics>({ prefixW: 0, suffixW: 0, stageW: 320 })
  const toastTimer = useRef<any>(null)

  const meta = STYLES[style]

  // 持久化
  useEffect(() => {
    try {
      Storage.set(STORAGE_KEY, {
        style, prefix, suffix, prefixColor, suffixColor, suffixBg,
        fontSize, transparent, reverse, exportScale,
      })
    } catch (e) {
      // ignore
    }
  }, [style, prefix, suffix, prefixColor, suffixColor, suffixBg, fontSize, transparent, reverse, exportScale])

  function showToast(msg: string) {
    setToastMsg(msg)
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2200)
  }

  function applyStyle(next: StyleKey) {
    if (next === style) return
    const m = STYLES[next]
    setStyle(next)
    setPrefix(m.defaultPrefix)
    setSuffix(m.defaultSuffix)
    setPrefixColor(m.defaultPrefixColor)
    setSuffixColor(m.defaultSuffixColor)
    setSuffixBg(m.defaultSuffixBg)
    setReverse(false)
    setTransparent(false)
  }

  function randomize() {
    if (style === "of") {
      const c = OF_COLORS[Math.floor(Math.random() * OF_COLORS.length)]
      setSuffixColor(c)
    } else {
      const p = PH_PALETTES[Math.floor(Math.random() * PH_PALETTES.length)]
      setPrefixColor(p.prefix)
      setSuffixColor(p.suffix)
      setSuffixBg(p.bg)
    }
    showToast("随机配色已生成")
  }

  // 布局计算（预览字号随导出尺寸实时变化）
  const { fitted, g } = fitSize(
    style, prefix, suffix, Math.round(fontSize * exportScale),
    metrics.current, metrics.current.stageW, STAGE_H
  )

  // ── 导出 ──
  function capture(): UIImage | null {
    const img = shotRef.current?.screenshot()
    if (!img) return null
    if (exportScale > 1) {
      const w = Math.round(img.width * exportScale)
      const h = Math.round(img.height * exportScale)
      return img.renderedIn({ width: w, height: h }) ?? img
    }
    return img
  }

  async function saveToPhotos() {
    const img = capture()
    if (!img) return showToast("预览尚未就绪，请稍候再试")
    const data = img.toPNGData()
    if (!data) return showToast("图片生成失败")
    const name = `${sanitizeName(prefix)}-${sanitizeName(suffix)}`
    const ok = await Photos.savePhoto(data, { fileName: `${name}.png` })
    showToast(ok ? "已保存到相册 ✓" : "保存失败，请检查相册权限")
  }

  async function exportPNG() {
    const img = capture()
    if (!img) return showToast("预览尚未就绪，请稍候再试")
    const data = img.toPNGData()
    if (!data) return showToast("图片生成失败")
    try {
      const dir = FileManager.temporaryDirectory + "/Logoly"
      FileManager.createDirectorySync(dir, true)
      const path = `${dir}/${sanitizeName(prefix)}-${sanitizeName(suffix)}.png`
      FileManager.writeAsDataSync(path, data)
      await DocumentInteraction.optionsMenu(path)
    } catch (e) {
      showToast("导出失败，请重试")
    }
  }

  async function exportSVG() {
    try {
      const dir = FileManager.temporaryDirectory + "/Logoly"
      FileManager.createDirectorySync(dir, true)
      const path = `${dir}/${sanitizeName(prefix)}-${sanitizeName(suffix)}.svg`
      const svg = buildSVG(
        { style, prefix, suffix, prefixColor, suffixColor, suffixBg, transparent, reverse, fontSize, exportScale },
        fitted,
        g
      )
      FileManager.writeAsStringSync(path, svg)
      await DocumentInteraction.optionsMenu(path)
    } catch (e) {
      showToast("导出失败，请重试")
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Logoly"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="完成" action={dismiss} />,
          topBarTrailing: (
            <Button title="随机配色" systemImage="die.face.5" action={randomize} />
          ),
        }}
        toast={{
          isPresented: toastVisible,
          onChanged: setToastVisible,
          message: toastMsg,
          duration: 2.2,
          position: "bottom",
        }}
      >
        {/* ── 预览 ── */}
        <Section>
          <VStack spacing={10} padding={12}>
            <ZStack
              frame={{ maxWidth: "infinity", height: STAGE_H }}
              clipShape={{ type: "rect", cornerRadius: 20 }}
              glassEffect={{
                glass: UIGlass.regular().interactive(true),
                shape: { type: "rect", cornerRadius: 20 },
              }}
            >
              <Canvas
                frame={{ maxWidth: "infinity", height: STAGE_H }}
                draw={(ctx, size) => {
                  if (transparent) {
                    const cell = 18
                    ctx.fillStyle = "#E9E9F0"
                    ctx.fillRect(0, 0, size.width, size.height)
                    ctx.fillStyle = "#DCDCE6"
                    for (let y = 0; y < size.height; y += cell) {
                      for (let x = 0; x < size.width; x += cell) {
                        if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) {
                          ctx.fillRect(x, y, cell, cell)
                        }
                      }
                    }
                  }
                  const pFont = meta.prefixFontName
                  ctx.font = (pFont != null ? { name: pFont, size: fontSize } : fontSize) as any
                  metrics.current.prefixW = Math.max(4, ctx.measureText(prefix || " ").width)
                  const sFont = meta.suffixFontName
                  ctx.font = (sFont != null ? { name: sFont, size: fontSize } : fontSize) as any
                  metrics.current.suffixW = Math.max(4, ctx.measureText(suffix || " ").width)
                  metrics.current.stageW = size.width
                }}
              />
              <LogoMark
                style={style}
                prefix={prefix}
                suffix={suffix}
                prefixColor={prefixColor}
                suffixColor={suffixColor}
                suffixBg={suffixBg}
                transparent={transparent}
                reverse={reverse}
                fittedSize={fitted}
                g={g}
                shotRef={shotRef}
              />
            </ZStack>

            <HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">
                字号 {fontSize}px · 导出 {exportScale}x
              </Text>
              <Spacer />
              {transparent ? (
                <Text font="caption" foregroundStyle="secondaryLabel">透明背景</Text>
              ) : null}
              {meta.hasSuffixBg ? (
                <Text font="caption" foregroundStyle="secondaryLabel">高亮后缀</Text>
              ) : null}
            </HStack>
          </VStack>
        </Section>

        {/* ── 风格 ── */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">风格</Text>}>
          <Picker title="风格" value={style} onChanged={(v: any) => applyStyle(v as StyleKey)} pickerStyle="segmented">
            {STYLE_ORDER.map((k) => (
              <Text key={k} tag={k}>{STYLES[k].label}</Text>
            ))}
          </Picker>
        </Section>

        {/* ── 文字 ── */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">文字</Text>}>
          <TextField
            title="前缀"
            value={prefix}
            onChanged={setPrefix}
            prompt="前段文字"
          />
          <TextField
            title="后缀"
            value={suffix}
            onChanged={setSuffix}
            prompt="后段文字"
          />
        </Section>

        {/* ── 外观 ── */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">外观</Text>}>
          <ColorRow title="前缀颜色" value={prefixColor} onChanged={setPrefixColor} />
          <ColorRow title="后缀文字颜色" value={suffixColor} onChanged={setSuffixColor} />
          {meta.hasSuffixBg ? (
            <ColorRow title="后缀底色" value={suffixBg} onChanged={setSuffixBg} />
          ) : null}
          <HStack spacing={12} padding={{ vertical: 10 }}>
            <Text font="subheadline" foregroundStyle="label">字号</Text>
            <Slider
              min={30}
              max={200}
              step={1}
              value={fontSize}
              onChanged={setFontSize}
            />
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="systemOrange"
              fontDesign="monospaced"
              frame={{ width: 34 }}
            >
              {fontSize}
            </Text>
          </HStack>
          <Toggle value={transparent} onChanged={setTransparent}>
            <VStack spacing={2} alignment="leading">
              <Text font="subheadline" foregroundStyle="label">透明背景</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">导出 PNG 带 Alpha 通道</Text>
            </VStack>
          </Toggle>
          {meta.hasReverse ? (
            <Toggle value={reverse} onChanged={setReverse}>
              <VStack spacing={2} alignment="leading">
                <Text font="subheadline" foregroundStyle="label">反向高亮</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">把高亮色块换到前缀</Text>
              </VStack>
            </Toggle>
          ) : null}
          <HStack padding={{ vertical: 10 }}>
            <Text font="subheadline" foregroundStyle="label">导出尺寸</Text>
            <Spacer />
            <Picker title="导出尺寸" value={exportScale} onChanged={setExportScale} pickerStyle="segmented">
              <Text tag={1}>1x</Text>
              <Text tag={2}>2x</Text>
              <Text tag={4}>4x</Text>
            </Picker>
          </HStack>
        </Section>

        {/* ── 导出 ── */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">导出</Text>}>
          <Picker
            title="导出"
            value={exportAction}
            onChanged={(v: any) => {
              const act = v as string
              // 复位为无选中，保证每次点击都能再次触发动作
              setExportAction("none")
              if (act === "photos") saveToPhotos()
              else if (act === "png") exportPNG()
              else if (act === "svg") exportSVG()
            }}
            pickerStyle="segmented"
          >
            <Text tag="photos">相册</Text>
            <Text tag="png">PNG</Text>
            <Text tag="svg">SVG</Text>
          </Picker>
        </Section>

      </List>
    </NavigationStack>
  )
}

// ─────────────────────────── 入口 ───────────────────────────

async function run() {
  try {
    await Navigation.present({ element: <App /> })
  } finally {
    Script.exit()
  }
}

run()
