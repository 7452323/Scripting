import { NavigationStack, Navigation, Form, Section, Text, Button, Toggle, HStack, VStack, Widget, Script } from 'scripting'

const CONFIG_PATH = FileManager.appGroupDocumentsDirectory + '/bottom_bar_config.json'

const PRESET_COLORS: { label: string; hex: string | null }[] = [
  { label: '默认', hex: null }, { label: '纯白', hex: 'rgba(255,255,255,0.7)' }, { label: '纯黑', hex: 'rgba(0,0,0,0.5)' }, { label: '浅灰', hex: 'rgba(239,235,233,0.7)' }, { label: '中灰', hex: 'rgba(200,200,200,0.5)' }, { label: '深灰', hex: 'rgba(80,80,80,0.5)' }, { label: '天蓝', hex: 'rgba(173,216,230,0.6)' }, { label: '浅蓝', hex: 'rgba(180,210,255,0.6)' }, { label: '深蓝', hex: 'rgba(22,29,42,0.6)' }, { label: '浅绿', hex: 'rgba(200,240,200,0.6)' }, { label: '翠绿', hex: 'rgba(50,180,100,0.4)' }, { label: '淡黄', hex: 'rgba(255,245,180,0.6)' }, { label: '橙色', hex: 'rgba(255,200,130,0.6)' }, { label: '淡粉', hex: 'rgba(255,200,210,0.6)' }, { label: '粉色', hex: 'rgba(255,160,180,0.5)' }, { label: '淡紫', hex: 'rgba(230,220,250,0.6)' }, { label: '紫色', hex: 'rgba(180,140,220,0.5)' }, { label: '米色', hex: 'rgba(245,235,220,0.6)' },
]

interface Config { useTransparentBackground: boolean; showSolarTerms: 'auto' | 'always' | 'never'; refreshIntervalMinutes: number; weatherBgColor: string | null; contentBgColor: string | null }
function loadConfig(): Config { try { const content = FileManager.readAsStringSync(CONFIG_PATH); return content ? JSON.parse(content) : defaultConfig() } catch { return defaultConfig() } }
function saveConfig(config: Config): void { try { FileManager.writeAsStringSync(CONFIG_PATH, JSON.stringify(config, null, 2)) } catch (e) { console.error('保存配置失败:', e) } }
function defaultConfig(): Config { return { useTransparentBackground: false, showSolarTerms: 'auto', refreshIntervalMinutes: 30, weatherBgColor: null, contentBgColor: null } }

function ColorSwatch({hex,isSelected}:{hex:string|null;isSelected:boolean}){const backgroundColor=hex===null?'rgba(120,120,120,0.2)':hex;const size=isSelected?38:34;return(<VStack frame={{width:size,height:size}} background={{style:backgroundColor as any,shape:{type:'rect',cornerRadius:size/2}}} alignment="center" shadow={isSelected?{color:'#8C7CFF' as any,radius:4,x:0,y:0}:undefined}>{hex===null&&<Text font={13} foregroundStyle="secondaryLabel" fontWeight="bold">A</Text>}{isSelected&&hex!==null&&<Text font={16} foregroundStyle="white" fontWeight="bold">✓</Text>}</VStack>)}

function ColorPickerRow({currentColor,onSelect}:{currentColor:string|null;onSelect:(hex:string|null)=>void}){const rows:typeof PRESET_COLORS[]=[];const chunkSize=9;for(let i=0;i<PRESET_COLORS.length;i+=chunkSize){rows.push(PRESET_COLORS.slice(i,i+chunkSize))}return(<VStack spacing={8}>{rows.map((row,ri)=>(<HStack spacing={10} padding={{top:2,bottom:2}} key={ri}>{row.map((c)=>(<VStack key={c.label} alignment="center" spacing={2} onTapGesture={()=>onSelect(c.hex)}><ColorSwatch hex={c.hex} isSelected={currentColor===c.hex}/><Text font={8} foregroundStyle={currentColor===c.hex?'#8C7CFF':'secondaryLabel'}>{c.label}</Text></VStack>))}</HStack>))}</VStack>)}

function SettingsView(){const config=loadConfig();return(<NavigationStack><Form><Section title="外观设置"><Toggle title="透明背景" value={config.useTransparentBackground} onChanged={(value)=>{config.useTransparentBackground=value;saveConfig(config)}}/><Text font="caption" foregroundStyle="secondaryLabel">启用后，小组件背景将变为透明，可配合壁纸实现"无界"效果。</Text></Section><Section header={<Text font="headline">天气栏背景色</Text>} footer={<Text font="caption" foregroundStyle="secondaryLabel">设置顶部天气区域的背景颜色。选择"默认"将跟随系统浅色/深色模式。</Text>}><ColorPickerRow currentColor={config.weatherBgColor} onSelect={(hex)=>{config.weatherBgColor=hex;saveConfig(config)}}/></Section><Section header={<Text font="headline">内容区背景色</Text>} footer={<Text font="caption" foregroundStyle="secondaryLabel">设置底部每日一句/节气区域的背景颜色。选择"默认"将跟随系统浅色/深色模式。</Text>}><ColorPickerRow currentColor={config.contentBgColor} onSelect={(hex)=>{config.contentBgColor=hex;saveConfig(config)}}/></Section></Form></NavigationStack>)}

async function previewWidget(){try{await Widget.preview({family:'systemMedium'})}catch(e){console.error('预览失败:',e)}}
async function refreshWidgetData(){try{Widget.reloadAll();console.log('已触发小组件刷新')}catch(e){console.error('刷新失败:',e)}}
function clearConfig(){try{if(FileManager.existsSync(CONFIG_PATH)){FileManager.removeSync(CONFIG_PATH);console.log('配置已清除')}}catch(e){console.error('清除配置失败:',e)}}

async function run(){await Navigation.present(<SettingsView/>);Script.exit()}
run()
