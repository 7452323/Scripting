import { Dialog, Script } from 'scripting'

async function run() {
  await Dialog.alert('Hello Scripting', '这是一个可以直接运行的最小示例。')
  Script.exit()
}

run()
