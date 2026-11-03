import { AVAILABLE_SOURCES } from '../data'
import { Link, paths } from './router'

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
