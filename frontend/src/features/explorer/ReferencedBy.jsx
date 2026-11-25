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

import { useId } from 'react'
import { Link } from '../../app/router'
import { useData } from '../../data/useData'
import { Button } from '../../ui/components'
import { IconButton } from '../../ui/icons'
import { MAX_DEPTH, datasetLabel } from './AttributeLine'
import { displayName } from './attributes'
import { Iri, shortenText, useRegistry } from './Iri'
import { entityPath } from './query'
import { referrersKey, useKept, useUnnested } from './store'

/** The address of the referring entity, at the attribute it refers from. */
const placeHref = (id, path, query) => {
  const base = entityPath(id, query)
  return `${base}${base.includes('?') ? '&' : '?'}focus=${encodeURIComponent(JSON.stringify(path))}`
}

/**
 * The entities that refer to `id`, the way up the hierarchy: each with the
 * attributes it refers from, a link to it at that attribute, and an icon that
 * expands it in place. An entity expanded here has its own list of referring
 * entities, so the way up goes on from there.
 */
export default function ReferencedBy({ id, title, ctx, refreshKey }) {
  const reg = useRegistry()
  const heading = useId()
  const key = referrersKey(ctx.nodeKey)
  const [nested, setNested] = useKept(`${key}|nested`, [])
  const unnested = useUnnested()
  const result = useData('entities', 'listReferrers', [id], { refreshKey })
  const list = result.data
  const limited = list?.limited
  const toggle = (target) => setNested((open) => (open.includes(target) ? open.filter((t) => t !== target) : [...open, target]))

  let content = null
  if (!list) {
    content = result.status === 'error' ? null : <p className="muted" role="status">Searching all entities…</p>
  } else if (list.length === 0) {
    content = <p className="muted" role="status">No {limited ? 'searched ' : ''}entity refers to this one.</p>
  } else {
    content = (
      <ul className="entity-doc" aria-label={`Entities that refer to ${title}`}>
        {list.map((entity) => {
          const name = displayName(entity)
          const short = reg.shorten(entity.id)
          const out = unnested.find((u) => u.id === entity.id && u.origin?.level === key)
          const open = nested.includes(entity.id) && !out
          return (
            <li key={entity.id} className="attr-item" data-referrer={entity.id}>
              <div className="attr-line">
                <span className="kind-tag kind-tag--neutral"><Iri value={[].concat(entity.type)[0]} /></span>
                {name && <span className="attr-line__name">{name}</span>}
                <span className="attr-line__value mono"><Iri value={entity.id} to={ctx.refTo(entity.id)} /></span>
                {out ? (
                  <IconButton icon="goTo" tone="muted" label={`Go to ${short}, moved out of the tree`} onClick={() => ctx.goTo(entity.id)} />
                ) : ctx.chain.includes(entity.id) ? (
                  <span className="attr-line__marker">shown above</span>
                ) : ctx.depth < MAX_DEPTH ? (
                  <IconButton
                    icon={open ? 'collapse' : 'expand'} tone="muted" aria-expanded={open}
                    label={`Expand ${short} in place`} onClick={() => toggle(entity.id)}
                  />
                ) : (
                  <span className="attr-line__marker">nesting limit</span>
                )}
                <span className="attr-line__end referrer__places">
                  <span className="attr-line__meta">by</span>
                  {entity.references.map(({ path, datasetId }) => (
                    <Link
                      key={JSON.stringify([path, datasetId])} className="mono referrer__place" to={placeHref(entity.id, path, ctx.query)}
                      title={path.join('\n')}
                    >
                      {path.map((level) => reg.shorten(level)).join('.')}{datasetId ? `[${datasetLabel(datasetId)}]` : ''}
                    </Link>
                  ))}
                </span>
              </div>
              {open && !ctx.chain.includes(entity.id) && (
                <div className="attr-line__nested">
                  {ctx.renderNested(entity.id, { key, level: key, parent: id, attribute: '[]' })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="referrers" aria-labelledby={heading}>
      <p id={heading} className="referrers__title">Referenced by{list ? ` (${list.length})` : ''}</p>
      {limited && (
        <p className="muted" role="status">
          Only the first {limited.scanned}{limited.total ? ` of ${limited.total}` : ''} entities were searched, so there may be more.
        </p>
      )}
      {result.status === 'error' && (
        <div role="alert">
          <p>Could not find the entities that refer to this one{list ? ' now; the list may be out of date' : ''}: {shortenText(result.error?.message)}</p>
          <Button size="sm" onClick={result.retry}>Retry</Button>
        </div>
      )}
      {content}
    </section>
  )
}
