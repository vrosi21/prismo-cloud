import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { errorText } from '../lib/log'
import { Cube, Prismo } from '../components/sprites'

// Reasons the server may give when it sends the browser back from Google.
const REFUSALS: Record<string, string> = {
  not_allowed: 'that google account is not on the guest list.',
  cancelled: 'sign-in was cancelled.',
  expired: 'sign-in took too long. try again.',
  invalid: "google's answer could not be verified. try again.",
  server: 'the server had a problem. try again.',
}

// Read once, then cleaned out of the address bar so a reload does not show
// an old error again.
function takeRefusal(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return null
  params.delete('auth_error')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return REFUSALS[code] ?? 'sign-in did not work. try again.'
}

export function Login() {
  const qc = useQueryClient()
  const [refusal] = useState(takeRefusal)
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, staleTime: Infinity, retry: 1 })

  const dev = useMutation({
    mutationFn: api.devLogin,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const nothingOffered = config.data && !config.data.google && !config.data.dev

  return (
    <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-[720px] flex-col items-center gap-8 md:flex-row md:items-end md:gap-12">
        <div className="hidden md:block">
          <Prismo scale={9} />
        </div>
        <div className="panel px-raised flex w-full max-w-[400px] flex-col gap-5 p-6">
          <div className="flex items-center gap-4">
            <Cube size={34} />
            <div>
              <h1>PRISMO CLOUD</h1>
              <p className="dim">&gt; enter the time room</p>
            </div>
          </div>

          {refusal && (
            <p className="text-danger" role="alert">
              &gt; {refusal}
            </p>
          )}
          {config.isError && (
            <p className="text-danger" role="alert">
              &gt; {errorText(config.error)}
            </p>
          )}
          {dev.isError && (
            <p className="text-danger" role="alert">
              &gt; {errorText(dev.error)}
            </p>
          )}
          {nothingOffered && <p className="text-danger">&gt; sign-in is not set up on this server yet.</p>}

          {/* A plain link: signing in is a trip to Google and back, not a request from this page. */}
          {config.data?.google && (
            <a className="btn btn-accent" href="/v1/auth/google/start">
              continue with google
            </a>
          )}
          {config.data?.dev && (
            <button type="button" className="btn" disabled={dev.isPending} onClick={() => dev.mutate()}>
              {dev.isPending ? 'opening...' : 'development sign-in'}
            </button>
          )}
          {config.isPending && <p className="dim cursor">&gt; asking the wishmaster</p>}
        </div>
      </div>
    </div>
  )
}
