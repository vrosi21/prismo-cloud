import { api, ApiError, type Asset, type Visibility } from '../api'
import { errorText, log } from './log'
import { createStore } from './store'

export interface UploadItem {
  id: number
  name: string
  state: 'waiting' | 'checking' | 'sending' | 'done' | 'duplicate' | 'error'
  progress: number // 0..1 while sending
  error?: string
}

export interface UploadOptions {
  collectionId?: string | null
  visibility?: Visibility
  onStored?: (asset: Asset) => void
}

export const uploads = createStore<UploadItem[]>([])

const PARALLEL = 3
// Hashing reads the whole file into memory; above this size it is skipped and
// the server does the duplicate check after upload instead.
const HASH_LIMIT = 256 * 1024 * 1024

let nextId = 1
let running = 0
const queue: Array<() => Promise<void>> = []

function patch(id: number, change: Partial<UploadItem>) {
  uploads.set((items) => items.map((it) => (it.id === id ? { ...it, ...change } : it)))
}

function pump() {
  while (running < PARALLEL && queue.length > 0) {
    const job = queue.shift()!
    running++
    void job().finally(() => {
      running--
      pump()
    })
  }
}

export function clearFinished() {
  uploads.set((items) => items.filter((it) => it.state !== 'done' && it.state !== 'duplicate' && it.state !== 'error'))
}

export function uploadFiles(files: Iterable<File>, opts: UploadOptions = {}) {
  for (const file of files) {
    const id = nextId++
    uploads.set((items) => [...items, { id, name: file.name || 'pasted image', state: 'waiting', progress: 0 }])
    queue.push(() => uploadOne(id, file, opts))
  }
  pump()
}

async function uploadOne(id: number, file: File, opts: UploadOptions) {
  const name = file.name || `pasted-${Date.now()}.png`
  try {
    patch(id, { state: 'checking' })
    const sha256 = await hashFile(file)
    const ticket = await api.createUpload({
      filename: name,
      bytes: file.size,
      sha256,
      collection_id: opts.collectionId ?? undefined,
      visibility: opts.visibility,
    })
    if (ticket.duplicate || !ticket.upload) {
      patch(id, { state: 'duplicate', progress: 1 })
      log('info', `already in the cloud: ${name}`)
      opts.onStored?.(ticket.asset)
      return
    }

    patch(id, { state: 'sending' })
    let asset: Asset
    try {
      // Straight to object storage; the API never touches the bytes.
      await put(ticket.upload.url, file, (p) => patch(id, { progress: p }))
      asset = await api.completeUpload(ticket.asset.id)
    } catch (e) {
      if (e instanceof ApiError) throw e
      // Storage not reachable from this browser (blocked port, CORS):
      // fall back to sending the file through the API.
      asset = await postThroughApi(file, name, opts, (p) => patch(id, { progress: p }))
    }
    patch(id, { state: 'done', progress: 1 })
    log('ok', `wish granted: ${name}`)
    opts.onStored?.(asset)
  } catch (e) {
    patch(id, { state: 'error', error: errorText(e) })
    log('err', `${name}: ${errorText(e)}`)
  }
}

async function hashFile(file: File): Promise<string | undefined> {
  // crypto.subtle only exists on https and localhost.
  if (!globalThis.crypto?.subtle || file.size > HASH_LIMIT) return undefined
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// XMLHttpRequest instead of fetch: it is still the only way to get upload
// progress in every browser.
function send(xhr: XMLHttpRequest, body: Blob | FormData, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new Error('connection lost during upload'))
    xhr.onabort = () => reject(new Error('upload cancelled'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText)
      let message = `upload failed (${xhr.status})`
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message
      } catch {
        /* storage answers in XML; the status code is enough */
      }
      reject(new Error(message))
    }
    xhr.send(body)
  })
}

function put(url: string, file: File, onProgress: (p: number) => void) {
  const xhr = new XMLHttpRequest()
  xhr.open('PUT', url)
  return send(xhr, file, onProgress)
}

async function postThroughApi(file: File, name: string, opts: UploadOptions, onProgress: (p: number) => void) {
  const form = new FormData()
  if (opts.visibility) form.set('visibility', opts.visibility)
  form.set('file', file, name)
  const xhr = new XMLHttpRequest()
  const collection = opts.collectionId ? `?collection_id=${opts.collectionId}` : ''
  xhr.open('POST', `/v1/upload${collection}`)
  const text = await send(xhr, form, onProgress)
  return (JSON.parse(text) as { asset: Asset }).asset
}
