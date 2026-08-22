import {
  useState, useEffect, useMemo, fetch,
  HStack, VStack, Text, Button, List, Section,
  NavigationStack, Spacer, Image, Markdown, Editor, TextField,
} from "scripting"
import {
  Gist, listGists, fetchGitHubUser, fetchRawContent,
  contentCache, filenameToExt, TOKEN_KEY,
} from "./shared"

// ─── 首页默认 UI ──────────────────────────────────────────────
export default function GistHomeDefaultUi() {
  const [gists, setGists] = useState<Gist[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const token = (Storage.get(TOKEN_KEY) as string) || ""

  // 页面切换状态（同一个 NavigationStack 内切换）
  const [page, setPage] = useState<"list" | "detail" | "create" | "settings">("list")
  const [selectedGist, setSelectedGist] = useState<Gist | null>(null)

  const loadGists = async () => {
    if (!token) {
      setError("请先配置 GitHub Token（点击 ⚙️ 设置）")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [userData, data] = await Promise.all([
        fetchGitHubUser(token),
        listGists(token),
      ])
      if (userData) {
        setUsername(userData.login)
        setUserAvatar(userData.avatar_url)
      }
      setGists(data.filter(g => !g.public))
    } catch (e: any) {
      setError(e.message || "加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGists()
  }, [])

  const goToList = () => { setPage("list"); loadGists() }

  return (
    <NavigationStack>
      {renderPage()}
    </NavigationStack>
  )

  function renderPage(): any {
    if (page === "detail" && selectedGist) {
      return (
        <GistDetailView
          gist={selectedGist}
          token={token}
          onBack={goToList}
        />
      )
    }
    if (page === "create") {
      return (
        <CreateGistView
          token={token}
          onBack={goToList}
        />
      )
    }
    if (page === "settings") {
      return (
        <SettingsInlineView
          onBack={goToList}
        />
      )
    }
    /* list */
    return (
      <List
          navigationTitle="Gist"
          toolbar={{
            topBarTrailing: (
              <HStack spacing={8}>
                <Button
                  title=""
                  systemImage="arrow.clockwise"
                  action={loadGists}
                />
                <Button
                  title=""
                  systemImage="plus"
                  action={() => setPage("create")}
                />
              </HStack>
            ),
          }}
        >
          {username ? (
            <Section>
              <HStack spacing={8} padding={{ vertical: 4 }}>
                {userAvatar ? (
                  <Image
                    imageUrl={userAvatar}
                    resizable
                    scaleToFill
                    frame={{ width: 28, height: 28 }}
                    clipShape={{ type: "rect", cornerRadius: 14 }}
                  />
                ) : (
                  <Image
                    systemName="person.circle.fill"
                    foregroundStyle="systemBlue"
                    font="title2"
                  />
                )}
                <Text font={14} foregroundStyle="secondaryLabel">{username}</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="gear"
                  action={() => setPage("settings")}
                  buttonStyle="plain"
                  font="body"
                  foregroundStyle="secondaryLabel"
                />
              </HStack>
            </Section>
          ) : null}

          {error ? (
            <Section>
              <VStack padding={16} spacing={8}>
                <Text font="body" foregroundStyle="secondaryLabel">{error}</Text>
                <Button
                  title="去设置"
                  systemImage="gear"
                  action={() => setPage("settings")}
                />
              </VStack>
            </Section>
          ) : null}

          {loading ? (
            <Section>
              <VStack padding={16}>
                <Text font="body" foregroundStyle="secondaryLabel">加载中...</Text>
              </VStack>
            </Section>
          ) : null}

          {!loading && !error && gists.length === 0 ? (
            <Section>
              <VStack padding={16} spacing={8}>
                <Text font="body" foregroundStyle="secondaryLabel">暂无私密 Gist</Text>
                <Text font="caption" foregroundStyle="tertiaryLabel">点击右上角「+」创建</Text>
              </VStack>
            </Section>
          ) : null}

          {!loading && gists.map(g => (
            <Section key={g.id}>
              <HStack spacing={12} padding={{ vertical: 8 }}>
                <Button action={() => { setSelectedGist(g); setPage("detail") }}>
                  <VStack>
                    <HStack>
                      <Text font="body">{g.description || Object.keys(g.files)[0] || "未命名"}</Text>
                      <Spacer />
                      <Text font="caption" foregroundStyle="secondaryLabel">
                        {new Date(g.updated_at).toLocaleDateString("zh-CN")}
                      </Text>
                    </HStack>
                    <HStack padding={{ top: 2 }}>
                      <Text font="caption" foregroundStyle="tertiaryLabel">
                        {Object.keys(g.files)[0] || "未命名"} · {g.files[Object.keys(g.files)[0]]?.language || "文本"} · {(g.files[Object.keys(g.files)[0]]?.size || 0) + " 字节"}
                      </Text>
                    </HStack>
                  </VStack>
                </Button>
              </HStack>
            </Section>
          ))}
        </List>
    )
  }
}

// ─── Gist 详情（内联） ─────────────────────────────────────────
function GistDetailView({
  gist, token, onBack,
}: {
  gist: Gist, token: string, onBack: () => void
}) {
  const firstFn = Object.keys(gist.files)[0] || "笔记.md"
  const firstFile = gist.files[firstFn]
  const isMarkdown = firstFn.endsWith(".md") || firstFn.endsWith(".markdown")
  const desc = gist.description || firstFn

  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState(desc)
  const [editContent, setEditContent] = useState("")
  const [saving, setSaving] = useState(false)

  const editorController = useMemo(() => {
    return new EditorController({
      content: "",
      ext: filenameToExt(firstFn),
      readOnly: false,
    })
  }, [])

  useEffect(() => {
    return () => editorController.dispose()
  }, [editorController])

  useEffect(() => {
    const cached = contentCache.get(gist.id)
    if (cached !== undefined) {
      setContent(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    fetchRawContent(firstFile?.raw_url || "")
      .then(text => {
        if (!cancelled) {
          setContent(text)
          contentCache.set(gist.id, text)
        }
      })
      .catch(() => {
        if (!cancelled) setContent(firstFile?.content || "")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const enterEdit = () => {
    setEditDesc(desc)
    setEditContent(content)
    editorController.content = content
    setEditing(true)
  }

  const saveGist = async () => {
    const currentContent = editorController.content || editContent
    if (!currentContent.trim()) { setError("内容不能为空"); return }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("https://api.github.com/gists/" + gist.id, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: editDesc, files: { [firstFn]: { content: currentContent } } }),
      })
      if (!r.ok) throw new Error("HTTP " + r.status)
      contentCache.delete(gist.id)
      setContent(currentContent)
      setEditing(false)
    } catch (e: any) {
      setError(e.message || "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const deleteGist = async () => {
    setSaving(true)
    try {
      const r = await fetch("https://api.github.com/gists/" + gist.id, {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
      if (!r.ok) throw new Error("HTTP " + r.status)
      contentCache.delete(gist.id)
      onBack()
    } catch (e: any) {
      setError(e.message || "删除失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <List
      navigationTitle="Gist 详情"
      toolbar={{
        topBarLeading: editing ? (
          <HStack spacing={8}>
            <Button title="返回" action={onBack} />
            <Button title="取消编辑" action={() => { setEditing(false); setError(null) }} />
          </HStack>
        ) : (
          <Button title="返回" action={onBack} />
        ),
        topBarTrailing: loading ? undefined : (
          editing ? (
            <HStack spacing={8}>
              <Button title="删除" action={deleteGist} disabled={saving} />
              <Button title={saving ? "保存中..." : "保存"} action={saveGist} disabled={saving} />
            </HStack>
          ) : (
            <Button title="编辑" action={enterEdit} />
          )
        ),
      }}
    >
      {error ? (
        <Section>
          <Text font="caption" foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : null}

      {loading ? (
        <Section>
          <VStack padding={20}>
            <Text font="body" foregroundStyle="secondaryLabel">加载中...</Text>
          </VStack>
        </Section>
      ) : editing ? (
        <>
          <Section title="描述">
            <TextField title="" prompt="输入描述" value={editDesc} onChanged={(v: string) => setEditDesc(v)} />
          </Section>
          <Section
            header={<Text font="headline">代码编辑</Text>}
            footer={<Text font="caption" foregroundStyle="tertiaryLabel">共 {(editorController.content || editContent).length} 字符</Text>}
          >
            <VStack frame={{ maxWidth: "infinity", minHeight: 400 }}>
              <Editor controller={editorController} />
            </VStack>
          </Section>
        </>
      ) : (
        <>
          <Section title="描述">
            <Text font="body">{desc || "（无描述）"}</Text>
          </Section>
          <Section title="文件信息">
            <HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">文件名</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">{firstFn}</Text>
            </HStack>
            <HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">语言</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">{firstFile?.language || "未知"}</Text>
            </HStack>
            <HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">更新</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">{new Date(gist.updated_at).toLocaleDateString("zh-CN")}</Text>
            </HStack>
            <HStack>
              <Text font="caption" foregroundStyle="secondaryLabel">大小</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">{(firstFile?.size || 0) + " 字节"}</Text>
            </HStack>
          </Section>
          <Section
            header={
              <HStack>
                <Text font="headline">内容预览</Text>
                <Spacer />
                <Text font="caption" foregroundStyle="tertiaryLabel">
                  {isMarkdown ? "Markdown" : (firstFile?.language || "纯文本")}
                </Text>
              </HStack>
            }
          >
            {isMarkdown ? (
              <Markdown content={content} theme="github" useDefaultHighlighterTheme />
            ) : content.trim() ? (
              <Text font="caption" foregroundStyle="label">{content}</Text>
            ) : (
              <Text font="caption" foregroundStyle="tertiaryLabel">（文件为空）</Text>
            )}
          </Section>
        </>
      )}
    </List>
  )
}

// ─── 新建 Gist（内联） ─────────────────────────────────────────
function CreateGistView({
  token, onBack,
}: {
  token: string, onBack: () => void
}) {
  const [desc, setDesc] = useState("")
  const [fname, setFname] = useState("笔记.md")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editorController = useMemo(() => {
    return new EditorController({ content: "", ext: "md", readOnly: false })
  }, [])

  useEffect(() => {
    return () => editorController.dispose()
  }, [editorController])

  const submit = async () => {
    const currentContent = editorController.content || content
    if (!currentContent.trim()) { setError("内容不能为空"); return }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: desc || fname, public: false, files: { [fname]: { content: currentContent } } }),
      })
      if (!r.ok) throw new Error("HTTP " + r.status)
      onBack()
    } catch (e: any) {
      setError(e.message || "创建失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <List
      navigationTitle="新建 Gist"
      toolbar={{
        topBarLeading: <Button title="取消" action={onBack} />,
        topBarTrailing: (
          <Button title={saving ? "创建中..." : "创建"} action={submit} disabled={saving} />
        ),
      }}
    >
      {error ? (
        <Section><Text font="caption" foregroundStyle="systemRed">{error}</Text></Section>
      ) : null}
      <Section title="描述">
        <TextField title="" prompt="输入描述" value={desc} onChanged={(v: string) => setDesc(v)} />
      </Section>
      <Section title="文件名">
        <TextField title="" prompt="文件名（如 笔记.md）" value={fname} onChanged={(v: string) => setFname(v)} />
      </Section>
      <Section
        header={<Text font="headline">代码编辑</Text>}
        footer={<Text font="caption" foregroundStyle="tertiaryLabel">共 {(editorController.content || content).length} 字符</Text>}
      >
        <VStack frame={{ maxWidth: "infinity", minHeight: 400 }}>
          <Editor controller={editorController} />
        </VStack>
      </Section>
    </List>
  )
}

// ─── 设置（内联） ────────────────────────────────────────────────
function SettingsInlineView({
  onBack,
}: {
  onBack: () => void
}) {
  const existing = (Storage.get(TOKEN_KEY) as string) || ""
  const [token, setToken] = useState(existing)
  const [saved, setSaved] = useState(!!existing)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    setSaved(!!Storage.get(TOKEN_KEY))
  }, [token])

  return (
    <List
      navigationTitle="设置"
      toolbar={{
        topBarLeading: <Button title="返回" action={onBack} />,
      }}
    >
      <Section title="GitHub 认证">
        <VStack padding={12} spacing={12} frame={{ maxWidth: "infinity" }}>
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Image
              systemName={saved ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
              foregroundStyle={saved ? "systemGreen" : "systemOrange"}
              font="body"
            />
            <VStack spacing={0}>
              <Text font="body" bold>{saved ? "已连接" : "未配置"}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{saved ? "Token 已保存" : "请输入个人访问令牌"}</Text>
            </VStack>
            <Spacer />
          </HStack>

          {saved ? (
            <HStack spacing={8} padding={{ vertical: 8 }}>
              <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" font="body" />
              <Text font="body" foregroundStyle="systemGreen">Token 已保存 ✓</Text>
              <Spacer />
              <Button
                title="清除 Token"
                action={() => { Storage.set(TOKEN_KEY, null); setToken(""); setSaved(false) }}
                buttonStyle="plain"
                font="subheadline"
              />
            </HStack>
          ) : (
            <>
              <HStack spacing={8}>
                {showToken ? (
                  <TextField title="Token" prompt="输入 ghp_ 开头的令牌" value={token} onChanged={(v: string) => setToken(v)} />
                ) : (
                  <TextField title="Token" prompt="输入 ghp_ 开头的令牌" value={token} onChanged={(v: string) => setToken(v)} />
                )}
                <Button
                  title={showToken ? "🙈" : "👁"}
                  action={() => setShowToken(!showToken)}
                  font="title2"
                  frame={{ width: 36, height: 36 }}
                  buttonStyle="plain"
                />
              </HStack>
              <HStack spacing={8}>
                <Button
                  title="保存令牌"
                  action={() => { Storage.set(TOKEN_KEY, token.trim()); setSaved(true) }}
                  disabled={!token.trim()}
                  frame={{ maxWidth: "infinity" }}
                />
              </HStack>
            </>
          )}
        </VStack>
      </Section>

      <Section header={<Text font="subheadline" foregroundStyle="secondaryLabel">使用指南</Text>}>
        {[
          "访问 github.com/settings/tokens",
          "点击 Generate new token (classic)",
          "勾选 gist 权限",
          "粘贴令牌并点击保存",
        ].map((step, i) => (
          <HStack spacing={10} padding={{ vertical: 6 }} key={i}>
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ width: 22, height: 22 }}>{String(i + 1)}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{step}</Text>
            <Spacer />
          </HStack>
        ))}
      </Section>

      <Section footer={<Text font="caption" foregroundStyle="tertiaryLabel">令牌仅保存在本地设备，不会上传到任何服务器</Text>}>
        <HStack>
          <VStack spacing={2}>
            <Text font="body" fontWeight="semibold">Gist 客户端</Text>
            <Text font="caption" foregroundStyle="tertiaryLabel">© 2026</Text>
          </VStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">v2.0.0</Text>
        </HStack>
      </Section>
    </List>
  )
}
