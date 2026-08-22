/**
 * GitHub 上传 - 将文件上传到 GitHub 仓库
 *
 * 使用 GitHub API 直接上传文件到指定仓库。
 * 需先在「设置 → GitHub」中配置 Personal Access Token。
 */

import {
  Button,
  HStack,
  Image,
  Label,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  VStack,
  Divider,
  useState,
  useEffect,
  TabView,
} from 'scripting'

// ── Types ──

interface UploadRecord {
  path: string
  fileName: string
  owner: string
  repo: string
  branch: string
  status: 'success' | 'error'
  message: string
  time: string
}

/** 选中的文件，上传时直接从原始路径读取 */
interface FileItem {
  name: string
  /** 相对于所选文件夹的路径；单文件时就是文件名 */
  relativePath: string
  originalPath: string
  size: number
}

// ── Constants ──

const STORAGE_KEYS = {
  owner: 'github_owner',
  repo: 'github_repo',
  branch: 'github_branch',
  uploadPath: 'github_uploadPath',
  folderName: 'github_folderName',
  commitMessage: 'github_commitMessage',
  history: 'github_uploadHistory',
} as const

// ── Helper ──

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function loadString(key: string, fallback: string): string {
  return Storage.get<string>(key) ?? fallback
}

// ── Main ──

async function run() {
  const availability = GitHub.getAvailability()

  if (!availability.available) {
    if (!availability.tokenConfigured) {
      await alert({
        title: 'GitHub 未配置',
        message: '请在 Settings 中配置 Personal Access Token。\n需要权限：read_profile, read_repos, write_contents',
      })
    } else {
      await alert({
        title: 'GitHub 不可用',
        message: '此功能需要 Scripting PRO。',
      })
    }
    Script.exit()
  }

  const granted = await GitHub.requestPermissions([
    'read_profile',
    'read_repos',
    'write_contents',
  ])

  if (granted.length === 0) {
    await alert({
      title: '权限不足',
      message: '需要授予 read_profile、read_repos、write_contents 权限才能使用上传功能。',
    })
    Script.exit()
  }

  await Navigation.present(<UploadPage />)
  Script.exit()
}

// ── Upload Page ──

function UploadPage() {
  const dismiss = Navigation.useDismiss()
  const [tabIndex, setTabIndex] = useState(0)

  // ── Reactive state ──
  const [owner, setOwner] = useState(loadString(STORAGE_KEYS.owner, ''))
  const [repo, setRepo] = useState(loadString(STORAGE_KEYS.repo, ''))
  const [branch, setBranch] = useState(loadString(STORAGE_KEYS.branch, 'main'))
  const [uploadPath, setUploadPath] = useState(loadString(STORAGE_KEYS.uploadPath, ''))
  const [folderName, setFolderName] = useState(loadString(STORAGE_KEYS.folderName, ''))
  const [commitMsg, setCommitMsg] = useState(loadString(STORAGE_KEYS.commitMessage, 'Upload via Scripting'))
  const [files, setFiles] = useState<FileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadedCount, setUploadedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [resultMessage, setResultMessage] = useState('')
  const [uploadHistory, setUploadHistory] = useState<UploadRecord[]>(Storage.get<UploadRecord[]>(STORAGE_KEYS.history) ?? [])
  const [userInfo, setUserInfo] = useState('')
  const [userAvatar, setUserAvatar] = useState('')
  const [savedToast, setSavedToast] = useState('')

  // ── Load user info ──
  useEffect(() => {
    GitHub.getViewer().then(user => {
      if (user?.login) {
        setUserInfo(user.login)
        setUserAvatar(user.avatar_url || user.avatarUrl || '')
      }
    }).catch(() => {})
  }, [])

  // ── Persist helpers ──
  function saveField(key: string, value: string) {
    Storage.set(key, value)
  }

  function saveSettings() {
    Storage.set(STORAGE_KEYS.owner, owner)
    Storage.set(STORAGE_KEYS.repo, repo)
    Storage.set(STORAGE_KEYS.branch, branch)
    Storage.set(STORAGE_KEYS.uploadPath, uploadPath)
    Storage.set(STORAGE_KEYS.folderName, folderName)
    Storage.set(STORAGE_KEYS.commitMessage, commitMsg)
    setSavedToast('✅ 设置已保存')
  }

  // ── File handlers ──
  async function pickFiles() {
    const paths = await DocumentPicker.pickFiles({
      allowsMultipleSelection: true,
    })
    if (!paths || paths.length === 0) return

    const newItems: FileItem[] = []
    for (const filePath of paths) {
      const data = Data.fromFile(filePath)
      if (data == null) continue
      const name = filePath.split('/').pop() ?? 'unknown'
      newItems.push({ name, relativePath: name, originalPath: filePath, size: data.size })
    }
    setFiles(prev => {
      const existing = new Set(prev.map(item => item.originalPath))
      return [...prev, ...newItems.filter(item => !existing.has(item.originalPath))]
    })
  }

  /** 递归选择整个文件夹，并保留所有子目录层级 */
  async function pickFolder() {
    // 使用目录 Bookmark 版本，确保 Files App 以“选择文件夹”模式打开，
    // 并在读取多层子目录时保持安全访问权限。
    const picked = await DocumentPicker.pickDirectoryBookmark({
      preferredName: `github-upload-${Date.now()}`,
    })
    if (!picked) return
    // 通过 bookmark 解析后的路径读取，避免嵌套目录失去安全访问权限。
    const folderPath = FileManager.bookmarkedPath(picked.bookmarkName) ?? picked.path
    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`
    const newItems: FileItem[] = []

    // 不使用 readDirectory(..., true)：部分 iOS 文件提供程序对递归参数支持不完整，
    // 只会返回顶层内容。这里手动逐层遍历，确保子文件夹中的文件也被加入。
    async function collectFiles(directoryPath: string): Promise<void> {
      const entries = await FileManager.readDirectory(directoryPath)
      for (const entryName of entries) {
        // FileManager.readDirectory 在部分文件提供程序返回的是“当前目录下的名称”，
        // 不是完整路径；必须拼接当前目录，否则子目录判断和读取都会失败。
        const entryPath = entryName.startsWith('/')
          ? entryName
          : `${directoryPath.replace(/\/+$/, '')}/${entryName}`
        if (await FileManager.isDirectory(entryPath)) {
          await collectFiles(entryPath)
          continue
        }
        if (!(await FileManager.isFile(entryPath))) continue
        const data = Data.fromFile(entryPath)
        if (data == null) continue
        const relativePath = entryPath.startsWith(prefix)
          ? entryPath.slice(prefix.length)
          : (entryPath.split('/').pop() ?? 'unknown')
        if (!relativePath) continue
        newItems.push({
          name: entryPath.split('/').pop() ?? relativePath,
          relativePath,
          originalPath: entryPath,
          size: data.size,
        })
      }
    }

    await collectFiles(folderPath)
    if (newItems.length === 0) {
      await alert({ title: '文件夹为空', message: '所选文件夹中没有可读取的文件。' })
      return
    }
    setFiles(prev => {
      const existing = new Set(prev.map(item => item.originalPath))
      return [...prev, ...newItems.filter(item => !existing.has(item.originalPath))]
    })
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  function clearFiles() {
    setFiles([])
  }

  // ── Upload path ──
  function buildDestPath(filePath: string): string {
    const base = uploadPath.trim().replace(/^\/+|\/+$/g, '')
    const folder = folderName.trim().replace(/^\/+|\/+$/g, '')
    return [base, folder, filePath.replace(/^\/+/, '')].filter(Boolean).join('/')
  }

  function buildFolderUrl(): string {
    const path = [uploadPath.trim(), folderName.trim()].filter(Boolean)
      .join('/').replace(/^\/+|\/+$/g, '')
    const encodedPath = path.split('/').filter(Boolean).map(part => encodeURIComponent(part)).join('/')
    const base = `https://github.com/${encodeURIComponent(owner.trim())}/${encodeURIComponent(repo.trim())}/tree/${encodeURIComponent(branch.trim() || 'main')}`
    return encodedPath ? `${base}/${encodedPath}` : base
  }

  // ── Upload ──
  async function doUpload() {
    if (!owner.trim()) {
      await alert({ title: '提示', message: '请填写 GitHub 仓库所有者（Owner）' })
      return
    }
    if (!repo.trim()) {
      await alert({ title: '提示', message: '请填写 GitHub 仓库名称（Repo）' })
      return
    }
    if (files.length === 0) {
      await alert({ title: '提示', message: '请先选择要上传的文件' })
      return
    }

    saveSettings()
    setUploading(true)
    setUploadedCount(0)
    setTotalCount(files.length)
    setUploadProgress('')
    setResultMessage('')

    const results: UploadRecord[] = []
    const successfulIndices = new Set<number>()
    const now = new Date().toLocaleString('zh-CN')
    const branchVal = branch.trim() || undefined

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const destPath = buildDestPath(file.relativePath)

      setUploadProgress(`[${i + 1}/${files.length}] ${file.name} ...`)

      try {
        const content = Data.fromFile(file.originalPath)
        if (content == null) {
          throw new Error('无法读取文件数据')
        }

        let sha: string | undefined
        let action = '🆕 新建'
        try {
          const existing = await GitHub.getContent({
            owner: owner.trim(),
            repo: repo.trim(),
            path: destPath,
            ref: branchVal,
          })
          if (existing && typeof existing === 'object' && !Array.isArray(existing) && 'sha' in existing) {
            sha = existing.sha as string
            action = '🔄 更新'
          }
        } catch { /* 文件不存在 */ }

        await GitHub.putContent({
          owner: owner.trim(),
          repo: repo.trim(),
          path: destPath,
          message: commitMsg.trim() || `Upload ${file.relativePath}`,
          content,
          sha,
          branch: branchVal,
        })

        setUploadedCount(prev => {
          const next = prev + 1
          setUploadProgress(`[${next}/${files.length}] ${action} ${file.relativePath} → ${destPath}`)
          return next
        })

        successfulIndices.add(i)

        results.push({
          path: destPath,
          fileName: file.name,
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
          status: 'success',
          message: `${action} ${destPath}`,
          time: now,
        })
      } catch (e: any) {
        setUploadProgress(`[${i + 1}/${files.length}] ❌ ${file.name} 失败: ${e?.message ?? e}`)
        results.push({
          path: destPath,
          fileName: file.name,
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
          status: 'error',
          message: `❌ ${e?.message ?? String(e)}`,
          time: now,
        })
      }
    }

    const newHistory = [...results, ...uploadHistory].slice(0, 50)
    setUploadHistory(newHistory)
    Storage.set(STORAGE_KEYS.history, newHistory)

    setUploading(false)
    setUploadProgress('')

    const successCount = results.filter(r => r.status === 'success').length
    const failCount = results.filter(r => r.status === 'error').length
    let copiedFolderUrl = ''
    if (successCount > 0) {
      copiedFolderUrl = buildFolderUrl()
      try {
        await Pasteboard.setString(copiedFolderUrl)
        setResultMessage(`✅ 成功: ${successCount}   ❌ 失败: ${failCount}\n🔗 文件夹链接已复制`)
      } catch {
        setResultMessage(`✅ 成功: ${successCount}   ❌ 失败: ${failCount}`)
      }
    } else {
      setResultMessage(`✅ 成功: ${successCount}   ❌ 失败: ${failCount}`)
    }

    if (successfulIndices.size > 0) {
      setFiles(prev => prev.filter((_, i) => !successfulIndices.has(i)))
    }

    await alert({
      title: '上传完成',
      message: `✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个${copiedFolderUrl ? `\n\n文件夹链接已复制到剪贴板：\n${copiedFolderUrl}` : ''}`,
    })
  }

  function clearHistory() {
    setUploadHistory([])
    Storage.set(STORAGE_KEYS.history, [])
  }

  // ── Computed ──
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const exampleDest = files.length > 0
    ? buildDestPath(files[0].relativePath)
    : buildDestPath('example.txt')

  // ── Render ──
  return (
    <NavigationStack>
      <Toolbar>
        <ToolbarItem placement="cancellationAction">
          <Button title="关闭" action={dismiss} />
        </ToolbarItem>
      </Toolbar>
      <TabView tabIndex={tabIndex} onTabIndexChanged={setTabIndex}>
        {/* ═══════ 主页 Tab ═══════ */}
        <List
          tag={0}
          tabItem={<Label title="主页" systemImage="house.fill" />}
          navigationTitle="GitHub 上传"
          navigationBarTitleDisplayMode="inline"
          glassEffect={false}
        >
          {/* 用户信息 */}
          {userInfo ? (
            <Section>
              <HStack spacing={6}>
                {userAvatar ? (
                  <Image
                    imageUrl={userAvatar}
                    resizable scaleToFill
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
                <Text font={14} foregroundStyle="secondaryLabel">
                  {userInfo}
                </Text>
                <Spacer />
              </HStack>
            </Section>
          ) : null}

          {/* 文件选择 */}
          <Section
            header={
              <HStack>
                <Image systemName="doc.badge.plus" foregroundStyle="systemGreen" font={14} />
                <Text fontWeight="semibold">选择文件</Text>
                <Spacer />
                {files.length > 0 ? <Button title="清除全部" action={clearFiles} /> : null}
              </HStack>
            }
          >
            <Section header={<Text fontWeight="semibold">单个或多个文件</Text>}>
              <Button title="选择文件" action={pickFiles} tint="systemBlue" />
            </Section>
            <Section header={<Text fontWeight="semibold">整个文件夹</Text>}>
              <Button title="选择整个文件夹（包含所有子目录）" action={pickFolder} tint="systemGreen" />
              <Text font={12} foregroundStyle="secondaryLabel">会自动读取文件夹内的所有子文件夹和文件</Text>
            </Section>
            {files.length === 0 ? (
              <Text font={12} foregroundStyle="tertiaryLabel">尚未选择文件</Text>
            ) : (
              <VStack>
                {files.map((file, index) => (
                  <HStack key={index} padding={{ vertical: 4 }}>
                    <Image systemName="doc.fill" foregroundStyle="secondaryLabel" font={18} />
                    <VStack>
                      <Text lineLimit={1}>{file.relativePath}</Text>
                      <Text font={12} foregroundStyle="secondaryLabel">{formatSize(file.size)}</Text>
                    </VStack>
                    <Spacer />
                    <Button title="移除" action={() => removeFile(index)} />
                  </HStack>
                ))}
                <Text font={12} foregroundStyle="secondaryLabel" padding={{ top: 2 }}>
                  共 {files.length} 个文件，总计 {formatSize(totalSize)}
                </Text>
              </VStack>
            )}
          </Section>

          {/* 上传 */}
          <Section
            header={
              <HStack>
                <Image systemName="arrow.up.doc.fill" foregroundStyle="systemBlue" font={14} />
                <Text fontWeight="semibold">上传</Text>
              </HStack>
            }
          >
            <Button
              title={uploading ? '上传中...' : '上传到 GitHub'}
              action={doUpload}
              disabled={uploading}
              tint={uploading ? undefined : 'systemBlue'}
            />
            {uploading ? (
              <VStack padding={{ top: 8 }}>
                <ProgressView />
                <Text font={12} foregroundStyle="secondaryLabel">{uploadProgress}</Text>
                <Text font={12} foregroundStyle="secondaryLabel">{uploadedCount} / {totalCount}</Text>
              </VStack>
            ) : null}
            {resultMessage ? (
              <Text font={12} padding={{ top: 4 }}>{resultMessage}</Text>
            ) : null}
          </Section>

          {/* 说明 */}
          <Section
            header={
              <HStack>
                <Image systemName="info.circle" foregroundStyle="secondaryLabel" font={14} />
                <Text fontWeight="semibold">说明</Text>
              </HStack>
            }
          >
            <VStack foregroundStyle="secondaryLabel">
              <Text font={12}>使用 GitHub API 将文件上传到指定仓库。</Text>
              <Text font={12}>1. 在底部 Tab 切换到「设置」填写仓库信息</Text>
              <Text font={12}>2. 选择文件并上传</Text>
              <Text font={12}>3. 同名文件自动更新，新文件自动创建</Text>
              <Text font={12} foregroundStyle="tertiaryLabel">支持所有文件类型，单文件 ≤ 25MB</Text>
            </VStack>
          </Section>
        </List>

        {/* ═══════ 历史 Tab ═══════ */}
        <List
          tag={1}
          tabItem={<Label title="历史" systemImage="clock.arrow.circlepath" />}
          navigationTitle="上传历史"
          navigationBarTitleDisplayMode="inline"
          glassEffect={false}
        >
          {uploadHistory.length === 0 ? (
            <Section>
              <Text font={14} foregroundStyle="tertiaryLabel" padding={{ vertical: 20 }}>
                暂无上传记录
              </Text>
            </Section>
          ) : (
            <Section
              header={
                <HStack>
                  <Image systemName="clock.arrow.circlepath" foregroundStyle="systemIndigo" font={14} />
                  <Text fontWeight="semibold">最近 {uploadHistory.length} 条记录</Text>
                  <Spacer />
                  <Button title="清空" action={clearHistory} />
                </HStack>
              }
            >
              {uploadHistory.slice(0, 20).map((record, index) => {
                const encodedPath = record.path.split('/').map(p => encodeURIComponent(p)).join('/')
                const githubUrl = `https://raw.githubusercontent.com/${record.owner}/${record.repo}/${record.branch || 'main'}/${encodedPath}`
                return (
                  <VStack key={index}>
                    <HStack padding={{ vertical: 2 }}>
                      <Image
                        systemName={record.status === 'success' ? 'checkmark.circle.fill' : 'xmark.circle.fill'}
                        foregroundStyle={record.status === 'success' ? 'systemGreen' : 'systemRed'}
                        font={16}
                      />
                      {record.status === 'success' ? (
                        <Button
                          title={record.fileName}
                          action={() => Safari.present(githubUrl)}
                        />
                      ) : (
                        <Text lineLimit={1}>{record.fileName}</Text>
                      )}
                      <Spacer />
                      <Text font={11} foregroundStyle="tertiaryLabel">{record.time}</Text>
                    </HStack>
                    {record.status === 'error' ? (
                      <Text font={12} foregroundStyle="systemRed">{record.message}</Text>
                    ) : (
                      <HStack padding={{ top: 2 }}>
                        <Text font={11} foregroundStyle="tertiaryLabel">{record.message}</Text>
                        <Spacer />
                        <Text font={11} foregroundStyle="systemBlue">查看 →</Text>
                      </HStack>
                    )}
                    <Divider />
                  </VStack>
                )
              })}
            </Section>
          )}
        </List>

        {/* ═══════ 设置 Tab ═══════ */}
        <List
          tag={2}
          tabItem={<Label title="设置" systemImage="gearshape.fill" />}
          navigationTitle="设置"
          navigationBarTitleDisplayMode="inline"
          glassEffect={false}
        >
          <Section
            header={
              <HStack>
                <Image systemName="tray.full.fill" foregroundStyle="systemBlue" font={14} />
                <Text fontWeight="semibold">仓库配置</Text>
              </HStack>
            }
          >
            <TextField title="Owner" value={owner}
              onChanged={(v) => { setOwner(v); saveField(STORAGE_KEYS.owner, v) }} prompt="GitHub 用户名" />
            <TextField title="Repo" value={repo}
              onChanged={(v) => { setRepo(v); saveField(STORAGE_KEYS.repo, v) }} prompt="仓库名称" />
            <TextField title="Branch" value={branch}
              onChanged={(v) => { setBranch(v); saveField(STORAGE_KEYS.branch, v) }} prompt="分支名，留空默认 main" />
            <TextField title="仓库内路径" value={uploadPath}
              onChanged={(v) => { setUploadPath(v); saveField(STORAGE_KEYS.uploadPath, v) }} prompt="例如 Scripting/" />
          </Section>

          <Section
            header={
              <HStack>
                <Image systemName="folder.badge.plus" foregroundStyle="systemTeal" font={14} />
                <Text fontWeight="semibold">自动创建文件夹</Text>
              </HStack>
            }
          >
            <TextField title="文件夹名称" value={folderName}
              onChanged={(v) => { setFolderName(v); saveField(STORAGE_KEYS.folderName, v) }} prompt="例如 生日、壁纸、备份" />
            {folderName.trim() || uploadPath.trim() ? (
              <HStack padding={{ top: 4 }}>
                <Image systemName="arrow.turn.down.right" foregroundStyle="secondaryLabel" font={12} />
                <Text font={12} foregroundStyle="secondaryLabel">{exampleDest}</Text>
              </HStack>
            ) : null}
          </Section>

          <Section
            header={
              <HStack>
                <Image systemName="pencil.and.list.clipboard" foregroundStyle="systemOrange" font={14} />
                <Text fontWeight="semibold">提交信息</Text>
              </HStack>
            }
          >
            <TextField title="Commit 信息" value={commitMsg}
              onChanged={(v) => { setCommitMsg(v); saveField(STORAGE_KEYS.commitMessage, v) }} prompt="提交说明文字" />
          </Section>

          <Section>
            <Button title="保存设置" action={saveSettings} tint="systemBlue" />
            {savedToast ? (
              <Text font={12} foregroundStyle="secondaryLabel">{savedToast}</Text>
            ) : null}
          </Section>
        </List>
      </TabView>
    </NavigationStack>
  )
}

run()
