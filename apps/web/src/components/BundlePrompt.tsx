import { useEffect, useState } from 'react'
import prompt from '../bundle-prompt.md?raw'
import { log } from '../lib/log'

// The instructions a Claude session needs to write a bundle Prismo can
// import (lib/bundle.ts): copied from here, put under a prompt, and what
// comes back goes in through "import". One text, src/bundle-prompt.md.

export function BundlePrompt({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      log('ok', 'the prompt is in the clipboard')
    } catch {
      log('err', 'could not copy; select the text and copy it')
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-8" role="dialog" aria-modal="true" aria-label="prompt for an import file">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="panel px pop relative flex max-h-full w-full max-w-[860px] flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="uppercase">prompt for an import file</h2>
          <span className="flex-1" />
          <button type="button" className="btn btn-sm btn-accent" onClick={() => void copy()}>
            {copied ? 'copied' : 'copy'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">
            x
          </button>
        </div>
        <p className="dim">
          &gt; put this under what you ask a Claude session for ("my exam dates are...", "a board for my trip"), save the JSON it answers with as a .json file, and add it
          with "import". Everything in it is added as new.
        </p>
        <pre className="bundle-prompt">{prompt}</pre>
      </div>
    </div>
  )
}
