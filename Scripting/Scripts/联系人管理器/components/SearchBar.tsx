/**
 * SearchBar - Text input for searching contacts
 * Styled like 番茄下载's search input
 */

import { TextField, Button, Image } from 'scripting'

interface SearchBarProps {
  value: string
  onChanged: (value: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChanged, placeholder = "搜索联系人..." }: SearchBarProps) {
  return (
    <TextField
      title=""
      value={value}
      onChanged={onChanged}
      prompt={placeholder}
      padding={{ horizontal: 12, vertical: 10 }}
      background={{ style: "secondarySystemBackground", shape: { type: "rect" as const, cornerRadius: 10 } }}
      font={14}
      submitLabel="search"
    />
  )
}
