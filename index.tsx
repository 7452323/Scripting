import {
  Button,
  HStack,
  Label,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Script,
  Section,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState
} from 'scripting'
import { loadRepositories } from './data'
import type { Repository } from './types'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function languageColor(language: string | null) {
  if (language === 'TypeScript') return 'rgba(49, 120, 198, 1)'
  if (language === 'JavaScript') return 'rgba(240, 219, 79, 1)'
  if (language === 'Python') return 'rgba(53, 114, 165, 1)'
  return 'secondaryLabel'
}

function RepositoryDetail({ repository }: { repository: Repository }) {
  return (
    <List
      navigationTitle={repository.name}
      navigationBarTitleDisplayMode="inline"
    >
      <Section header={<Text>{repository.full_name}</Text>}>
        <Text font="body">{repository.description || '暂无仓库描述。'}</Text>
      </Section>
      <Section header={<Text>仓库信息</Text>}>
        <Label title={repository.language || '未标注语言'} systemImage="chevron.left.forwardslash.chevron.right" />
        <Label title={`${repository.stargazers_count} Stars`} systemImage="star" />
        <Label title={`${repository.forks_count} Forks`} systemImage="tuningfork" />
        <Label title={`${repository.open_issues_count} 个 Issue`} systemImage="exclamationmark.circle" />
        <Label title={`更新于 ${formatDate(repository.updated_at)}`} systemImage="calendar" />
      </Section>
      <Section>
        <Button
          title="在 GitHub 中打开"
          systemImage="safari"
          action={() => Safari.present(repository.html_url)}
        />
      </Section>
    </List>
  )
}

function RepositoryRow({ repository }: { repository: Repository }) {
  return (
    <NavigationLink destination={<RepositoryDetail repository={repository} />}>
      <VStack alignment="leading" spacing={5}>
        <HStack spacing={8}>
          <Text font="headline" lineLimit={1}>{repository.name}</Text>
          {repository.archived ? <Label title="已归档" systemImage="archivebox" /> : null}
        </HStack>
        <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2}>
          {repository.description || '暂无描述'}
        </Text>
        <HStack spacing={14} foregroundStyle="secondaryLabel">
          <Label title={repository.language || '未知'} systemImage="circle.fill" tint={languageColor(repository.language)} />
          <Label title={`${repository.stargazers_count}`} systemImage="star" />
          <Label title={formatDate(repository.updated_at)} systemImage="clock" />
        </HStack>
      </VStack>
    </NavigationLink>
  )
}

function LibraryScreen() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [sortMode, setSortMode] = useState<'updated' | 'stars'>('updated')
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    setIsLoading(true)
    const nextRepositories = await loadRepositories()
    setRepositories(nextRepositories)
    setIsLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const visibleRepositories = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = repositories.filter(repository => {
      if (!query) return true
      return [repository.name, repository.description || '', repository.language || '']
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return [...filtered].sort((left, right) => {
      if (sortMode === 'stars') return right.stargazers_count - left.stargazers_count
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    })
  }, [repositories, searchTerm, sortMode])

  return (
    <NavigationStack tint="rgba(10, 132, 255, 1)">
      <List
        navigationTitle="Scripting 脚本库"
        navigationBarTitleDisplayMode="large"
        listStyle="plain"
        searchable={{
          value: searchTerm,
          onChanged: setSearchTerm,
          prompt: '搜索仓库、描述或语言'
        }}
        refreshable={refresh}
        toolbar={
          <Button
            title={sortMode === 'updated' ? '按 Star 排序' : '按更新时间排序'}
            systemImage="arrow.up.arrow.down"
            labelStyle="iconOnly"
            action={() => setSortMode(sortMode === 'updated' ? 'stars' : 'updated')}
          />
        }
      >
        <Section
          header={<Text>{isLoading ? '正在同步 GitHub' : `${visibleRepositories.length} 个公开仓库`}</Text>}
          footer={<Text>数据来源：github.com/7452323</Text>}
        >
          {visibleRepositories.map(repository => (
            <RepositoryRow key={repository.id} repository={repository} />
          ))}
          {!isLoading && visibleRepositories.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">没有匹配的仓库</Text>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({
    element: <LibraryScreen />,
    modalPresentationStyle: 'fullScreen'
  })
  Script.exit()
}

run()
