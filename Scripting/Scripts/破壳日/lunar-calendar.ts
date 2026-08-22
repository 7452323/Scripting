/**
 * 农历公历转换工具
 * 
 * 基于经典天文数据表格法实现：
 * - 支持 1900-2100 年农历计算
 * - 二十四节气（近似算法）
 * - 生肖、星座、干支
 */

// 农历数据表: 每个元素表示一年的农历月份信息
// 十六进制编码:
// 0-3位: 闰月月份 (0=无闰月)
// 4-15位: 12个月份的大小月 (1=30天, 0=29天)
// 16-19位: 闰月大小 (1=30天, 0=29天)
const LUNAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06aa0, 0x1a6c4, 0x0aae0, // 2050-2059
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
];

// 天干
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
// 地支
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
// 生肖
const SHENG_XIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
// 农历月份
const LUNAR_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
// 农历日期
const LUNAR_DAY = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
// 星座
const CONSTELLATIONS = [
  '摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座',
  '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座'
];
// 星座日期边界
const CONSTELLATION_EDGES = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];

/** 获取农历年的总天数 */
function lunarYearDays(year: number): number {
  let sum = 348; // 12 * 29
  const info = LUNAR_INFO[year - 1900];
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (info & i) ? 1 : 0;
  }
  // 闰月天数
  const leapMonth = info & 0xf;
  if (leapMonth > 0) {
    sum += (info & 0x10000) ? 30 : 29;
  }
  return sum;
}

/** 获取农历年闰月月份 (0=无闰月) */
function leapMonth(year: number): number {
  return LUNAR_INFO[year - 1900] & 0xf;
}

/** 获取农历年闰月天数 */
function leapMonthDays(year: number): number {
  return (LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29;
}

/** 获取农历年指定月份天数 */
function monthDays(year: number, month: number): number {
  return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29;
}

/** 计算农历新年（正月初一）对应的公历日期 */
function lunarNewYearDate(year: number): { month: number; day: number } {
  // 从 1900 年 1 月 31 日（1900年正月初一）开始累计
  let offset = 0;
  for (let y = 1900; y < year; y++) {
    offset += lunarYearDays(y);
  }
  // 1900-01-31 是正月初一
  const base = new Date(1900, 0, 31);
  const target = new Date(base.getTime() + offset * 86400000);
  return { month: target.getMonth() + 1, day: target.getDate() };
}

/** 获取农历日期 */
function lunarDate(year: number, month: number, day: number): {
  lYear: number; lMonth: number; lDay: number; isLeap: boolean;
} {
  // 计算目标日期与 1900-01-31 的偏移天数
  const base = new Date(1900, 0, 31);
  const target = new Date(year, month - 1, day);
  let offset = Math.round((target.getTime() - base.getTime()) / 86400000);
  
  if (offset < 0) return { lYear: 0, lMonth: 0, lDay: 0, isLeap: false };

  // 查找农历年份
  let lYear = 1900;
  let daysInYear: number;
  while (lYear < 2100) {
    daysInYear = lunarYearDays(lYear);
    if (offset < daysInYear) break;
    offset -= daysInYear;
    lYear++;
  }
  if (lYear > 2100) return { lYear: 0, lMonth: 0, lDay: 0, isLeap: false };

  // 查找农历月份
  const leap = leapMonth(lYear);
  let isLeap = false;
  let lMonth = 1;
  
  for (let m = 1; m <= 12; m++) {
    const days = monthDays(lYear, m);
    if (offset < days) {
      lMonth = m;
      break;
    }
    offset -= days;
    
    // 如果在闰月之后有闰月
    if (leap > 0 && m === leap) {
      const leapDays = leapMonthDays(lYear);
      if (offset < leapDays) {
        lMonth = m;
        isLeap = true;
        break;
      }
      offset -= leapDays;
    }
  }

  return { lYear, lMonth, lDay: offset + 1, isLeap };
}

/** 公历转农历 */
export function solar2lunar(year: number, month: number, day: number): {
  lYear: number; lMonth: number; lDay: number; isLeap: boolean;
  IMonthCn: string; IDayCn: string;
  Animal: string; astro: string;
  cYear: number; cMonth: number; cDay: number;
  gzYear: string; gzMonth: string; gzDay: string;
} {
  const result = lunarDate(year, month, day);
  const animalIdx = (result.lYear - 4) % 12;
  const astro = getConstellation(month, day);
  const ganZhiYear = getGanZhiYear(result.lYear);
  const gzMonth = getGanZhiMonth(result.lYear, month, day);
  const gzDay = getGanZhiDay(year, month, day);

  return {
    ...result,
    IMonthCn: (result.isLeap ? '闰' : '') + LUNAR_MONTH[result.lMonth - 1] + '月',
    IDayCn: LUNAR_DAY[result.lDay - 1],
    Animal: SHENG_XIAO[(animalIdx + 12) % 12],
    astro,
    cYear: year,
    cMonth: month,
    cDay: day,
    gzYear: ganZhiYear,
    gzMonth: gzMonth,
    gzDay: gzDay,
  };
}

/** 农历转公历 */
export function lunar2solar(
  year: number, month: number, day: number, isLeap: boolean = false
): {
  lYear: number; lMonth: number; lDay: number; isLeap: boolean;
  IMonthCn: string; IDayCn: string;
  Animal: string; astro: string;
  cYear: number; cMonth: number; cDay: number;
} {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    throw new Error('农历日期超出支持范围');
  }

  const leap = leapMonth(year);
  if (isLeap && leap !== month) {
    throw new Error(`年份 ${year} 的 ${month} 月不是闰月`);
  }
  const maxDay = isLeap ? leapMonthDays(year) : monthDays(year, month);
  if (day > maxDay) {
    throw new Error(`农历 ${month} 月没有第 ${day} 天`);
  }

  // 计算农历新年日期
  const nyd = lunarNewYearDate(year);
  let offset = 0;
  
  for (let m = 1; m < month; m++) {
    offset += monthDays(year, m);
  }
  
  if (isLeap) {
    // 正常月的天数已在前面加上
    offset += monthDays(year, month); // 跳过正常月
  } else if (leap > 0 && month > leap) {
    offset += leapMonthDays(year);
  }
  
  offset += day - 1;

  const base = new Date(year, nyd.month - 1, nyd.day);
  const target = new Date(base.getTime() + offset * 86400000);
  const cYear = target.getFullYear();
  const cMonth = target.getMonth() + 1;
  const cDay = target.getDate();
  
  const animalIdx = (year - 4) % 12;
  const astro = getConstellation(cMonth, cDay);

  return {
    lYear: year, lMonth: month, lDay: day, isLeap,
    IMonthCn: (isLeap ? '闰' : '') + LUNAR_MONTH[month - 1] + '月',
    IDayCn: LUNAR_DAY[day - 1],
    Animal: SHENG_XIAO[(animalIdx + 12) % 12],
    astro,
    cYear, cMonth, cDay,
  };
}

/** 获取星座 */
export function getConstellation(month: number, day: number): string {
  const idx = day < CONSTELLATION_EDGES[month - 1] ? month - 1 : month % 12;
  return CONSTELLATIONS[idx];
}

/** 获取生肖 Emoji */
export function getAnimalZodiacToEmoji(animal: string): string {
  const map: Record<string, string> = {
    '鼠': '🐭', '牛': '🐮', '虎': '🐯', '兔': '🐰',
    '龙': '🐲', '蛇': '🐍', '马': '🐴', '羊': '🐑',
    '猴': '🐵', '鸡': '🐔', '狗': '🐶', '猪': '🐷'
  };
  return map[animal] || '';
}

/** 获取星座 Emoji */
export function getAstroToEmoji(astro: string): string {
  const map: Record<string, string> = {
    '摩羯座': '♑', '水瓶座': '♒', '双鱼座': '♓', '白羊座': '♈',
    '金牛座': '♉', '双子座': '♊', '巨蟹座': '♋', '狮子座': '♌',
    '处女座': '♍', '天秤座': '♎', '天蝎座': '♏', '射手座': '♐'
  };
  return map[astro] || '';
}

/** 获取农历年干支 */
function getGanZhiYear(year: number): string {
  const gan = (year - 4) % 10;
  const zhi = (year - 4) % 12;
  return TIAN_GAN[(gan + 10) % 10] + DI_ZHI[(zhi + 12) % 12];
}

/** 获取月干支（立春为界） */
function getGanZhiMonth(year: number, month: number, day: number): string {
  // 立春通常在 2 月 3-5 日
  const isBeforeLichun = month < 2 || (month === 2 && day < 4);
  const ganZhiYear = (year - 4) % 10;
  // 月干支：甲己之年丙作首
  const monthGanStart = [2, 4, 6, 8, 0, 2]; // 甲(0)己(5) -> 丙(2)
  const yearGan = isBeforeLichun ? (ganZhiYear - 1 + 10) % 10 : ganZhiYear;
  const ganStart = Math.floor(yearGan / 2) % 6;
  const zhiIdx = (month + 1) % 12;
  const ganIdx = (monthGanStart[ganStart] + month - 1) % 10;
  return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
}

/** 获取日干支（基于1900-01-01为甲子日） */
function getGanZhiDay(year: number, month: number, day: number): string {
  const base = new Date(1900, 0, 1);
  const target = new Date(year, month - 1, day);
  const offset = Math.round((target.getTime() - base.getTime()) / 86400000);
  const gan = offset % 10;
  const zhi = offset % 12;
  return TIAN_GAN[(gan + 10) % 10] + DI_ZHI[(zhi + 12) % 12];
}

/** 
 * 计算下一个生日的日期（公历）
 * 如果是农历生日，需要转换
 */
export function getNextBirthday(
  birthYear: number, birthMonth: number, birthDay: number,
  isNongli: boolean, isLeapMonth: boolean
): { cYear: number; cMonth: number; cDay: number; daysUntil: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentYear = today.getFullYear();
  let targetYear = currentYear;
  
  let solarDate: { cYear: number; cMonth: number; cDay: number };
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (isNongli) {
        // 农历生日 → 转为公历
        const converted = lunar2solar(targetYear, birthMonth, birthDay, isLeapMonth);
        solarDate = converted;
      } else {
        solarDate = { cYear: targetYear, cMonth: birthMonth, cDay: birthDay };
      }
      
      const birthdayThisYear = new Date(solarDate.cYear, solarDate.cMonth - 1, solarDate.cDay);
      if (birthdayThisYear.getTime() >= today.getTime()) {
        // 今年的生日还没过，生日当天返回 0
        const diff = Math.round((birthdayThisYear.getTime() - today.getTime()) / 86400000);
        return { ...solarDate, daysUntil: diff };
      }
    } catch (e) {
      // 转换失败，尝试下一年
    }
    targetYear++;
  }
  
  // 如果今年已过，取明年
  targetYear = currentYear + 1;
  if (isNongli) {
    const converted = lunar2solar(targetYear, birthMonth, birthDay, isLeapMonth);
    solarDate = converted;
  } else {
    solarDate = { cYear: targetYear, cMonth: birthMonth, cDay: birthDay };
  }
  const birthdayNext = new Date(solarDate.cYear, solarDate.cMonth - 1, solarDate.cDay);
  const diff = Math.round((birthdayNext.getTime() - today.getTime()) / 86400000);
  return { ...solarDate, daysUntil: diff };
}

/** 验证日期字符串是否有效 */
export function verifyTime(dateStr: string): boolean {
  if (!dateStr) return false;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getFullYear() === parts[0] && d.getMonth() === parts[1] - 1 && d.getDate() === parts[2];
}

/** 计算两个日期之间的天数 */
export function daysBetween(
  year1: number, month1: number, day1: number,
  year2: number, month2: number, day2: number
): number {
  const d1 = new Date(year1, month1 - 1, day1);
  const d2 = new Date(year2, month2 - 1, day2);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

/** 从出生日期计算年龄 */
export function getAge(birthStr: string): { year: number; month: number; day: number } {
  if (!birthStr) return { year: 0, month: 0, day: 0 };
  const parts = birthStr.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  
  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  let days = today.getDate() - start.getDate();
  
  if (days < 0) {
    months--;
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  
  return { year: Math.max(0, years), month: Math.max(0, months), day: Math.max(0, days) };
}

/** 计算从相识日到今天的总天数 */
export function getMeetDays(edayStr: string): number {
  if (!verifyTime(edayStr)) return 0;
  const parts = edayStr.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
}
