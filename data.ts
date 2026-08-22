import { fetch } from 'scripting'
import type { Repository } from './types'

const API_URL = 'https://api.github.com/users/7452323/repos?per_page=100&sort=updated'

const fallbackRepositories: Repository[] = [
  {
    id: 1023938396,
    name: 'QuantumultX',
    full_name: '7452323/QuantumultX',
    description: 'Quantumult X scripts and modules.',
    html_url: 'https://github.com/7452323/QuantumultX',
    language: 'TypeScript',
    stargazers_count: 11,
    forks_count: 1,
    open_issues_count: 2,
    updated_at: '2026-08-18T15:21:57Z',
    archived: false,
    fork: false
  },
  {
    id: 1245986318,
    name: 'Nexus',
    full_name: '7452323/Nexus',
    description: 'Reverse engineering and security research resources.',
    html_url: 'https://github.com/7452323/Nexus',
    language: 'Markdown',
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    updated_at: '2026-08-08T20:48:18Z',
    archived: false,
    fork: false
  }
]

export async function loadRepositories(): Promise<Repository[]> {
  try {
    const response = await fetch(API_URL, {
      headers: {
        Accept: 'application/vnd.github+json'
      }
    })
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)

    const repositories = await response.json() as Repository[]
    return repositories.filter(repository => !repository.private)
  } catch (error) {
    console.log('Failed to load repositories:', error)
    return fallbackRepositories
  }
}
