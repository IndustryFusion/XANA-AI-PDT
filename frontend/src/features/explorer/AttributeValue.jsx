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

import { EntityRef } from '../../app/EntityRef'
import { attributeKind, iriOf } from './attributes'

/** A JSON value written inline with syntax colouring: strings, numbers, booleans and null differ. */
export function JsonValue({ value, lang }) {
  if (value === null || value === undefined) return <span className="tok tok--null">null</span>
  if (typeof value === 'string') return <span className="tok tok--string" lang={lang}>&quot;{value}&quot;</span>
  if (typeof value === 'number') return <span className="tok tok--number">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="tok tok--boolean">{String(value)}</span>
  if (Array.isArray(value)) {
    return (
      <span className="tok-group">
        <span className="tok tok--punct">{value.length ? '[ ' : '['}</span>
        {value.map((v, i) => (
          <span key={i}><JsonValue value={v} />{i < value.length - 1 && <span className="tok tok--punct">, </span>}</span>
        ))}
        <span className="tok tok--punct">{value.length ? ' ]' : ']'}</span>
      </span>
    )
  }
  const entries = Object.entries(value)
  return (
    <span className="tok-group">
      <span className="tok tok--punct">{entries.length ? '{ ' : '{'}</span>
      {entries.map(([k, v], i) => (
        <span key={k}>
          <span className="tok tok--key">{k}</span><span className="tok tok--punct">: </span><JsonValue value={v} />
          {i < entries.length - 1 && <span className="tok tok--punct">, </span>}
        </span>
      ))}
      <span className="tok tok--punct">{entries.length ? ' }' : '}'}</span>
    </span>
  )
}

function Geo({ value }) {
  if (value?.type === 'Point' && Array.isArray(value.coordinates)) {
    const [lon, lat] = value.coordinates
    return (
      <span className="tok tok--geo">
        Point · {Math.abs(lat).toFixed(4)}° {lat >= 0 ? 'N' : 'S'}, {Math.abs(lon).toFixed(4)}° {lon >= 0 ? 'E' : 'W'}
      </span>
    )
  }
  return (
    <span className="tok tok--geo">
      {value?.type ?? 'Geometry'}{Array.isArray(value?.coordinates) ? ` with ${value.coordinates.length} coordinates` : ''}
    </span>
  )
}

function LanguageMap({ map }) {
  const entries = Object.entries(map ?? {})
  return (
    <span className="tok-group">
      <span className="tok tok--punct">{entries.length ? '{ ' : '{'}</span>
      {entries.map(([lang, text], i) => (
        <span key={lang}>
          <span className="tok tok--key">{lang}</span><span className="tok tok--punct">: </span><JsonValue value={text} lang={lang} />
          {i < entries.length - 1 && <span className="tok tok--punct">, </span>}
        </span>
      ))}
      <span className="tok tok--punct">{entries.length ? ' }' : '}'}</span>
    </span>
  )
}

/**
 * Value of one attribute instance, presented by its kind. IRI values are
 * entity references; `refTo(id)` builds their explorer URLs. Relationship
 * targets are rendered by the attribute line, which can also expand them.
 */
export default function AttributeValue({ attr, refTo }) {
  const kind = attributeKind(attr)
  if (kind === 'iri') {
    const target = iriOf(attr.value)
    return <EntityRef id={target} label={target} to={refTo?.(target)} />
  }
  if (kind === 'geo') return <Geo value={attr.value} />
  if (kind === 'json') return <JsonValue value={attr.json} />
  if (kind === 'language') return <LanguageMap map={attr.languageMap} />
  if (kind === 'list') return <JsonValue value={attr.valueList ?? []} />
  if (kind === 'vocabulary') return <span className="tok tok--vocab">{String(attr.vocab)}</span>
  if (kind === 'property') return <JsonValue value={attr.value} />
  const { type: _type, ...rest } = attr
  return <JsonValue value={rest} />
}
