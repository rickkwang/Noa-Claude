import type { ImageAttachment } from "./protocol"

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("noa-agent-drafts", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("images")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function loadImageDraft(key: string): Promise<ImageAttachment[]> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("images").objectStore("images").get(key)
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function saveImageDraft(key: string, images: ImageAttachment[]): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite")
      const store = transaction.objectStore("images")
      if (images.length) store.put(images, key)
      else store.delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteImageDraft(key: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite")
      transaction.objectStore("images").delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
