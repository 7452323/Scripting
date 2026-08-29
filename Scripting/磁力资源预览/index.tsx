declare const fetch: any;

import {
  Script,
  Navigation,
  NavigationStack,
  ScrollView,
  VStack,
  HStack,
  ZStack,
  Text,
  TextField,
  Button,
  Image,
  RoundedRectangle,
  ProgressView,
  Spacer,
  Link,
  MagnifyGesture,
  TabView,
  useEffect,
  useObservable,
  useState,
} from "scripting";

type WhatsLinkScreenshot = {
  time?: number;
  screenshot: string;
};

type WhatsLinkResponse = {
  error?: string;
  type?: string;
  file_type?: string;
  name?: string;
  size?: number;
  count?: number;
  screenshots?: WhatsLinkScreenshot[];
};

type CodeSearchItem = {
  id: string;
  source: "MissAV" | "JavDB";
  title: string;
  url: string;
  cover?: string;
  meta?: string;
  badge?: string;
};

type FavoriteItem = {
  id: string;
  url: string;
  name: string;
  size: number;
  count: number;
  type: string;
  fileType: string;
  cover?: string;
  createdAt: number;
};

const API_ENDPOINT = "https://whatslink.info/api/v1/link";
const FAVORITES_KEY = "magnet-preview-favorites-v1";
const MISSAV_HOSTS = ["https://missav.ws", "https://missav.ai"];
const JAVDB_HOST = "https://javdb.com";
const BLUE = "#0A84FF";
const GLASS_TINT = "rgba(255,255,255,0.18)";
const GLASS_STROKE = { light: "rgba(255,255,255,0.58)", dark: "rgba(255,255,255,0.16)" };
const GLASS_FILL = { light: "rgba(255,255,255,0.36)", dark: "rgba(44,44,46,0.52)" };
const SUBTLE_GLASS_FILL = { light: "rgba(255,255,255,0.20)", dark: "rgba(58,58,60,0.34)" };
const INPUT_GLASS_FILL = { light: "rgba(255,255,255,0.28)", dark: "rgba(28,28,30,0.50)" };
const PAGE_BACKGROUND = { light: "white", dark: "black" };

function loadFavorites(): FavoriteItem[] {
  return Storage.get<FavoriteItem[]>(FAVORITES_KEY) ?? [];
}

function persistFavorites(items: FavoriteItem[]) {
  Storage.set(FAVORITES_KEY, items);
}

function normalizeInput(input: string) {
  return input.trim().replace(/^\s+|\s+$/g, "");
}

function extractSupportedLink(input: string) {
  const text = normalizeInput(input);
  if (!text) return "";

  const magnet = text.match(/magnet:\?[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (magnet) return magnet;

  const ed2k = text.match(/ed2k:\/\/[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (ed2k) return ed2k;

  const http = text.match(/https?:\/\/[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (http) return http;

  return text;
}

function isSupportedLink(input: string) {
  const text = extractSupportedLink(input).toLowerCase();
  return text.startsWith("magnet:?") || text.startsWith("ed2k://") || text.startsWith("http://") || text.startsWith("https://");
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

function shortLink(url: string) {
  if (url.length <= 72) return url;
  return `${url.slice(0, 44)}…${url.slice(-24)}`;
}

function displayFileType(result?: WhatsLinkResponse | null) {
  if (!result) return "-";
  return (result.file_type || result.type || "unknown").toUpperCase();
}

function getCover(result?: WhatsLinkResponse | null, index = 0) {
  const shots = result?.screenshots ?? [];
  return shots[index]?.screenshot || shots[0]?.screenshot || "";
}

async function queryWhatsLink(url: string): Promise<WhatsLinkResponse> {
  const res = await fetch(`${API_ENDPOINT}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`接口请求失败：HTTP ${res.status}`);
  const json = (await res.json()) as WhatsLinkResponse;
  if (json.error) throw new Error(json.error);
  return json;
}

function normalizeCode(input: string) {
  return input.trim().toUpperCase().replace(/[＿_\s]+/g, "-");
}

function looksLikeCode(input: string) {
  const code = normalizeCode(input);
  return /^[A-Z0-9]{2,12}-?\d{2,7}(?:-[A-Z0-9]+)?$/.test(code);
}

const MISSAV_EXTRACT_SCRIPT = `
return Array.from(document.querySelectorAll('.thumbnail')).slice(0, 12).map((card, index) => {
  const titleLink = card.querySelector('a.text-secondary') || card.querySelector('a[href]');
  const image = card.querySelector('img');
  const video = card.querySelector('video');
  const labels = Array.from(card.querySelectorAll('span')).map((el) => el.textContent.trim()).filter(Boolean);
  return {
    id: 'missav-' + index + '-' + (titleLink?.getAttribute('alt') || ''),
    source: 'MissAV',
    title: titleLink?.textContent?.trim() || image?.getAttribute('alt') || '未知作品',
    url: titleLink?.href || '',
    cover: image?.getAttribute('data-src') || image?.src || '',
    meta: labels.find((text) => /^\\d{1,2}:\\d{2}/.test(text)) || '',
    badge: labels.find((text) => !/^\\d{1,2}:\\d{2}/.test(text)) || '',
    preview: video?.getAttribute('data-src') || ''
  };
}).filter((item) => item.url);`;

const JAVDB_EXTRACT_SCRIPT = `
return Array.from(document.querySelectorAll('.movie-list .item, a.box')).slice(0, 12).map((card, index) => {
  const link = card.matches('a[href]') ? card : card.querySelector('a[href]');
  const image = card.querySelector('img');
  const title = card.querySelector('.video-title, .title, strong');
  const code = card.querySelector('.video-title strong, .uid, .code');
  const meta = card.querySelector('.meta, .score, .video-meta');
  const href = link?.href || '';
  return {
    id: 'javdb-' + index + '-' + href,
    source: 'JavDB',
    title: title?.textContent?.trim() || card.textContent?.trim().split('\\n').filter(Boolean).slice(0, 2).join(' ') || '未知作品',
    url: href,
    cover: image?.getAttribute('data-src') || image?.getAttribute('src') || '',
    meta: meta?.textContent?.trim() || '',
    badge: code?.textContent?.trim() || ''
  };
}).filter((item) => item.url);`;

async function scrapeWithWebView(url: string, extractScript: string, cloudflare = false): Promise<CodeSearchItem[]> {
  const webView = new WebViewController();
  try {
    await webView.setCustomUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
    const loaded = await webView.loadURL(url);
    if (!loaded) throw new Error("网页加载失败");

    const attempts = cloudflare ? 24 : 8;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await new Promise<void>((resolve) => setTimeout(() => resolve(), cloudflare ? 1250 : 500));
      const state = await webView.evaluateJavaScript<any>(`
        return {
          title: document.title || '',
          challenging: !!document.querySelector('#challenge-running, .main-wrapper') || /安全验证|just a moment|checking your browser/i.test(document.body?.innerText || ''),
          ready: document.readyState === 'complete'
        };
      `);
      if (state?.challenging) continue;
      if (state?.ready) {
        const rows = await webView.evaluateJavaScript<CodeSearchItem[]>(extractScript);
        return Array.isArray(rows) ? rows : [];
      }
    }
    throw new Error(cloudflare ? "Cloudflare 自动验证超时，请稍后重试" : "网页解析超时");
  } finally {
    webView.dispose();
  }
}

async function searchMissAV(code: string) {
  let lastError: any;
  for (const host of MISSAV_HOSTS) {
    try {
      const rows = await scrapeWithWebView(`${host}/cn/search/${encodeURIComponent(code)}`, MISSAV_EXTRACT_SCRIPT, true);
      if (rows.length) return rows;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function searchJavDB(code: string) {
  return scrapeWithWebView(`${JAVDB_HOST}/search?q=${encodeURIComponent(code)}&f=all`, JAVDB_EXTRACT_SCRIPT, true);
}

async function queryCode(code: string): Promise<{ items: CodeSearchItem[]; warnings: string[] }> {
  const settled = await Promise.allSettled([searchMissAV(code), searchJavDB(code)]);
  const items: CodeSearchItem[] = [];
  const warnings: string[] = [];
  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled") items.push(...entry.value);
    else warnings.push(`${index === 0 ? "MissAV" : "JavDB"}：${entry.reason?.message ?? String(entry.reason)}`);
  });
  return { items, warnings };
}

async function extractMagnetFromDetail(url: string): Promise<string> {
  const webView = new WebViewController();
  try {
    await webView.setCustomUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
    const loaded = await webView.loadURL(url);
    if (!loaded) throw new Error("作品详情页加载失败");

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (attempt > 0) await new Promise<void>((resolve) => setTimeout(() => resolve(), 1250));
      const state = await webView.evaluateJavaScript<any>(`
        const text = document.body?.innerText || '';
        const magnets = Array.from(document.querySelectorAll('a[href^="magnet:"]'))
          .map((link) => link.href || link.getAttribute('href') || '')
          .filter(Boolean);
        return {
          challenging: !!document.querySelector('#challenge-running, .main-wrapper') || /安全验证|just a moment|checking your browser/i.test(text),
          ready: document.readyState === 'complete',
          magnet: magnets.find((value) => /[?&]dn=/i.test(value)) || magnets[0] || ''
        };
      `);
      if (state?.challenging) continue;
      if (state?.magnet) return String(state.magnet).replace(/&amp;/g, "&");
      if (state?.ready && attempt >= 7) break;
    }
    throw new Error("该作品页没有提取到磁力链接");
  } finally {
    webView.dispose();
  }
}

function CloseButton({ action }: { action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Image systemName="xmark" frame={{ width: 17, height: 17 }} foregroundStyle="red" font="body" fontWeight="semibold" />
    </Button>
  );
}

function GlassShape({ cornerRadius = 28, fill = GLASS_FILL }: { cornerRadius?: number; fill?: any }) {
  return <RoundedRectangle cornerRadius={cornerRadius} fill={fill as any} stroke={GLASS_STROKE as any} />;
}

function GlassButtonContent({ systemName, title, prominent = false }: { systemName: string; title: string; prominent?: boolean }) {
  return (
    <HStack
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      padding={{ vertical: 13, horizontal: 14 }}
      background={<GlassShape cornerRadius={18} fill={prominent ? "rgba(10,132,255,0.68)" : SUBTLE_GLASS_FILL} />}
      glassEffect={{ glass: UIGlass.clear().interactive().tint(prominent ? "rgba(110,198,255,0.45)" : GLASS_TINT), shape: { type: "rect", cornerRadius: 18 } }}
      shadow={{ color: prominent ? "rgba(10,132,255,0.26)" : "rgba(0,0,0,0.10)", radius: 14, x: 0, y: 8 }}
    >
      <Image systemName={systemName} frame={{ width: 20, height: 20 }} foregroundStyle={prominent ? "white" : BLUE} />
      <Text font={16} fontWeight="semibold" foregroundStyle={prominent ? "white" : "label"}>{title}</Text>
    </HStack>
  );
}

function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text foregroundStyle="secondaryLabel" font={15}>{label}：</Text>
      <Text foregroundStyle="secondaryLabel" font={15} textSelection frame={{ maxWidth: "infinity", alignment: "leading" }}>{String(value)}</Text>
    </HStack>
  );
}

function BlueButton({ title, icon, action }: { title: string; icon: string; action: () => void }) {
  return (
    <Button action={action}>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={22}>{icon}</Text>
        <Text font={18} fontWeight="semibold" foregroundStyle="white">{title}</Text>
      </HStack>
      <Spacer />
    </Button>
  );
}

function ScreenshotPager({ result, index, onChange }: { result: WhatsLinkResponse; index: number; onChange: (n: number) => void }) {
  const shots = result.screenshots ?? [];
  if (shots.length <= 1) return <VStack />;

  return (
    <HStack spacing={8} padding={{ top: 6 }}>
      <Button title="上一张" action={() => onChange(Math.max(0, index - 1))} />
      <Spacer />
      <Text foregroundStyle="secondaryLabel" font={13}>{index + 1} / {shots.length}</Text>
      <Spacer />
      <Button title="下一张" action={() => onChange(Math.min(shots.length - 1, index + 1))} />
    </HStack>
  );
}

function getPreviewHeight(width?: number, height?: number, exportMode = false) {
  if (exportMode) return 206;
  if (!width || !height) return 220;
  const estimatedWidth = 340;
  const ratio = height / width;
  return Math.round(Math.min(380, Math.max(150, estimatedWidth * ratio)));
}

async function loadPreviewHeight(imageUrl?: string, exportMode = false) {
  if (exportMode) return 206;
  if (!imageUrl) return getPreviewHeight(undefined, undefined, exportMode);
  try {
    const image = await UIImage.fromURL(imageUrl);
    return getPreviewHeight(image?.width, image?.height, exportMode);
  } catch {
    return getPreviewHeight(undefined, undefined, exportMode);
  }
}

function PreviewCard({
  result,
  url,
  screenshotSelection,
  onCopyUrl,
  onPreviewImage,
  initialImageHeight,
  exportMode = false,
}: {
  result: WhatsLinkResponse;
  url: string;
  screenshotSelection: Observable<number>;
  onCopyUrl?: () => void;
  onPreviewImage?: (index: number) => void;
  initialImageHeight?: number;
  exportMode?: boolean;
}) {
  const shots = result.screenshots ?? [];
  const screenshotIndex = Math.min(Math.max(screenshotSelection.value, 0), Math.max(0, shots.length - 1));
  const cover = getCover(result, screenshotIndex);
  const title = result.name || "未知资源";
  const titleFont = title.length > 90 ? 17 : title.length > 56 ? 19 : title.length > 32 ? 21 : 23;
  const [imageHeight, setImageHeight] = useState(() => initialImageHeight ?? getPreviewHeight(undefined, undefined, exportMode));

  useEffect(() => {
    if (exportMode) {
      setImageHeight(206);
      return;
    }
    if (!cover) {
      setImageHeight(getPreviewHeight(undefined, undefined, exportMode));
      return;
    }

    let cancelled = false;
    loadPreviewHeight(cover, exportMode).then((height) => {
      if (!cancelled) setImageHeight(height);
    });

    return () => {
      cancelled = true;
    };
  }, [cover, exportMode]);

  return (
    <VStack
      alignment="leading"
      spacing={16}
      padding={exportMode ? 18 : 18}
      frame={exportMode ? { width: 370 } : { maxWidth: "infinity" }}
      background={<GlassShape cornerRadius={30} />}
      glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 30 } }}
      shadow={{ color: "rgba(30,88,160,0.16)", radius: 26, x: 0, y: 16 }}
    >
      {cover ? (
        <ZStack alignment="topTrailing" frame={{ maxWidth: "infinity" }}>
          {exportMode || shots.length <= 1 ? (
            <ZStack
              frame={{ maxWidth: "infinity", height: imageHeight }}
              background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}
              onTapGesture={() => onPreviewImage?.(screenshotIndex)}
            >
              <Image
                imageUrl={cover}
                resizable
                scaleToFit
                frame={{ maxWidth: "infinity", height: imageHeight }}
                clipShape={{ type: "rect", cornerRadius: 20 }}
                placeholder={
                  <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}>
                    <ProgressView />
                  </ZStack>
                }
              />
            </ZStack>
          ) : (
            <TabView
              selection={screenshotSelection}
              tabViewStyle="pageAutomaticDisplayIndex"
              indexViewStyle="pageBackgroundInteractiveDisplay"
              frame={{ maxWidth: "infinity", height: imageHeight }}
            >
              {shots.map((shot, idx) => (
                <ZStack
                  tag={idx}
                  key={`${idx}-${shot.screenshot}`}
                  frame={{ maxWidth: "infinity", height: imageHeight }}
                  background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}
                  onTapGesture={() => onPreviewImage?.(idx)}
                >
                  <Image
                    imageUrl={shot.screenshot}
                    resizable
                    scaleToFit
                    frame={{ maxWidth: "infinity", height: imageHeight }}
                    clipShape={{ type: "rect", cornerRadius: 20 }}
                    placeholder={
                      <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}>
                        <ProgressView />
                      </ZStack>
                    }
                  />
                </ZStack>
              ))}
            </TabView>
          )}
        </ZStack>
      ) : (
        <ZStack
          frame={{ maxWidth: "infinity", height: imageHeight }}
          background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}
          glassEffect={{ glass: UIGlass.clear().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 20 } }}
        >
          <VStack spacing={8}>
            <Image systemName="doc.text.magnifyingglass" resizable frame={{ width: 44, height: 44 }} foregroundStyle={BLUE} />
            <Text foregroundStyle="secondaryLabel">暂无预览图</Text>
          </VStack>
        </ZStack>
      )}

      <Text
        font={titleFont}
        fontWeight="bold"
        allowsTightening
        fixedSize={{ horizontal: false, vertical: true }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        textSelection
      >
        {title}
      </Text>

      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <MetaLine label="大小" value={formatBytes(result.size)} />
        <MetaLine label="文件数量" value={result.count ?? 0} />
        <MetaLine label="文件类型" value={displayFileType(result)} />
      </VStack>

      <Text
        font={14}
        padding={14}
        fixedSize={{ horizontal: false, vertical: true }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        background={<GlassShape cornerRadius={18} fill={INPUT_GLASS_FILL} />}
        glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 18 } }}
        onTapGesture={() => onCopyUrl?.()}
        onLongPressGesture={{ minDuration: 500, perform: () => onCopyUrl?.() }}
      >
        {url}
      </Text>

      {exportMode ? (
        <Text foregroundStyle="secondaryLabel" font={12} frame={{ maxWidth: "infinity", alignment: "center" }}>
          File information by whatslink.info
        </Text>
      ) : null}
    </VStack>
  );
}

function ImagePreviewPage({ screenshots, initialIndex }: { screenshots: WhatsLinkScreenshot[]; initialIndex: number }) {
  const dismiss = Navigation.useDismiss();
  const previewSelection = useObservable(Math.min(Math.max(initialIndex, 0), Math.max(0, screenshots.length - 1)));
  const [baseScale, setBaseScale] = useState(1);
  const [pinchScale, setPinchScale] = useState(1);
  const [scaleAnchor, setScaleAnchor] = useState<any>("center");
  const imageScale = Math.min(4, Math.max(1, baseScale * pinchScale));

  useEffect(() => {
    const resetScale = () => {
      setBaseScale(1);
      setPinchScale(1);
      setScaleAnchor("center");
    };
    previewSelection.subscribe(resetScale);
    return () => previewSelection.unsubscribe(resetScale);
  }, []);

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
      ignoresSafeArea
      onTapGesture={dismiss}
    >
      <TabView
        selection={previewSelection}
        tabViewStyle="pageAutomaticDisplayIndex"
        indexViewStyle="pageBackgroundInteractiveDisplay"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {screenshots.map((shot, idx) => (
          <ZStack
            tag={idx}
            key={`fullscreen-${idx}-${shot.screenshot}`}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            background="black"
            onTapGesture={dismiss}
          >
            <Image
              imageUrl={shot.screenshot}
              resizable
              scaleToFit
              scaleEffect={idx === previewSelection.value ? { x: imageScale, y: imageScale, anchor: scaleAnchor } : 1}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              onTapGesture={dismiss}
              gesture={
                MagnifyGesture()
                  .onChanged((value) => {
                    setScaleAnchor(value.startAnchor);
                    setPinchScale(value.magnification);
                  })
                  .onEnded((value) => {
                    const nextScale = Math.min(4, Math.max(1, baseScale * value.magnification));
                    setBaseScale(nextScale);
                    setPinchScale(1);
                    if (nextScale <= 1) {
                      setScaleAnchor("center");
                    }
                  })
              }
              placeholder={
                <VStack spacing={12} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                  <ProgressView />
                  <Text foregroundStyle="secondaryLabel">正在加载图片…</Text>
                </VStack>
              }
            />
          </ZStack>
        ))}
      </TabView>
    </ZStack>
  );
}

function CodeResultRow({ item, onTap }: { item: CodeSearchItem; onTap: () => void }) {
  return (
    <Button action={onTap} buttonStyle="plain">
      <HStack spacing={12} padding={12} frame={{ maxWidth: "infinity" }} background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />} glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 20 } }}>
        {item.cover ? (
          <Image imageUrl={item.cover} resizable scaleToFill frame={{ width: 112, height: 72 }} clipShape={{ type: "rect", cornerRadius: 14 }} placeholder={<ZStack frame={{ width: 112, height: 72 }}><ProgressView /></ZStack>} />
        ) : (
          <ZStack frame={{ width: 112, height: 72 }} background={<GlassShape cornerRadius={14} fill={INPUT_GLASS_FILL} />}><Image systemName="film" foregroundStyle="secondaryLabel" /></ZStack>
        )}
        <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity" }}>
          <HStack spacing={6}>
            <Text font={12} fontWeight="bold" foregroundStyle={item.source === "JavDB" ? "orange" : BLUE}>{item.source}</Text>
            {item.badge ? <Text font={11} foregroundStyle="secondaryLabel">{item.badge}</Text> : null}
          </HStack>
          <Text font={14} fontWeight="semibold" lineLimit={3} fixedSize={{ horizontal: false, vertical: true }}>{item.title}</Text>
          {item.meta ? <Text font={12} foregroundStyle="secondaryLabel">{item.meta}</Text> : null}
        </VStack>
        <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  );
}

function EmptyState() {
  return (
    <VStack
      spacing={14}
      padding={26}
      frame={{ maxWidth: "infinity" }}
      background={<GlassShape cornerRadius={28} />}
      glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 28 } }}
      shadow={{ color: "rgba(30,88,160,0.12)", radius: 22, x: 0, y: 12 }}
    >
      <ZStack
        frame={{ width: 66, height: 66 }}
        background={<GlassShape cornerRadius={24} fill={{ light: "rgba(10,132,255,0.10)", dark: "rgba(10,132,255,0.18)" }} />}
        glassEffect={{ glass: UIGlass.clear().tint("rgba(110,198,255,0.32)"), shape: { type: "rect", cornerRadius: 24 } }}
      >
        <Image systemName="magnifyingglass" resizable frame={{ width: 34, height: 34 }} foregroundStyle={BLUE} />
      </ZStack>
      <Text font={20} fontWeight="bold">输入链接或番号开始查询</Text>
      <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        粘贴磁力/ED2K 链接自动解析资源信息，输入番号（如 SSIS-001）同时查询 MissAV 与 JavDB。
      </Text>
    </VStack>
  );
}

function FavoriteRow({ item, onOpen, onDelete }: { item: FavoriteItem; onOpen: () => void; onDelete: () => void }) {
  return (
    <HStack
      spacing={12}
      padding={12}
      background={<GlassShape cornerRadius={20} fill={SUBTLE_GLASS_FILL} />}
      glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 20 } }}
    >
      {item.cover ? (
        <Image imageUrl={item.cover} resizable frame={{ width: 68, height: 50 }} clipShape={{ type: "rect", cornerRadius: 14 }} />
      ) : (
        <ZStack frame={{ width: 68, height: 50 }} background={<GlassShape cornerRadius={14} fill={INPUT_GLASS_FILL} />}>
          <Image systemName="doc" foregroundStyle="secondaryLabel" />
        </ZStack>
      )}
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text font={14} fontWeight="semibold" lineLimit={1} truncationMode="middle">{item.name}</Text>
        <Text font={12} foregroundStyle="secondaryLabel">{formatBytes(item.size)} · {item.count} 个文件 · {item.fileType.toUpperCase()}</Text>
      </VStack>
      <Button title="打开" action={onOpen} buttonStyle="glass" />
      <Button title="删除" role="destructive" action={onDelete} buttonStyle="glass" foregroundStyle="red"/>
    </HStack>
  );
}

function MainApp() {
  const dismiss = Navigation.useDismiss();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<WhatsLinkResponse | null>(null);
  const [queriedUrl, setQueriedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [previewImageHeight, setPreviewImageHeight] = useState(() => getPreviewHeight());
  const screenshotSelection = useObservable(0);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [loadingType, setLoadingType] = useState<"link" | "code" | "detail" | null>(null);
  const [codeResults, setCodeResults] = useState<CodeSearchItem[]>([]);
  const [codeWarnings, setCodeWarnings] = useState<string[]>([]);

  useEffect(() => {
    Pasteboard.getString().then((text) => {
      const pasted = extractSupportedLink(text ?? "");
      if (pasted && isSupportedLink(pasted)) setInput(pasted);
    });
  }, []);

  const currentUrl = queriedUrl || extractSupportedLink(input);
  const isFav = favorites.some((item) => item.url === currentUrl);

  const notify = async (message: string, title = "提示") => {
    await Dialog.alert({ title, message });
  };

  const handlePaste = async () => {
    const text = extractSupportedLink((await Pasteboard.getString()) ?? "");
    if (!text) return notify("剪贴板没有文本内容");
    setInput(text);
  };

  const handleQuery = async () => {
    Keyboard.hide();
    const text = normalizeInput(input);
    if (!text) return notify("请先输入链接或番号");

    // Auto-detect: try link first, then code
    const url = extractSupportedLink(text);
    if (url && isSupportedLink(url)) {
      if (url !== input) setInput(url);
      setLoadingType("link");
      setLoading(true);
      setResult(null);
      setCodeResults([]);
      setCodeWarnings([]);
      setPreviewImageHeight(getPreviewHeight());
      screenshotSelection.setValue(0);
      try {
        const data = await queryWhatsLink(url);
        const firstImageHeight = await loadPreviewHeight(getCover(data, 0));
        setPreviewImageHeight(firstImageHeight);
        setResult(data);
        setQueriedUrl(url);
      } catch (error: any) {
        await notify(error?.message ?? String(error), "查询失败");
      } finally {
        setLoading(false);
        setLoadingType(null);
      }
      return;
    }

    if (looksLikeCode(text)) {
      const code = normalizeCode(text);
      if (code !== input) setInput(code);
      setLoadingType("code");
      setLoading(true);
      setResult(null);
      setCodeResults([]);
      setCodeWarnings([]);
      try {
        const { items, warnings } = await queryCode(code);
        setCodeResults(items);
        setCodeWarnings(warnings);
        if (!items.length) await notify(warnings.length ? warnings.join("\n") : "没有查询到相关作品", "查询完成");
      } catch (error: any) {
        await notify(error?.message ?? String(error), "查询失败");
      } finally {
        setLoading(false);
        setLoadingType(null);
      }
      return;
    }

    return notify("未识别到有效链接或番号。\n链接以 magnet:? / ed2k:// / http(s):// 开头\n番号示例：SSIS-001、ABP-123");
  };

  const handleCodeResult = async (item: CodeSearchItem) => {
    setLoadingType("detail");
    setLoading(true);
    setResult(null);
    setPreviewImageHeight(getPreviewHeight());
    screenshotSelection.setValue(0);
    try {
      const magnet = await extractMagnetFromDetail(item.url);
      setInput(magnet);
      const data = await queryWhatsLink(magnet);
      const firstImageHeight = await loadPreviewHeight(getCover(data, 0));
      setPreviewImageHeight(firstImageHeight);
      setQueriedUrl(magnet);
      setResult(data);
      setCodeResults([]);
      setCodeWarnings([]);
    } catch (error: any) {
      await notify(error?.message ?? String(error), "磁力预览失败");
    } finally {
      setLoading(false);
      setLoadingType(null);
    }
  };

  const handleCopy = async () => {
    const url = currentUrl;
    if (!url) return;
    await Pasteboard.setString(url);
    await notify("磁力链接已复制到剪贴板");
  };

  const handleFavorite = async () => {
    if (!result || !currentUrl) return;
    const exists = favorites.some((item) => item.url === currentUrl);
    const next = exists
      ? favorites.filter((item) => item.url !== currentUrl)
      : [
          {
            id: `${Date.now()}`,
            url: currentUrl,
            name: result.name || "未知资源",
            size: result.size ?? 0,
            count: result.count ?? 0,
            type: result.type || "unknown",
            fileType: result.file_type || "unknown",
            cover: getCover(result, screenshotSelection.value),
            createdAt: Date.now(),
          },
          ...favorites,
        ];
    setFavorites(next);
    persistFavorites(next);
    await notify(exists ? "已取消收藏" : "已收藏");
  };

  const handleDownloadAllScreenshots = async () => {
    const shots = result?.screenshots ?? [];
    if (!shots.length) return notify("当前资源没有可下载的预览图");

    setSavingImage(true);
    let savedCount = 0;
    try {
      for (let i = 0; i < shots.length; i += 1) {
        const imageUrl = shots[i]?.screenshot;
        if (!imageUrl) continue;
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`第 ${i + 1} 张预览图下载失败：HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const data = Data.fromArrayBuffer(buffer);
        if (!data) throw new Error(`第 ${i + 1} 张预览图数据无效`);
        const ok = await Photos.savePhoto(data, { fileName: `magnet-preview-${Date.now()}-${i + 1}.jpg` });
        if (!ok) throw new Error(`第 ${i + 1} 张预览图保存失败或权限被拒绝`);
        savedCount += 1;
      }
      await notify(`已保存 ${savedCount} 张预览图到相册`, "下载完成");
    } catch (error: any) {
      await notify(error?.message ?? String(error), "下载失败");
    } finally {
      setSavingImage(false);
    }
  };

  const handlePreviewImage = async (index: number) => {
    const screenshots = result?.screenshots ?? [];
    if (!screenshots.length) return;
    await Navigation.present({
      element: <ImagePreviewPage screenshots={screenshots} initialIndex={index} />,
      modalPresentationStyle: "overFullScreen",
    });
  };

  const handleOpenFavorite = async (item: FavoriteItem) => {
    setInput(item.url);
    setLoadingType("link");
    setLoading(true);
    setResult(null);
    setCodeResults([]);
    setCodeWarnings([]);
    setPreviewImageHeight(getPreviewHeight());
    screenshotSelection.setValue(0);
    try {
      const data = await queryWhatsLink(item.url);
      const firstImageHeight = await loadPreviewHeight(getCover(data, 0));
      setPreviewImageHeight(firstImageHeight);
      setQueriedUrl(item.url);
      setResult(data);
    } catch (error: any) {
      await notify(error?.message ?? String(error), "查询失败");
    } finally {
      setLoading(false);
      setLoadingType(null);
    }
  };

  const handleDeleteFavorite = async (id: string) => {
    const next = favorites.filter((item) => item.id !== id);
    setFavorites(next);
    persistFavorites(next);
  };

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="磁力资源预览"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <CloseButton action={dismiss} /> }}
      >
        <ZStack frame={{ maxWidth: "infinity" }} background={PAGE_BACKGROUND as any}>
          <VStack alignment="leading" spacing={20} padding={18} frame={{ maxWidth: "infinity" }}>
            <VStack
              alignment="leading"
              spacing={14}
              padding={18}
              frame={{ maxWidth: "infinity" }}
              background={<GlassShape cornerRadius={28} />}
              glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 28 } }}
              shadow={{ color: "rgba(30,88,160,0.14)", radius: 24, x: 0, y: 14 }}
            >
              <HStack spacing={8}>
                <Image systemName="magnifyingglass" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
                <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">搜索</Text>
              </HStack>
              <TextField
                title=""
                prompt="粘贴磁力链接或输入番号（如 SSIS-001）"
                axis="vertical"
                value={input}
                onChanged={setInput}
                padding={14}
                background={<GlassShape cornerRadius={18} fill={INPUT_GLASS_FILL} />}
                glassEffect={{ glass: UIGlass.clear().interactive().tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 18 } }}
              />
              <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
                <Button action={handleQuery} buttonStyle="plain">
                  <GlassButtonContent systemName="magnifyingglass" title={loading ? "查询中…" : "查询"} prominent />
                </Button>
              </HStack>
            </VStack>

            {loading ? (
              <VStack
                spacing={14}
                padding={26}
                frame={{ maxWidth: "infinity" }}
                background={<GlassShape cornerRadius={28} />}
                glassEffect={{ glass: UIGlass.clear().interactive(false).tint(GLASS_TINT), shape: { type: "rect", cornerRadius: 28 } }}
                shadow={{ color: "rgba(30,88,160,0.12)", radius: 22, x: 0, y: 12 }}
              >
                <ProgressView />
                <Text foregroundStyle="secondaryLabel">{loadingType === "code" ? "正在查询 MissAV 与 JavDB…" : loadingType === "detail" ? "正在提取磁力并生成预览…" : "正在解析资源信息…"}</Text>
              </VStack>
            ) : codeResults.length > 0 ? (
              <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
                <HStack padding={{ horizontal: 4 }}>
                  <Text font={20} fontWeight="bold">番号结果</Text>
                  <Spacer />
                  <Text font={13} foregroundStyle="secondaryLabel">{codeResults.length} 条</Text>
                </HStack>
                {codeResults.map((item) => (
                  <CodeResultRow key={item.id} item={item} onTap={() => void handleCodeResult(item)} />
                ))}
                {codeWarnings.length > 0 ? (
                  <Text font={12} foregroundStyle="orange" multilineTextAlignment="leading">{codeWarnings.join("\n")}</Text>
                ) : null}
              </VStack>
            ) : result ? (
              <VStack alignment="leading" spacing={14} frame={{ maxWidth: "infinity" }}>
                <PreviewCard
                  key={currentUrl}
                  result={result}
                  url={currentUrl}
                  screenshotSelection={screenshotSelection}
                  initialImageHeight={previewImageHeight}
                  onCopyUrl={() => void handleCopy()}
                  onPreviewImage={(index) => void handlePreviewImage(index)}
                />

                <HStack spacing={14} frame={{ maxWidth: "infinity" }}>
                  <Button action={handleFavorite} buttonStyle="plain">
                    <GlassButtonContent systemName={isFav ? "star.fill" : "star"} title={isFav ? "已收藏" : "收藏"} />
                  </Button>
                  <Button action={handleDownloadAllScreenshots} buttonStyle="plain">
                    <GlassButtonContent systemName="arrow.down.circle" title={savingImage ? "下载中" : "保存预览图"} prominent />
                  </Button>
                </HStack>
              </VStack>
            ) : (
              <EmptyState />
            )}

            {favorites.length > 0 ? (
              <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
                <HStack padding={{ horizontal: 4 }}>
                  <Text font={20} fontWeight="bold">收藏</Text>
                  <Spacer />
                  <Text font={13} foregroundStyle="secondaryLabel">{favorites.length} 条</Text>
                </HStack>
                {favorites.map((item) => (
                  <FavoriteRow
                    key={item.id}
                    item={item}
                    onOpen={() => void handleOpenFavorite(item)}
                    onDelete={() => void handleDeleteFavorite(item.id)}
                  />
                ))}
              </VStack>
            ) : undefined}

            <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
              <Text foregroundStyle="secondaryLabel" font={13}>链接数据 by whatslink.info · 番号数据来自 MissAV 与 JavDB</Text>
              <HStack spacing={16}>
                <Link url="https://whatslink.info/">
                  <Text foregroundStyle={BLUE} font={13}>whatslink</Text>
                </Link>
                <Link url="https://javdb.com">
                  <Text foregroundStyle={BLUE} font={13}>JavDB</Text>
                </Link>
              </HStack>
            </VStack>
          </VStack>
        </ZStack>
      </ScrollView>
    </NavigationStack>
  );
}

async function run() {
  await Navigation.present({ element: <MainApp /> });
  Script.exit();
}

run();
