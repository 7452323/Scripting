import { Dialog, Script, fetch } from 'scripting'

const url = 'https://httpbin.org/json'

async function run() {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const value = await response.json()
    await Dialog.alert('请求成功', JSON.stringify(value, null, 2))
  } catch (error) {
    await Dialog.alert('请求失败', String(error))
  }
  Script.exit()
}

run()
