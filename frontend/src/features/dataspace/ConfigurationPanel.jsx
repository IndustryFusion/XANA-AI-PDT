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

import { useData } from '../../data/useData'
import { Card, DataView, StatusBadge } from '../../ui/components'

/** The gateway and registry configuration as the backend has it: addresses, realm, client and state. No secret. */
export default function ConfigurationPanel({ state, refreshKey }) {
  const result = useData('dataspace', 'getConnectionConfig', [], { refreshKey })
  return (
    <Card title="Configuration" className="dataspace-config">
      <DataView result={result} errorTitle="Could not load the configuration">
        {(c) => (
          <dl className="details">
            <dt>Connection</dt><dd>{state ? <StatusBadge kind="connection" value={state} /> : '—'}</dd>
            <dt>Gateway</dt><dd className="mono">{c.gatewayUrl ?? 'Not configured'}</dd>
            <dt>Identity provider</dt><dd className="mono">{c.keycloakUrl ?? 'Not configured'}</dd>
            <dt>Realm</dt><dd className="mono">{c.realm}</dd>
            <dt>Client ID</dt><dd className="mono">{c.clientId ?? '—'}</dd>
            <dt>IFRIC registry</dt><dd className="mono">{c.registryUrl ?? 'Not configured'}</dd>
          </dl>
        )}
      </DataView>
    </Card>
  )
}
