import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { ApiError } from './api'
import { Backdrop } from './components/Backdrop'
import { Shell } from './components/Shell'
import { BmoFace, Cube } from './components/sprites'
import { errorText } from './lib/log'
import { useMe } from './lib/queries'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'

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

  return (
    <>
      <Backdrop />
      {me.data ? (
        <Shell me={me.data}>
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/trash" element={<Library trashed />} />
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
