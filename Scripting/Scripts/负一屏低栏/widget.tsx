import { VStack, HStack, Text, Image, Spacer, Widget, fetch, modifiers } from 'scripting'

const lengthThreshold = 5
const CONFIG_PATH = FileManager.appGroupDocumentsDirectory + '/bottom_bar_config.json'
const barColor = { light: '#8C7CFF', dark: '#00C400' } as const
const defaultBgColor = { light: 'rgba(239,235,233,0.6)', dark: 'rgba(22,29,42,0.5)' } as const
const labelColor = { light: 'rgba(0,0,0,0.45)', dark: 'rgba(255,255,255,0.45)' } as const
const textColor = { light: 'rgba(0,0,0,0.7)', dark: 'rgba(255,255,255,0.7)' } as const
const strongColor = { light: 'rgba(0,0,0,0.85)', dark: 'rgba(255,255,255,0.85)' } as const

interface Config { weatherBgColor: string | null; contentBgColor: string | null }
function loadConfig(): Config { try { const content = FileManager.readAsStringSync(CONFIG_PATH); return content ? JSON.parse(content) : { weatherBgColor: null, contentBgColor: null } } catch { return { weatherBgColor: null, contentBgColor: null } } }
function getCurrentTimeString(): string { const now = new Date(); return [String(now.getHours()).padStart(2,'0'),String(now.getMinutes()).padStart(2,'0')].join(':') }
function conditionToChinese(condition: WeatherCondition): string { const map: Record<string, string> = { blizzard: '暴风雪', blowingDust: '扬尘', blowingSnow: '吹雪', breezy: '微风', clear: '晴', cloudy: '多云', drizzle: '小雨', flurries: '小雪', foggy: '雾', freezingDrizzle: '冻雨', freezingRain: '冻雨', frigid: '严寒', hail: '冰雹', haze: '霾', heavyRain: '大雨', heavySnow: '大雪', hot: '炎热', hurricane: '飓风', isolatedThunderstorms: '局部雷阵雨', mostlyClear: '晴', mostlyCloudy: '多云', partlyCloudy: '多云', rain: '雨', scatteredThunderstorms: '零星雷阵雨', sleet: '雨夹雪', smoky: '烟霾', snow: '雪', strongStorms: '强风暴', sunFlurries: '太阳雪', sunShowers: '太阳雨', thunderstorms: '雷暴', tropicalStorm: '热带风暴', windy: '大风', wintryMix: '冻雨' }; return map[condition] ?? condition }
