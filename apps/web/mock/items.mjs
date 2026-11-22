// Items for the mock API: tasks, events, notebooks, boards. The same rules as
// the real server (apps/api/internal/api/items.go), kept short.

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function itemRoutes({ uuid, body, collections }) {
  const items = []
  const links = [] // { from, to }
  const now = () => new Date().toISOString()

  function make(fields) {
    const it = {
      id: uuid(),
      kind: 'task',
      title: '',
      body: '',
      canvas: undefined,
      collection_id: null,
      status: null,
      done_at: null,
      date: null,
      time: null,
      end_date: null,
      minutes: null,
      repeat: null,
      repeat_until: null,
      color: null,
      tags: [],
      exceptions: {},
      version: 1,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
      ...fields,
    }
    const msg = settle(it, fields)
    if (msg) throw new Error(msg)
    items.push(it)
    return it
  }

  // What follows from what, then is it valid. Mirrors itemRequest.apply.
  function settle(it, req) {
    if (!it.repeat && req.repeat_until) return 'an end of the repeat needs a repeat'
    if (!it.repeat && req.exceptions && Object.keys(req.exceptions).length) return 'changing one of a repeat needs a repeat'
    if (it.date === null && (req.time || req.end_date || req.repeat)) return 'a time, a last day or a repeat needs a day'
    if (it.time === null && req.minutes) return 'a length needs a time'
    if (it.kind === 'task' && !it.status) it.status = 'todo'
    if (it.kind !== 'task') it.status = null
    if (it.kind === 'board' && !it.canvas) it.canvas = { nodes: [], edges: [] }
    if (it.kind !== 'board') it.canvas = undefined
    if (!it.date) Object.assign(it, { time: null, end_date: null, repeat: null })
    if (!it.time) it.minutes = null
    if (!it.repeat) Object.assign(it, { repeat_until: null, exceptions: {} })
    if (req.tags) it.tags = [...new Set(req.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
    if (it.end_date && it.end_date === it.date) it.end_date = null
    if (it.status === 'done' && it.repeat && it.date) {
      const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
      const from = new Date(`${it.date}T12:00:00`)
      const today = iso(new Date())
      // The n-th step, on to the first day not past (a late tick skips what went by).
      let d = from
      for (let n = 1; n < 40000; n++) {
        d = new Date(from)
        if (it.repeat === 'daily') d.setDate(d.getDate() + n)
        if (it.repeat === 'weekly') d.setDate(d.getDate() + 7 * n)
        if (it.repeat === 'monthly') d.setMonth(d.getMonth() + n)
        if (it.repeat === 'yearly') d.setFullYear(d.getFullYear() + n)
        if ((it.repeat === 'monthly' || it.repeat === 'yearly') && d.getDate() !== from.getDate()) continue
        if (iso(d) >= today) break
      }
      const shift = Math.round((d - from) / 86_400_000)
      if (it.repeat_until && iso(d) > it.repeat_until) {
        it.done_at = it.done_at ?? now()
        return ''
      }
      it.date = iso(d)
      it.exceptions = Object.fromEntries(Object.entries(it.exceptions ?? {}).filter(([k]) => k >= it.date))
      if (it.end_date) {
        const e = new Date(`${it.end_date}T12:00:00`)
        e.setDate(e.getDate() + shift)
        it.end_date = iso(e)
      }
      it.status = 'todo'
    }
    it.done_at = it.status === 'done' ? (it.done_at ?? now()) : null
    if ((it.kind === 'task' || it.kind === 'event') && !it.title.trim()) return `a ${it.kind} needs a title`
    if (it.kind === 'event' && !it.date) return 'an event needs a day'
    if (it.end_date && it.end_date < it.date) return 'the last day is before the first'
    return ''
  }

  const brief = (it) => {
    const { body: text, canvas, ...rest } = it
    return { ...rest, excerpt: text.slice(0, 280) }
  }
  const full = (it) => ({
    ...brief(it),
    body: it.body,
    canvas: it.canvas,
    links: links
      .filter((l) => l.from === it.id || l.to === it.id)
      .map((l) => (l.from === it.id ? { id: l.to, dir: 'to' } : { id: l.from, dir: 'from' }))
      .map(({ id, dir }) => ({ o: items.find((x) => x.id === id), dir }))
      .filter(({ o }) => o && !o.deleted_at)
      .map(({ o, dir }) => ({ id: o.id, kind: o.kind, title: o.title, status: o.status, dir })),
  })

  // --- something to look at ---
  const dentist = make({ kind: 'task', title: 'dentist', date: day(3), time: '09:30', minutes: 45, color: 1 })
  make({ kind: 'task', title: 'back up the server', date: day(0), time: '20:00', minutes: 30 })
  make({ kind: 'task', title: 'sort the screenshots from october', date: day(0) })
  make({ kind: 'task', title: 'reply to the invite', date: day(-1), status: 'done' })
  make({ kind: 'task', title: 'make stickers from the trip photos', date: day(9), status: 'doing' })
  make({ kind: 'task', title: 'try the time wall on the phone' })
  make({ kind: 'task', title: 'pick a new hotkey for the picker', status: 'waiting' })
  make({ kind: 'event', title: 'standup', date: day(-14), time: '10:00', minutes: 15, repeat: 'weekly', color: 5 })
  make({ kind: 'event', title: 'lunch with mia', date: day(1), time: '12:30', minutes: 90, color: 4 })
  make({ kind: 'event', title: 'focus block', date: day(1), time: '13:00', minutes: 120, color: 6 })
  make({ kind: 'event', title: 'trip to the coast', date: day(12), end_date: day(15), color: 3 })
  // Calendars: a few items in categories, so the calendar's groups and
  // colours by tag have something to show.
  make({ kind: 'task', title: 'mai3 midterm', date: day(2), time: '10:00', minutes: 90, tags: ['dsai', 'course:mai3', 'type:exam'] })
  make({ kind: 'event', title: 'rf lab', date: day(-7), time: '14:00', minutes: 120, repeat: 'weekly', tags: ['dsai', 'course:rf', 'type:lab'] })
  make({ kind: 'task', title: 'rl project report', date: day(5), tags: ['dsai', 'course:rl', 'type:deadline'] })
  make({ kind: 'event', title: 'haircut', date: day(4), time: '17:00', minutes: 30, tags: ['personal', 'type:appointment'] })
  make({ kind: 'task', title: 'buy printer ink', date: day(1), tags: ['personal', 'type:errand'] })
  make({ kind: 'task', title: 'prismo: phone layout', date: day(2), tags: ['prismo', 'area:web'], collection_id: collections[0].id })
  const notes = make({
    kind: 'notebook',
    title: 'dentist questions',
    collection_id: collections[0].id,
    body: '# Questions\n\n- does the crown need **replacing**?\n- cost: $c = n \\cdot p$\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n- [ ] bring the insurance card\n- [x] book the day off\n',
  })
  links.push({ from: dentist.id, to: notes.id })
  make({ kind: 'notebook', title: 'ideas for the lookout', body: 'boards for **roadmaps**, notebooks with $\\LaTeX$.' })
  const t1 = make({ kind: 'task', title: 'survey and export', status: 'done' })
  const t2 = make({ kind: 'task', title: 'import the core data', status: 'doing' })
  const t3 = make({ kind: 'task', title: 'wait for the admin', status: 'waiting' })
  const t4 = make({ kind: 'task', title: 'go live', date: day(20) })
  make({
    kind: 'board',
    title: 'migration roadmap',
    canvas: {
      nodes: [
        { id: 'lane1', type: 'group', label: 'data', x: -40, y: -60, width: 980, height: 260 },
        { id: 'a', type: 'file', file: `item/${t1.id}`, x: 0, y: 0, width: 220, height: 110 },
        { id: 'b', type: 'file', file: `item/${t2.id}`, x: 300, y: 0, width: 220, height: 110 },
        { id: 'c', type: 'file', file: `item/${t3.id}`, x: 300, y: 300, width: 220, height: 110 },
        { id: 'd', type: 'file', file: `item/${t4.id}`, x: 640, y: 120, width: 220, height: 110 },
        { id: 'n', type: 'text', text: 'old production stays **read-only** for a month', x: 0, y: 300, width: 240, height: 120, color: '3' },
      ],
      edges: [
        { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', toEnd: 'arrow' },
        { id: 'e2', fromNode: 'b', fromSide: 'right', toNode: 'd', toSide: 'left', toEnd: 'arrow' },
        { id: 'e3', fromNode: 'c', fromSide: 'right', toNode: 'd', toSide: 'left', toEnd: 'arrow', label: 'blocks' },
      ],
    },
  })

  const find = (id) => items.find((x) => x.id === id)

  // The ledger, as Claude sessions would have filled it.
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
  const ledger = [
    { id: uuid(), at: ago(3), who: 'prismo secretary', kind: 'note', message: 'moved the dentist to thursday and pinned it under "this week", as asked.', items: [dentist.id] },
    { id: uuid(), at: ago(4), who: 'prismo secretary', kind: 'change', message: 'changed task "dentist": day, pinned in this week', items: [dentist.id] },
    { id: uuid(), at: ago(95), who: 'dsai-schedule', kind: 'note', message: 'added the rf midterm and the mai3 test 3 date from the course page.', items: [] },
    { id: uuid(), at: ago(96), who: 'dsai-schedule', kind: 'change', message: 'made task "rf midterm" on 2026-12-01', items: [] },
    { id: uuid(), at: ago(97), who: 'dsai-schedule', kind: 'change', message: 'changed task "mai3 test 3": day 2026-12-11', items: [] },
  ]

  // Calendars' settings (the real ones are in the calendars table).
  const calendars = new Map([
    ['*', { tag: '*', name: '', color: null, group: 'me', tag_colors: { 'type:exam': 1, 'type:deadline': 2, 'type:lab': 5, 'type:appointment': 6, 'type:errand': 3 }, updated_at: now() }],
    ['dsai', { tag: 'dsai', name: 'DSAI', color: 5, group: 'study', tag_colors: {}, updated_at: now() }],
    ['personal', { tag: 'personal', name: 'Personal', color: 4, group: 'me', tag_colors: {}, updated_at: now() }],
    ['prismo', { tag: 'prismo', name: 'Prismo', color: 6, group: 'projects', tag_colors: {}, updated_at: now() }],
  ])

  return [
    ['GET', /^\/v1\/calendars$/, () => [200, { calendars: [...calendars.values()] }]],
    ['PUT', /^\/v1\/calendars\/([^/]+)$/, async (req, m) => {
      const tag = decodeURIComponent(m[1])
      const b = await body(req)
      const c = { tag, name: b.name ?? '', color: b.color ?? null, group: b.group || 'me', tag_colors: b.tag_colors ?? {}, updated_at: now() }
      calendars.set(tag, c)
      return [200, c]
    }],
    ['DELETE', /^\/v1\/calendars\/([^/]+)$/, (req, m) => {
      calendars.delete(decodeURIComponent(m[1]))
      return [204]
    }],
    ['GET', /^\/v1\/ledger$/, (req, m, q) => [200, { entries: ledger.filter((e) => !q.get('who') || e.who === q.get('who')) }]],
    ['POST', /^\/v1\/ledger$/, async (req) => {
      const b = await body(req)
      ledger.unshift({ id: uuid(), at: new Date().toISOString(), who: b.who || 'you', kind: 'note', message: b.message, items: b.items ?? [] })
      return [204]
    }],
    ['GET', /^\/v1\/items$/, (req, m, q) => {
      const from = q.get('from')
      const to = q.get('to')
      const fresh = Date.now() - 14 * 86_400_000
      let list = items.filter((it) => Boolean(it.deleted_at) === (q.get('trashed') === '1'))
      if (from) {
        list = list.filter(
          (it) =>
            (it.date && it.date <= to && (it.end_date ?? it.date) >= from) ||
            (it.repeat && it.date <= to) ||
            (q.get('someday') === '1' && it.kind === 'task' && !it.date && (!it.done_at || Date.parse(it.done_at) > fresh)),
        )
        const order = (t) => `${t.date ?? '9999'} ${t.time ?? '00:00'} ${t.created_at}`
        list.sort((a, b) => order(a).localeCompare(order(b)))
      } else {
        list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      }
      if (q.get('kind')) list = list.filter((it) => q.get('kind').split(',').includes(it.kind))
      if (q.get('collection') === 'none') list = list.filter((it) => !it.collection_id)
      else if (q.get('collection')) list = list.filter((it) => it.collection_id === q.get('collection'))
      if (q.get('q')) list = list.filter((it) => (it.title + it.body).toLowerCase().includes(q.get('q').toLowerCase()))
      if (q.get('ids')) list = list.filter((it) => q.get('ids').split(',').includes(it.id))
      return [200, { items: list.map(brief) }]
    }],
    ['GET', /^\/v1\/items\/([^/]+)$/, (req, m) => {
      const it = find(m[1])
      return it ? [200, full(it)] : [404, { error: 'not found' }]
    }],
    ['POST', /^\/v1\/items$/, async (req) => {
      const { link_from, ...fields } = await body(req)
      try {
        const it = make(fields)
        if (link_from) links.push({ from: link_from, to: it.id })
        return [201, full(it)]
      } catch (e) {
        return [400, { error: e.message }]
      }
    }],
    ['PATCH', /^\/v1\/items\/([^/]+)$/, async (req, m) => {
      const it = find(m[1])
      if (!it) return [404, { error: 'not found' }]
      const { version, trashed, ...change } = await body(req)
      if (('body' in change && change.body !== it.body) || ('canvas' in change && JSON.stringify(change.canvas) !== JSON.stringify(it.canvas))) {
        if (version && version !== it.version) return [409, { error: 'changed elsewhere since you opened it', item: full(it) }]
        it.version++
      }
      if ('kind' in change && (change.kind === 'board') !== (it.kind === 'board')) return [400, { error: 'a board stays a board, and nothing else becomes one' }]
      const next = { ...it, ...change }
      if (trashed !== undefined) next.deleted_at = trashed ? (it.deleted_at ?? now()) : null
      const msg = settle(next, change)
      if (msg) return [400, { error: msg }]
      Object.assign(it, next, { updated_at: now() })
      return [200, full(it)]
    }],
    ['DELETE', /^\/v1\/items\/([^/]+)$/, (req, m, q) => {
      const it = find(m[1])
      if (!it) return [404, { error: 'not found' }]
      if (q.get('permanent') === '1') {
        if (!it.deleted_at) return [404, { error: 'not found' }]
        items.splice(items.indexOf(it), 1)
      } else {
        it.deleted_at = now()
      }
      return [204]
    }],
    ['POST', /^\/v1\/items\/([^/]+)\/links$/, async (req, m) => {
      const { to } = await body(req)
      if (!links.some((l) => l.from === m[1] && l.to === to)) links.push({ from: m[1], to })
      return [204]
    }],
    ['DELETE', /^\/v1\/items\/([^/]+)\/links\/([^/]+)$/, (req, m) => {
      const i = links.findIndex((l) => (l.from === m[1] && l.to === m[2]) || (l.from === m[2] && l.to === m[1]))
      if (i < 0) return [404, { error: 'not found' }]
      links.splice(i, 1)
      return [204]
    }],
  ]
}
