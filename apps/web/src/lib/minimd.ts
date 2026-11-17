import katex from 'katex'

// Just enough Markdown for a sticky note or a card: headings, lists,
// **bold**, *italic*, `code`, [links](https://...) and $formulas$. Safe by
// construction: the text is escaped first, so only the tags made here exist.
// A full page uses the notebook editor instead.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(raw: string): string {
  // Formulas first, out of the way of the other rules.
  const maths: string[] = []
  let s = raw.replace(/\$([^$\n]+)\$/g, (_, tex: string) => {
    maths.push(katex.renderToString(tex, { throwOnError: false }))
    return `\u0000${maths.length - 1}\u0000`
  })
  s = esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => maths[Number(i)])
}

export function miniMarkdown(text: string): string {
  const out: string[] = []
  let list: 'ul' | null = null
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const line of text.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^\s*[-*]\s+(\[( |x)\]\s+)?(.*)$/.exec(line)
    if (h) {
      closeList()
      out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`)
    } else if (li) {
      if (!list) out.push('<ul>')
      list = 'ul'
      const box = li[1] ? `<span class="mini-box">${li[2] === 'x' ? '[x]' : '[ ]'}</span> ` : ''
      out.push(`<li>${box}${inline(li[3])}</li>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return out.join('')
}

/**
 * A few words from the start of a text, for a card or a tile: headings,
 * tables and formula blocks left out, Markdown marks taken off.
 */
export function plainExcerpt(md: string, max = 140): string {
  const out: string[] = []
  let inMath = false
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (t === '$$' || (t.startsWith('$$') && !t.endsWith('$$'))) {
      inMath = !inMath
      continue
    }
    if (inMath || !t || t.startsWith('#') || t.startsWith('|') || t.startsWith('$$')) continue
    out.push(t.replace(/^[-*>]\s+(\[[ x]\]\s+)?/, '').replace(/[*_`~]/g, '').replace(/\$([^$]+)\$/g, '$1'))
    if (out.join(' ').length > max) break
  }
  const text = out.join(' ')
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}
