import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { api, ApiError } from './api'
import { Backdrop } from './components/Backdrop'
import { Shell } from './components/Shell'
import { BmoFace, Cube } from './components/sprites'
import { forgetInvite, inviteToken } from './lib/invite'
import { errorText } from './lib/log'
import { useMe } from './lib/queries'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { SharedHome, SharedItems, SharedJar } from './pages/Shared'

// After signing in from an invitation link: go straight to what was shared.
// Only if it really is shared with this account; the owner opening their own
// link, or someone signed in as the wrong person, stays where they are.
function InviteLanding() {
  const navigate = useNavigate()
  useEffect(() => {
    const token = inviteToken()
    if (!token) return
    forgetInvite()
    void Promise.all([api.invite(token), api.shared()])
      .then(([invite, shared]) => {
        if (invite.collection_id && shared.jars.some((j) => j.id === invite.collection_id)) {
          navigate(`/shared/jar/${invite.collection_id}`, { replace: true })
        } else if (invite.asset_id && shared.items.some((i) => i.id === invite.asset_id)) {
          navigate('/shared/items', { replace: true })
        }
      })
      .catch(() => {
        /* invitation withdrawn meanwhile: nothing to go to */
      })
  }, [navigate])
  return null
}

export function App() {
  const me = useMe()
  // Latched on purpose. While "who am I" is being re-asked its error is
  // cleared for a moment; deriving this straight from the query would swap
  // the sign-in form out and back in, wiping whatever was typed into it.
  const [signedOut, setSignedOut] = useState(false)
  const unauthorized = me.error instanceof ApiError && me.error.status === 401
  useEffect(() => {
    if (me.data) setSignedOut(false)
    else if (unauthorized) setSignedOut(true)
  }, [me.data, unauthorized])

  // A guest has no library: only what others shared with them.
  const member = me.data?.member ?? false

  return (
    <>
      <Backdrop />
      {me.data ? (
        <Shell me={me.data}>
          <InviteLanding />
          <Routes>
            <Route path="/" element={member ? <Library /> : <SharedHome />} />
            <Route path="/shared/jar/:id" element={<SharedJar />} />
            <Route path="/shared/items" element={<SharedItems />} />
            {member && <Route path="/trash" element={<Library trashed />} />}
            <Route path="/settings" element={<Settings me={me.data} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      ) : signedOut ? (
        <Login />
      ) : (
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
          {me.isError ? (
            <>
              <BmoFace mood="sad" scale={5} />
              <p className="text-danger">&gt; {errorText(me.error)}</p>
              <button type="button" className="btn" onClick={() => void me.refetch()}>
                try again
              </button>
            </>
          ) : (
            <Cube size={64} label="loading" />
          )}
        </div>
      )}
    </>
  )
}
