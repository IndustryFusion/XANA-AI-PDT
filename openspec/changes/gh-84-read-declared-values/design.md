# Design

## Context

The IFF Digital Twin platform declares its doubles
(IndustryFusion/DigitalTwin#961, PR IndustryFusion/DigitalTwin#962). Measured on
Scorpio 0.10 (the platform's build) and 6.0.2 (the newest release), which behave
the same:

| Write | GET or notification, `application/json` |
|---|---|
| upsert, declared `0.0` | `{"type": "…#double", "@value": 0}` |
| batch merge or merge entity, plain `42.5` | `{"type": "…#double", "@value": 42.5}`, the stored type kept |
| batch merge, string `"42.5"` (the live path's form) | `{"type": "…#double", "@value": "42.5"}` |
| `PATCH …/attrs`, plain `42.5` | `42.5`, the type dropped |

The read form is JSON-LD as specified: a value object becomes a bare number
only through a context term that declares its type, and the core context has
none. That the merge keeps the stored type is Scorpio's behaviour, and it
could change.

How XANA reads values today:

| Where | Today | With a declared double |
|---|---|---|
| Agent: attribute value, facts, signals | plain values, language maps, IRIs | dropped from the signals; facts carry JSON |
| Explorer API: local query evaluation | plain values and `{"@id": …}` | ranges, comparisons and patterns don't match |
| Explorer API: edit check | numeric if the stored value is a plain number | text accepted for a double |
| Event trigger | already unwraps `@value` | fine |
| Data explorer: kind, editable value, input parsing, change detection, display | plain values and `{"@id": …}` | raw object shown, not editable, spurious "Updated" |
| History, time-shift, agent history | TimescaleDB, `value` and `valueType` separately | not affected |

## Decisions

### D1 — One reading, one helper per side

- **Chosen:** one backend function and one Data explorer function read a
  property value into its plain value. Every place listed above uses it; the
  event trigger's own unwrapping moves to it, so there is one reading.
  - **Backend:** the function lives in the agent package, which the
    application already imports.
  - **Frontend:** it sits beside the existing value helpers of the Data
    explorer.
- *Alternative:* unwrap once, where entities enter XANA (broker client, live
  stream). Rejected:
  - the raw form has to stay available for the conversation tools and the
    escalation export, which hand the entity on as it is;
  - edits must know the stored datatype.
- *Alternative:* fix each place on its own. Rejected: the forms (`type` or
  `@type`, a number or a number string) would be handled several times, and
  differently.

### D2 — Which forms count

- **Chosen:** a dictionary with `@value`, its datatype under `type` or
  `@type`, read as `@value`. A string `@value` becomes a number when the
  datatype is a numeric XSD type (double, float, decimal, integer and its
  subtypes), and a boolean for `xsd:boolean`. Anything else is unchanged:
  plain values, IRI references, language maps, JSON values.
- *Alternative:* coerce any numeric-looking string. Rejected: a plain string
  property such as a serial number `"00042"` would become a number.

### D3 — An edit sends the declared value

- **Chosen:** when the stored value was declared, an in-place edit sends
  `{"@value": <the number entered>, "@type": <the stored datatype, as a full IRI>}`.
- *Alternative:* send the plain number and rely on the broker keeping the
  type. Rejected: that is the merge behaviour the platform's contract says not
  to depend on; with a replacing update the type is lost.
- The raw JSON editor sends what the operator wrote, as today.

### D4 — The edit check reads the plain value

- **Chosen:** the "must be a number" check compares the plain values, so a
  declared number is protected like a plain one.
- **Why it matters:** without it, the broker would store the text typed as a
  double -- a value no reader can use.

## Conflicts

None with architecture.md or the existing specs. The new requirements add to
*Edit attributes and entities* and *Query and browse* (explorer API), *Observe
the machine* (diagnostic workflow), and *Edit attributes* and *Live updates*
(Data explorer), without changing them.

## Risks

- **The broker's own query evaluation** (`q` handled by Scorpio, not XANA) on
  declared values is not XANA's to change. The real-broker test records how
  it behaves for `temperature>40` on a declared `"42.5"`.
- **Order:** declared values must not reach a broker XANA reads before this
  change is deployed. The platform's PR IndustryFusion/DigitalTwin#962 names
  this issue as the gate.
