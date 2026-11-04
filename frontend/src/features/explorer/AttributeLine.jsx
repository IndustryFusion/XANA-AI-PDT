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

import { useId, useState } from 'react'
import { EntityRef, entityLabel } from '../../app/EntityRef'
import { entities } from '../../data'
import { formatTime } from '../../ui/format'
import {
  attributeKind, editableValue, hasHistory, instancesOf, iriOf, kindInfo, parseInput, subAttributesOf, targetsOf,
} from './attributes'
import AttributeValue from './AttributeValue'
import AddAttributeForm from './AddAttributeForm'
import HistoryPane from './HistoryPane'
import ValueEditor from './ValueEditor'

/** Deepest nesting of relationship targets expanded in place. */
export const MAX_DEPTH = 5

/** Kind label, tinted per kind; the text is always present. */
export function KindBadge({ kind }) {
  const info = kindInfo(kind)
  return <span className={`kind-tag kind-tag--${info.tone}`}>{info.label}</span>
}

const Space = () => ' '

function ActionButton({ label, children, ...props }) {
  return <button type="button" className="line-action" aria-label={label} {...props}>{children}</button>
}

/**
 * Relationship targets as entity references, each with a toggle that expands
 * the target in place, or a marker when the target is already shown above in
 * this branch of the tree.
 */
function Targets({ attr, ctx, open, onToggle }) {
  return (
    <span className="attr-line__targets">
      {targetsOf(attr).map((target) => (
        <span key={target} className="attr-line__target">
          <EntityRef id={target} label={target} to={ctx.refTo(target)} />
          {ctx.chain.includes(target) ? (
            <span className="attr-line__marker">shown above</span>
          ) : ctx.depth < MAX_DEPTH ? (
            <button
              type="button" className="line-action line-action--expand" aria-expanded={open.includes(target)}
              aria-label={`Expand ${target} in place`} onClick={() => onToggle(target)}
            >
              <span aria-hidden="true">{open.includes(target) ? '▾' : '▸'}</span> expand
            </button>
          ) : (
            <span className="attr-line__marker">nesting limit</span>
          )}
        </span>
      ))}
    </span>
  )
}

/**
 * One line of the entity document: kind label, name, `=`, value, unit,
 * observation time and the line's actions. `sub` names a sub-attribute of
 * the attribute `name`. Selecting an editable value edits it in place.
 */
function Line({ name, sub, inst, ctx, actions, first, onAddSub, addingSub }) {
  const [editing, setEditing] = useState(false)
  const [subsOpen, setSubsOpen] = useState(false)
  const [nested, setNested] = useState([])
  const subsId = useId()
  const kind = attributeKind(inst)
  const label = sub ? `sub-attribute ${sub} of ${name}` : name
  const shownName = sub ?? name
  const editable = actions && !ctx.readOnly && editableValue(inst)
  const subs = sub ? [] : subAttributesOf(inst)
  const changed = !sub && ctx.changed

  async function save(text) {
    const [member] = editable
    const value = parseInput(text, inst[member], member)
    await entities.updateAttributes(ctx.entityId, sub
      ? { [name]: { [sub]: { ...inst, [member]: value } } }
      : { [name]: { [member]: value } })
    setEditing(false)
    ctx.onSaved(sub ? `${name}.${sub}` : name)
  }

  const toggleNested = (target) => setNested((list) => (list.includes(target) ? list.filter((t) => t !== target) : [...list, target]))
  const linkValue = kind === 'relationship' || kind === 'iri'
  const [member, current] = editable || []
  const initial = member === 'value' && iriOf(inst.value) ? iriOf(inst.value) : current

  let value
  if (editing) {
    value = (
      <ValueEditor
        label={sub ? `${sub} of ${name}` : name} initial={initial} entityType={ctx.entityType} attribute={shownName}
        onSave={save} onCancel={() => setEditing(false)}
      />
    )
  } else if (kind === 'relationship') {
    value = <Targets attr={inst} ctx={ctx} open={nested} onToggle={toggleNested} />
  } else if (editable && !linkValue) {
    value = (
      <button type="button" className="attr-line__value-btn" onClick={() => setEditing(true)}>
        <span className="visually-hidden">Value of {label}: </span><AttributeValue attr={inst} refTo={ctx.refTo} />
      </button>
    )
  } else {
    value = <AttributeValue attr={inst} refTo={ctx.refTo} />
  }

  return (
    <>
      <div className={`attr-line${changed ? ' attr-line--changed' : ''}`}>
        <KindBadge kind={kind} /><Space />
        <span className="attr-line__name mono">{shownName}</span><Space />
        <span className="tok tok--punct" aria-hidden="true">=</span><Space />
        <div className="attr-line__value mono">{value}</div><Space />
        {inst.unitCode && !editing && <><span className="attr-line__unit">{inst.unitCode}</span><Space /></>}
        {inst.datasetId && <><span className="attr-line__meta" title={inst.datasetId}>dataset {entityLabel(inst.datasetId)}</span><Space /></>}
        {inst.lang && <><span className="attr-line__meta">lang {inst.lang}</span><Space /></>}
        {changed && <><span className="attr-line__changed">Updated</span><Space /></>}
        {subs.length > 0 && (
          <button
            type="button" className="line-action line-action--subs" aria-expanded={subsOpen}
            aria-controls={subsOpen ? subsId : undefined} onClick={() => setSubsOpen((o) => !o)}
          >
            <span aria-hidden="true">{subsOpen ? '▾' : '▸'}</span> {subs.length} sub-attribute{subs.length === 1 ? '' : 's'}
            <span className="visually-hidden"> of {name}</span>
          </button>
        )}
        <span className="attr-line__end">
          {inst.observedAt && (
            <span className="attr-line__time"><span className="visually-hidden">Observed </span><time dateTime={inst.observedAt}>{formatTime(inst.observedAt)}</time></span>
          )}
          {actions && (
            <span className="attr-line__actions">
              {!sub && first && hasHistory(inst) && (
                <ActionButton label={`History of ${name}`} aria-pressed={ctx.historyOpen} onClick={() => ctx.onHistory(name)}>History</ActionButton>
              )}
              {editable && !editing && <ActionButton label={sub ? `Edit sub-attribute ${sub} of ${name}` : `Edit ${name}`} onClick={() => setEditing(true)}>Edit</ActionButton>}
              {!ctx.readOnly && onAddSub && (
                <ActionButton label={`Add sub-attribute to ${name}`} aria-expanded={addingSub} onClick={onAddSub}>Add sub</ActionButton>
              )}
              {!ctx.readOnly && (
                <ActionButton label={sub ? `Delete sub-attribute ${sub} of ${name}` : `Delete ${name}`} className="line-action line-action--danger" onClick={() => ctx.onDelete(name, sub)}>
                  Delete
                </ActionButton>
              )}
            </span>
          )}
        </span>
      </div>
      {nested.length > 0 && (
        <div className="attr-line__nested">
          {nested.map((target) => <div key={target}>{ctx.renderNested(target)}</div>)}
        </div>
      )}
      {subsOpen && subs.length > 0 && (
        <ul id={subsId} className="attr-subs" aria-label={`Sub-attributes of ${name}`}>
          {subs.map(([subName, subAttr]) => (
            <li key={subName} data-attribute={`${name}.${subName}`}>
              <Line name={name} sub={subName} inst={subAttr} ctx={ctx} actions />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * One attribute of the entity document: a line per instance (several for
 * multi-attributes with dataset IDs), its history pane and the form that
 * adds a sub-attribute.
 */
export default function AttributeLine({ name, attr, ctx }) {
  const [addingSub, setAddingSub] = useState(false)
  const instances = instancesOf(attr)
  const multi = Array.isArray(attr)

  return (
    <li className="attr-item" data-attribute={name}>
      {instances.map((inst, i) => (
        <Line
          key={inst.datasetId ?? i} name={name} inst={inst} ctx={{ ...ctx, readOnly: ctx.readOnly || multi }}
          actions={i === 0} first={i === 0}
          addingSub={addingSub}
          onAddSub={!multi && !ctx.readOnly ? () => setAddingSub((a) => !a) : null}
        />
      ))}
      {multi && !ctx.readOnly && (
        <div className="attr-line attr-line--note">
          <span className="muted">{instances.length} instances; edit them in the raw JSON.</span>
          <span className="attr-line__end">
            <span className="attr-line__actions">
              <ActionButton label={`Delete ${name}`} className="line-action line-action--danger" onClick={() => ctx.onDelete(name)}>Delete</ActionButton>
            </span>
          </span>
        </div>
      )}
      {addingSub && (
        <AddAttributeForm
          entityId={ctx.entityId} parent={name} label={`Add a sub-attribute to ${name}`}
          onCancel={() => setAddingSub(false)}
          onAdded={(n) => { setAddingSub(false); ctx.onSaved(n) }}
        />
      )}
      {ctx.historyOpen && (
        <HistoryPane entityId={ctx.entityId} name={name} unit={instances[0]?.unitCode} headingLevel={ctx.headingLevel + 1} onClose={() => ctx.onHistory(name)} />
      )}
    </li>
  )
}
