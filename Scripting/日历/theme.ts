/** theme.ts — 配色与通用尺寸
 *
 * 配色用「**双值基础表 + 按当前外观展开**」的方式：
 *
 * - `BASE` 存浅 / 深两套原始值；
 * - `C` 是**当前生效的单值配色表**，由 `applyAppearance()` 展开而来。
 *
 * 为什么要自己展开？系统深色下 `{light, dark}`（`DynamicShapeStyle`）本身是会跟随的，
 * 但 Scripting 文档写得很明确：
 *
 * > `preferredColorScheme`: Sets the preferred system appearance (light or dark) for the
 * > view hierarchy. **Only affects non-transient system overlays.**
 *
 * 也就是说它**改变不了自己视图的颜色**，所以想控制外观只能自己算。目前外观**恒跟随系统**
 * （设置页不再提供手动切换）：由 App 用 `useColorScheme()` 拿到系统外观，展开进 `C`。
 *
 * 文字 / 图标色直接用系统语义色（`label` 系列），它们本身就会随外观自动变，不用展开。
 */

import type { Color } from "scripting"

/** 双值：浅 / 深各一个取值 */
export type DynStyle = { light: Color; dark: Color }

/** 一套主题色 */
export type AccentTheme = {
  id: string
  name: string
  /** 强调色（浅色模式） */
  accent: Color
  /** 深一级的强调色（用于文字 / 图标） */
  deep: Color
  /** 软底：浅色模式 */
  softLight: Color
  /** 软底：深色模式 */
  softDark: Color
}

export const ACCENT_THEMES: AccentTheme[] = [
  { id: "terracotta", name: "陶土橙", accent: "#C0632E", deep: "#8E4A1E", softLight: "#F6E3D2", softDark: "#3D2A1D" },
  { id: "indigo", name: "黛蓝", accent: "#3E6C9A", deep: "#2B4E73", softLight: "#DCE8F4", softDark: "#1B2C3D" },
  { id: "moss", name: "苔绿", accent: "#5F7A45", deep: "#43572F", softLight: "#E3EBD3", softDark: "#28331C" },
  { id: "plum", name: "莓紫", accent: "#8A4A77", deep: "#653255", softLight: "#F0DEEA", softDark: "#3A1F31" },
  { id: "rose", name: "绛红", accent: "#B04A47", deep: "#85322F", softLight: "#F6DEDC", softDark: "#3D1F1E" },
  { id: "graphite", name: "石墨", accent: "#5A5A5E", deep: "#3D3D41", softLight: "#E6E6E9", softDark: "#2C2C30" },
]

export const DEFAULT_ACCENT_ID = ACCENT_THEMES[0].id

export function findAccentTheme(id: string): AccentTheme {
  return ACCENT_THEMES.find((t) => t.id === id) ?? ACCENT_THEMES[0]
}

/** 需要按外观展开的双值字段 */
const BASE: Record<string, DynStyle> = {
  // 暖白：保留一点暖意（日历类更亲和），但去掉了原来的黄气。
  // 旧值是 #FBF4E9（偏黄奶油），大面积铺开会显「脏」。
  bg: { light: "#F7F4F0", dark: "#141312" },
  bgDeep: { light: "#F1ECE6", dark: "#1D1B19" },
  surface: { light: "#FFFFFF", dark: "#252220" },
  surfaceSoft: { light: "#F2EDE7", dark: "#2E2A27" },
  greenSoft: { light: "#E6EDD8", dark: "#2A331E" },
  onAccentSoft: { light: "rgba(255,255,255,0.85)", dark: "rgba(255,255,255,0.80)" },
}

/** 当前生效的配色表（单值，字段可写） */
export const C: {
  bg: Color
  bgDeep: Color
  surface: Color
  surfaceSoft: Color
  greenSoft: Color
  onAccentSoft: Color
  accentSoft: Color
  separator: Color
  accent: Color
  accentDeep: Color
  green: Color
  greenDeep: Color
  tagOff: Color
  tagWork: Color
  onAccent: Color
  text: Color
  textSecondary: Color
  textTertiary: Color
} = {
  bg: BASE.bg.light,
  bgDeep: BASE.bgDeep.light,
  surface: BASE.surface.light,
  surfaceSoft: BASE.surfaceSoft.light,
  greenSoft: BASE.greenSoft.light,
  onAccentSoft: BASE.onAccentSoft.light,
  accentSoft: ACCENT_THEMES[0].softLight,
  separator: "separator",
  accent: ACCENT_THEMES[0].accent,
  accentDeep: ACCENT_THEMES[0].deep,
  green: "#6B854A",
  greenDeep: "#4A5F32",
  tagOff: ACCENT_THEMES[0].accent,
  tagWork: "#6B854A",
  onAccent: "#FFFFFF",
  text: "label",
  textSecondary: "secondaryLabel",
  textTertiary: "tertiaryLabel",
}

let currentScheme: "light" | "dark" = "light"
let activeAccent: AccentTheme = ACCENT_THEMES[0]

/**
 * 按当前生效外观把双值展开成单值（外观恒跟随系统，由 App 传入系统外观）。
 *
 * `preferredColorScheme` 只影响系统覆盖层，改变不了自己视图的颜色，所以得自己展开。
 */
export function applyAppearance(scheme: "light" | "dark"): void {
  currentScheme = scheme
  for (const key of Object.keys(BASE)) {
    ;(C as any)[key] = scheme === "dark" ? BASE[key].dark : BASE[key].light
  }
  // 软底依赖当前外观，展开后再刷一次主题色
  applyAccentTheme(activeAccent.id)
}

/** 切换主题色（就地改写 C，所有引用处自动跟随） */
export function applyAccentTheme(id: string): void {
  const theme = findAccentTheme(id)
  activeAccent = theme
  C.accent = theme.accent
  C.accentDeep = theme.deep
  C.accentSoft = currentScheme === "dark" ? theme.softDark : theme.softLight
  C.tagOff = theme.accent
}

export const R = {
  card: 18,
  chip: 999,
} as const

export const F = {
  largeTitle: 34,
  title: 22,
  headline: 16,
  body: 15,
  caption: 12.5,
  micro: 11,
} as const

/** 日历颜色回退（系统日历取不到时）；本身是彩色，浅深色下都可用 */
export const FALLBACK_COLORS = ["#C0632E", "#7D8F52", "#4E7D8F", "#8F6A4E", "#7D5BA6", "#B5533F"] as const
