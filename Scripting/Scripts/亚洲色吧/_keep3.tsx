// ━━━━━━━━━━━━━━ 书库（收藏）━━━━━━━━━━━━━━━

function LibraryView() {
  const ctx = useContext(AppContext)
  const [subTab, setSubTab] = useState<"articles" | "audio">("articles")

  return (
    <NavigationStack>
      <VStack navigationTitle={'书库'} spacing={0}>
        <HStack padding={{ horizontal: 16, vertical: 8 }} spacing={16}>
          <Button action={() => setSubTab("articles")}>
            <Text font={'subheadline'}
              foregroundStyle={subTab === 'articles' ? 'systemBlue' : 'secondaryLabel'}
              fontWeight={subTab === 'articles' ? 'semibold' : 'regular'}>
              文章
            </Text>
          </Button>
          <Button action={() => setSubTab("audio")}>
            <Text font={'subheadline'}
              foregroundStyle={subTab === 'audio' ? 'systemBlue' : 'secondaryLabel'}
              fontWeight={subTab === 'audio' ? 'semibold' : 'regular'}>
              听书
            </Text>
          </Button>
        </HStack>
        <Rectangle frame={{ height: 0.5 }} fill={'separator'} />

        {subTab === 'articles' ? (
          (ctx?.favArticles.length ?? 0) === 0 ? (
            <VStack frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }} spacing={12} alignment={'center'}>
              <Image systemName={'bookmark.slash'} imageScale={'large'}
                foregroundStyle={'tertiaryLabel'} font={'title'} />
              <Text font={'headline'} foregroundStyle={'secondaryLabel'}>还没有收藏文章</Text>
              <Text font={'subheadline'} foregroundStyle={'tertiaryLabel'}>
                在「看书」页面点击书签图标添加收藏
              </Text>
            </VStack>
          ) : (
            <ScrollView>
              <LazyVGrid columns={[
                { size: { type: 'adaptive' as const, min: 90 }, spacing: 12 },
              ]} padding={16} spacing={10}>
                {(ctx?.favArticles ?? []).map(a => {
                  return (
                    <NavigationLink key={a.id} destination={<ArticleReaderView article={a} />}>
                      <VStack alignment={'leading'} spacing={4}>
                        <ZStack
                          frame={{ height: 100 }}
                          background={gradient("linear", {
                            colors: ['#FF9500', '#FF6B35'],
                            startPoint: 'topLeading',
                            endPoint: 'bottomTrailing',
                          })}
                          clipShape={{ type: 'rect', cornerRadius: 8 }}>
                          <VStack alignment={'center'} padding={8}>
                            <Text font={'caption2'} foregroundStyle={'white'} lineLimit={4}>
                              {a.title}
                            </Text>
                          </VStack>
                        </ZStack>
                        <Text font={'caption2'} foregroundStyle={'secondaryLabel'} lineLimit={1}>
                          {a.category || ''}
                        </Text>
                      </VStack>
                    </NavigationLink>
                  )
                })}
              </LazyVGrid>
            </ScrollView>
          )
        ) : (
          (ctx?.favAudio.length ?? 0) === 0 ? (
            <VStack frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }} spacing={12} alignment={'center'}>
              <Image systemName={'heart.slash'} imageScale={'large'}
                foregroundStyle={'tertiaryLabel'} font={'title'} />
              <Text font={'headline'} foregroundStyle={'secondaryLabel'}>还没有收藏听书</Text>
              <Text font={'subheadline'} foregroundStyle={'tertiaryLabel'}>
                在「听书」页面点击 ♡ 添加收藏
              </Text>
            </VStack>
          ) : (
            <List>
              {(ctx?.favAudio ?? []).map(b => (
                <NavigationLink key={b.id} destination={<TrackListView book={b} />}>
                  <HStack padding={{ vertical: 4 }}>
                    <Image systemName={'headphones'} foregroundStyle={'systemBlue'} imageScale={'small'} />
                    <Text font={'subheadline'} lineLimit={1}>{b.title}</Text>
                    <Spacer />
                    <Text font={'caption2'} foregroundStyle={'tertiaryLabel'}>
                      {b.type === 'long' ? '长篇' : '短篇'}
                    </Text>
                  </HStack>
                </NavigationLink>
              ))}
            </List>
          )
        )}
      </VStack>
    </NavigationStack>
  )
}

// ━━━━━━━━━━━━━━ 历史 ━━━━━━━━━━━━━━

function HistoryView() {
  const [subTab, setSubTab] = useState<"reading" | "listening">("reading")
  const [readHistory, setReadHistory] = useState<ReadingHistory[]>(() => loadReadHistory())
  const [listenHistory, setListenHistory] = useState<ListeningHistory[]>(() => loadListenHistory())

  const refresh = useCallback(() => {
    setReadHistory(loadReadHistory())
    setListenHistory(loadListenHistory())
  }, [])

  useEffect(() => { refresh() }, [])
  useEffect(() => {
    const listener = () => refresh()
    _moduleListeners.add(listener)
    return () => { _moduleListeners.delete(listener) }
  }, [])

  const clearAll = () => {
    if (subTab === 'reading') {
      saveReadHistory([])
      setReadHistory([])
    } else {
      saveListenHistory([])
      setListenHistory([])
    }
  }

  const items = subTab === 'reading' ? readHistory : listenHistory

  return (
    <NavigationStack>
      <List navigationTitle={'历史'}
        toolbar={{
          topBarTrailing: items.length > 0 ? (
            <Button action={clearAll}>
              <Image systemName={'trash'} foregroundStyle={'systemRed'} />
            </Button>
          ) : undefined,
        }}>
        <Section>
          <HStack spacing={16}>
            <Button action={() => setSubTab("reading")}>
              <Text font={'subheadline'}
                foregroundStyle={subTab === 'reading' ? 'systemBlue' : 'secondaryLabel'}
                fontWeight={subTab === 'reading' ? 'semibold' : 'regular'}>
                看书
              </Text>
            </Button>
            <Button action={() => setSubTab("listening")}>
              <Text font={'subheadline'}
                foregroundStyle={subTab === 'listening' ? 'systemBlue' : 'secondaryLabel'}
                fontWeight={subTab === 'listening' ? 'semibold' : 'regular'}>
                听书
              </Text>
            </Button>
          </HStack>
        </Section>

        {items.length === 0 ? (
          <VStack frame={{ maxWidth: 'infinity' }} padding={40} spacing={12} alignment={'center'}>
            <Image systemName={'clock.arrow.circlepath'} imageScale={'large'}
              foregroundStyle={'tertiaryLabel'} font={'title'} />
            <Text font={'headline'} foregroundStyle={'secondaryLabel'}>
              {subTab === 'reading' ? '暂无阅读记录' : '暂无收听记录'}
            </Text>
          </VStack>
        ) : subTab === 'reading' ? (
          (items as ReadingHistory[]).map(h => {
            const article: ArticleInfo = {
              id: h.articleId, title: h.articleTitle, category: h.category,
            }
            return (
              <NavigationLink key={h.id} destination={<ArticleReaderView article={article} />}>
                <VStack alignment={'leading'} spacing={2} padding={{ vertical: 4 }}>
                  <Text font={'subheadline'} fontWeight={'medium'} lineLimit={2}>{h.articleTitle}</Text>
                  <HStack spacing={8}>
                    {h.category ? (
                      <Text font={'caption'} foregroundStyle={'systemBlue'}>{h.category}</Text>
                    ) : null}
                    <Text font={'caption2'} foregroundStyle={'tertiaryLabel'}>
                      {new Date(h.timestamp).toLocaleString()}
                    </Text>
                  </HStack>
                </VStack>
              </NavigationLink>
            )
          })
        ) : (
          (items as ListeningHistory[]).map(h => {
            const book: AudioBookInfo = {
              id: h.bookId, title: h.bookTitle, type: 'long',
            }
            return (
              <NavigationLink key={h.id} destination={<TrackListView book={book} />}>
                <HStack spacing={12} padding={{ vertical: 4 }}>
                  <ZStack
                    frame={{ width: 44, height: 44 }}
                    background={gradient("linear", {
                      colors: ['#007AFF', '#5856D6'],
                      startPoint: 'topLeading',
                      endPoint: 'bottomTrailing',
                    })}
                    clipShape={{ type: 'rect', cornerRadius: 8 }}>
                    <Image systemName={'headphones'} foregroundStyle={'white'} imageScale={'small'} />
                  </ZStack>
                  <VStack alignment={'leading'} spacing={2} frame={{ maxWidth: 'infinity' }}>
                    <Text font={'subheadline'} fontWeight={'medium'} lineLimit={1}>{h.bookTitle}</Text>
                    <Text font={'caption'} foregroundStyle={'secondaryLabel'} lineLimit={1}>
                      {h.trackTitle} · {Math.round(h.progress * 100)}%
                    </Text>
                    <Text font={'caption2'} foregroundStyle={'tertiaryLabel'}>
                      {new Date(h.timestamp).toLocaleString()}
                    </Text>
                  </VStack>
                </HStack>
              </NavigationLink>
            )
          })
        )}
      </List>
    </NavigationStack>
  )
}

// ━━━━━━━━━━━━━━ 设置 ━━━━━━━━━━━━━━

function SettingsView() {
  const [fontSize, setFontSizeState] = useState(18)
  const [autoPlayNext, setAutoPlayNext] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const settings = loadJSON(SK.SETTINGS, { fontSize: 18, autoPlayNext: true })
    setFontSizeState(settings.fontSize || 18)
    setAutoPlayNext(settings.autoPlayNext !== false)
  }, [])

  const saveSettings = () => {
    saveJSON(SK.SETTINGS, { fontSize, autoPlayNext })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <NavigationStack>
      <ScrollView>
        <VStack navigationTitle={'设置'} padding={{ horizontal: 16, top: 8, bottom: 32 }} spacing={24}>

          {/* 阅读设置 */}
          <VStack spacing={10}>
            <Text font={'footnote'} fontWeight={'semibold'} foregroundStyle={'secondaryLabel'}
              padding={{ horizontal: 4 }}>
              阅读
            </Text>
            <VStack
              background={'secondarySystemGroupedBackground'}
              clipShape={{ type: 'rect', cornerRadius: 14 }}
              spacing={0}>
              <VStack padding={{ horizontal: 16, vertical: 14 }} spacing={10}>
                <HStack alignment={'center'}>
                  <VStack spacing={2}>
                    <Text font={'body'} fontWeight={'medium'}>默认字体大小</Text>
                    <Text font={'caption2'} foregroundStyle={'tertiaryLabel'}>
                      调整阅读器文字大小
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text font={'body'} fontWeight={'semibold'} foregroundStyle={'systemBlue'}>
                    {fontSize}pt
                  </Text>
                </HStack>
                <Slider min={12} max={28} step={2} value={fontSize} onChanged={v => setFontSizeState(v)} />
              </VStack>
            </VStack>
          </VStack>

          {/* 播放设置 */}
          <VStack spacing={10}>
            <Text font={'footnote'} fontWeight={'semibold'} foregroundStyle={'secondaryLabel'}
              padding={{ horizontal: 4 }}>
              播放
            </Text>
            <VStack
              background={'secondarySystemGroupedBackground'}
              clipShape={{ type: 'rect', cornerRadius: 14 }}
              spacing={0}>
              <HStack padding={{ horizontal: 16, vertical: 13 }} alignment={'center'}>
                <VStack spacing={2}>
                  <Text font={'body'} fontWeight={'medium'}>自动播放下一曲</Text>
                  <Text font={'caption2'} foregroundStyle={'tertiaryLabel'}>
                    一曲结束后自动续播
                  </Text>
                </VStack>
                <Spacer />
                <Toggle title={'自动播放'} value={autoPlayNext} onChanged={setAutoPlayNext} />
              </HStack>
            </VStack>
          </VStack>

          {/* 保存 */}
          <HStack spacing={12}>
            <ZStack
              onTapGesture={saveSettings}
              frame={{ maxWidth: 'infinity', height: 50 }}
              background={saved
                ? gradient("linear", { colors: ['#34C759', '#30D158'], startPoint: 'leading', endPoint: 'trailing' })
                : gradient("linear", { colors: ['#007AFF', '#5856D6'], startPoint: 'leading', endPoint: 'trailing' })}
              clipShape={{ type: 'rect', cornerRadius: 14 }}
              shadow={{ color: saved ? 'systemGreen' : 'systemBlue', radius: 8, y: 4 }}>
              <Text font={'body'} fontWeight={'semibold'} foregroundStyle={'white'}>
                {saved ? '已保存' : '保存设置'}
              </Text>
            </ZStack>
            <ZStack
              onTapGesture={() => Script.exit()}
              frame={{ maxWidth: 'infinity', height: 50 }}
              background={gradient("linear", { colors: ['#FF375F', '#FF453A'], startPoint: 'leading', endPoint: 'trailing' })}
              clipShape={{ type: 'rect', cornerRadius: 14 }}
              shadow={{ color: 'systemRed', radius: 8, y: 4 }}>
              <Text font={'body'} fontWeight={'semibold'} foregroundStyle={'white'}>
                退出
              </Text>
            </ZStack>
          </HStack>

        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// ━━━━━━━━━━━━━━ 主应用 ━━━━━━━━━━━━━━

function App() {
  Navigation.useDismiss()

  const [favArticles, setFavArticles] = useState<ArticleInfo[]>(() => loadFavArticles())
  const [favAudio, setFavAudio] = useState<AudioBookInfo[]>(() => loadFavAudio())

  const toggleFavArticle = useCallback((a: ArticleInfo) => {
    setFavArticles(prev => {
      const idx = prev.findIndex(x => x.id === a.id)
      const next = idx >= 0 ? prev.filter((_, i) => i !== idx) : [a, ...prev]
      saveFavArticles(next)
      return next
    })
  }, [])

  const toggleFavAudio = useCallback((b: AudioBookInfo) => {
    setFavAudio(prev => {
      const idx = prev.findIndex(x => x.id === b.id)
      const next = idx >= 0 ? prev.filter((_, i) => i !== idx) : [b, ...prev]
      saveFavAudio(next)
      return next
    })
  }, [])

  const isFavArticle = useCallback((id: string) => {
    return favArticles.some(a => a.id === id)
  }, [favArticles])

  const isFavAudio = useCallback((id: string) => {
    return favAudio.some(b => b.id === id)
  }, [favAudio])

  const ctx = useMemo(() => ({
    favArticles, favAudio, toggleFavArticle, toggleFavAudio,
    isFavArticle, isFavAudio,
  }), [favArticles, favAudio, toggleFavArticle, toggleFavAudio, isFavArticle, isFavAudio])

  return (
    <AppContext.Provider value={ctx}>
      <TabView>
        <Tab title={"看书"} systemImage={"book.fill"} value={0}>
          <NavigationStack>
            <CategoryGrid onSelect={() => {}} />
          </NavigationStack>
        </Tab>
        <Tab title={"听书"} systemImage={"headphones"} value={1}>
          <ListeningView />
        </Tab>
        <Tab title={"书库"} systemImage={"books.vertical"} value={2}>
          <LibraryView />
        </Tab>
        <Tab title={"历史"} systemImage={"clock"} value={3}>
          <HistoryView />
        </Tab>
        <Tab title={"设置"} systemImage={"gearshape"} value={4}>
          <SettingsView />
        </Tab>
      </TabView>
    </AppContext.Provider>
  )
}

// ━━━━━━━━━━━━━━ 启动 ━━━━━━━━━━━━━━

async function run() {
  await Navigation.present({ element: <App />, modalPresentationStyle: "overFullScreen" })
  Script.exit()
}
run()
