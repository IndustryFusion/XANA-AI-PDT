import { AVAILABLE_SOURCES } from '../data'
import { Link, NAV_ITEMS, paths, useRoute } from './router'

/** Shown when the configured data source does not exist in this build. */
export function ConfigError({ error }) {
  return (
    <main className="center-screen">
      <div className="card config-error" role="alert">
        <div className="card__body stack">
          <h1>Configuration error</h1>
          <p>
            The setting <code>{error.setting}</code> is <code>{error.value}</code>, which is not a data source in this build.
          </p>
          <p>Accepted values: {AVAILABLE_SOURCES.map((s) => <code key={s}>{s}</code>)}</p>
        </div>
      </div>
    </main>
  )
}

export function NotFound() {
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Page not found</h1>
      <p className="muted">There is no screen at this address.</p>
      <p><Link to={paths.dashboard()}>Go to the dashboard</Link></p>
    </section>
  )
}

/** Change of issue #3 that delivers each area. */
const DELIVERED_BY = {
  dataspace: 'gh-3-ui-dataspace-system',
  system: 'gh-3-ui-dataspace-system',
}

/** Stand-in for an area delivered by a later change. */
export function Placeholder() {
  const { area, params, query } = useRoute()
  const label = NAV_ITEMS.find((n) => n.area === area)?.label ?? area
  const item = Object.entries(params)[0]
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{label}</h1>
      <div className="card placeholder">
        <div className="card__body stack">
          <p><strong>{label} is not available yet.</strong></p>
          <p className="muted">This area is delivered by the change <code>{DELIVERED_BY[area]}</code>.</p>
          {(item || query.machine) && (
            <dl className="details">
              {item && <><dt>{item[0]}</dt><dd className="mono">{item[1]}</dd></>}
              {query.machine && <><dt>{query.new ? 'New incident for machine' : 'Machine'}</dt><dd className="mono">{query.machine}</dd></>}
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}
