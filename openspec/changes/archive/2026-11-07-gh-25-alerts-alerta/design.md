# Design

## Findings: what was checked first

From the platform's charts, rule templates and bridge, and a real Alerta (9.0.4, the platform's version).

| Question | Finding | Consequence |
|---|---|---|
| `resource` | The platform's rule templates set `this AS resource`, the full entity ID, such as `urn:plasmacutter-test:12345`. | The filter sends the full ID. |
| The filter | `GET /alerts?resource=<full id>` matches exactly. A prefix of the ID matches nothing. A test uses an alert in the rules' form: event `ClassConstraintComponent(...)`, environment `Development`, service `SHACL Validator`. | Confirmed. The agent always passes full IDs. |
| Key authentication | The platform's bridge sends `Authorization: Key <key>`, and Alerta accepted it. A wrong key answers 401. | As the issue says. A rejected key is a 502 with a message that says so, and doesn't count as the operator's sign-in failing. |
| `/api` | Without it, the web UI answers HTML with 200. | Checked at startup. |
| Free text | **`q` is a query language, and text is not safe in it.** `urn:other:2` gives a 500, because the part before `:` is taken as a column. Quoted, it finds nothing. | See decision 2. |
| Actions | `PUT /alert/{id}/action` answers only `{"status": "ok"}`. A wrong status gives 409. **An unknown action gives 200** and records a note. | The route checks the action itself, then reads the alert back. |
| Lists | `/alerts` holds `severityCounts` for its own filter, and `history` is empty. | The severity bar calls `/alerts/count` without the severity filter. |
| Severities | The platform's map adds `up` and `down`, which the UI didn't know. Local Alerta needs the same setting to accept them. | Added to the UI's severities. |
| History types | `new`, `ack`, `action`, `shelve`, `unshelve`, `close`, `open`, `note`, `status`, `severity`. | Mapped to the interface's `new`, `note` and `status`. |

## Decisions

### 1. Interface shape in the backend

The backend answers in the interface's terms: one page with `total` and `bySeverity`, alerts without history, names for `environments` and `services`. Keys under `attributes` aren't changed.

### 2. Free text is filtered in the backend

With a search text, the backend reads up to 1000 alerts matching the other filters, keeps those containing the text in ID, resource, event, text, value or service, ignoring case, and pages the result. When the cap was reached, `searchLimited` and `searched` say so, and the Alerts screen says that the numbers count only those. It reads in the chosen order, so what it misses is the least severe or the oldest. **Alternative:** build regular expressions in `q`: this keeps the query language, its failure modes and a column name taken from input.

### 3. A wrong `ALERTA_URL` stops the backend

This is how other invalid settings behave. A URL without a scheme gets `http://`, so the issue's default form works. **Alternative:** reporting it only on the alerts routes: easier to miss.

### 4. The agent's alerts

- A read-only source, offering only GET.
- For the machine and up to 5 related entities, read in parallel with a 5 second limit each. "Up to 5 related" is read as not counting the machine itself.
- Duplicates are removed by alert ID.
- `weight = 0.5 ^ (age in hours / 24)`, from the last time it was received, multiplied by a factor for severity. Sorted by weight, at most 20.
- A failing entity adds nothing, and the source shows `unavailable` with how many failed, and the round continues. It doesn't mark the data as partial when another entity answered. It does when all failed, or no key is configured and Alerta refuses.
- The step's output holds `alerts`, and the state holds them for #28.
- The alert source is optional, so the workflow stays usable on its own.
- Alert text comes from the platform, and is treated as data, like other text in prompts. It goes in the observations section, and the step has no tools it could misuse.

**Alternatives:** weight by age alone puts a fresh warning above a day-old critical alert; a fixed cut-off discards evidence.

### 5. Actions are operators' only

Only the `/api/alerta` route calls the action route. Tests check that a round sends only GET to Alerta.

### 6. Refresh interval

`ALERTS_REFRESH_INTERVAL_S` (default 30) is the UI's default interval, from `/api/alerta/config`, unless the operator chose one. `autoRefresh` from Alerta isn't used.

## Risks and limits

- **Open API.** While the shared session stands, anyone who can reach the backend can act on alerts, with the configured key (see #36). Alerta records the key's owner as the user, so actions aren't attributed to an operator.
- **Rules were not run through the platform.** The test alert has the form from the rule templates and is sent the way the bridge sends it. Flink and Kafka did not run.
