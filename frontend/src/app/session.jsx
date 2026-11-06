//
// Copyright (c) 2026 IndustryFusion Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { session as sessionApi } from '../data'
import { ErrorState, LoadingState } from '../ui/components'
import SignInScreen from './SignInScreen'

export const SESSION_CHECK_MS = 60_000
/** How often to look for a backend that could not be reached when the UI loaded. */
export const BACKEND_CHECK_MS = 10_000

const SessionContext = createContext(null)

/**
 * Shows the sign-in screen when authentication is enabled and there is no
 * valid session; otherwise renders the application. The session is re-checked
 * periodically. The URL is left untouched, so after signing in (again) the
 * operator is on the screen they requested.
 */
export function SessionGate({ children, checkIntervalMs = SESSION_CHECK_MS }) {
  const [state, setState] = useState({ phase: 'loading', authConfig: null, session: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const [signOutError, setSignOutError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const authConfig = await sessionApi.getAuthConfig()
        const current = await sessionApi.getSession()
        if (cancelled) return
        const signedIn = !authConfig.enabled || current.valid
        setState({ phase: signedIn ? 'ready' : 'signin', authConfig, session: current, error: null })
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', authConfig: null, session: null, error })
      }
    }
    load()
    return () => { cancelled = true }
  }, [attempt])

  const authEnabled = state.authConfig?.enabled ?? false
  const backendUnreachable = state.authConfig?.backendUnreachable ?? false

  useEffect(() => {
    if (state.phase !== 'ready' || !backendUnreachable || !checkIntervalMs) return undefined
    const id = setInterval(async () => {
      try {
        const authConfig = await sessionApi.getAuthConfig()
        if (!authConfig.backendUnreachable) setAttempt((a) => a + 1)
      } catch {
        // Still out of reach; check again later.
      }
    }, Math.min(checkIntervalMs, BACKEND_CHECK_MS))
    return () => clearInterval(id)
  }, [state.phase, backendUnreachable, checkIntervalMs])

  useEffect(() => {
    if (state.phase !== 'ready' || !authEnabled || !checkIntervalMs) return undefined
    const id = setInterval(async () => {
      try {
        const current = await sessionApi.getSession()
        setState((s) => ({ ...s, phase: current.valid ? s.phase : 'signin', session: current }))
      } catch {
        // A failed check is not proof of expiry; keep working and check again later.
      }
    }, checkIntervalMs)
    return () => clearInterval(id)
  }, [state.phase, authEnabled, checkIntervalMs])

  const signIn = useCallback(async (credentials) => {
    const current = await sessionApi.signIn(credentials)
    setState((s) => ({ ...s, phase: 'ready', session: current }))
  }, [])

  const signOut = useCallback(async () => {
    setSignOutError(null)
    try {
      await sessionApi.signOut()
      setState((s) => ({ ...s, phase: 'signin', session: null }))
    } catch (error) {
      setSignOutError(error) // the session may still be active, so the sign-in screen would mislead
    }
  }, [])

  if (state.phase === 'loading') {
    return <main className="center-screen"><LoadingState label="Checking session…" /></main>
  }
  if (state.phase === 'error') {
    return (
      <main className="center-screen">
        <ErrorState title="Cannot check your session" error={state.error} onRetry={() => setAttempt((a) => a + 1)} />
      </main>
    )
  }
  if (state.phase === 'signin') {
    return <SignInScreen provider={state.authConfig?.provider} onSignIn={signIn} />
  }

  return (
    <SessionContext.Provider value={{ session: state.session, authEnabled, backendUnreachable, signOut, signOutError, checkIntervalMs }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
