import {
  Script,
  Navigation,
  NavigationStack,
  Button,
  Text,
  HStack,
  VStack,
  ZStack,
  Grid,
  GridRow,
  Spacer,
  Image,
  RoundedRectangle,
  useState,
  useRef,
  useEffect,
} from "scripting"

interface VibrationLevel {
  id: number
  name: string
  intensity: number
  sharpness: number
}

const VIBRATION_LEVELS: VibrationLevel[] = [
  { id: 1, name: "轻抚", intensity: 0.2, sharpness: 0.1 },
  { id: 2, name: "吞息", intensity: 0.35, sharpness: 0.2 },
  { id: 3, name: "沉浸", intensity: 0.5, sharpness: 0.4 },
  { id: 4, name: "失重", intensity: 0.7, sharpness: 0.5 },
  { id: 5, name: "震颤", intensity: 0.85, sharpness: 0.8 },
  { id: 6, name: "余潮", intensity: 1.0, sharpness: 1.0 },
]

function formatTime(date: Date) {
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${hh}:${mm}`
}

function CapsuleButton({title,active,running,glassOpacity,action}:{title:string;active:boolean;running:boolean;glassOpacity:number;action:()=>void}){
  const idleFill=glassOpacity>=0.13?"rgba(255,255,255,0.14)":glassOpacity>=0.11?"rgba(255,255,255,0.12)":glassOpacity>=0.09?"rgba(255,255,255,0.10)":"rgba(255,255,255,0.08)"
  const activeFill="rgba(255,255,255,0.16)"
  const strokeColor=running?"rgba(255,255,255,0.22)":active?"rgba(255,255,255,0.32)":glassOpacity>=0.13?"rgba(255,255,255,0.22)":glassOpacity>=0.11?"rgba(255,255,255,0.20)":glassOpacity>=0.09?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.16)"
  return(<Button action={action} buttonStyle="plain"><ZStack frame={{width:148,height:102}} background={running?{style:{colors:title==="强劲"?["rgba(255,124,196,0.82)","rgba(155,104,255,0.74)"]:["rgba(255,105,180,0.90)","rgba(139,92,246,0.86)"],startPoint:"topLeading",endPoint:"bottomTrailing"},shape:{type:'capsule',style:'continuous'}}:active?{style:activeFill,shape:{type:'capsule',style:'continuous'}}:{style:idleFill,shape:{type:'capsule',style:'continuous'}}} overlay={<ZStack><RoundedRectangle cornerRadius={32} style="continuous" stroke={{shapeStyle:strokeColor,strokeStyle:{lineWidth:running?0.9:1.05}}} fill="clear"/>{running&&title==="强劲"&&<RoundedRectangle cornerRadius={32} style="continuous" stroke={{shapeStyle:"rgba(255,210,244,0.16)",strokeStyle:{lineWidth:3.2}}} fill="clear"/>}</ZStack>}><Text font={{name:"SF Pro Display",size:18}} foregroundStyle={running?"#ffffff":active?"rgba(255,255,255,0.98)":"rgba(255,255,255,0.92)"}>{title}</Text></ZStack></Button>)
}

function GlassActionButton({title,emphasis,action}:{title:string;emphasis:'primary'|'secondary';action:()=>void}){
  const strokeColor=emphasis==='primary'?"rgba(255,255,255,0.24)":"rgba(255,255,255,0.18)"
  return(<Button action={action} buttonStyle="plain"><ZStack frame={{width:148,height:58}} background={emphasis==='primary'?{style:{colors:["rgba(59,130,246,0.88)","rgba(96,165,250,0.72)"],startPoint:"topLeading",endPoint:"bottomTrailing"},shape:{type:'capsule',style:'continuous'}}:{style:"rgba(255,255,255,0.12)",shape:{type:'capsule',style:'continuous'}}} overlay={<RoundedRectangle cornerRadius={29} style="continuous" stroke={{shapeStyle:strokeColor,strokeStyle:{lineWidth:1}}} fill="clear"/>}><Text font={{name:"SF Pro Display",size:16}} foregroundStyle="#ffffff">{title}</Text></ZStack></Button>)
}

function View(){const dismiss=Navigation.useDismiss();const[isEnabled,setIsEnabled]=useState(false);const[activeLevel,setActiveLevel]=useState(VIBRATION_LEVELS[3]!);const[timeText,setTimeText]=useState(formatTime(new Date()));const timerRef=useRef<number>();const clockRef=useRef<number>();const runningRef=useRef(false);function stopAll(){runningRef.current=false;setIsEnabled(false);if(timerRef.current!=null){clearTimeout(timerRef.current);timerRef.current=undefined}}function runPattern(level:VibrationLevel){if(timerRef.current!=null){clearTimeout(timerRef.current);timerRef.current=undefined}runningRef.current=true;async function tick(){if(!runningRef.current)return;try{await Haptics.continuous(0.9,level.intensity,level.sharpness)}finally{if(!runningRef.current)return;timerRef.current=setTimeout(()=>{void tick()},20)}}void tick()}function handleToggle(nextValue:boolean){if(nextValue){setIsEnabled(true);runPattern(activeLevel)}else{stopAll()}}function handleLevelPress(level:VibrationLevel){setActiveLevel(level);if(isEnabled||runningRef.current){setIsEnabled(true);runPattern(level)}}useEffect(()=>{clockRef.current=setTimeout(function updateClock(){setTimeText(formatTime(new Date()));clockRef.current=setTimeout(updateClock,1000)},1000);return()=>{runningRef.current=false;if(timerRef.current!=null)clearTimeout(timerRef.current);if(clockRef.current!=null)clearTimeout(clockRef.current)}},[]);return(<NavigationStack><ZStack background={{colors:["#020308","#0a1020","#161d30","#090d16"],startPoint:"topLeading",endPoint:"bottomTrailing"}} safeAreaInset={{top:{content:(<VStack spacing={12} padding={16}><HStack alignment="center" spacing={10} padding={10} background={{style:"rgba(0,0,0,0.58)",shape:{type:'capsule',style:'continuous'}}} overlay={<RoundedRectangle cornerRadius={18} style="continuous" stroke={{shapeStyle:"rgba(0,0,0,0.72)",strokeStyle:{lineWidth:1.1}}} fill="clear"/>}><Text font={{name:"SF Pro Display",size:14}} foregroundStyle="#ffffff">{timeText}</Text><Spacer/><HStack spacing={6}><Image systemName="cellularbars" foregroundStyle="#ffffff"/><Image systemName="wifi" foregroundStyle="#ffffff"/><Image systemName="battery.100" foregroundStyle="#ffffff"/></HStack></HStack><HStack alignment="center" spacing={12} padding={14} background={{style:"rgba(0,0,0,0.58)",shape:{type:'capsule',style:'continuous'}}} overlay={<RoundedRectangle cornerRadius={22} style="continuous" stroke={{shapeStyle:"rgba(0,0,0,0.72)",strokeStyle:{lineWidth:1.1}}} fill="clear"/>}><Spacer/><Text font={{name:"SF Pro Display",size:21}} foregroundStyle="#ffffff">🪄巴啦啦小魔仙</Text><Spacer/></HStack></VStack>)}}}><VStack spacing={22} padding={20} frame={{maxWidth:'infinity',maxHeight:'infinity',alignment:'center'}}><Spacer minLength={120}/><Grid><GridRow><CapsuleButton title={VIBRATION_LEVELS[0]!.name} active={activeLevel.id===1} running={activeLevel.id===1&&isEnabled} glassOpacity={0.10} action={()=>handleLevelPress(VIBRATION_LEVELS[0]!)}/><CapsuleButton title={VIBRATION_LEVELS[1]!.name} active={activeLevel.id===2} running={activeLevel.id===2&&isEnabled} glassOpacity={0.08} action={()=>handleLevelPress(VIBRATION_LEVELS[1]!)}/></GridRow><GridRow><CapsuleButton title={VIBRATION_LEVELS[2]!.name} active={activeLevel.id===3} running={activeLevel.id===3&&isEnabled} glassOpacity={0.12} action={()=>handleLevelPress(VIBRATION_LEVELS[2]!)}/><CapsuleButton title={VIBRATION_LEVELS[3]!.name} active={activeLevel.id===4} running={activeLevel.id===4&&isEnabled} glassOpacity={0.14} action={()=>handleLevelPress(VIBRATION_LEVELS[3]!)}/></GridRow><GridRow><CapsuleButton title={VIBRATION_LEVELS[4]!.name} active={activeLevel.id===5} running={activeLevel.id===5&&isEnabled} glassOpacity={0.09} action={()=>handleLevelPress(VIBRATION_LEVELS[4]!)}/><CapsuleButton title={VIBRATION_LEVELS[5]!.name} active={activeLevel.id===6} running={activeLevel.id===6&&isEnabled} glassOpacity={0.11} action={()=>handleLevelPress(VIBRATION_LEVELS[5]!)}/></GridRow></Grid><Spacer/><HStack spacing={12}><GlassActionButton title="开启" emphasis={isEnabled?'secondary':'primary'} action={()=>handleToggle(true)}/><GlassActionButton title="停止" emphasis={isEnabled?'primary':'secondary'} action={()=>handleToggle(false)}/></HStack></VStack></ZStack></NavigationStack>)}async function run(){await Navigation.present(<View/>);Script.exit()}run()
