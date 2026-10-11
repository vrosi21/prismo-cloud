// An invitation link is the site's address with ?invite=<token>. The token is
// kept for the length of the browser session, because signing in means a trip
// to Google and back, and the address bar does not survive that.

const KEY = 'prismo.invite'

/** Moves a token from the address bar into session storage, once. */
export function captureInvite(): void {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('invite')
  if (!token) return
  try {
    sessionStorage.setItem(KEY, token)
  } catch {
    /* storage blocked: the notice shows on this page load only */
  }
  params.delete('invite')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  pending = token
}

let pending: string | null = null

export function inviteToken(): string | null {
  if (pending) return pending
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetInvite(): void {
  pending = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to forget */
  }
}
