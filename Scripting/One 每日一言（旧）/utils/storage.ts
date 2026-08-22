/**
 * 统一存储管理类
 * 通用的存储管理解决方案
 */
export class UnifiedStorage {
  private storageName: string

  constructor(storageName: string) {
    this.storageName = storageName
  }

  private getStorageData(): Record<string, any> {
    try {
      return Storage.get<Record<string, any>>(this.storageName) || {}
    } catch {
      return {}
    }
  }

  private setStorageData(data: Record<string, any>): void {
    try {
      Storage.set(this.storageName, data)
    } catch {
      // silent
    }
  }

  get<T = any>(key: string): T | undefined {
    return this.getStorageData()[key] as T
  }

  set(key: string, value: any): void {
    const data = this.getStorageData()
    data[key] = value
    this.setStorageData(data)
  }

  remove(key: string): void {
    const data = this.getStorageData()
    delete data[key]
    this.setStorageData(data)
  }

  clear(): void {
    this.setStorageData({})
  }
}

export function createStorageManager(storageName: string) {
  const storage = new UnifiedStorage(storageName)
  return { storage }
}
