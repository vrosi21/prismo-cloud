// Thin typed client for the /v1 API. Same origin, cookie session.

export type Visibility = 'private' | 'unlisted' | 'public'
export type Kind = 'image' | 'gif' | 'video' | 'sticker' | 'file'
export type Access = 'owner' | 'edit' | 'view'
export type Role = 'view' | 'edit'
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
  /** The folder the file is in; null when it is in none. */
  collection_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  variants: string[]
  urls: Record<string, string | undefined>
  /** What the signed-in person may do with it. */
  access: Access
}

/** A folder. The API calls it a collection. */
export interface Folder {
  id: string
  name: string
  /** null at the top level. */
  parent_id: string | null
  /** Files directly inside, not counting subfolders. */
  count: number
}

export interface Token {
  id: string
  name: string
  scope: 'upload' | 'device' | 'full'
  default_visibility: Visibility
  created_at: string
  last_used_at: string | null
}

export type ItemKind = 'task' | 'event' | 'notebook' | 'board'
export type ItemStatus = 'todo' | 'doing' | 'waiting' | 'done'
export type Repeat = 'daily' | 'weekly' | 'monthly' | 'yearly'

/**
 * Anything written or planned: a task, an event, a notebook, a board. One
 * shape for all of them; the kind says what an item mainly is, the other
 * parts say where else it shows (a day puts it on the calendar, a status
 * makes it a task, a board's card points at it). Days and times are the
 * owner's own wall clock: date 2026-11-12, time 09:30.
 */
export interface Item {
  id: string
  kind: ItemKind
  title: string
  /** The start of the body, for cards and lists. */
  excerpt: string
  /** Markdown; only when one item is read. */
  body?: string
  /** JSON Canvas; boards only, only when one item is read. */
  canvas?: Canvas
  collection_id: string | null
  status: ItemStatus | null
  done_at: string | null
  date: string | null
  time: string | null
  /** Last day of an item that spans several. */
  end_date: string | null
  /** Length of a timed item. */
  minutes: number | null
  repeat: Repeat | null
  /** The last day a repeat may fall on; null: it goes on. */
  repeat_until: string | null
  /** 1..6, the JSON Canvas colours, painted by the theme. */
  color: number | null
  /** Categories: "dsai" is one, "course:mai3" a facet inside it. */
  tags: string[]
  /** Counts changes to the body or canvas. */
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** Only when one item is read: what it links to ("to") and what links to it ("from"). */
  links?: ItemRef[]
}

export interface ItemRef {
  id: string
  kind: ItemKind
  title: string
  status: ItemStatus | null
  dir: 'to' | 'from'
}

/** A change to an item: a field left out stays; null clears it. */
export type ItemChange = Partial<{
  kind: ItemKind
  title: string
  body: string
  canvas: Canvas
  collection_id: string | null
  status: ItemStatus
  date: string | null
  time: string | null
  end_date: string | null
  minutes: number | null
  repeat: Repeat | null
  repeat_until: string | null
  color: number | null
  tags: string[]
  trashed: boolean
  /** The version read; a body or canvas change is refused if it moved on. */
  version: number
}>

export interface ItemQuery {
  /** The calendar: what touches these days (both included). */
  from?: string
  to?: string
  /** With from/to: the tasks with no day too. */
  someday?: boolean
  kind?: string
  collection?: string
  q?: string
  ids?: string[]
  trashed?: boolean
}

// JSON Canvas 1.0 (jsoncanvas.org), the format boards are stored in. A card
// for one of the owner's items is a file node pointing at "item/<id>", a
// picture from the library one pointing at "asset/<id>".
export type CanvasColor = string // "1".."6" or "#rrggbb"
export type Side = 'top' | 'right' | 'bottom' | 'left'
interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
}
export type CanvasNode =
  | (NodeBase & { type: 'text'; text: string })
  | (NodeBase & { type: 'file'; file: string; subpath?: string })
  | (NodeBase & { type: 'link'; url: string })
  | (NodeBase & { type: 'group'; label?: string; background?: string })
export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: 'none' | 'arrow'
  toNode: string
  toSide?: Side
  toEnd?: 'none' | 'arrow'
  color?: CanvasColor
  label?: string
}
export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** A save refused because the text changed elsewhere: what is there now. */
export class ConflictError extends Error {
  item: Item
  constructor(message: string, item: Item) {
    super(message)
    this.item = item
  }
}

export interface Me {
  user: { id: string; email: string }
  /** false for a guest: someone who only reaches what was shared with them. */
  member: boolean
  limits: { max_upload_bytes: number; gif_max_seconds: number; trash_retention_days: number }
  public_url: string
}

export interface Share {
  id: string
  collection_id: string | null
  asset_id: string | null
  email: string
  role: Role
  created_at: string
  /** Link to send to the invited person. */
  invite_url: string
}

/** What gets shared: one folder or one item. */
export type ShareTarget = { collection_id: string } | { asset_id: string }

export interface SharedFolder {
  id: string
  name: string
  role: Role
  owner: string
  count: number
}

export interface SharedItem extends Asset {
  owner: string
}

export interface Invite {
  email: string
  role: Role
  owner: string
  name: string
  collection_id: string | null
  asset_id: string | null
}

export interface Stats {
  assets: number
  trashed: number
  bytes: number
  processing: number
}

export interface AssetFilter {
  trashed?: boolean
  /** One kind, or several joined with commas. */
  kind?: string
  /** A folder id, or "none" for files that are in no folder. Unset: every folder. */
  collection?: string
  tag?: string
  q?: string
  /** Size in bytes, both ends included. */
  min?: string
  max?: string
  /** Added on or after / on or before these days (YYYY-MM-DD). */
  from?: string
  to?: string
  vis?: Visibility
  sort?: AssetSort
}

export type AssetSort = 'old' | 'big' | 'small' | 'name'

/** The filters a listing can take beyond folder, tag and search, as they appear in the URL. */
export const FILTER_KEYS = ['kind', 'min', 'max', 'from', 'to', 'vis', 'sort'] as const

export interface AssetPage {
  assets: Asset[]
  next_cursor: string | null
}

export interface SharedFolderPage extends AssetPage {
  folder: { id: string; name: string; role: Role }
  /** Path from the folder that was shared down to this one. */
  crumbs: { id: string; name: string }[]
  folders: Folder[]
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
  /** A folder path such as "stickers"; created when missing. */
  collection?: string
  visibility?: Visibility
  kind?: 'sticker'
}

export type AssetPatch = Partial<Pick<Asset, 'title' | 'tags' | 'visibility' | 'kind' | 'collection_id'>>

export type BulkAction =
  | { action: 'trash' | 'restore' | 'purge' }
  | { action: 'collection'; collection_id: string | null }
  | { action: 'visibility'; visibility: Visibility }

/** The server takes this many ids in one bulk call. */
export const BULK_LIMIT = 500

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
    const current = (data as { item?: Item } | null)?.item
    if (res.status === 409 && current) throw new ConflictError(message, current)
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

// The instant a day of the viewer's own calendar starts, plus some days.
function localMidnight(day: string, plusDays = 0): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + plusDays).toISOString()
}

const filterParams = (f: AssetFilter) => ({
  trashed: f.trashed ? '1' : undefined,
  kind: f.kind,
  collection: f.collection,
  tag: f.tag,
  q: f.q,
  min: f.min,
  max: f.max,
  from: f.from && localMidnight(f.from),
  to: f.to && localMidnight(f.to, 1),
  vis: f.vis,
  sort: f.sort,
})

export const api = {
  authConfig: () => request<{ google: boolean; dev: boolean }>('GET', '/v1/auth/config'),
  devLogin: () => request<void>('POST', '/v1/auth/dev'),
  invite: (token: string) => request<Invite>('GET', `/v1/invites/${token}`),
  logout: () => request<void>('POST', '/v1/auth/logout'),
  me: () => request<Me>('GET', '/v1/me'),
  stats: () => request<Stats>('GET', '/v1/stats'),

  assets: (f: AssetFilter, cursor?: string) => request<AssetPage>('GET', '/v1/assets' + query({ ...filterParams(f), cursor })),
  /** Ids of everything a filter matches, including what is not loaded yet. */
  assetIds: (f: AssetFilter) => request<{ ids: string[]; truncated: boolean }>('GET', '/v1/assets' + query({ ...filterParams(f), ids: '1' })),
  asset: (id: string) => request<Asset>('GET', `/v1/assets/${id}`),
  patchAsset: (id: string, patch: AssetPatch) => request<Asset>('PATCH', `/v1/assets/${id}`, patch),
  // One item at a time: unlike bulk, this also works on items shared with you for editing.
  trashAsset: (id: string) => request<void>('DELETE', `/v1/assets/${id}`),
  /** At most BULK_LIMIT ids; lib/bulk.ts splits longer lists. */
  bulk: (ids: string[], change: BulkAction) => request<{ changed: number }>('POST', '/v1/assets/bulk', { ids, ...change }),

  createUpload: (u: NewUpload) => request<UploadTicket>('POST', '/v1/assets', u),
  completeUpload: (id: string) => request<Asset>('POST', `/v1/assets/${id}/complete`),

  folders: () => request<{ collections: Folder[] }>('GET', '/v1/collections').then((r) => r.collections),
  createFolder: (name: string, parentId: string | null) => request<Folder>('POST', '/v1/collections', { name, parent_id: parentId }),
  /** parent_id: null moves the folder to the top level. */
  updateFolder: (id: string, change: { name?: string; parent_id?: string | null }) => request<void>('PATCH', `/v1/collections/${id}`, change),
  /** Subfolders go with it. Its files are trashed, or kept and moved up one level. */
  deleteFolder: (id: string, trashFiles: boolean) => request<void>('DELETE', `/v1/collections/${id}` + query({ files: trashFiles ? 'trash' : undefined })),

  shares: (target: ShareTarget) =>
    request<{ shares: Share[] }>(
      'GET',
      '/v1/shares' + query('collection_id' in target ? { collection: target.collection_id } : { asset: target.asset_id }),
    ).then((r) => r.shares),
  createShare: (target: ShareTarget, email: string, role: Role) => request<Share>('POST', '/v1/shares', { ...target, email, role }),
  updateShare: (id: string, role: Role) => request<Share>('PATCH', `/v1/shares/${id}`, { role }),
  deleteShare: (id: string) => request<void>('DELETE', `/v1/shares/${id}`),

  shared: () => request<{ folders: SharedFolder[]; items: SharedItem[] }>('GET', '/v1/shared'),
  sharedFolder: (id: string, f: AssetFilter, cursor?: string) =>
    request<SharedFolderPage>('GET', `/v1/shared/folders/${id}/assets` + query({ kind: f.kind, tag: f.tag, q: f.q, cursor })),

  tokens: () => request<{ tokens: Token[] }>('GET', '/v1/tokens').then((r) => r.tokens),
  createToken: (name: string, scope: Token['scope'], default_visibility: Visibility) =>
    request<{ token: Token; secret: string }>('POST', '/v1/tokens', { name, scope, default_visibility }),
  updateToken: (id: string, change: { name?: string; default_visibility?: Visibility }) => request<Token>('PATCH', `/v1/tokens/${id}`, change),
  deleteToken: (id: string) => request<void>('DELETE', `/v1/tokens/${id}`),

  items: (q: ItemQuery) =>
    request<{ items: Item[] }>(
      'GET',
      '/v1/items' +
        query({
          from: q.from,
          to: q.to,
          someday: q.someday ? '1' : undefined,
          kind: q.kind,
          collection: q.collection,
          q: q.q,
          ids: q.ids?.join(','),
          trashed: q.trashed ? '1' : undefined,
        }),
    ).then((r) => r.items),
  item: (id: string) => request<Item>('GET', `/v1/items/${id}`),
  /** linkFrom: also link the new item from that one (a notebook for a task). */
  createItem: (item: ItemChange & { kind: ItemKind }, linkFrom?: string) => request<Item>('POST', '/v1/items', { ...item, link_from: linkFrom }),
  updateItem: (id: string, change: ItemChange) => request<Item>('PATCH', `/v1/items/${id}`, change),
  trashItem: (id: string) => request<void>('DELETE', `/v1/items/${id}`),
  purgeItem: (id: string) => request<void>('DELETE', `/v1/items/${id}?permanent=1`),
  linkItems: (from: string, to: string) => request<void>('POST', `/v1/items/${from}/links`, { to }),
  unlinkItems: (a: string, b: string) => request<void>('DELETE', `/v1/items/${a}/links/${b}`),
}
