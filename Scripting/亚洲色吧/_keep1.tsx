/**
 * 学习资料 - 看书 & 听书
 * 数据源: https://yazhouse8.com
 * 看书: /article.php (分类/文章列表) → /article/ID.html (内容)
 * 听书: /mp3/ (列表) → /mp3/mp3-l-N.html (曲目/音频URL)
 */

import {
  useState, useEffect, useMemo, useCallback, createContext, useContext, useRef,
  VStack, HStack, ZStack, Text, Image, Button, List, Section, ScrollView, ForEach,
  NavigationStack, NavigationLink, Spacer, LazyVGrid, TextField, ProgressView,
  TabView, Tab, fetch, Picker, Menu, Toggle, Slider,
  Navigation, Script, gradient, RoundedRectangle, Rectangle
} from "scripting"

// ━━━━━━━━━━━━━━ 常量 ━━━━━━━━━━━━━━

const BASE_URL = "https://yazhouse8.com"

// 看书分类 — 完整标签列表
const READING_CATEGORIES = [
  { id: "1", name: "都市激情", url: "/article.php?cate=1" },
  { id: "2", name: "人妻交换", url: "/article.php?cate=2" },
  { id: "3", name: "校园春色", url: "/article.php?cate=3" },
  { id: "4", name: "家庭乱伦", url: "/article.php?cate=4" },
  { id: "5", name: "情色笑话", url: "/article.php?cate=5" },
  { id: "6", name: "性爱技巧", url: "/article.php?cate=6" },
  { id: "7", name: "另类小说", url: "/article.php?cate=7" },
  { id: "8", name: "乱伦文章", url: "/article.php?cate=8" },
  { id: "9", name: "纪实小说", url: "/article.php?cate=9" },
  { id: "10", name: "武侠小说", url: "/article.php?cate=10" },
  { id: "11", name: "虐待小说", url: "/article.php?cate=11" },
  { id: "12", name: "两性话题", url: "/article.php?cate=12" },
  { id: "siwa", name: "丝袜小说", url: "/l9kdK.htm" },
  { id: "mijian", name: "迷奸小说", url: "/Ryuid.htm" },
  { id: "tiaojiao", name: "调教小说", url: "/KGl2i.htm" },
  { id: "lunjian", name: "轮奸小说", url: "/6pmJE.htm" },
  { id: "shoujiao", name: "兽交小说", url: "/BmwSt.htm" },
  { id: "luchu", name: "露出小说", url: "/thguq.htm" },
  { id: "xingnu", name: "性奴小说", url: "/McpCg.htm" },
  { id: "juru", name: "巨乳小说", url: "/sxUlc.htm" },
]

// 听书分类
const AUDIO_CATEGORIES = [
  { id: "long", name: "长篇", icon: "book.fill" },
  { id: "short", name: "短篇", icon: "text.justify" },
]

// ━━━━━━━━━━━━━━ 类型定义 ━━━━━━━━━━━━━━

interface ArticleInfo {
  id: string         // URL path, e.g. /article/142346.html
  title: string
  category?: string
}

interface AudioBookInfo {
  id: string         // URL path, e.g. /mp3/mp3-l-0.html
  title: string
  type: "long" | "short"
}

interface TrackInfo {
  id: string         // index or URL
  bookId: string
  title: string
  audioUrl: string
}

interface ReadingHistory {
  id: string
  articleId: string
  articleTitle: string
  category?: string
  scrollPos: number   // 0-1
  timestamp: number
}

interface ListeningHistory {
  id: string
  bookId: string
  trackId: string
  trackTitle: string
  bookTitle: string
  progress: number    // 0-1
  timestamp: number
}
