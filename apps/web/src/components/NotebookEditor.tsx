import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Mathematics from '@tiptap/extension-mathematics'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// A notebook page: rich text to look at and type into, Markdown underneath.
// What is saved is Markdown with $inline$ and $$block$$ LaTeX, so a page can
// be read anywhere, and the "md" button shows exactly that text to edit by
// hand. Typing Markdown works too: "# " is a heading, "- [ ] " a checkbox,
// $$x^2$$ becomes a formula. "/" at the start of a line opens a menu of blocks.

interface Props {
  value: string
  onChange?: (markdown: string) => void
  editable?: boolean
  /** Smaller, for the side panel. */
  compact?: boolean
  placeholder?: string
}

type Ask = { title: string; value: string; math?: boolean; onSave: (value: string) => void }

interface Block {
  id: string
  label: string
  hint: string
  run: (e: Editor) => void
}

export default function NotebookEditor({ value, onChange, editable = true, compact = false, placeholder = 'write here. "/" for blocks, $$x^2$$ for maths.' }: Props) {
  const [source, setSource] = useState(false)
  // The Markdown shown while editing it by hand.
  const [sourceText, setSourceText] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  // The Markdown this editor last produced, to tell our own echo from news.
  const emitted = useRef(value)
  const slashKeys = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const changed = useRef(onChange)
  changed.current = onChange

  const editor = useEditor({
    editable,
    content: value,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({ link: { openOnClick: !editable, autolink: true } }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: {
          onClick: (node, pos) =>
            editable &&
            setAsk({ title: 'formula', math: true, value: node.attrs.latex, onSave: (latex) => editorRef.current?.chain().focus().updateInlineMath({ latex, pos }).run() }),
        },
        blockOptions: {
          onClick: (node, pos) =>
            editable &&
            setAsk({ title: 'formula', math: true, value: node.attrs.latex, onSave: (latex) => editorRef.current?.chain().focus().updateBlockMath({ latex, pos }).run() }),
        },
      }),
    ],
    editorProps: {
      // The "/" menu takes arrows, Enter and Escape while it is open.
      handleKeyDown: (_view, event) => slashKeys.current(event),
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown()
      emitted.current = md
      changed.current?.(md)
    },
  })
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  // A new value from outside (another tab won, a different item): show it.
  useEffect(() => {
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  const blocks = useMemo<Block[]>(
    () => [
      { id: 'h1', label: 'heading 1', hint: '#', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
      { id: 'h2', label: 'heading 2', hint: '##', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { id: 'h3', label: 'heading 3', hint: '###', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
      { id: 'ul', label: 'list', hint: '-', run: (e) => e.chain().focus().toggleBulletList().run() },
      { id: 'ol', label: 'numbered list', hint: '1.', run: (e) => e.chain().focus().toggleOrderedList().run() },
      { id: 'todo', label: 'checklist', hint: '- [ ]', run: (e) => e.chain().focus().toggleTaskList().run() },
      { id: 'quote', label: 'quote', hint: '>', run: (e) => e.chain().focus().toggleBlockquote().run() },
      { id: 'code', label: 'code', hint: '```', run: (e) => e.chain().focus().toggleCodeBlock().run() },
      {
        id: 'math',
        label: 'formula block',
        hint: '$$',
        run: (e) => setAsk({ title: 'formula', math: true, value: '', onSave: (latex) => latex && e.chain().focus().insertBlockMath({ latex }).run() }),
      },
      {
        id: 'imath',
        label: 'formula in the line',
        hint: '$',
        run: (e) => setAsk({ title: 'formula', math: true, value: '', onSave: (latex) => latex && e.chain().focus().insertInlineMath({ latex }).run() }),
      },
      { id: 'table', label: 'table', hint: '|', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: 'hr', label: 'line', hint: '---', run: (e) => e.chain().focus().setHorizontalRule().run() },
    ],
    [],
  )

  const slash = useSlashMenu(editor, blocks, editable && !source)
  slashKeys.current = slash.onKey

  if (!editor) return null
  return (
    <div className={`notebook ${compact ? 'notebook-compact' : ''}`}>
      {editable && (
        <Toolbar
          editor={editor}
          source={source}
          onSource={() => {
            if (source) editor.commands.setContent(emitted.current, { contentType: 'markdown', emitUpdate: false })
            else setSourceText(emitted.current)
            setSource(!source)
          }}
          onAsk={setAsk}
        />
      )}
      {source ? (
        <textarea
          className="notebook-source field"
          spellCheck={false}
          value={sourceText}
          aria-label="markdown"
          onChange={(e) => {
            setSourceText(e.target.value)
            emitted.current = e.target.value
            changed.current?.(e.target.value)
          }}
        />
      ) : (
        <div
          className="notebook-page"
          // A click below the text (or beside it) carries on writing at the end, like a page.
          onMouseDown={(e) => {
            if (!editable || (e.target as HTMLElement).closest('.tiptap, .nb-slash')) return
            e.preventDefault()
            editor.commands.focus('end')
          }}
        >
          <EditorContent editor={editor} />
          {slash.menu}
        </div>
      )}
      {ask && <AskBox ask={ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function Toolbar({ editor, source, onSource, onAsk }: { editor: Editor; source: boolean; onSource: () => void; onAsk: (a: Ask) => void }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      ul: e.isActive('bulletList'),
      ol: e.isActive('orderedList'),
      todo: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      block: e.isActive('codeBlock'),
      link: e.isActive('link'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  })
  const c = () => editor.chain().focus()
  const B = ({ k, title, run, children }: { k?: keyof typeof on; title: string; run: () => void; children: ReactNode }) => (
    <button
      type="button"
      className="nb-tool"
      aria-pressed={k ? Boolean(on[k]) : undefined}
      title={title}
      disabled={source}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {children}
    </button>
  )
  const selected = () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')
  return (
    <div className="nb-toolbar" role="toolbar" aria-label="formatting">
      <B k="bold" title="bold (ctrl+b)" run={() => c().toggleBold().run()}>
        <b>B</b>
      </B>
      <B k="italic" title="italic (ctrl+i)" run={() => c().toggleItalic().run()}>
        <i>I</i>
      </B>
      <B k="strike" title="strike through" run={() => c().toggleStrike().run()}>
        <s>S</s>
      </B>
      <B k="code" title="code (ctrl+e)" run={() => c().toggleCode().run()}>
        {'<>'}
      </B>
      <span className="nb-sep" />
      <B k="h1" title="heading" run={() => c().toggleHeading({ level: 1 }).run()}>
        H1
      </B>
      <B k="h2" title="smaller heading" run={() => c().toggleHeading({ level: 2 }).run()}>
        H2
      </B>
      <B k="ul" title="list" run={() => c().toggleBulletList().run()}>
        •
      </B>
      <B k="ol" title="numbered list" run={() => c().toggleOrderedList().run()}>
        1.
      </B>
      <B k="todo" title="checklist" run={() => c().toggleTaskList().run()}>
        [x]
      </B>
      <B k="quote" title="quote" run={() => c().toggleBlockquote().run()}>
        &gt;
      </B>
      <B k="block" title="code block" run={() => c().toggleCodeBlock().run()}>
        {'{}'}
      </B>
      <span className="nb-sep" />
      <B
        title="formula in the line: $x$"
        run={() => {
          const text = selected()
          onAsk({ title: 'formula', math: true, value: text, onSave: (latex) => latex && c().insertInlineMath({ latex }).run() })
        }}
      >
        ∑
      </B>
      <B title="formula block: $$x$$" run={() => onAsk({ title: 'formula', math: true, value: selected(), onSave: (latex) => latex && c().insertBlockMath({ latex }).run() })}>
        ∫
      </B>
      <B title="table" run={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        ⊞
      </B>
      <B
        k="link"
        title="link"
        run={() => {
          const href = (editor.getAttributes('link').href as string | undefined) ?? ''
          onAsk({
            title: 'link address',
            value: href,
            onSave: (url) => (url ? c().extendMarkRange('link').setLink({ href: url }).run() : c().extendMarkRange('link').unsetLink().run()),
          })
        }}
      >
        ⛓
      </B>
      <span className="nb-sep" />
      <B title="undo (ctrl+z)" run={() => c().undo().run()}>
        ↶
      </B>
      <B title="redo (ctrl+shift+z)" run={() => c().redo().run()}>
        ↷
      </B>
      <span className="flex-1" />
      <button type="button" className="nb-tool" aria-pressed={source} title="the markdown underneath, to edit by hand" onClick={onSource}>
        md
      </button>
    </div>
  )
}

/** A small box for one value: a link, or a formula with its preview. */
function AskBox({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [value, setValue] = useState(ask.value)
  const preview = useMemo(() => {
    if (!ask.math || !value.trim()) return ''
    return katex.renderToString(value, { throwOnError: false, displayMode: true })
  }, [ask.math, value])
  const save = () => {
    ask.onSave(value.trim())
    onClose()
  }
  return (
    <div className="panel px-raised nb-ask" role="dialog" aria-label={ask.title}>
      <span className="label">{ask.title}</span>
      {ask.math ? (
        <textarea
          className="field font-mono"
          rows={3}
          autoFocus
          value={value}
          placeholder="\frac{a}{b}"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
            if (e.key === 'Escape') onClose()
          }}
        />
      ) : (
        <input
          className="field"
          autoFocus
          value={value}
          placeholder="https://"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onClose()
          }}
        />
      )}
      {/* KaTeX output: built from the formula, never from raw HTML. */}
      {preview && <div className="nb-preview" dangerouslySetInnerHTML={{ __html: preview }} />}
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-accent" onClick={save}>
          {ask.math ? 'done (ctrl+enter)' : 'done'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          cancel
        </button>
      </div>
    </div>
  )
}

/**
 * "/" at the start of an empty line opens a menu of blocks; typing narrows it,
 * arrows pick, Enter takes, Escape closes. The "/word" typed is removed
 * before the block is made.
 */
function useSlashMenu(editor: Editor | null, blocks: Block[], enabled: boolean) {
  const [state, setState] = useState<{ query: string; from: number; to: number; top: number; left: number } | null>(null)
  const [index, setIndex] = useState(0)
  const live = useRef({ state, index, shown: [] as Block[] })

  const shown = state ? blocks.filter((b) => b.label.includes(state.query.toLowerCase()) || b.id.startsWith(state.query.toLowerCase())) : []
  live.current = { state, index, shown }

  useEffect(() => {
    if (!editor || !enabled) return
    const look = () => {
      const { $from, empty } = editor.state.selection
      const text = $from.parent.textContent
      const m = empty && $from.parent.isTextblock && /^\/([a-z0-9 ]{0,20})$/i.exec(text)
      if (!m || $from.parentOffset !== text.length) {
        setState(null)
        return
      }
      if (editor.isDestroyed || !editor.isInitialized) return
      const at = editor.view.coordsAtPos($from.pos)
      const box = (editor.view.dom.closest('.notebook-page') as HTMLElement | null)?.getBoundingClientRect()
      setState({ query: m[1], from: $from.start(), to: $from.pos, top: at.bottom - (box?.top ?? 0) + 4, left: at.left - (box?.left ?? 0) })
      setIndex(0)
    }
    editor.on('transaction', look)
    return () => {
      editor.off('transaction', look)
    }
  }, [editor, enabled])

  const take = (b: Block) => {
    const s = live.current.state
    if (!editor || !s) return
    editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run()
    setState(null)
    b.run(editor)
  }

  /** Keys while the menu is open; true when the menu used the key. */
  const onKey = (e: KeyboardEvent): boolean => {
    const { state: s, index: i, shown: list } = live.current
    if (!s || list.length === 0) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setIndex((i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      take(list[Math.min(i, list.length - 1)])
    } else if (e.key === 'Escape') {
      setState(null)
    } else {
      return false
    }
    e.preventDefault()
    return true
  }

  const menu =
    state && shown.length > 0 ? (
      <ul className="panel px-raised nb-slash" role="listbox" style={{ top: state.top, left: state.left }}>
        {shown.map((b, i) => (
          <li key={b.id} role="option" aria-selected={i === index}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => take(b)}>
              <span>{b.label}</span>
              <span className="dim">{b.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null
  return { menu, onKey }
}
