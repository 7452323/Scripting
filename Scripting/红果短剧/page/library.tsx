import { Button, HStack, Image, ScrollView, Text, VStack, ZStack, useEffect, useMemo, useObservable, useState } from "scripting"
import { repairDrama, seriesExists, type Drama } from "../client"
import { PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { clearHistory, loadFavourites, loadHistory, removeFavourite, removeHistory, replaceFavourite, replaceHistory, type HistoryRecord } from "../storage"
import { DramaRowList } from "./components"
import { DetailPage } from "./detail"

export function LibraryPage({ revision, onLibraryChanged }: { revision: number; onLibraryChanged: () => void }) {
  const [selected, setSelected] = useState<Drama | null>(null), presented = useObservable(false)
  // ⚠️ 以前在 render 里直接读两个 Storage 键并排序：资料库页任意 setState（含「检查失效记录」时每批 4 条刷新进度）
  //    都会重读 + 重建整张表 → 卡。改为 state + 仅在数据版本变化时读。
  const [favourites, setFavourites] = useState<Drama[]>(() => loadFavourites())
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory())
  useEffect(() => {
    setFavourites(loadFavourites())
    setHistory(loadHistory())
  }, [revision])
  const [cleanup, setCleanup] = useState<{ running: boolean; checked: number; total: number; removed: number; note: string }>({ running: false, checked: 0, total: 0, removed: 0, note: "" })

  /**
   * 把收藏 / 历史里**已经打不开**的记录修好或清掉。
   *
   * ⚠️ 老版本把 19 位 id 当 JS 数字解析过（被四舍五入），历史里存的 id 就是坏的；
   * 所以先按剧名回站内**重新定位**（能修就修，把记录接回去），修不了才当成真下架删掉。
   * 检查走的是与详情同样的 `seriesExists`（只有「这个 id 不存在」才判死），
   * 且为**手动**触发，避免网络抖动时误删。
   */
  async function pruneDead() {
    const ids = Array.from(new Set([...loadFavourites().map(item => item.id), ...loadHistory().map(item => item.drama.id)]))
    if (!ids.length) {
      setCleanup({ running: false, checked: 0, total: 0, removed: 0, note: "没有可检查的记录。" })
      return
    }
    const targets = ids.slice(0, 60)
    setCleanup({ running: true, checked: 0, total: targets.length, removed: 0, note: "" })
    const titleOf = (id: string) => favourites.find(item => item.id === id)?.title ?? history.find(item => item.drama.id === id)?.drama.title ?? ""
    let checked = 0, removed = 0, repaired = 0, unknown = 0
    const dead: { id: string; title: string }[] = []
    for (let i = 0; i < targets.length; i += 4) {
      const batch = targets.slice(i, i + 4)
      const results = await Promise.all(batch.map(async id => ({ id, state: await seriesExists(id) })))
      for (const row of results) {
        checked++
        // ⚠️ 只有「确认不存在」才动手；断网 / 超时 / 上游抖动（unknown）一律跳过，绝不删本地数据
        if (row.state !== "missing") { if (row.state === "unknown") unknown++; continue }
        // ⚠️ 先试着重定位（老版本把 19 位 id 存成了四舍五入的数字）：**能修就修，修不了才进待删名单**
        const title = titleOf(row.id)
        const fixed = title ? await repairDrama({ id: row.id, title }) : null
        if (fixed) {
          replaceFavourite(row.id, fixed)
          replaceHistory(row.id, fixed)
          repaired++
        } else {
          dead.push({ id: row.id, title })
        }
      }
      setCleanup({ running: true, checked, total: targets.length, removed, note: "" })
    }

    // ⚠️ 删除是不可逆的，所以要用户确认一次再删（上游抖动时也可能回「服务异常」）
    if (dead.length) {
      const sample = dead.slice(0, 3).map(item => `《${item.title || item.id}》`).join("、")
      const more = dead.length > 3 ? ` 等 ${dead.length} 条` : ""
      const ok = await Dialog.confirm({
        title: `确认清理 ${dead.length} 条记录？`,
        message: `这些在红果上查不到了${sample ? `：${sample}${more}` : ""}。删除后收藏和历史里的这些条目会消失，无法恢复。`,
        confirmLabel: "清理",
        cancelLabel: "先留着",
      })
      if (ok) {
        for (const item of dead) {
          removeFavourite(item.id)
          removeHistory(item.id)
          removed++
        }
      }
    }

    onLibraryChanged()
    const capped = ids.length > targets.length ? "（一次最多检查 60 条，可再点一次继续）" : ""
    const parts: string[] = []
    if (repaired) parts.push(`修正了 ${repaired} 条能重新找到的`)
    if (removed) parts.push(`清掉了 ${removed} 条确认已下架的`)
    else if (dead.length) parts.push(`${dead.length} 条待清理（你选择了先留着）`)
    if (unknown) parts.push(`${unknown} 条因网络问题没查成（已跳过，没动它们）`)
    setCleanup({
      running: false, checked, total: targets.length, removed,
      note: parts.length ? `${parts.join("、")}（共检查 ${checked} 条）${capped}` : `检查了 ${checked} 条，全部正常 ${capped}`,
    })
  }
  function open(drama: Drama) { setSelected(drama); presented.setValue(true) }
  const historySubtitle = useMemo(
    () => new Map(history.map(item => [item.drama.id, `看到第 ${item.index} 集 · ${new Date(item.playedAt).toLocaleDateString()} · ${item.quality}p`])),
    [history],
  )
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="资料库" navigationBarTitleDisplayMode="large"
      navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}>
      <VStack key={String(revision)} spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="收藏" subtitle={`${favourites.length} 部短剧 · 仅保存在本机`} />
          {favourites.length ? <DramaRowList items={favourites} onOpen={open} /> : <StateCard title="暂无收藏" description="在短剧详情页选择收藏后，会直接显示在这里。" systemImage="heart" />}
        </VStack>
        <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="播放历史" subtitle={`${history.length} 条记录 · 按最近播放排序`} />
          {history.length ? <DramaRowList items={history.map(item => item.drama)} subtitle={drama => historySubtitle.get(drama.id)} onOpen={open} /> : <StateCard title="暂无播放记录" description="播放剧集后，最近观看记录会显示在这里。" systemImage="clock.arrow.circlepath" />}
          {history.length ? <Button title="清除播放历史" systemImage="trash" tint="systemRed" frame={{ maxWidth: "infinity", minHeight: 44 }} action={() => { clearHistory(); onLibraryChanged() }} /> : undefined}
          <Button title={cleanup.running ? `正在检查 ${cleanup.checked}/${cleanup.total}…` : "检查失效记录"} systemImage="checkmark.seal"
            disabled={cleanup.running} frame={{ maxWidth: "infinity", minHeight: 44 }} action={() => { void pruneDead() }} />
          {cleanup.note ? <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Image systemName="info.circle" font="footnote" foregroundStyle="secondaryLabel" />
            <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{cleanup.note}</Text>
          </HStack> : undefined}
        </VStack>
      </VStack>
    </ScrollView>
  </ZStack>
}
