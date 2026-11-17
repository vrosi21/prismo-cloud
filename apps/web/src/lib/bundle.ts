import { api, type Canvas, type CanvasNode, type ItemChange, type ItemKind } from '../api'

// A bundle: a file of items to add in one go, for starting a board with real
// content (a course plan, a roadmap) instead of typing it card by card.
//
//   {
//     "prismo": "bundle/1",
//     "items": [
//       { "ref": "mai3", "kind": "notebook", "title": "MAI3", "tags": ["dsai"] },
//       { "ref": "mai3-test2", "kind": "task", "title": "test 2", "date": "2026-11-20" },
//       { "ref": "board", "kind": "board", "title": "DSAI",
//         "canvas": { "nodes": [{ "id": "a", "type": "file", "file": "ref:mai3", ... }], "edges": [] } }
//     ],
//     "links": [["mai3", "mai3-test2"]]
//   }
//
// "ref" names an item inside the file only. A board card points at one with
// "ref:<ref>" and becomes "item/<new id>" when imported. Everything is added
// as new: importing the same file twice makes everything twice.

export type BundleItem = ItemChange & { ref: string; kind: ItemKind }
export interface Bundle {
  prismo: 'bundle/1'
  items: BundleItem[]
  links?: [string, string][]
}

export function readBundle(text: string): Bundle {
  const b = JSON.parse(text) as Bundle
  if (b?.prismo !== 'bundle/1' || !Array.isArray(b.items)) throw new Error('not a Prismo bundle ("prismo": "bundle/1")')
  const refs = new Set<string>()
  for (const it of b.items) {
    if (!it.ref || !it.kind) throw new Error('every item needs a ref and a kind')
    if (refs.has(it.ref)) throw new Error(`ref "${it.ref}" is used twice`)
    refs.add(it.ref)
  }
  for (const [a, z] of b.links ?? []) if (!refs.has(a) || !refs.has(z)) throw new Error(`link ${a} -> ${z} names a ref that is not in the file`)
  return b
}

/**
 * Adds a bundle: the items first, then the boards (their cards now know the
 * new ids), then the links. Returns the new ids of the boards.
 * folder: where items go that do not name a folder themselves.
 */
export async function importBundle(b: Bundle, folder: string | null, progress: (done: number, total: number) => void): Promise<string[]> {
  const ids = new Map<string, string>()
  const total = b.items.length + (b.links?.length ?? 0)
  let done = 0
  const step = () => progress(++done, total)

  const place = (canvas: Canvas): Canvas => ({
    edges: canvas.edges,
    nodes: canvas.nodes.map((n): CanvasNode => {
      if (n.type !== 'file' || !n.file.startsWith('ref:')) return n
      const id = ids.get(n.file.slice(4))
      if (id) return { ...n, file: `item/${id}` }
      const { file: _f, subpath: _s, ...rest } = n
      return { ...rest, type: 'text', text: `missing: ${n.file}` }
    }),
  })

  const boards: string[] = []
  for (const pass of ['things', 'boards'] as const) {
    for (const { ref, ...item } of b.items) {
      if ((item.kind === 'board') !== (pass === 'boards')) continue
      const fields = { ...item, collection_id: item.collection_id === undefined ? folder : item.collection_id }
      if (fields.canvas) fields.canvas = place(fields.canvas)
      const made = await api.createItem(fields)
      ids.set(ref, made.id)
      if (made.kind === 'board') boards.push(made.id)
      step()
    }
  }
  for (const [a, z] of b.links ?? []) {
    await api.linkItems(ids.get(a)!, ids.get(z)!)
    step()
  }
  return boards
}
