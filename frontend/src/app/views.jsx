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
