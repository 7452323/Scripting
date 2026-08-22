import {
  fetch, useState, useEffect, useMemo, Navigation,
  HStack, VStack, Text, Button, List, Section,
  TextField, SecureField, NavigationStack, Spacer, Image, Markdown, Editor,
} from "scripting"

// ─── 常量 ───────────────────────────────────────────────────────
export const TOKEN_KEY = "github_gist_token"
export const contentCache = new Map<string, string>()

// ─── Types ─────────────────────────────────────────────────────
export interface GistFile {
  filename: string
  type: string
  language: string | null
  raw_url: string
  size: number
  content?: string
}

export interface Gist {
  id: string
  description: string
  public: boolean
  files: { [filename: string]: GistFile }
  updated_at: string
  html_url: string
}

export interface GitHubUserInfo {
  login: string
  avatar_url: string
}

// ─── API ───────────────────────────────────────────────────────
async function ghAPI(token: string, path: string, opts: any = {}) {
  return fetch(`https://api.github.com${path}`, {
    method: "GET",
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers ?? {}),
    },
  })
}

export async function listGists(token: string): Promise<Gist[]> {
  const r = await ghAPI(token, "/gists")
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`)
  return (await r.json()) as Gist[]
}

export async function fetchGitHubUser(token: string): Promise<GitHubUserInfo | null> {
  try {
    const r = await ghAPI(token, "/user")
    if (!r.ok) return null
    const data = (await r.json()) as GitHubUserInfo
    return data || null
  } catch {
    return null
  }
}

export async function fetchRawContent(rawUrl: string): Promise<string> {
  const r = await fetch(rawUrl)
  if (!r.ok) throw new Error(`获取内容失败: HTTP ${r.status}`)
  return await r.text()
}

// ─── 文件名 → 编辑器扩展 ───────────────────────────────────────
export function filenameToExt(filename: string): "tsx" | "ts" | "jsx" | "js" | "json" | "css" | "html" | "md" | "txt" {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".tsx")) return "tsx"
  if (lower.endsWith(".ts")) return "ts"
  if (lower.endsWith(".jsx")) return "jsx"
  if (lower.endsWith(".js")) return "js"
  if (lower.endsWith(".json")) return "json"
  if (lower.endsWith(".css")) return "css"
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html"
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md"
  return "txt"
}

// ─── Gist 列表行 ───────────────────────────────────────────────
export function GistRow({ gist, onPress }: { gist: Gist, onPress: () => void }) {
  const filename = Object.keys(gist.files)[0] || "未命名"
  const file = gist.files[filename]
  const desc = gist.description || filename
  const date = new Date(gist.updated_at).toLocaleDateString("zh-CN")
  const rawUrl = file?.raw_url || ""
  const htmlUrl = gist.html_url || ""

  return (
    <HStack
      spacing={12}
      padding={{ vertical: 8 }}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button tint="systemBlue" action={async () => {
            await Pasteboard.setString(rawUrl)
          }}>
            <VStack spacing={2}>
              <Image systemName="doc.on.doc" font="body" />
              <Text font="caption" foregroundStyle="tertiaryLabel">RAW</Text>
            </VStack>
          </Button>,
          <Button tint="systemOrange" action={async () => {
            await Pasteboard.setString(htmlUrl)
          }}>
            <VStack spacing={2}>
              <Image systemName="link" font="body" />
              <Text font="caption" foregroundStyle="tertiaryLabel">链接</Text>
            </VStack>
          </Button>,
        ],
      }}
    >
      <Button action={onPress}>
        <VStack>
          <HStack>
            <Text font="body">{desc}</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{date}</Text>
          </HStack>
          <HStack padding={{ top: 2 }}>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              {filename} · {file?.language || "文本"} · {(file?.size || 0) + " 字节"}
            </Text>
          </HStack>
        </VStack>
      </Button>
    </HStack>
  )
}

// ─── 详情/编辑页面 ─────────────────────────────────────────────
export function DetailPage({
  gist, token, isNew,
}: {
  gist?: Gist, token: string, isNew?: boolean
}) {
  const firstFn = gist ? Object.keys(gist.files)[0] : "笔记.md"
  const firstFile = gist?.files[firstFn]
  const isMarkdown = firstFn.endsWith(".md") || firstFn.endsWith(".markdown")

  const [desc, setDesc] = useState(gist?.description || "")
  const [fname, setFname] = useState(firstFn)
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const dismiss = Navigation.useDismiss()

  const editorController = useMemo(() => {
    const existingContent = content
    return new EditorController({
      content: existingContent,
      ext: filenameToExt(firstFn),
      readOnly: false,
    })
  }, [])

  useEffect(() => {
    return () => editorController.dispose()
  }, [editorController])

  useEffect(() => {
    if (editing && editorController.content !== content) {
      editorController.content = content
    }
  }, [editing, content, editorController])

  useEffect(() => {
    if (isNew || !firstFile || !gist) {
      setContent("")
      setLoading(false)
      return
    }
    const cached = contentCache.get(gist.id)
    if (cached !== undefined) {
      setContent(cached)
      editorController.content = cached
      setLoading(false)
      return
    }
    let cancelled = false
    fetchRawContent(firstFile.raw_url)
      .then(text => {
        if (!cancelled) {
          setContent(text)
          editorController.content = text
          contentCache.set(gist.id, text)
        }
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = firstFile.content || ""
          setContent(fallback)
          editorController.content = fallback
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const submit = async () => {
    const currentContent = editorController.content || content
    if (!currentContent.trim()) {
      setError("内容不能为空")
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
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
      } else if (gist) {
        const files: Record<string, { content: string } | null> = {}
        if (fname !== firstFn) files[firstFn] = null
        files[fname] = { content: currentContent }
        const r = await fetch("https://api.github.com/gists/" + gist.id, {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description: desc, files }),
        })
        if (!r.ok) throw new Error("HTTP " + r.status)
        contentCache.delete(gist.id)
      }
      dismiss()
    } catch (e: any) {
      setError(e.message || "保存失败")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!gist) return
    setBusy(true)
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
      dismiss()
    } catch (e: any) {
      setError(e.message || "删除失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={isNew ? "新建 Gist" : "Gist 详情"}
        toolbar={{
          topBarLeading: (
            editing ? (
              <HStack spacing={8}>
                <Button title="关闭" action={dismiss} />
                <Button
                  title="返回"
                  action={() => {
                    editorController.content = content
                    setEditing(false)
                    setError(null)
                  }}
                />
              </HStack>
            ) : (
              <Button title="关闭" action={dismiss} />
            )
          ),
          topBarTrailing: loading ? undefined : (
            editing ? (
              <HStack spacing={8}>
                {!isNew && (
                  <Button
                    title="删除"
                    action={async () => {
                      if (!gist) return
                      const index = await Dialog.actionSheet({
                        title: "确认删除",
                        message: "确定要删除这个 Gist 吗？",
                        actions: [{ label: "删除", destructive: true }],
                      })
                      if (index === 0) {
                        setBusy(true)
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
                          dismiss()
                        } catch (e: any) {
                          setError(e.message || "删除失败")
                        } finally {
                          setBusy(false)
                        }
                      }
                    }}
                    disabled={busy}
                  />
                )}
                <Button
                  title={busy ? "保存中..." : "提交"}
                  action={submit}
                  disabled={busy}
                />
              </HStack>
            ) : (
              <Button title="编辑" action={() => setEditing(true)} />
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
              <TextField
                title=""
                prompt="输入描述"
                value={desc}
                onChanged={(v: string) => setDesc(v)}
              />
            </Section>
            <Section title="文件名">
              <TextField
                title=""
                prompt="文件名"
                value={fname}
                onChanged={(v: string) => setFname(v)}
              />
            </Section>
            <Section
              header={
                <HStack>
                  <Text font="headline">代码编辑</Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="tertiaryLabel">
                    {firstFile?.language || filenameToExt(fname)}
                  </Text>
                </HStack>
              }
              footer={
                <HStack>
                  <Text font="caption" foregroundStyle="tertiaryLabel">
                    共 {editorController.content?.length || 0} 字符
                  </Text>
                  <Spacer />
                </HStack>
              }
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
                <Text font="caption" foregroundStyle="tertiaryLabel">{fname}</Text>
              </HStack>
              <HStack>
                <Text font="caption" foregroundStyle="secondaryLabel">语言</Text>
                <Spacer />
                <Text font="caption" foregroundStyle="tertiaryLabel">{firstFile?.language || "未知"}</Text>
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
                <Markdown
                  content={content}
                  theme="github"
                  useDefaultHighlighterTheme
                />
              ) : content.trim() ? (
                <Text font="caption" foregroundStyle="label">{content}</Text>
              ) : (
                <Text font="caption" foregroundStyle="tertiaryLabel">（文件为空）</Text>
              )}
            </Section>
          </>
        )}
      </List>
    </NavigationStack>
  )
}

// ─── HomeTab（Gist 列表 Tab） ──────────────────────────────────
export function HomeTab({ onClose }: { onClose: () => void }) {
  const [gists, setGists] = useState<Gist[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)

  const loadGists = async () => {
    const token = (Storage.get(TOKEN_KEY) as string) || ""
    if (!token) {
      setError("请先配置 GitHub Token")
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

  const openGist = async (gist: Gist) => {
    const token = (Storage.get(TOKEN_KEY) as string) || ""
    await Navigation.present({
      element: (
        <DetailPage
          gist={gist}
          token={token}
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
  }

  const openCreate = async () => {
    const token = (Storage.get(TOKEN_KEY) as string) || ""
    await Navigation.present({
      element: (
        <DetailPage
          token={token}
          isNew
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
    loadGists()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle=""
        toolbar={{
          topBarLeading: (
            <Button title="关闭" action={onClose} />
          ),
          topBarTrailing: (
            <HStack spacing={8}>
              <Button title="刷新" action={loadGists} />
              <Button title="新建" action={openCreate} />
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
            </HStack>
          </Section>
        ) : null}

        {error ? (
          <Section>
            <VStack padding={16} spacing={8}>
              <Text font="body" foregroundStyle="secondaryLabel">{error}</Text>
              <Text font="caption" foregroundStyle="tertiaryLabel">点击「设置」标签页配置 Token</Text>
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
              <Text font="caption" foregroundStyle="tertiaryLabel">点击右上角「新建」创建</Text>
            </VStack>
          </Section>
        ) : null}

        {!loading && gists.map(g => (
          <Section key={g.id}>
            <GistRow gist={g} onPress={() => openGist(g)} />
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}

// ─── 设置 Tab ─────────────────────────────────────────────────
export function SettingsTab() {
  const existing = (Storage.get(TOKEN_KEY) as string) || ""
  const [token, setToken] = useState(existing)
  const [saved, setSaved] = useState(!!existing)
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSaved(!!Storage.get(TOKEN_KEY))
  }, [token])

  return (
    <NavigationStack>
      <List navigationTitle="设置">
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
                  action={() => {
                    Storage.set(TOKEN_KEY, null)
                    setToken("")
                    setSaved(false)
                  }}
                  buttonStyle="plain"
                  font="subheadline"
                />
              </HStack>
            ) : (
              <>
                <HStack spacing={8}>
                  {showToken ? (
                    <TextField
                      title="Token"
                      prompt="输入 ghp_ 开头的令牌"
                      value={token}
                      onChanged={(v: string) => setToken(v)}
                    />
                  ) : (
                    <SecureField
                      title="Token"
                      prompt="输入 ghp_ 开头的令牌"
                      value={token}
                      onChanged={(v: string) => setToken(v)}
                    />
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
                    title={saving ? "保存中..." : "保存令牌"}
                    action={() => {
                      setSaving(true)
                      Storage.set(TOKEN_KEY, token.trim())
                      setSaved(true)
                      setSaving(false)
                    }}
                    disabled={!token.trim() || saving}
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
    </NavigationStack>
  )
}
