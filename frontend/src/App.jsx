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

import { useEffect } from 'react'
import { configError, DevControls } from './data'
import Header from './app/Header'
import { RouterProvider, useRoute } from './app/router'
import { SessionGate } from './app/session'
import { ConfigError, NotFound } from './app/views'
import Alerts from './features/alerts/Alerts'
import Dashboard from './features/dashboard/Dashboard'
import Dataspace from './features/dataspace/Dataspace'
import DataExplorer from './features/explorer/DataExplorer'
import IncidentHistory from './features/history/IncidentHistory'
import ActiveIncidents from './features/incidents/ActiveIncidents'
import System from './features/system/System'
import { ToastProvider } from './ui/components'
import { ThemeProvider } from './ui/theme'
import './ui/tokens.css'
import './ui/base.css'
import './ui/ui.css'
import './app/app.css'

/** Already signed in: the sign-in URL leads to the dashboard. */
function SignInRedirect() {
  const { navigate } = useRoute()
  useEffect(() => { navigate('/', { replace: true }) }, [navigate])
  return null
}

function AreaContent() {
  const { area } = useRoute()
  if (area === 'signin') return <SignInRedirect />
  if (area === 'dashboard') return <Dashboard />
  if (area === 'incidents') return <ActiveIncidents />
  if (area === 'history') return <IncidentHistory />
  if (area === 'explorer') return <DataExplorer />
  if (area === 'alerts') return <Alerts />
  if (area === 'dataspace') return <Dataspace />
  if (area === 'system') return <System />
  return <NotFound />
}

function Shell() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main" className="app-main" tabIndex={-1}>
        <AreaContent />
      </main>
    </>
  )
}

export default function App({ sessionCheckMs }) {
  if (configError) {
    return (
      <ThemeProvider>
        <ConfigError error={configError} />
      </ThemeProvider>
    )
  }
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider>
          <SessionGate checkIntervalMs={sessionCheckMs}>
            <Shell />
          </SessionGate>
        </RouterProvider>
        {DevControls && <DevControls />}
      </ToastProvider>
    </ThemeProvider>
  )
}
