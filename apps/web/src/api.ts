// Thin typed client for the /v1 API. Same origin, cookie session.

export type Visibility = 'private' | 'unlisted' | 'public'
export type Kind = 'image' | 'gif' | 'video' | 'sticker' | 'file'
export type Status = 'pending' | 'processing' | 'ready' | 'failed'

export interface Asset {
  id: string
  kind: Kind
  status: Status
  error: string | null
  title: string
  filename: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  duration_ms: number | null
  visibility: Visibility
  slug: string
  source: string
  tags: string[]
  collection_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  variants: string[]
  urls: Record<string, string | undefined>
}

export interface Collection {
  id: string
  name: string
  count: number
}

export interface Token {
  id: string
  name: string
  scope: 'upload' | 'full'
  default_visibility: Visibility
  created_at: string
  last_used_at: string | null
}

export interface Me {
  user: { id: string; email: string }
  limits: { max_upload_bytes: number; gif_max_seconds: number; trash_retention_days: number }
  public_url: string
}

export interface Stats {
  assets: number
  trashed: number
  bytes: number
  processing: number
}

export interface AssetFilter {
  trashed?: boolean
  kind?: string
  collection?: string
  tag?: string
  q?: string
}

export interface AssetPage {
  assets: Asset[]
  next_cursor: string | null
}

export interface UploadTicket {
  asset: Asset
  duplicate: boolean
  upload?: { method: string; url: string }
}

export interface NewUpload {
  filename: string
  bytes: number
  sha256?: string
  collection_id?: string | null
  visibility?: Visibility
}

export type AssetPatch = Partial<Pick<Asset, 'title' | 'tags' | 'visibility' | 'kind' | 'collection_id'>>

export type BulkAction =
  | { action: 'trash' | 'restore' | 'purge' }
  | { action: 'collection'; collection_id: string | null }
  | { action: 'visibility'; visibility: Visibility }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'cannot reach the server')
  }
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return data as T
}

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  authConfig: () => request<{ google: boolean; dev: boolean }>('GET', '/v1/auth/config'),
  devLogin: () => request<void>('POST', '/v1/auth/dev'),
  logout: () => request<void>('POST', '/v1/auth/logout'),
  me: () => request<Me>('GET', '/v1/me'),
  stats: () => request<Stats>('GET', '/v1/stats'),

  assets: (f: AssetFilter, cursor?: string) =>
    request<AssetPage>(
      'GET',
      '/v1/assets' +
        query({ trashed: f.trashed ? '1' : undefined, kind: f.kind, collection: f.collection, tag: f.tag, q: f.q, cursor }),
    ),
  asset: (id: string) => request<Asset>('GET', `/v1/assets/${id}`),
  patchAsset: (id: string, patch: AssetPatch) => request<Asset>('PATCH', `/v1/assets/${id}`, patch),
  bulk: (ids: string[], change: BulkAction) => request<{ changed: number }>('POST', '/v1/assets/bulk', { ids, ...change }),

  createUpload: (u: NewUpload) => request<UploadTicket>('POST', '/v1/assets', u),
  completeUpload: (id: string) => request<Asset>('POST', `/v1/assets/${id}/complete`),

  collections: () => request<{ collections: Collection[] }>('GET', '/v1/collections').then((r) => r.collections),
  createCollection: (name: string) => request<Collection>('POST', '/v1/collections', { name }),
  renameCollection: (id: string, name: string) => request<void>('PATCH', `/v1/collections/${id}`, { name }),
  deleteCollection: (id: string) => request<void>('DELETE', `/v1/collections/${id}`),

  tokens: () => request<{ tokens: Token[] }>('GET', '/v1/tokens').then((r) => r.tokens),
  createToken: (name: string, scope: Token['scope'], default_visibility: Visibility) =>
    request<{ token: Token; secret: string }>('POST', '/v1/tokens', { name, scope, default_visibility }),
  deleteToken: (id: string) => request<void>('DELETE', `/v1/tokens/${id}`),
}
