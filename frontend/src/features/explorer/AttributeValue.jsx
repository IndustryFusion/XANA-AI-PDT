import { EntityRef } from '../../app/EntityRef'
import { formatTime } from '../../ui/format'
import { attributeKind, iriOf } from './attributes'

const leaf = (v) => (typeof v === 'string' ? v : JSON.stringify(v))

/** JSON value as a labelled tree; keys are shown as they are. */
export function JsonTree({ value }) {
  if (value === null || typeof value !== 'object') return <span className="mono">{leaf(value)}</span>
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value)
  if (entries.length === 0) return <span className="muted">{Array.isArray(value) ? 'Empty list' : 'Empty object'}</span>
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) {
    return <ul className="attr-list">{value.map((v, i) => <li key={i}><span className="mono">{leaf(v)}</span></li>)}</ul>
  }
  return (
    <dl className="json-tree">
      {entries.map(([k, v]) => (
        <div key={k} className="json-tree__entry">
          <dt className="mono">{Array.isArray(value) ? `[${k}]` : k}</dt>
          <dd><JsonTree value={v} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Scalar({ value, unit }) {
  if (value === null || value === undefined || value === '') return <span className="muted">No value</span>
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>
  if (typeof value === 'object') return <JsonTree value={value} />
  return <span className="attr-value__scalar">{String(value)}{unit ? <span className="attr-value__unit"> {unit}</span> : null}</span>
}

function Geo({ value }) {
  if (value?.type === 'Point' && Array.isArray(value.coordinates)) {
    const [lon, lat] = value.coordinates
    return (
      <span>
        Point · {Math.abs(lat).toFixed(4)}° {lat >= 0 ? 'N' : 'S'}, {Math.abs(lon).toFixed(4)}° {lon >= 0 ? 'E' : 'W'}
      </span>
    )
  }
  return (
    <span>
      {value?.type ?? 'Geometry'}{Array.isArray(value?.coordinates) ? ` with ${value.coordinates.length} coordinates` : ''}
    </span>
  )
}

/**
 * Value presentation of one attribute instance, chosen by its kind.
 * `refTo(id)` builds explorer URLs for relationship targets and IRIs.
 */
export default function AttributeValue({ attr, refTo }) {
  const kind = attributeKind(attr)
  if (kind === 'relationship') {
    const targets = [].concat(attr.object ?? attr.objectList?.map((o) => o.object ?? o) ?? [])
    return <span className="row">{targets.map((t) => <EntityRef key={t} id={t} label={t} to={refTo?.(t)} />)}</span>
  }
  if (kind === 'iri') {
    const target = iriOf(attr.value)
    return <EntityRef id={target} label={target} to={refTo?.(target)} />
  }
  if (kind === 'geo') return <Geo value={attr.value} />
  if (kind === 'json') return <JsonTree value={attr.json} />
  if (kind === 'language') {
    return (
      <dl className="lang-map">
        {Object.entries(attr.languageMap ?? {}).map(([lang, text]) => (
          <div key={lang} className="lang-map__entry"><dt className="mono">{lang}</dt><dd lang={lang}>{text}</dd></div>
        ))}
      </dl>
    )
  }
  if (kind === 'list') {
    const items = attr.valueList ?? []
    return items.length === 0
      ? <span className="muted">Empty list</span>
      : <ol className="attr-list">{items.map((v, i) => <li key={i}><Scalar value={v} /></li>)}</ol>
  }
  if (kind === 'vocabulary') return <span className="mono">{String(attr.vocab)}</span>
  if (kind === 'property') return <Scalar value={attr.value} unit={attr.unitCode} />
  return <JsonTree value={attr} />
}

/** Compact metadata line: unit, observation time, dataset. */
export function AttributeMeta({ attr }) {
  const items = []
  if (attr.unitCode) items.push(<span key="unit">Unit {attr.unitCode}</span>)
  if (attr.observedAt) items.push(<span key="obs">Observed <time dateTime={attr.observedAt}>{formatTime(attr.observedAt)}</time></span>)
  if (attr.datasetId) items.push(<span key="ds">Dataset <span className="mono">{attr.datasetId}</span></span>)
  if (attr.lang) items.push(<span key="lang">Language {attr.lang}</span>)
  return items.length ? <span className="attr-meta">{items}</span> : null
}
