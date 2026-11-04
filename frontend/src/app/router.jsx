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

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Small History-API router. Every area and selected item has its own URL;
 * the route table is flat, so a routing library is not needed.
 */
export const ROUTES = [
  { area: 'dashboard', pattern: '/' },
  { area: 'incidents', pattern: '/incidents' },
  { area: 'incidents', pattern: '/incidents/:runId' },
  { area: 'history', pattern: '/history' },
  { area: 'history', pattern: '/history/:incidentId' },
  { area: 'explorer', pattern: '/explorer' },
  { area: 'explorer', pattern: '/explorer/:entityId' },
  { area: 'alerts', pattern: '/alerts' },
  { area: 'alerts', pattern: '/alerts/:alertId' },
  { area: 'dataspace', pattern: '/dataspace' },
  { area: 'system', pattern: '/system' },
  { area: 'signin', pattern: '/signin' },
]

/** Main navigation entries, in display order. */
export const NAV_ITEMS = [
  { area: 'dashboard', label: 'Dashboard', path: '/' },
  { area: 'incidents', label: 'Active incidents', path: '/incidents' },
  { area: 'explorer', label: 'Data explorer', path: '/explorer' },
  { area: 'alerts', label: 'Alerts', path: '/alerts' },
  { area: 'history', label: 'Incident history', path: '/history' },
  { area: 'dataspace', label: 'Dataspace', path: '/dataspace' },
  { area: 'system', label: 'System', path: '/system' },
]

const enc = encodeURIComponent

/** Builders for every URL the UI links to. */
export const paths = {
  dashboard: () => '/',
  incidents: () => '/incidents',
  run: (runId) => `/incidents/${enc(runId)}`,
  newIncident: (machineId, issue) => `/incidents?new=1${machineId ? `&machine=${enc(machineId)}` : ''}${issue ? `&issue=${enc(issue)}` : ''}`,
  activeIncidentsFor: (machineId) => `/incidents?machine=${enc(machineId)}`,
  history: () => '/history',
  incident: (incidentId) => `/history/${enc(incidentId)}`,
  historyFor: (machineId) => `/history?machine=${enc(machineId)}`,
  explorer: () => '/explorer',
  entity: (entityId) => `/explorer/${enc(entityId)}`,
  alerts: () => '/alerts',
  alert: (alertId) => `/alerts/${enc(alertId)}`,
  dataspace: () => '/dataspace',
  system: () => '/system',
}

/** Matches a pathname against the route table: `{ area, params }` or null. */
export function matchRoute(pathname) {
  const parts = splitPath(pathname)
  for (const route of ROUTES) {
    const pattern = splitPath(route.pattern)
    if (pattern.length !== parts.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) {
        try { params[pattern[i].slice(1)] = decodeURIComponent(parts[i]) } catch { ok = false; break }
      } else if (pattern[i] !== parts[i]) { ok = false; break }
    }
    if (ok) return { area: route.area, params }
  }
  return null
}

function splitPath(path) {
  return path.split('/').filter(Boolean)
}

const RouterContext = createContext(null)

function currentLocation() {
  return { pathname: window.location.pathname, search: window.location.search }
}

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(currentLocation)

  useEffect(() => {
    const onPop = () => setLocation(currentLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * Goes to `to`. Moving to another area starts at the top of the page;
   * within an area (selecting an item, changing a filter) the page keeps its
   * scroll position. `scroll: true | false` overrides this.
   */
  const navigate = useCallback((to, { replace = false, scroll } = {}) => {
    const url = new URL(to, window.location.origin)
    const next = { pathname: url.pathname, search: url.search }
    const toTop = scroll ?? matchRoute(url.pathname)?.area !== matchRoute(window.location.pathname)?.area
    if (replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLocation(next)
    if (toTop) window.scrollTo?.(0, 0)
  }, [])

  const value = useMemo(() => {
    const match = matchRoute(location.pathname)
    return {
      ...location,
      area: match?.area ?? null,
      params: match?.params ?? {},
      query: Object.fromEntries(new URLSearchParams(location.search)),
      navigate,
    }
  }, [location, navigate])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRoute() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRoute must be used inside RouterProvider')
  return ctx
}

/** In-app link: plain anchor for the browser, client-side navigation on click. */
export function Link({ to, onClick, children, ...props }) {
  const { navigate } = useRoute()
  function handleClick(e) {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handleClick} {...props}>{children}</a>
}
