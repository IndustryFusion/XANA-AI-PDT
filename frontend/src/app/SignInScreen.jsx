import { useState } from 'react'
import { sourceInfo } from '../data'
import { Button } from '../ui/components'
import { ProductMark } from './Brand'

const MESSAGES = {
  unauthorized: 'Username or password is not correct.',
  unavailable: 'The identity provider could not be reached. Try again in a moment.',
}

export default function SignInScreen({ provider, onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSignIn({ username, password })
    } catch (err) {
      setError(MESSAGES[err?.kind] ?? MESSAGES.unavailable)
      setBusy(false)
    }
  }

  return (
    <main className="center-screen">
      <form className="signin card" onSubmit={submit} aria-labelledby="signin-title">
        <div className="signin__brand">
          <ProductMark />
          <div>
            <h1 id="signin-title" className="signin__title">XANA AI PDT</h1>
            <p className="muted">Process Digital Twin</p>
          </div>
        </div>
        {provider && <p className="muted">Sign in with {provider}</p>}
        <label className="field">
          <span className="field__label">Username</span>
          <input name="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="signin__error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        {sourceInfo?.signInHint && <p className="muted signin__hint">{sourceInfo.signInHint}</p>}
      </form>
    </main>
  )
}
