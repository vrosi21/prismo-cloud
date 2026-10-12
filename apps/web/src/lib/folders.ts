import type { Folder } from '../api'

// The server sends folders as a flat list with parent ids. Everything that
// needs the tree (sidebar, breadcrumbs, "move to" lists) builds it here.

export interface FolderNode extends Folder {
  children: FolderNode[]
  depth: number
  /** "screenshots / 2026", for lists where the tree is not visible. */
  path: string
}

export interface FolderTree {
  roots: FolderNode[]
  byId: Map<string, FolderNode>
  /** Every folder, parents before their children. */
  flat: FolderNode[]
}

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

export function buildTree(folders: Folder[]): FolderTree {
  const byId = new Map<string, FolderNode>()
  for (const f of folders) byId.set(f.id, { ...f, children: [], depth: 0, path: f.name })
  const roots: FolderNode[] = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const flat: FolderNode[] = []
  const walk = (nodes: FolderNode[], depth: number, prefix: string) => {
    nodes.sort(byName)
    for (const n of nodes) {
      n.depth = depth
      n.path = prefix + n.name
      flat.push(n)
      walk(n.children, depth + 1, n.path + ' / ')
    }
  }
  walk(roots, 0, '')
  return { roots, byId, flat }
}

/** The folders from the top level down to id, id included. */
export function crumbsOf(tree: FolderTree, id: string | null): FolderNode[] {
  const out: FolderNode[] = []
  for (let n = id ? tree.byId.get(id) : undefined; n; n = n.parent_id ? tree.byId.get(n.parent_id) : undefined) out.unshift(n)
  return out
}

/** Is id the folder `ancestor` itself, or somewhere inside it? */
export function isInside(tree: FolderTree, id: string, ancestor: string): boolean {
  for (let n = tree.byId.get(id); n; n = n.parent_id ? tree.byId.get(n.parent_id) : undefined) if (n.id === ancestor) return true
  return false
}
